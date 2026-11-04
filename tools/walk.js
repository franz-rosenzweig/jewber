'use strict';
// Walks a whole ride through the real page in headless Chrome, a driver's phone and a friend's
// phone side by side, and screenshots every screen. Runs its own sandbox server (mail goes to an
// outbox) on localhost, so geolocation and the service worker work as on https.
//
//   node tools/walk.js OUT_DIR [CHROME]
// CHROME defaults to Playwright's headless shell. Routes and search use the real OSRM/Photon.
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const OUT = path.resolve(process.argv[2] || 'walk');
const CHROME = process.argv[3] || fs.readdirSync(path.join(os.homedir(), '.cache/ms-playwright')).filter((d) => d.startsWith('chromium_headless_shell')).sort().map((d) => path.join(os.homedir(), '.cache/ms-playwright', d, 'chrome-headless-shell-linux64/chrome-headless-shell')).at(-1);
fs.mkdirSync(OUT, { recursive: true });
const root = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(process.env.JEWBER_TEST_TMP || os.tmpdir(), 'jewber-walk-'));
const PORT = 18900 + Math.floor(Math.random() * 90);
const BASE = `http://localhost:${PORT}`;
const env = { ...process.env, JEWBER_STATE: dir, JEWBER_PORT: String(PORT), JEWBER_MAIL: 'outbox', JEWBER_NOTIFY: '', JEWBER_URL: BASE };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];

let ws, seq = 0;
const pending = new Map();
function cdp(method, params = {}, sessionId) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params, sessionId }));
  return new Promise((ok, no) => pending.set(id, { ok, no, method }));
}

async function phone(label, { width = 390, height = 844, lat, lng }) {
  const { browserContextId } = await cdp('Target.createBrowserContext', { disposeOnDetach: true });
  await cdp('Browser.grantPermissions', { origin: BASE, browserContextId, permissions: ['geolocation', 'notifications'] });
  const { targetId } = await cdp('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
  const s = (m, p) => cdp(m, p, sessionId);
  await s('Page.enable');
  await s('Runtime.enable');
  await s('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true });
  await s('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 15; SM-S921U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36' });
  await s('Emulation.setGeolocationOverride', { latitude: lat, longitude: lng, accuracy: 10 });
  const p = {
    label, sessionId, s,
    async go(url) { await s('Page.navigate', { url }); await sleep(2500); },
    async eval(expr) {
      const r = await s('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(`${label}: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
      return r.result.value;
    },
    async click(sel, i = 0) {
      const ok = await p.eval(`(() => { const el = document.querySelectorAll(${JSON.stringify(sel)})[${i}]; if (!el) return false; el.click(); return true; })()`);
      if (!ok) throw new Error(`${label}: nothing to click at ${sel}`);
      await sleep(700);
    },
    async type(sel, text) {
      await p.eval(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); el.focus(); el.value = ${JSON.stringify(text)}; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await sleep(300);
    },
    async has(text) { return p.eval(`document.body.innerText.includes(${JSON.stringify(text)})`); },
    async waitFor(text, ms = 15000) {
      const t = Date.now();
      while (Date.now() - t < ms) { if (await p.has(text)) return; await sleep(300); }
      throw new Error(`${label}: never saw "${text}". Screen says: ${(await p.eval('document.body.innerText')).slice(0, 300)}`);
    },
    async drag(x1, y1, x2, y2) {
      await s('Input.dispatchMouseEvent', { type: 'mousePressed', x: x1, y: y1, button: 'left', clickCount: 1 });
      for (let i = 1; i <= 12; i++) await s('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1 + ((x2 - x1) * i) / 12, y: y1 + ((y2 - y1) * i) / 12, button: 'left', buttons: 1 });
      await s('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x2, y: y2, button: 'left', clickCount: 1 });
      await sleep(400);
    },
    async moveTo(la, ln) { await s('Emulation.setGeolocationOverride', { latitude: la, longitude: ln, accuracy: 8 }); await sleep(1200); },
    async shot(name, wait = 1200) {
      await sleep(wait);
      const { data } = await s('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
      console.log('  shot', name);
    },
  };
  return p;
}

function code(email) {
  const lines = fs.readFileSync(path.join(dir, 'outbox.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  return lines.filter((m) => m.to === email).at(-1).subject.match(/\d{6}/)[0];
}

async function signIn(p, email) {
  await p.go(BASE);
  await p.shot(`${p.label}-00-signin`, 300);
  await p.type('#email', email);
  await p.eval("document.querySelector('form.signin').requestSubmit()");
  await p.waitFor('Code');
  await sleep(500);
  await p.type('#code', code(email));
  await sleep(2500);
}

(async () => {
  execFileSync(process.execPath, [path.join(root, 'server.js'), 'driver', 'dovid@example.com', 'Dovid'], { env });
  execFileSync(process.execPath, [path.join(root, 'server.js'), 'friend', 'avi@example.com', 'Avi'], { env });
  const srv = spawn(process.execPath, [path.join(root, 'server.js')], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((ok) => srv.stdout.on('data', (d) => { if (String(d).includes('jewber')) ok(); }));
  const dbg = 9330 + Math.floor(Math.random() * 60);
  const profile = fs.mkdtempSync(path.join(dir, 'chrome-'));
  const chrome = spawn(CHROME, [`--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`, '--no-sandbox', '--hide-scrollbars', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
  let wsUrl;
  for (let i = 0; i < 50 && !wsUrl; i++) {
    await sleep(200);
    try { wsUrl = (await (await fetch(`http://127.0.0.1:${dbg}/json/version`)).json()).webSocketDebuggerUrl; } catch {}
  }
  ws = new WebSocket(wsUrl);
  await new Promise((ok) => ws.addEventListener('open', ok));
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.no(new Error(`${p.method}: ${m.error.message}`)) : p.ok(m.result); return; }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value || a.description).join(' '));
  });

  try {
    // Somewhere in Phoenix: the driver a few blocks from the friend.
    const drv = await phone('driver', { lat: 33.4795, lng: -112.0740 });
    const avi = await phone('friend', { lat: 33.5089, lng: -112.0569 });

    await signIn(drv, 'dovid@example.com');
    await drv.waitFor('Off duty');
    await drv.shot('driver-01-off-duty');
    await drv.click('[data-act="go"][data-to="ledger"]');
    await drv.click('[data-act="mHandles"]');
    await drv.type('#m-cashapp', '$dovid'); await drv.type('#m-venmo', 'dovid'); await drv.type('#m-zelle', 'dovid@example.com');
    await drv.click('[data-act="saveHandles"]');
    await drv.click('[data-act="mCar"]');
    await drv.type('#m-car', 'Silver Corolla'); await drv.type('#m-plate', 'JWB 613'); await drv.type('#m-dphone', '555-0100');
    await drv.click('[data-act="saveSettings"]');
    await drv.click('[data-act="go"][data-to="dhome"]');
    await drv.click('[data-act="duty"]');
    await drv.waitFor('Waiting for requests');
    await drv.shot('driver-02-on-duty', 2500);

    await signIn(avi, 'avi@example.com');
    await avi.waitFor('Where to?');
    await avi.shot('friend-01-home', 3000);
    await avi.click('[data-act="whereTo"]');
    await avi.type('#f-drop', 'Desert Botanical Garden');
    await avi.waitFor('Botanical');
    await avi.shot('friend-02-where', 300);
    await avi.click('[data-act="pickResult"]');
    await avi.waitFor('Choose a ride');
    await avi.waitFor('Schlep');
    for (let i = 0; i < 40 && (await avi.eval("(document.querySelector('.type .price b') || {}).textContent")) === '…'; i++) await sleep(500);
    await avi.shot('friend-03-choose', 1200);
    // move the pickup with the pin: tap its label on the map, drag the map, set it
    await avi.eval("document.querySelector('.mk-tag.white').click()");
    await avi.waitFor('Set pickup');
    await sleep(1500);
    await avi.drag(195, 300, 150, 340);
    await sleep(2500);
    await avi.shot('friend-03b-pin', 300);
    await avi.click('[data-act="pinOk"]');
    await avi.waitFor('Choose a ride');
    await sleep(2500);
    await avi.click('[data-act="pickType"][data-id="bubbe"]');
    await avi.click('[data-act="request"]');
    await avi.waitFor('Asking Dovid');
    await avi.shot('friend-04-asking', 1500);

    await drv.waitFor('Accept');
    await drv.shot('driver-03-request', 1500);
    await drv.click('[data-act="accept"]');
    await drv.waitFor('Picking up Avi');
    await drv.shot('driver-04-picking-up', 4000);

    await avi.waitFor("Dovid's on the way");
    // the voice: catch what it says
    await drv.eval("window.__said = []; if (window.speechSynthesis) { speechSynthesis.speak = (u) => window.__said.push(u.text); speechSynthesis.cancel = () => {}; } true");
    let nav = null;
    for (let i = 0; i < 20 && !(nav && nav.steps && nav.steps.length > 2); i++) { await sleep(1000); nav = (await drv.eval("fetch('/api/nav').then((r) => r.json())")).nav; }
    const line = nav.line;
    const pick = line[line.length - 1];
    // points every ~120 m along the route
    const pts = [line[0]];
    const m = (a, b) => Math.hypot((b[0] - a[0]) * 92500, (b[1] - a[1]) * 110540);
    let acc = 0;
    for (let i = 1; i < line.length; i++) { acc += m(line[i - 1], line[i]); if (acc >= 120) { pts.push(line[i]); acc = 0; } }
    const half = Math.floor(pts.length / 2);
    for (let i = 1; i < pts.length - 1; i++) {
      await drv.moveTo(pts[i][1], pts[i][0]);
      if (i === 3) await avi.shot('friend-05-on-the-way', 600);
      if (i === half) {
        await drv.shot('driver-04b-driving', 400);
        // off the route: 200 m to the side, twice
        await drv.moveTo(pts[i][1] + 0.0018, pts[i][0] + 0.0012);
        await drv.moveTo(pts[i][1] + 0.0019, pts[i][0] + 0.0013);
        await sleep(2500);
      }
    }
    await drv.moveTo(pick[1], pick[0]);
    await drv.waitFor('At the pickup');
    await drv.shot('driver-04c-arrived', 600);
    const said = await drv.eval('window.__said');
    console.log('  voice said:', said.length, 'lines, e.g.', JSON.stringify(said.slice(0, 4)));
    if (!said.some((t) => /^Picking up Avi/.test(t))) throw new Error('no start announcement');
    if (!said.some((t) => /^(In .*, )?(turn|bear|continue|keep|take|merge|at the roundabout)/i.test(t))) throw new Error('no turn announcement');
    if (!said.includes('Rerouting.')) throw new Error('no reroute');
    if (!said.some((t) => /^You've arrived/.test(t))) throw new Error('no arrival');
    await drv.click('[data-act="here"]');
    await avi.waitFor('Dovid is here');
    await avi.shot('friend-06-here', 1500);
    await drv.shot('driver-05-waiting', 500);
    await drv.click('[data-act="start"]');
    await drv.waitFor('Dropping off Avi');
    await drv.moveTo(33.5050, -112.0450);
    await avi.waitFor('Heading to');
    await avi.click('[data-act="simcha"]');
    await avi.shot('friend-07-riding', 3000);
    await drv.shot('driver-06-dropping-off', 1500);

    await drv.eval('window.confirm = () => true');
    await drv.click('[data-act="end"]');
    await avi.waitFor("You're here");
    await avi.click('[data-act="tip"]', 1);
    await avi.shot('friend-08-pay-rate', 2000);
    await drv.waitFor('Rate Avi');
    await drv.shot('driver-07-rate', 800);
    await avi.click('[data-act="chip"]');
    await avi.click('[data-act="ghost"]');
    await avi.shot('friend-08b-review', 500);
    await avi.eval('window.open = () => null');
    await avi.click('[data-act="pay"]');
    await avi.waitFor('Where to?');
    await drv.click('[data-act="rrRate"]', 4);
    await drv.click('[data-act="rrChip"]');
    await drv.click('[data-act="rrGhost"]');
    await drv.shot('driver-07b-review-rider', 500);
    await drv.click('[data-act="rrSend"]');
    // someone new asks to join from the sign-in screen
    const yoni = await phone('newcomer', { lat: 33.5, lng: -112.06 });
    await yoni.go(BASE);
    await yoni.type('#email', 'yoni@example.com');
    await yoni.eval("document.querySelector('form.signin').requestSubmit()");
    await yoni.waitFor('Your name');
    await yoni.type('#jname', 'Yoni');
    await yoni.shot('newcomer-01-ask', 300);
    await yoni.eval("document.querySelector('form.signin').requestSubmit()");
    await yoni.waitFor("You'll get an email");
    await yoni.shot('newcomer-02-asked', 300);
    await drv.click('[data-act="go"][data-to="ledger"]');
    await drv.waitFor('Got it');
    await drv.shot('driver-08-ledger', 800);
    await avi.click('[data-act="go"][data-to="tab"]');
    await avi.shot('friend-09-tab', 600);
    await avi.click('[data-act="go"][data-to="rides"]');
    await avi.shot('friend-10-rides', 600);
    await avi.click('[data-act="go"][data-to="account"]');
    await avi.shot('friend-11-account', 600);
    await drv.click('[data-act="gotIt"]');
    await drv.shot('driver-09-ledger-paid', 1200);
    // profiles, the account editor, dark, a holiday, the driver by day
    await avi.click('[data-act="go"][data-to="home"]');
    await avi.waitFor('Where to?');
    await avi.eval(`document.querySelector('.drv [data-act="profile"]').click()`);
    await avi.waitFor('Mitzvahs');
    await avi.shot('friend-12-driver-profile', 1200);
    await avi.click('[data-act="profileBack"]');
    await avi.click('[data-act="go"][data-to="account"]');
    await avi.click('[data-act="setProfile"][data-v="Yerushalmi"]');
    await avi.click('[data-act="setProfile"][data-v="Klezmer"]');
    await avi.shot('friend-13-account', 800);
    await avi.click('[data-act="setTheme"][data-id="dark"]');
    await avi.click('[data-act="go"][data-to="home"]');
    await avi.shot('friend-14-dark', 3500);
    await avi.eval("localStorage.setItem('jb.theme', 'light'); true");
    await avi.go(BASE + '/?fun=chanukah');
    await avi.waitFor('Where to?');
    await avi.shot('friend-15-chanukah', 3000);
    await avi.go(BASE + '/?fun=shabbat');
    await avi.waitFor('Shabbat Shalom');
    await avi.shot('friend-16-shabbat', 1500);
    await drv.eval("localStorage.setItem('jb.theme', 'light'); true");
    await drv.go(BASE);
    await drv.waitFor('On duty');
    await drv.shot('driver-10-light', 3500);
    console.log(errors.length ? `\npage errors:\n${[...new Set(errors)].join('\n')}` : '\nno page errors');
  } catch (e) {
    console.log('page errors so far:', [...new Set(errors)].join(' | ') || 'none');
    throw e;
  } finally {
    try { ws.close(); } catch {}
    chrome.kill();
    await new Promise((ok) => { srv.on('exit', ok); srv.kill(); });
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => { console.error('WALK FAILED:', e.message); process.exitCode = 1; });
