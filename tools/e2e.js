'use strict';
// A whole ride against a throwaway server: the driver and a friend sign in with emailed codes
// (written to an outbox), the friend asks for a ride, the driver accepts and drives there with
// GPS fixes, picks up, drops off, and the money lands in the ledger. Also: the list keeps
// strangers out, a declined request, booking for later, a treat payment, a nudge.
//
//   node tools/e2e.js        (routes are straight lines here, so it doesn't lean on OSRM)
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

const dir = fs.mkdtempSync(path.join(process.env.JEWBER_TEST_TMP || os.tmpdir(), 'jewber-e2e-'));
const PORT = 18525 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}`;
const env = { ...process.env, JEWBER_STATE: dir, JEWBER_PORT: String(PORT), JEWBER_MAIL: 'outbox', JEWBER_NOTIFY: '', JEWBER_OSRM: 'http://127.0.0.1:9', JEWBER_URL: BASE };
const root = path.join(__dirname, '..');

const run = (args) => new Promise((ok, no) => {
  const p = spawn(process.execPath, [path.join(root, 'server.js'), ...args], { env, stdio: 'inherit' });
  p.on('exit', (c) => (c ? no(new Error('exit ' + c)) : ok()));
});

class Client {
  constructor(name) { this.name = name; this.cookie = ''; }
  async call(method, p, body) {
    const r = await fetch(BASE + p, {
      method,
      headers: { 'X-Jewber': '1', 'Content-Type': 'application/json', Cookie: this.cookie },
      body: body ? JSON.stringify(body) : undefined,
    });
    const sc = r.headers.get('set-cookie');
    if (sc) this.cookie = sc.split(';')[0];
    const j = await r.json().catch(() => ({}));
    return { status: r.status, ...j };
  }
  async ok(method, p, body) {
    const j = await this.call(method, p, body);
    if (j.status !== 200) throw new Error(`${this.name} ${method} ${p} -> ${j.status} ${j.error} ${j.message || ''}`);
    return j;
  }
  async signIn(email) {
    await this.ok('POST', '/api/auth/code', { email });
    const lines = fs.readFileSync(path.join(dir, 'outbox.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const code = lines.filter((m) => m.to === email).at(-1).subject.match(/\d{6}/)[0];
    const j = await this.ok('POST', '/api/auth/verify', { email, code });
    assert.ok(j.token, 'verify gives a token for the app');
    return j.view;
  }
  me() { return this.ok('GET', '/api/me'); }
}

const steps = [];
const step = (name) => { steps.push(name); console.log('·', name); };

(async () => {
  await run(['driver', 'dovid@example.com', 'Dovid']);
  await run(['friend', 'avi@example.com', 'Avi']);
  const srv = spawn(process.execPath, [path.join(root, 'server.js')], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((ok) => srv.stdout.on('data', (d) => { if (String(d).includes('jewber')) ok(); }));
  try {
    const drv = new Client('driver');
    const avi = new Client('avi');
    const stranger = new Client('stranger');

    step('a stranger gets no code');
    const no = await stranger.call('POST', '/api/auth/code', { email: 'who@example.com' });
    assert.equal(no.status, 403);
    assert.equal((await stranger.call('GET', '/api/me')).status, 401);

    step('the driver and a friend sign in with codes');
    let v = await drv.signIn('dovid@example.com');
    assert.equal(v.me.role, 'driver');
    v = await avi.signIn('avi@example.com');
    assert.equal(v.me.role, 'rider');
    assert.equal(v.me.name, 'Avi');

    step('a wrong code is refused, writes need our header');
    await avi.ok('POST', '/api/auth/code', { email: 'avi@example.com' });
    assert.equal((await avi.call('POST', '/api/auth/verify', { email: 'avi@example.com', code: '000000' })).status, 400);
    const csrf = await fetch(BASE + '/api/me', { method: 'POST', headers: { Cookie: avi.cookie, 'Content-Type': 'application/json' }, body: '{"name":"x"}' });
    assert.equal(csrf.status, 403);

    step('a stranger asks to join; the driver says yes; an invitation goes out; they get in');
    const who = new Client('who');
    assert.equal((await who.call('POST', '/api/auth/join', { email: 'who@example.com', name: 'Yoni' })).ok, true);
    v = await drv.me();
    assert.equal(v.joins[0].name, 'Yoni');
    await drv.ok('POST', `/api/joins/${encodeURIComponent('who@example.com')}/yes`);
    assert.ok(fs.readFileSync(path.join(dir, 'outbox.jsonl'), 'utf8').includes('Dovid added you to Jewber'), 'an invitation email');
    v = await who.signIn('who@example.com');
    assert.equal(v.me.name, 'Yoni');
    assert.equal((await drv.me()).joins.length, 0);
    await who.call('POST', '/api/auth/join', { email: 'no@example.com', name: 'Nope' });
    await drv.ok('POST', `/api/joins/${encodeURIComponent('no@example.com')}/no`);
    assert.equal((await stranger.call('POST', '/api/auth/code', { email: 'no@example.com' })).status, 403, 'a no stays out');

    step('the driver sets fares, handles and the car');
    await drv.ok('POST', '/api/driver/settings', { base: 3, perMile: 1.2, minFare: 5, car: 'Silver Corolla', plate: 'JWB 613', phone: '555-0100', handles: { cashapp: '$dovid', venmo: 'dovid', zelle: 'dovid@example.com', paypal: '' } });

    const home = { lat: 33.5005, lng: -112.0650, label: 'Home', address: '1 Home St' };
    const shul = { lat: 33.5120, lng: -112.0400, label: 'Shul', address: '2 Shul Ave' };

    step('off duty: a ride now is refused');
    const off = await avi.call('POST', '/api/rides', { pickup: home, dropoff: shul, type: 'schlep', pay: 'cashapp' });
    v = await avi.me();
    if (!v.shabbat.closed) assert.equal(off.error, 'off-duty');
    if (v.shabbat.closed) { console.log('  (Shabbat right now: the rest needs a weekday)'); return; }

    step('on duty, the car shows up for friends (roughly)');
    await drv.ok('POST', '/api/driver/duty', { on: true });
    await drv.ok('POST', '/api/driver/location', { lat: 33.4900, lng: -112.0700, heading: 10, speed: 10 });
    v = await avi.me();
    assert.ok(v.driver.onDuty);
    assert.ok(v.driver.loc && v.driver.loc.rough, 'a friend without a ride sees a rough spot');

    step('a quote has every ride type');
    const q = await avi.ok('POST', '/api/quote', { pickup: home, dropoff: shul });
    assert.ok(q.prices.schlep >= 5);
    assert.equal(q.prices.mensch, Math.round((q.prices.schlep + 2) * 10) / 10);
    assert.ok(q.minutes.bubbe > q.minutes.schlep, 'Bubbe is slower');

    step('Avi asks; the driver declines; Avi sees it');
    let r = (await avi.ok('POST', '/api/rides', { pickup: home, dropoff: shul, type: 'bubbe', pay: 'cashapp' })).ride;
    v = await drv.me();
    assert.equal(v.requests.length, 1);
    assert.equal(v.requests[0].rider.name, 'Avi');
    await drv.ok('POST', `/api/rides/${r.id}/decline`);
    v = await avi.me();
    assert.equal(v.ride.state, 'declined');
    await avi.ok('POST', `/api/rides/${r.id}/ok`);
    assert.equal((await avi.me()).ride, null);

    step('Avi asks again; one ride at a time');
    r = (await avi.ok('POST', '/api/rides', { pickup: home, dropoff: shul, type: 'schlep', pay: 'cashapp' })).ride;
    assert.equal((await avi.call('POST', '/api/rides', { pickup: home, dropoff: shul })).error, 'have-one');

    step('accept, drive there, the ETA counts down, the friend sees the exact car');
    await drv.ok('POST', `/api/rides/${r.id}/accept`);
    v = await avi.me();
    assert.equal(v.ride.state, 'accepted');
    await drv.ok('POST', '/api/driver/location', { lat: 33.4950, lng: -112.0680 });
    for (let i = 0; i < 30; i++) { v = await avi.me(); if (v.ride.eta) break; await new Promise((ok) => setTimeout(ok, 250)); }
    assert.ok(v.ride.eta && v.ride.eta.seconds > 0, 'an ETA');
    assert.ok(!v.driver.loc.rough, 'exact car during the ride');
    assert.equal(v.driver.phone, '555-0100');
    v = await drv.me();
    assert.equal(v.active.rider.phone, '');
    const nav = await drv.ok('GET', '/api/nav');
    assert.equal(nav.nav.target, 'pickup');

    step("a second friend can't ask while the driver is busy");
    await drv.ok('POST', '/api/friends', { email: 'shira@example.com', name: 'Shira' });
    const shira = new Client('shira');
    await shira.signIn('shira@example.com');
    assert.equal((await shira.call('POST', '/api/rides', { pickup: shul, dropoff: home })).error, 'busy');

    step("here, start, the trip, the end");
    await drv.ok('POST', '/api/driver/location', { lat: home.lat, lng: home.lng });
    await drv.ok('POST', `/api/rides/${r.id}/here`);
    assert.equal((await avi.me()).ride.state, 'here');
    await drv.ok('POST', `/api/rides/${r.id}/start`);
    await avi.ok('POST', `/api/rides/${r.id}/simcha`, { on: true });
    assert.ok((await drv.me()).active.simcha, 'Simcha mode reaches the driver');
    await drv.ok('POST', '/api/driver/location', { lat: shul.lat, lng: shul.lng });
    await drv.ok('POST', `/api/rides/${r.id}/end`);
    v = await avi.me();
    assert.equal(v.ride.state, 'done');
    assert.ok(v.tab.usd > 0, 'unpaid ride is on the tab');

    step('Avi rates Tzaddik, tips $5, pays by Cash App: a link with the amount');
    const pay = await avi.ok('POST', `/api/rides/${r.id}/pay`, { method: 'cashapp', tip: { kind: 'usd', usd: 5 }, rating: 5 });
    assert.equal(pay.usd, Math.round((r.fare + 5) * 100) / 100);
    assert.equal(pay.link, `https://cash.app/$dovid/${pay.usd.toFixed(2)}`);
    assert.equal((await avi.me()).ride, null);

    step('the driver sees the claim, rates Avi, says got it');
    v = await drv.me();
    assert.equal(v.ledger.claims.length, 1);
    assert.equal(v.ended.id, r.id);
    await drv.ok('POST', `/api/rides/${r.id}/rate`, { stars: 4 });
    await drv.ok('POST', `/api/rides/${r.id}/paid`);
    v = await drv.me();
    assert.equal(v.ledger.weekUsd, pay.usd);
    assert.equal(v.rating.word, 'Tzaddik');
    assert.equal(v.ended, null);

    step('a ride paid in babka, nudged, then settled');
    r = (await avi.ok('POST', '/api/rides', { pickup: shul, dropoff: home, type: 'mensch', pay: 'babka' })).ride;
    await drv.ok('POST', `/api/rides/${r.id}/accept`);
    await drv.ok('POST', `/api/rides/${r.id}/start`);
    await drv.ok('POST', `/api/rides/${r.id}/end`);
    await avi.ok('POST', `/api/rides/${r.id}/pay`, { method: 'babka', tip: { kind: 'rugelach' }, rating: 5 });
    v = await avi.me();
    assert.deepEqual(v.tab.extras, { babka: 1, rugelach: 1 });
    v = await drv.me();
    const f = v.friends.find((x) => x.email === 'avi@example.com');
    assert.equal(f.owed.extras.babka, 1);
    await drv.ok('POST', `/api/friends/${f.uid}/nudge`);
    assert.equal((await drv.call('POST', `/api/friends/${f.uid}/nudge`)).error, 'nudged');
    const mails = fs.readFileSync(path.join(dir, 'outbox.jsonl'), 'utf8');
    assert.ok(mails.includes('1 babka + 1 rugelach'), 'the nudge email says what is owed');
    await drv.ok('POST', `/api/friends/${f.uid}/paid`);
    assert.deepEqual((await avi.me()).tab.extras, {});

    step('booking for later: off duty is fine, the driver books it');
    await drv.ok('POST', '/api/driver/duty', { on: false });
    const later = new Date(Date.now() + 2 * 3600e3);
    const bk = await avi.call('POST', '/api/rides', { pickup: home, dropoff: shul, type: 'schlep', pay: 'tab', when: later.toISOString() });
    if (bk.error === 'shabbat-time') console.log('  (that time is Shabbat: skipped)');
    else {
      assert.equal(bk.status, 200);
      assert.equal((await avi.me()).ride, null, 'a ride asked for later is not on screen');
      v = await drv.me();
      assert.ok(v.requests[0].when);
      await drv.ok('POST', `/api/rides/${bk.ride.id}/accept`);
      v = await avi.me();
      assert.equal(v.booked[0].state, 'booked');
      assert.equal(v.ride, null, 'a booked ride is not on screen yet');
      await drv.ok('POST', `/api/rides/${bk.ride.id}/go`);
      assert.equal((await avi.me()).ride.state, 'accepted');
      await avi.ok('POST', `/api/rides/${bk.ride.id}/cancel`);
    }

    step('the driver adds and removes a friend; removed friends are signed out');
    await drv.ok('POST', '/api/friends', { email: 'dani@example.com', name: 'Dani' });
    assert.ok((await drv.me()).friends.some((x) => x.email === 'dani@example.com'));
    await drv.ok('DELETE', `/api/friends/${encodeURIComponent('shira@example.com')}`);
    assert.equal((await shira.call('GET', '/api/me')).status, 401);

    step('reviews: words and badges on the driver\'s profile, and on the friend\'s');
    const rv = (await avi.ok('POST', '/api/rides', { pickup: home, dropoff: shul, type: 'shadchan', pay: 'cash' })).ride;
    await drv.ok('POST', '/api/driver/duty', { on: true });
    await drv.ok('POST', `/api/rides/${rv.id}/accept`);
    await drv.ok('POST', `/api/rides/${rv.id}/start`);
    await drv.ok('POST', `/api/rides/${rv.id}/end`);
    await avi.ok('POST', `/api/rides/${rv.id}/review`, { stars: 5, chips: ['Great schmooze', 'Not a real badge'], text: 'Found parking on the first try. Moshiach must be close.' });
    await drv.ok('POST', `/api/rides/${rv.id}/review`, { stars: 4, chips: ['Brought snacks'], text: 'Good passenger.' });
    v = await avi.me();
    let prof = await avi.ok('GET', `/api/profile/${v.driver.id}`);
    assert.equal(prof.reviews[0].text, 'Found parking on the first try. Moshiach must be close.');
    assert.deepEqual(prof.reviews[0].chips, ['Great schmooze'], 'only real badges');
    assert.equal(prof.compliments['Great schmooze'], 1);
    assert.equal(prof.reviews[0].by.name, 'Avi');
    prof = await drv.ok('GET', `/api/profile/${v.me.id}`);
    assert.equal(prof.reviews[0].text, 'Good passenger.');
    assert.equal(prof.rating.word, 'Mensch');

    step('a friend can see the driver and themselves, not other friends');
    const yoniId = (await who.me()).me.id;
    assert.equal((await avi.call('GET', `/api/profile/${yoniId}`)).status, 403);

    step('profile: the fun fields and a photo');
    await avi.ok('POST', '/api/me/profile', { kugel: 'Yerushalmi', music: 'Klezmer', schmooze: 'Full schmooze', bio: 'Rugelach enthusiast', shul: 'The one with the good kiddush', kugelX: 1 });
    await avi.ok('POST', '/api/me/profile', { music: 'Death metal' });
    v = await avi.me();
    assert.equal(v.me.kugel, 'Yerushalmi');
    assert.equal(v.me.music, '', 'only the listed choices');
    const jpeg = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]).toString('base64');
    await avi.ok('POST', '/api/me/photo', { data: jpeg });
    v = await avi.me();
    assert.match(v.me.photo, /^\/photos\/[\w-]+\.jpg$/);
    const ph = await fetch(BASE + v.me.photo);
    assert.equal(ph.status, 200);
    assert.equal(ph.headers.get('content-type'), 'image/jpeg');
    assert.equal((await avi.call('POST', '/api/me/photo', { data: 'data:text/html;base64,PGgxPg==' })).status, 400);
    assert.equal((await fetch(BASE + '/photos/..%2Fstate.json')).status, 404);
    await avi.ok('POST', `/api/rides/${rv.id}/pay`, { method: 'cash' });

    step('a bracha for a tip, rounded up for tzedakah, the jar, and giving it');
    const tz = (await avi.ok('POST', '/api/rides', { pickup: home, dropoff: shul, type: 'schlep', pay: 'cashapp' })).ride;
    await drv.ok('POST', `/api/rides/${tz.id}/accept`);
    await drv.ok('POST', `/api/rides/${tz.id}/start`);
    await drv.ok('POST', `/api/rides/${tz.id}/end`);
    const tzPay = await avi.ok('POST', `/api/rides/${tz.id}/pay`, { method: 'cashapp', tip: { kind: 'bracha', text: 'May all your lights be green' }, roundUp: true });
    assert.equal(tzPay.usd, Math.ceil(tz.fare + 0.001));
    v = await drv.me();
    assert.ok(v.tzedakah > 0 && v.tzedakah < 1, 'rounded-up cents in the jar');
    assert.equal(v.brachotGot[0].text, 'May all your lights be green');
    await drv.ok('POST', '/api/tzedakah/gave');
    assert.equal((await drv.me()).tzedakah, 0);
    assert.equal((await avi.call('POST', `/api/rides/${tz.id}/pay`, { method: 'cashapp', tip: { kind: 'bracha', text: 'Made up' } })).status, 200, 'an unknown bracha is just no tip');

    step('chutzpah jumps the queue');
    await drv.ok('POST', '/api/driver/duty', { on: false });
    const t1 = new Date(Date.now() + 3 * 3600e3).toISOString();
    const q1 = await avi.call('POST', '/api/rides', { pickup: home, dropoff: shul, type: 'schlep', pay: 'tab', when: t1 });
    const q2 = await who.call('POST', '/api/rides', { pickup: home, dropoff: shul, type: 'chutzpah', pay: 'tab', when: t1 });
    if (q1.status === 200 && q2.status === 200) {
      v = await drv.me();
      assert.equal(v.requests[0].type, 'chutzpah');
      await avi.ok('POST', `/api/rides/${q1.ride.id}/cancel`);
      await who.ok('POST', `/api/rides/${q2.ride.id}/cancel`);
    }

    step('every 18th ride is chai: free, a mitzvah');
    await drv.ok('POST', '/api/driver/duty', { on: true });
    let c = (await avi.me()).chai;
    while (c.done % 18 !== 17) {
      const x = (await avi.ok('POST', '/api/rides', { pickup: home, dropoff: shul, type: 'schlep', pay: 'cash' })).ride;
      await drv.ok('POST', `/api/rides/${x.id}/accept`);
      await drv.ok('POST', `/api/rides/${x.id}/start`);
      await drv.ok('POST', `/api/rides/${x.id}/end`);
      await avi.ok('POST', `/api/rides/${x.id}/pay`, { method: 'cash' });
      c = (await avi.me()).chai;
    }
    assert.ok(c.next);
    assert.equal((await avi.ok('POST', '/api/quote', { pickup: home, dropoff: shul })).chai, true);
    const chai = (await avi.ok('POST', '/api/rides', { pickup: home, dropoff: shul, type: 'mensch', pay: 'cashapp' })).ride;
    assert.equal(chai.fare, 0);
    assert.equal(chai.pay, 'mitzvah');
    await drv.ok('POST', `/api/rides/${chai.id}/accept`);
    await drv.ok('POST', `/api/rides/${chai.id}/start`);
    await drv.ok('POST', `/api/rides/${chai.id}/end`);
    await avi.ok('POST', `/api/rides/${chai.id}/pay`, { method: 'cashapp' });
    v = await avi.me();
    assert.equal(v.rides[0].payment.method, 'mitzvah');
    assert.equal(v.rides[0].payment.state, 'paid');
    assert.equal(v.chai.toGo, 18);

    step('the calendar comes along: Hebrew holidays and the parsha');
    v = await avi.me();
    assert.ok(Array.isArray(v.cal.events));
    assert.ok(v.brachot.length >= 5 && v.kvetchList.length >= 5 && v.compliments.driver.length >= 5);

    step("friends can't drive");
    assert.equal((await avi.call('POST', '/api/driver/duty', { on: true })).status, 403);

    step('the page and its files are served');
    const page = await fetch(BASE + '/');
    assert.equal(page.status, 200);
    assert.ok((page.headers.get('content-security-policy') || '').includes("default-src 'self'"));
    assert.equal((await fetch(BASE + '/app.js')).status, 200);
    assert.equal((await fetch(BASE + '/../server.js')).status, 404);
    assert.equal((await fetch(BASE + '/apk/')).status, 200);
    assert.equal((await fetch(BASE + '/apk/../state.json')).status, 404);

    console.log(`\nall ${steps.length} steps passed`);
  } finally {
    await new Promise((ok) => { srv.on('exit', ok); srv.kill(); });
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => { console.error('\nFAILED:', e.message); process.exitCode = 1; });
