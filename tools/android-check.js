'use strict';
// Checks the Android app on an emulator against a throwaway server (never the real one).
//   node tools/android-check.js APK OUT_DIR
// The APK is a test build pointed at the emulator's view of this machine:
//   (cd android && ./gradlew assembleDebug -PjewberUrl=http://10.0.2.2:8526)
// Env: ADB (path), SERIAL (default emulator-5590). The page is driven over the WebView's
// DevTools; notifications are read from dumpsys and tapped through uiautomator.
//
// Driver: signs in in the app, goes on duty -> the service runs with its notification, GPS
// fixes reach the server with the app in front AND in the background, a request rings with
// Accept / Can't, Accept from the shade accepts it, Go off duty from the shade stops it all.
// Friend: signs in, asks for a ride, leaves the app -> "on the way", "is here", "You're here".
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

const [APK, OUT = 'android-check'] = process.argv.slice(2);
const ADB = process.env.ADB || path.join(os.homedir(), '.cache/kavana-build/sdk/platform-tools/adb');
const SERIAL = process.env.SERIAL || 'emulator-5590';
const PKG = 'xyz.tiresia.jewber.debug';
const PORT = 8526;
fs.mkdirSync(OUT, { recursive: true });
const root = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(process.env.JEWBER_TEST_TMP || os.tmpdir(), 'jewber-android-'));
const env = { ...process.env, JEWBER_STATE: dir, JEWBER_PORT: String(PORT), JEWBER_HOSTS: '127.0.0.1', JEWBER_MAIL: 'outbox', JEWBER_NOTIFY: '', JEWBER_OSRM: 'http://127.0.0.1:9', JEWBER_URL: 'http://10.0.2.2:8526' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const adb = (...a) => execFileSync(ADB, ['-s', SERIAL, ...a], { maxBuffer: 64 << 20 }).toString();
const sh = (cmd) => adb('shell', cmd);
let n = 0;
const ok = (what) => console.log(`  ok ${++n}. ${what}`);
const shot = (name) => fs.writeFileSync(path.join(OUT, `${name}.png`), execFileSync(ADB, ['-s', SERIAL, 'exec-out', 'screencap', '-p'], { maxBuffer: 64 << 20 }));
const state = () => JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
const code = (email) => fs.readFileSync(path.join(dir, 'outbox.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((m) => m.to === email).at(-1).subject.match(/\d{6}/)[0];
async function until(what, fn, ms = 20000) {
  const t = Date.now();
  let last;
  while (Date.now() - t < ms) { try { last = await fn(); if (last) return last; } catch (e) { last = e.message; } await sleep(500); }
  throw new Error(`never: ${what} (${String(last).slice(0, 200)})`);
}
const notes = () => sh('dumpsys notification --noredact');
const serviceUp = () => /LiveService/.test(sh(`dumpsys activity services ${PKG}`));

// ---- the page, over DevTools
let ws, seq = 0;
const pending = new Map();
async function attach() {
  const sock = await until('a WebView to debug', () => {
    const pid = sh(`pidof ${PKG}`).trim().split(/\s+/)[0];
    return pid && sh('cat /proc/net/unix').includes(`webview_devtools_remote_${pid}`) ? `webview_devtools_remote_${pid}` : null;
  });
  const local = 9500 + Math.floor(Math.random() * 300);
  adb('forward', `tcp:${local}`, `localabstract:${sock}`);
  const page = await until('the page target', async () => (await (await fetch(`http://127.0.0.1:${local}/json`)).json()).find((t) => t.type === 'page'));
  if (ws) ws.close();
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
}
function evaluate(expr) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } }));
  return new Promise((r) => pending.set(id, (m) => r(m.result && m.result.result ? m.result.result.value : undefined)));
}
const text = () => evaluate('document.body.innerText');
const click = (sel) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (el) el.click(); return !!el; })()`);
async function signIn(email) {
  await until('the sign-in page', async () => (await text() || '').includes('Send code'));
  await evaluate(`(() => { const el = document.querySelector('#email'); el.value = ${JSON.stringify(email)}; el.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('form.signin').requestSubmit(); })()`);
  await until('the code box', async () => (await text() || '').includes('Code') && fs.existsSync(path.join(dir, 'outbox.jsonl')));
  await sleep(500);
  await evaluate(`(() => { const el = document.querySelector('#code'); el.value = ${JSON.stringify(code(email))}; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
}

// ---- tapping a notification button through the shade
async function tapInShade(label) {
  sh('cmd statusbar expand-notifications');
  await sleep(1500);
  const xml = await until(`"${label}" in the shade`, () => {
    sh('uiautomator dump /sdcard/ui.xml');
    const x = sh('cat /sdcard/ui.xml');
    return x.includes(`text="${label}"`) || x.includes(`text="${label.toUpperCase()}"`) ? x : null;
  }, 15000);
  const re = new RegExp(`text="(?:${label}|${label.toUpperCase()})"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`);
  const m = xml.match(re);
  sh(`input tap ${(+m[1] + +m[3]) >> 1} ${(+m[2] + +m[4]) >> 1}`);
  await sleep(1500);
}

// ---- a client for the other side (plain API)
class Client {
  constructor() { this.cookie = ''; }
  async call(method, p, body) {
    const r = await fetch(`http://127.0.0.1:${PORT}${p}`, { method, headers: { 'X-Jewber': '1', 'Content-Type': 'application/json', Cookie: this.cookie }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie');
    if (sc) this.cookie = sc.split(';')[0];
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`${method} ${p} ${r.status} ${j.error}`);
    return j;
  }
  async signIn(email) { await this.call('POST', '/api/auth/code', { email }); await this.call('POST', '/api/auth/verify', { email, code: code(email) }); }
}

(async () => {
  execFileSync(process.execPath, [path.join(root, 'server.js'), 'driver', 'dovid@example.com', 'Dovid'], { env });
  execFileSync(process.execPath, [path.join(root, 'server.js'), 'friend', 'avi@example.com', 'Avi'], { env });
  const srv = spawn(process.execPath, [path.join(root, 'server.js')], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((r) => srv.stdout.on('data', (d) => { if (String(d).includes('jewber')) r(); }));
  try {
    adb('install', '-r', '-g', APK);
    sh(`pm grant ${PKG} android.permission.ACCESS_FINE_LOCATION`);
    sh(`pm grant ${PKG} android.permission.POST_NOTIFICATIONS`);
    sh(`cmd appops set ${PKG} RUN_ANY_IN_BACKGROUND allow`);
    adb('emu', 'geo', 'fix', '-112.0740', '33.4795');
    sh(`pm clear ${PKG}`);
    sh(`pm grant ${PKG} android.permission.ACCESS_FINE_LOCATION`);
    sh(`pm grant ${PKG} android.permission.POST_NOTIFICATIONS`);
    sh(`am start -W -n ${PKG}/xyz.tiresia.jewber.MainActivity`);
    await sleep(4000);
    await attach();
    ok('the app opens the page in its WebView');
    shot('01-signin');

    console.log('driver');
    await signIn('dovid@example.com');
    await until('the driver screen', async () => (await text() || '').includes('Off duty'));
    ok('the driver signs in inside the app (code by email)');
    assert.ok(state().sessions && Object.values(state().sessions).some((s) => s.kind === 'android'), 'an android session');
    await click('[data-act="duty"]');
    await until('the service', () => serviceUp());
    await until('the On duty notification', () => /On duty/.test(notes()));
    ok('on duty: the service runs, with its "On duty" notification');
    await until('a fix at the server', () => state().driver.loc && Math.abs(state().driver.loc.lat - 33.4795) < 0.001);
    ok('GPS reaches the server from the app');
    shot('02-on-duty');

    sh('input keyevent KEYCODE_HOME');
    await sleep(1500);
    adb('emu', 'geo', 'fix', '-112.0650', '33.4950');
    await until('a background fix', () => Math.abs(state().driver.loc.lat - 33.4950) < 0.001, 30000);
    ok('GPS keeps reaching the server with the app in the background');

    const avi = new Client();
    await avi.signIn('avi@example.com');
    const ride = (await avi.call('POST', '/api/rides', { pickup: { lat: 33.5005, lng: -112.065, label: 'Home' }, dropoff: { lat: 33.512, lng: -112.04, label: 'Shul' }, type: 'bubbe', pay: 'cashapp' })).ride;
    await until('the request notification', () => /Avi wants a Bubbe/.test(notes()));
    const nd = notes();
    assert.ok(/Home → Shul/.test(nd), 'pickup and drop-off in the notification');
    assert.ok(/Accept/.test(nd) && /Can't/.test(nd), 'Accept and Can\'t buttons');
    ok('a request rings, with Accept and Can\'t');
    sh('cmd statusbar expand-notifications');
    await sleep(1500);
    shot('03-request-in-shade');
    await tapInShade('Accept');
    await until('accepted', () => state().rides[ride.id].state === 'accepted');
    ok('Accept in the notification accepts the ride and opens the app');
    await attach();
    await until('the pickup screen', async () => (await text() || '').includes('Picking up Avi'));
    shot('04-picking-up');
    await until('the live notification follows the ride', () => /Picking up Avi/.test(notes()));
    ok('the On duty notification follows the ride');
    adb('emu', 'geo', 'fix', '-112.0650', '33.5005');
    await until('the arrival notification', () => /You're at Avi's pickup/.test(notes()), 40000);
    assert.ok(/I'm here/.test(notes()), 'I\'m here on it');
    ok('near the pickup: "You\'re at Avi\'s pickup" with I\'m here on it');

    await evaluate("fetch('/api/rides/" + ride.id + "/cancel', { method: 'POST', headers: { 'X-Jewber': '1' } })");
    await sleep(1000);
    sh('input keyevent KEYCODE_HOME');
    await tapInShade('Go off duty');
    await until('off duty at the server', () => state().driver.onDuty === false);
    await until('the service stops', () => !serviceUp());
    ok('Go off duty in the notification: off duty at the server, the service stops');

    console.log('friend');
    sh(`am start -W -n ${PKG}/xyz.tiresia.jewber.MainActivity`);
    await sleep(1500);
    await attach();
    await evaluate("fetch('/api/auth/out', { method: 'POST', headers: { 'X-Jewber': '1' } }).then(() => location.reload())");
    await sleep(2500);
    await attach();
    await signIn('avi@example.com');
    await until('the cancelled ride', async () => (await text() || '').includes('Dovid cancelled'));
    ok('a friend signs in inside the app and sees the ride the driver cancelled');
    await click('[data-act="ackRide"]');
    await until('the friend home', async () => (await text() || '').includes('Where to?'));
    const drv2 = new Client();
    await drv2.signIn('dovid@example.com');
    await drv2.call('POST', '/api/driver/duty', { on: true });
    await drv2.call('POST', '/api/driver/location', { lat: 33.49, lng: -112.07 });
    const r2 = await evaluate(`fetch('/api/rides', { method: 'POST', headers: { 'X-Jewber': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ pickup: { lat: 33.5005, lng: -112.065, label: 'Home' }, dropoff: { lat: 33.512, lng: -112.04, label: 'Shul' }, type: 'schlep', pay: 'cashapp' }) }).then((r) => r.json())`);
    await until('the friend service', () => serviceUp());
    ok('asking for a ride starts the ride notification');
    sh('input keyevent KEYCODE_HOME');
    await drv2.call('POST', `/api/rides/${r2.ride.id}/accept`);
    await until('"on the way"', () => /Dovid's on the way/.test(notes()));
    ok('with the app closed: "Dovid\'s on the way"');
    await drv2.call('POST', `/api/rides/${r2.ride.id}/here`);
    await until('"is here"', () => /Dovid is here/.test(notes()));
    ok('"Dovid is here"');
    sh('cmd statusbar expand-notifications');
    await sleep(1500);
    shot('05-friend-here');
    sh('cmd statusbar collapse');
    await drv2.call('POST', `/api/rides/${r2.ride.id}/start`);
    await drv2.call('POST', `/api/rides/${r2.ride.id}/end`);
    await until('"You\'re here"', () => /You're here/.test(notes()));
    await until('the friend service stops', () => !serviceUp());
    ok('"You\'re here" and the ride notification goes away');
    sh(`am start -a android.intent.action.VIEW -d "jewber://open?paid=ok" ${PKG}`);
    await sleep(1500);
    await attach();
    await until('the paid message', async () => (await text() || '').includes('Paid with PayPal'));
    ok('back from PayPal (jewber://open?paid=ok): the app opens and says it\'s paid');
    console.log(`\nall ${n} checks passed`);
  } catch (e) {
    try { console.error('screen says:', String(await text()).slice(0, 400)); shot('failed'); } catch {}
    throw e;
  } finally {
    try { sh('cmd statusbar collapse'); } catch {}
    try { ws && ws.close(); } catch {}
    await new Promise((r) => { srv.on('exit', r); srv.kill(); });
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => { console.error('\nFAILED:', e.message); process.exitCode = 1; });
