'use strict';
// PayPal end to end against a pretend PayPal (never the real one): a ride paid by PayPal through
// the way back (/pp/return), the fee passed on, a refund, a whole tab paid where the way back
// got lost (the minute's check catches it), a cancel, and the page that sends the Android app home.
//   node tools/paypal-check.js
const http = require('node:http');
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(process.env.JEWBER_TEST_TMP || os.tmpdir(), 'jewber-pp-'));
const PORT = 18600 + Math.floor(Math.random() * 200);
const PP_PORT = PORT + 300;
const BASE = `http://127.0.0.1:${PORT}`;
fs.writeFileSync(path.join(dir, 'paypal.json'), JSON.stringify({ client_id: 'test-id', client_secret: 'test-secret', currency: 'USD' }));
const env = { ...process.env, JEWBER_STATE: dir, JEWBER_PORT: String(PORT), JEWBER_MAIL: 'outbox', JEWBER_NOTIFY: '', JEWBER_OSRM: 'http://127.0.0.1:9', JEWBER_URL: BASE, JEWBER_PAYPAL_API: `http://127.0.0.1:${PP_PORT}`, JEWBER_PAYPAL_ENV: '', JEWBER_PAYPAL_POLL_MS: '700' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- a pretend PayPal: orders, approval (by the test), capture with a fee, refunds
const orders = {};
let seq = 0;
const pp = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const send = (code, j) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(j)); };
    const u = req.url;
    if (u === '/v1/oauth2/token') {
      assert.equal(req.headers.authorization, 'Basic ' + Buffer.from('test-id:test-secret').toString('base64'));
      return send(200, { access_token: 'tok', expires_in: 32400 });
    }
    assert.equal(req.headers.authorization, 'Bearer tok');
    if (u === '/v2/checkout/orders' && req.method === 'POST') {
      const j = JSON.parse(body);
      const id = `ORDER${++seq}`;
      orders[id] = { id, status: 'PAYER_ACTION_REQUIRED', amount: +j.purchase_units[0].amount.value, ctx: j.payment_source.paypal.experience_context, desc: j.purchase_units[0].description };
      return send(201, { id, status: orders[id].status, links: [{ rel: 'payer-action', href: `https://paypal.example/checkoutnow?token=${id}` }] });
    }
    let m = u.match(/^\/v2\/checkout\/orders\/(\w+)(\/capture)?$/);
    if (m) {
      const o = orders[m[1]];
      if (!o) return send(404, { name: 'RESOURCE_NOT_FOUND' });
      if (!m[2]) return send(200, { id: o.id, status: o.status });
      if (o.status === 'COMPLETED') return send(422, { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'ORDER_ALREADY_CAPTURED' }] });
      if (o.status !== 'APPROVED') return send(422, { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'ORDER_NOT_APPROVED' }] });
      o.status = 'COMPLETED';
      const fee = Math.round((o.amount * 0.0349 + 0.49) * 100) / 100;
      o.capture = { id: `CAP${o.id}`, status: 'COMPLETED', amount: { value: o.amount.toFixed(2) }, seller_receivable_breakdown: { paypal_fee: { value: fee.toFixed(2) }, net_amount: { value: (o.amount - fee).toFixed(2) } } };
      return send(201, { id: o.id, status: 'COMPLETED', purchase_units: [{ payments: { captures: [o.capture] } }] });
    }
    m = u.match(/^\/v2\/payments\/captures\/(\w+)\/refund$/);
    if (m) {
      const o = Object.values(orders).find((x) => x.capture && x.capture.id === m[1]);
      if (!o) return send(404, { name: 'RESOURCE_NOT_FOUND' });
      o.refunded = true;
      return send(201, { id: `REF${o.id}`, status: 'COMPLETED' });
    }
    send(404, { name: 'NOT_FOUND' });
  });
});

class Client {
  constructor() { this.cookie = ''; }
  async call(method, p, body, raw) {
    const r = await fetch(BASE + p, { method, redirect: 'manual', headers: { 'X-Jewber': '1', 'Content-Type': 'application/json', Cookie: this.cookie }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie');
    if (sc) this.cookie = sc.split(';')[0];
    if (raw) return r;
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`${method} ${p} -> ${r.status} ${j.error} ${j.message || ''}`);
    return j;
  }
  async signIn(email) {
    await this.call('POST', '/api/auth/code', { email });
    const code = fs.readFileSync(path.join(dir, 'outbox.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((x) => x.to === email).at(-1).subject.match(/\d{6}/)[0];
    await this.call('POST', '/api/auth/verify', { email, code });
  }
  me() { return this.call('GET', '/api/me'); }
}
let n = 0;
const ok = (what) => console.log(`  ok ${++n}. ${what}`);

async function ride(avi, drv) {
  const r = (await avi.call('POST', '/api/rides', { pickup: { lat: 33.5005, lng: -112.065, label: 'Home' }, dropoff: { lat: 33.512, lng: -112.04, label: 'Shul' }, type: 'schlep', pay: 'paypal' })).ride;
  await drv.call('POST', `/api/rides/${r.id}/accept`);
  await drv.call('POST', `/api/rides/${r.id}/start`);
  await drv.call('POST', `/api/rides/${r.id}/end`);
  return r;
}

(async () => {
  await new Promise((r) => pp.listen(PP_PORT, '127.0.0.1', r));
  execFileSync(process.execPath, [path.join(root, 'server.js'), 'driver', 'dovid@example.com', 'Dovid'], { env });
  execFileSync(process.execPath, [path.join(root, 'server.js'), 'friend', 'avi@example.com', 'Avi'], { env });
  const srv = spawn(process.execPath, [path.join(root, 'server.js')], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((r) => srv.stdout.on('data', (d) => { if (String(d).includes('jewber')) r(); }));
  try {
    const drv = new Client();
    const avi = new Client();
    await drv.signIn('dovid@example.com');
    await avi.signIn('avi@example.com');
    let v = await avi.me();
    if (v.shabbat.closed) { console.log('Shabbat right now: run this on a weekday'); return; }
    assert.ok(v.paypalCheckout, 'PayPal is on for friends');
    await drv.call('POST', '/api/driver/duty', { on: true });
    await drv.call('POST', '/api/driver/location', { lat: 33.49, lng: -112.07 });

    let r = await ride(avi, drv);
    const start = await avi.call('POST', `/api/rides/${r.id}/paypal`, { tip: { kind: 'usd', usd: 5 }, rating: 5 });
    assert.match(start.url, /^https:\/\/paypal\.example\/checkoutnow\?token=ORDER/);
    assert.equal(start.amount, Math.round((r.fare + 5) * 100) / 100);
    const o1 = orders[start.order];
    assert.equal(o1.ctx.return_url, `${BASE}/pp/return`);
    assert.equal(o1.ctx.shipping_preference, 'NO_SHIPPING');
    assert.match(o1.desc, /Home → Shul/);
    ok('paying a ride by PayPal makes an order for fare + tip and hands back PayPal\'s page');
    assert.equal((await avi.me()).ride.state, 'done', 'not paid until PayPal says so');

    o1.status = 'APPROVED';
    const back = await avi.call('GET', `/pp/return?token=${start.order}&PayerID=X`, null, true);
    assert.equal(back.status, 302);
    assert.equal(back.headers.get('location'), '/?paid=ok');
    v = await avi.me();
    assert.equal(v.ride, null, 'the ride is settled');
    assert.equal(v.rides[0].payment.state, 'paid');
    assert.equal(v.rides[0].payment.method, 'paypal');
    ok('coming back from PayPal captures it: the ride is paid, no "Got it" needed');
    v = await drv.me();
    const row = v.paypal.find((x) => x.id === start.order);
    assert.equal(row.status, 'paid');
    assert.ok(row.fee > 0 && Math.abs(row.net - (row.amount - row.fee)) < 0.011);
    assert.equal(v.ledger.weekUsd, start.amount);
    assert.equal(v.ledger.claims.length, 0);
    ok('the driver\'s ledger shows it paid, with PayPal\'s fee and what\'s left');
    const again = await avi.call('GET', `/pp/return?token=${start.order}`, null, true);
    assert.equal(again.headers.get('location'), '/?paid=ok');
    ok('coming back twice changes nothing');

    await drv.call('POST', `/api/paypal/${start.order}/refund`);
    assert.ok(o1.refunded);
    v = await avi.me();
    assert.equal(v.tab.usd, start.amount, 'refunded money is owed again');
    assert.equal((await drv.me()).paypal.find((x) => x.id === start.order).status, 'refunded');
    ok('a refund goes back through PayPal and the ride is owed again');

    await drv.call('POST', '/api/driver/settings', { paypalFee: 'friend' });
    r = await ride(avi, drv);
    await avi.call('POST', `/api/rides/${r.id}/pay`, { method: 'tab', rating: 4 });
    v = await avi.me();
    const owedNow = v.tab.usd;
    const tab = await avi.call('POST', '/api/tab/paypal', { app: true });
    const o2 = orders[tab.order];
    assert.equal(o2.ctx.return_url, `${BASE}/pp/return?app=1`);
    assert.equal(tab.amount, Math.ceil(((owedNow + 0.49) / (1 - 0.0349)) * 100) / 100, 'the fee is passed on');
    ok('the whole tab in one PayPal order, with the fee passed on');
    o2.status = 'APPROVED';
    for (let i = 0; i < 20 && (await avi.me()).tab.usd > 0; i++) await sleep(300);
    assert.equal((await avi.me()).tab.usd, 0);
    ok('approved but never came back: the minute\'s check captures it, the tab is clear');

    const page = await avi.call('GET', `/pp/return?app=1&token=${tab.order}`, null, true);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.ok(html.includes('intent://open?paid=ok#Intent;scheme=jewber;package=xyz.tiresia.jewber;end'));
    ok('from the Android app the way back is a page that opens the app again');

    r = await ride(avi, drv);
    const s3 = await avi.call('POST', `/api/rides/${r.id}/paypal`, {});
    const c = await avi.call('GET', `/pp/cancel?token=${s3.order}`, null, true);
    assert.equal(c.headers.get('location'), '/?paid=cancel');
    v = await avi.me();
    assert.equal(v.ride.state, 'done', 'still to pay after a cancel');
    assert.equal((await drv.me()).paypal.find((x) => x.id === s3.order), undefined, 'cancelled orders stay out of the way');
    ok('cancelling on PayPal leaves the ride to pay another way');

    assert.equal((await avi.call('POST', `/api/paypal/${start.order}/refund`, null, true)).status, 403);
    ok('only the driver can refund');
    console.log(`\nall ${n} PayPal checks passed`);
  } finally {
    await new Promise((r) => { srv.on('exit', r); srv.kill(); });
    pp.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => { console.error('\nFAILED:', e.message); process.exitCode = 1; });
