'use strict';
// Jewber: rides from one driver to a handful of friends. One process, no dependencies.
//
//   node server.js                      # serve (JEWBER_PORT, default 8525)
//   node server.js driver EMAIL [NAME]  # who drives (always allowed to sign in)
//   node server.js friend EMAIL [NAME]  # let a friend sign in
//
// State lives in JEWBER_STATE (default ./state): state.json, mail.json (SMTP, see
// lib/mail.js), vapid.json (made on first run), dist/ (the Android app). The page is web/.
// Every change is pushed to signed-in pages over /api/events (server-sent events): each page
// gets its whole view again, so the page only ever draws what it's given.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { Store } = require('./lib/store');
const { mailer, cleanEmail, validEmail } = require('./lib/mail');
const push = require('./lib/push');
const geo = require('./lib/geo');
const shabbat = require('./lib/shabbat');
const rules = require('./lib/rules');
const paypal = require('./lib/paypal');
const emails = require('./lib/emails');

const STATE = process.env.JEWBER_STATE || path.join(__dirname, 'state');
const PORT = +process.env.JEWBER_PORT || 8525;
const HOSTS = (process.env.JEWBER_HOSTS || '127.0.0.1').split(',').map((s) => s.trim()).filter(Boolean);
const PUBLIC_URL = (process.env.JEWBER_URL || 'https://jewber.tiresia.xyz').replace(/\/$/, '');
// A script that pings the driver (on Signal, say): NOTIFY TITLE MESSAGE now. None by default.
const NOTIFY = process.env.JEWBER_NOTIFY || '';
const WEB = path.join(__dirname, 'web');
const VERSION = require('./package.json').version;

const store = new Store(STATE);
const S = store.data;
const mail = mailer(STATE);
const pp = paypal.client(STATE);

// ---- CLI ---------------------------------------------------------------------------------
if (require.main === module && process.argv[2] && process.argv[2] !== 'serve') {
  const [cmd, rawEmail, ...rest] = process.argv.slice(2);
  const email = cleanEmail(rawEmail);
  if (!['driver', 'friend', 'unfriend'].includes(cmd) || !validEmail(email)) {
    console.error('usage: node server.js driver|friend|unfriend EMAIL [NAME]');
    process.exit(2);
  }
  if (cmd === 'driver') {
    S.settings.driverEmail = email;
    S.allowed[email] = { name: rest.join(' ') || S.allowed[email]?.name || 'Driver', added: Date.now() };
    for (const u of Object.values(S.users)) u.role = u.email === email ? 'driver' : 'rider';
  } else if (cmd === 'friend') {
    S.allowed[email] = { name: rest.join(' ') || email.split('@')[0], added: Date.now() };
  } else {
    delete S.allowed[email];
  }
  store.flush();
  console.log(`${cmd}: ${email}`);
  process.exit(0);
}

// ---- small helpers -----------------------------------------------------------------------
const now = () => Date.now();
const rid = (n = 8) => crypto.randomBytes(n).toString('base64url').replace(/[-_]/g, '').slice(0, n + 2);
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const clip = (s, n) => String(s ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const money = (n) => Math.round(n * 100) / 100;
const COLORS = ['#2347D9', '#7A4FD1', '#D9574A', '#1F8A4C', '#C46A12', '#0E7C86', '#B5367A'];
const ACTIVE = ['requested', 'booked', 'accepted', 'here', 'riding'];
const ROLLING = ['accepted', 'here', 'riding'];

const driverUser = () => Object.values(S.users).find((u) => u.role === 'driver');
const driverName = () => (driverUser()?.name || S.allowed[S.settings.driverEmail]?.name || 'Your driver');
const userName = (uid) => S.users[uid]?.name || 'A friend';

let vapid;
try { vapid = JSON.parse(fs.readFileSync(path.join(STATE, 'vapid.json'), 'utf8')); } catch {
  vapid = push.generateVapidKeys();
  fs.writeFileSync(path.join(STATE, 'vapid.json'), JSON.stringify(vapid), { mode: 0o600 });
}
const signPush = push.vapidSigner(vapid, PUBLIC_URL);

// ---- notifications -----------------------------------------------------------------------
async function notify(uid, title, body, { tag = 'jewber', urgent = false } = {}) {
  const subs = S.push[uid] || [];
  if (!subs.length) return;
  const keep = [];
  await Promise.all(subs.map(async (sub) => {
    try {
      const r = await push.send(sub, { title, body, tag, url: '/' }, signPush, { ttl: urgent ? 300 : 3600 });
      if (!r.gone) keep.push(sub);
    } catch { keep.push(sub); }
  }));
  S.push[uid] = keep;
  store.save();
}

// The driver also gets a ping from the notify script (JEWBER_NOTIFY) for the things that can't wait.
function signal(title, body) {
  if (!S.settings.signal || !NOTIFY) return;
  execFile(NOTIFY, [title, body, 'now'], { timeout: 30000 }, (err) => {
    if (err) console.error('signal:', err.message);
  });
}

function notifyDriver(title, body, opts = {}) {
  const d = driverUser();
  if (d) notify(d.id, title, body, { urgent: true, ...opts });
  if (opts.signal) signal(title, `${body}\n${PUBLIC_URL}`);
}

// ---- rides -------------------------------------------------------------------------------
function ridesOf(uid) {
  return Object.values(S.rides).filter((r) => r.rider === uid).sort((a, b) => b.created - a.created);
}

function setState(ride, state, extra = {}) {
  ride.state = state;
  ride.events.push({ state, at: now() });
  Object.assign(ride, extra);
  store.save();
  changed();
}

// The ride a rider's screen is about: one in progress, one waiting to be paid for, or one that
// didn't happen and hasn't been seen yet.
function currentRide(uid) {
  for (const r of ridesOf(uid)) {
    if (ACTIVE.includes(r.state) && r.state !== 'booked' && !(r.state === 'requested' && r.when)) return r;
    if (r.state === 'done' && !r.payment && now() - r.ended < 6 * 3600e3) return r;
    if (['missed', 'declined', 'cancelled'].includes(r.state) && !r.acked && r.cancelledBy !== 'rider' && now() - r.events.at(-1).at < 3600e3) return r;
  }
  return null;
}

const activeForDriver = () => Object.values(S.rides).find((r) => ROLLING.includes(r.state)) || null;

function rideOut(r, forDriver) {
  const rider = S.users[r.rider];
  return {
    id: r.id,
    state: r.state,
    type: r.type,
    pay: r.pay,
    pickup: r.pickup,
    dropoff: r.dropoff,
    fare: r.fare,
    meters: Math.round(r.meters),
    seconds: Math.round(r.seconds),
    line: r.line,
    created: r.created,
    when: r.when || null,
    expires: r.expires || null,
    accepted: r.accepted || null,
    started: r.started || null,
    ended: r.ended || null,
    eta: r.eta || null,
    simcha: !!r.simcha,
    payment: r.payment || null,
    rating: r.rating || null,
    riderRating: r.riderRating || null,
    cancelledBy: r.cancelledBy || null,
    chai: !!r.chai,
    review: r.review || null,
    riderReview: r.riderReview || null,
    rider: forDriver ? { id: r.rider, name: rider?.name, photo: rider?.photo || '', phone: ROLLING.includes(r.state) ? rider?.phone || '' : '', color: rider?.color, rating: ratingOf(r.rider, 'riderRating'), schmooze: rider?.schmooze || '' } : undefined,
  };
}

function ratingOf(uid, field) {
  const list = Object.values(S.rides).filter((r) => (field === 'rating' ? true : r.rider === uid) && r[field]).map((r) => r[field]);
  if (!list.length) return null;
  const avg = list.reduce((a, b) => a + b, 0) / list.length;
  return { avg: Math.round(avg * 100) / 100, word: rules.ratingWord(avg), count: list.length };
}

// What a rider owes: dollars, plus things that come baked or cooked.
function owedBy(uid) {
  let usd = 0;
  const extras = {};
  const rides = [];
  for (const r of ridesOf(uid)) {
    if (r.state !== 'done') continue;
    const p = r.payment;
    if (p && (p.state === 'paid' || p.state === 'claimed')) continue;
    const method = p ? p.method : r.pay;
    const kind = rules.payOf(method)?.kind;
    if (kind === 'free') continue;
    if (kind === 'treat') extras[method] = (extras[method] || 0) + 1;
    else usd += p ? p.usd : r.fare;
    if (p && p.tip && p.tip.kind === 'rugelach') extras.rugelach = (extras.rugelach || 0) + 1;
    rides.push({ id: r.id, method });
  }
  return { usd: money(usd), extras, rides };
}

function weekStart() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d.getTime();
}

// ---- profiles, chai rides, tzedakah ------------------------------------------------------
const PROFILE_KEYS = ['bio', 'shul', 'kugel', 'music', 'schmooze', 'languages', 'fact'];
function profileFields(u) {
  const out = { photo: u.photo || '', since: u.created, username: u.username || '', hasPassword: !!u.pass };
  for (const k of PROFILE_KEYS) out[k] = u[k] || '';
  return out;
}

// Every 18th ride (chai) is on the house.
function chaiOf(uid) {
  const done = ridesOf(uid).filter((r) => r.state === 'done').length;
  const on = S.settings.chai !== false;
  return { on, done, toGo: on ? 18 - (done % 18) : null, next: on && (done + 1) % 18 === 0 };
}

// Rounded-up cents for tzedakah, in the jar until the driver gives them.
function tzedakahJar() {
  let total = 0;
  for (const r of Object.values(S.rides)) if (r.payment && r.payment.tzedakah && ['paid', 'claimed'].includes(r.payment.state)) total += r.payment.tzedakah;
  return money(Math.max(0, total - (S.tzedakahGiven || 0)));
}

// A tip: dollars, rugelach, or a blessing from the list.
function tipFrom(body) {
  const t = body && body.tip;
  if (!t) return null;
  if (t.kind === 'usd') { const usd = Math.min(100, Math.max(0, money(+t.usd || 0))); return usd ? { kind: 'usd', usd } : null; }
  if (t.kind === 'rugelach') return { kind: 'rugelach', usd: 0 };
  if (t.kind === 'bracha' && rules.BRACHOT.includes(t.text)) return { kind: 'bracha', usd: 0, text: t.text };
  return null;
}

// ---- views -------------------------------------------------------------------------------
let shab = { closed: false, soon: false, start: null, end: null, city: 'phoenix', cityName: 'Phoenix' };
let cal = { events: [], holiday: null, chanukah: null, parsha: null };
async function refreshShabbat() {
  try {
    const next = await shabbat.status(S.settings.city, S.driver.loc);
    const day = await shabbat.today(S.settings.city, S.driver.loc);
    if (JSON.stringify(day) !== JSON.stringify(cal)) { cal = day; changed(); }
    const was = shab.closed;
    shab = next;
    if (shab.closed && !was && S.driver.onDuty) { S.driver.onDuty = false; store.save(); }
    if (shab.closed !== was) changed();
  } catch (e) { console.error('shabbat:', e.message); }
}

function driverPublic(forUid) {
  const d = S.driver;
  const fresh = d.loc && now() - d.loc.at < 10 * 60e3;
  const cur = forUid ? currentRide(forUid) : null;
  const mine = cur && ROLLING.includes(cur.state);
  let loc = null;
  if (d.onDuty && fresh) {
    loc = mine ? d.loc : { lat: Math.round(d.loc.lat * 500) / 500, lng: Math.round(d.loc.lng * 500) / 500, heading: d.loc.heading, at: d.loc.at, rough: true };
  }
  const du = driverUser();
  return {
    id: du ? du.id : null,
    name: driverName(),
    photo: du ? du.photo || '' : '',
    onDuty: d.onDuty && !shab.closed,
    status: d.status,
    loc,
    car: S.settings.car,
    plate: S.settings.plate,
    phone: mine ? S.settings.phone : '',
    rating: ratingOf(null, 'rating'),
    busy: !!activeForDriver() && !mine,
  };
}

function common(u) {
  return {
    v: VERSION,
    now: now(),
    me: { id: u.id, name: u.name, email: u.email, role: u.role, phone: u.phone || '', color: u.color, places: u.places || [], pay: u.pay || 'cashapp', push: (S.push[u.id] || []).length > 0, ...profileFields(u) },
    types: rules.TYPES,
    payMethods: rules.PAY,
    statuses: rules.STATUSES,
    brachot: rules.BRACHOT,
    kvetchList: rules.KVETCHES,
    compliments: rules.COMPLIMENTS,
    profileOpts: rules.PROFILE,
    cal,
    ratings: rules.RATINGS,
    fares: { base: S.settings.base, perMile: S.settings.perMile, minFare: S.settings.minFare },
    shabbat: shab,
    vapid: vapid.publicKey,
    paypalCheckout: pp.on,
    paypalFee: S.settings.paypalFee === 'friend',
  };
}

function riderView(u) {
  const cur = currentRide(u.id);
  const mine = ridesOf(u.id);
  const recent = [];
  for (const r of mine) {
    if (r.state === 'done' && !recent.some((p) => p.label === r.dropoff.label)) recent.push(r.dropoff);
    if (recent.length >= 4) break;
  }
  const h = S.settings.handles;
  return {
    ...common(u),
    driver: driverPublic(u.id),
    ride: cur ? rideOut(cur, false) : null,
    booked: mine.filter((r) => r.state === 'booked' || (r.state === 'requested' && r.when)).map((r) => rideOut(r, false)),
    rides: mine.filter((r) => ['done', 'missed', 'declined', 'cancelled'].includes(r.state)).slice(0, 20).map((r) => rideOut(r, false)),
    recent,
    tab: owedBy(u.id),
    chai: chaiOf(u.id),
    handles: { cashapp: !!h.cashapp, venmo: !!h.venmo, zelle: h.zelle || '', paypal: pp.on || !!h.paypal },
  };
}

function driverView(u) {
  const rides = Object.values(S.rides);
  const week = weekStart();
  let weekUsd = 0;
  const weekExtras = {};
  for (const r of rides) {
    const p = r.payment;
    if (!p || p.state !== 'paid' || (p.paidAt || 0) < week) continue;
    const kind = rules.payOf(p.method)?.kind;
    if (kind === 'treat' || kind === 'free') weekExtras[p.method] = (weekExtras[p.method] || 0) + 1;
    else weekUsd += p.usd;
    if (p.tip && p.tip.kind === 'rugelach') weekExtras.rugelach = (weekExtras.rugelach || 0) + 1;
  }
  const friends = Object.entries(S.allowed).filter(([e]) => e !== S.settings.driverEmail).map(([email, a]) => {
    const fu = Object.values(S.users).find((x) => x.email === email);
    return { email, name: fu?.name || a.name, uid: fu?.id || null, photo: fu?.photo || '', color: fu?.color || '#5C6066', owed: fu ? owedBy(fu.id) : { usd: 0, extras: {}, rides: [] }, nudged: fu?.nudged || 0 };
  });
  const active = activeForDriver();
  const ended = rides.filter((r) => r.state === 'done' && !r.riderRating && !r.riderRatingSkipped && now() - r.ended < 3600e3).sort((a, b) => b.ended - a.ended)[0];
  return {
    ...common(u),
    driver: { ...S.driver, onDuty: S.driver.onDuty && !shab.closed, name: driverName() },
    settings: S.settings,
    // Chutzpah jumps the queue
    requests: rides.filter((r) => r.state === 'requested').sort((a, b) => (b.type === 'chutzpah') - (a.type === 'chutzpah') || a.created - b.created).map((r) => rideOut(r, true)),
    booked: rides.filter((r) => r.state === 'booked').sort((a, b) => a.when - b.when).map((r) => rideOut(r, true)),
    active: active ? rideOut(active, true) : null,
    ended: ended ? rideOut(ended, true) : null,
    ledger: {
      weekUsd: money(weekUsd),
      weekExtras,
      claims: rides.filter((r) => r.payment && r.payment.state === 'claimed').sort((a, b) => b.ended - a.ended).map((r) => rideOut(r, true)),
    },
    friends,
    tzedakah: tzedakahJar(),
    brachotGot: rides.filter((r) => r.payment && r.payment.tip && r.payment.tip.kind === 'bracha').sort((a, b) => b.payment.at - a.payment.at).slice(0, 10).map((r) => ({ name: userName(r.rider), text: r.payment.tip.text, at: r.payment.at })),
    kvetches: S.kvetches.slice(-10).reverse().map((k) => ({ ...k, name: userName(k.uid) })),
    joins: Object.values(S.joins).sort((a, b) => a.at - b.at),
    rating: ratingOf(null, 'rating'),
    app: appInfo(),
    paypal: Object.values(S.paypal).filter((o) => !['cancelled', 'expired'].includes(o.status) && (o.status !== 'created' || now() - o.created < 6 * 3600e3)).sort((a, b) => b.created - a.created).slice(0, 15)
      .map((o) => ({ id: o.id, kind: o.kind, name: userName(o.uid), amount: o.amount, rides: o.rides.length, status: o.status, created: o.created, paidAt: o.paidAt || null, fee: o.capture ? o.capture.fee : null, net: o.capture ? o.capture.net : null })),
  };
}

const viewFor = (u) => (u.role === 'driver' ? driverView(u) : riderView(u));

// ---- live updates (server-sent events) ---------------------------------------------------
const clients = new Set();
let flushTimer = null;
function changed() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    for (const c of clients) {
      const u = S.users[c.uid];
      if (!u) { c.res.end(); clients.delete(c); continue; }
      const body = JSON.stringify(viewFor(u));
      const key = body.replace(/"now":\d+,/, '');
      if (key === c.last) continue;
      c.last = key;
      c.res.write(`data: ${body}\n\n`);
    }
  }, 250);
}

// ---- ETAs while the driver is on the way --------------------------------------------------
let etaBusy = false;
async function refreshEta(force = false) {
  const r = activeForDriver();
  const loc = S.driver.loc;
  if (!r || !loc || etaBusy) return;
  const target = r.state === 'riding' ? r.dropoff : r.pickup;
  if (r.state === 'here') return;
  const moved = r.eta?.from ? geo.meters(r.eta.from, loc) : Infinity;
  if (!force && r.eta && now() - r.eta.at < 20000 && moved < 150) return;
  etaBusy = true;
  try {
    const rt = await geo.route([loc, target]);
    const slow = r.state === 'riding' ? (rules.typeOf(r.type)?.slow || 1) : 1;
    r.eta = { seconds: Math.round(rt.seconds * slow), meters: Math.round(rt.meters), at: now(), from: { lat: loc.lat, lng: loc.lng }, line: rt.line, target: r.state === 'riding' ? 'dropoff' : 'pickup' };
    if (r.state === 'accepted' && r.eta.seconds <= 90 && !r.almost) {
      r.almost = true;
      notify(r.rider, `${driverName()} is almost there`, 'Head outside.', { tag: 'ride', urgent: true });
    }
    store.save();
    changed();
  } finally { etaBusy = false; }
}

// ---- timers: requests that weren't answered, booked rides coming up, Shabbat ---------------
setInterval(() => {
  const t = now();
  for (const r of Object.values(S.rides)) {
    if (r.state === 'requested' && r.expires && t > r.expires) {
      setState(r, 'missed');
      notify(r.rider, `${driverName()} didn't answer`, 'Try again in a bit, or book for later.', { tag: 'ride' });
    }
    if (r.state === 'requested' && r.when && t > r.when) setState(r, 'missed');
    if (r.state === 'booked' && !r.reminded && t > r.when - 20 * 60e3) {
      r.reminded = true;
      store.save();
      const at = new Date(r.when).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      notifyDriver(`Time to get ${userName(r.rider)}`, `${r.pickup.label} at ${at}`, { signal: true });
    }
  }
}, 5000).unref();
setInterval(refreshShabbat, 60000).unref();

// ---- HTTP --------------------------------------------------------------------------------
class Fail extends Error { constructor(status, code, msg) { super(msg || code); this.status = status; this.code = code; } }
const fail = (status, code, msg) => { throw new Fail(status, code, msg); };

function send(res, status, body, headers = {}) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(data);
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((ok, no) => {
    let size = 0;
    const parts = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { no(new Fail(413, 'too-big')); req.destroy(); return; }
      parts.push(c);
    });
    req.on('end', () => {
      if (!parts.length) return ok({});
      try { ok(JSON.parse(Buffer.concat(parts).toString('utf8'))); } catch { no(new Fail(400, 'bad-json')); }
    });
    req.on('error', no);
  });
}

function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const isHttps = (req) => req.headers['x-forwarded-proto'] === 'https' || /"scheme":"https"/.test(req.headers['cf-visitor'] || '');
const ipOf = (req) => req.headers['cf-connecting-ip'] || req.socket.remoteAddress || '';

function sessionUser(req) {
  const h = String(req.headers.authorization || '');
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : cookies(req).jb;
  if (!token) return null;
  const s = S.sessions[sha(token)];
  if (!s || !S.users[s.uid]) return null;
  if (now() - (s.seen || 0) > 3600e3) { s.seen = now(); store.save(); }
  return S.users[s.uid];
}

// Sign-in codes: in memory only, 10 minutes, 5 tries. Only addresses on the list get one.
const codes = new Map();
const hits = new Map();
function limited(key, max, ms) {
  const t = now();
  const list = (hits.get(key) || []).filter((x) => t - x < ms);
  if (list.length >= max) return true;
  list.push(t);
  hits.set(key, list);
  return false;
}

function newSession(res, req, u, kind) {
  const token = crypto.randomBytes(32).toString('base64url');
  S.sessions[sha(token)] = { uid: u.id, created: now(), seen: now(), kind };
  store.save();
  const secure = isHttps(req) ? '; Secure' : '';
  res.setHeader('Set-Cookie', `jb=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure}`);
  return token;
}

function userFor(email) {
  let u = Object.values(S.users).find((x) => x.email === email);
  if (!u) {
    const a = S.allowed[email] || {};
    u = {
      id: rid(6),
      email,
      name: clip(a.name || email.split('@')[0], 40),
      role: email === S.settings.driverEmail ? 'driver' : 'rider',
      phone: '',
      color: COLORS[Object.keys(S.users).length % COLORS.length],
      places: [],
      pay: 'cashapp',
      created: now(),
    };
    S.users[u.id] = u;
    store.save();
  }
  return u;
}

function point(p, what) {
  if (!geo.validPoint(p)) fail(400, 'bad-place', `${what} needs a place`);
  return { lat: +(+p.lat).toFixed(6), lng: +(+p.lng).toFixed(6), label: clip(p.label, 80) || 'Pinned spot', address: clip(p.address, 160) };
}

function rideFor(id, who) {
  const r = S.rides[id];
  if (!r) fail(404, 'no-ride');
  if (who.role !== 'driver' && r.rider !== who.id) fail(404, 'no-ride');
  return r;
}

function appInfo() {
  try { return JSON.parse(fs.readFileSync(path.join(STATE, 'dist', 'app.json'), 'utf8')); } catch { return null; }
}

// ---- the API -----------------------------------------------------------------------------
const routes = [];
const on = (method, pattern, fn, opts = {}) => routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), fn, ...opts });

on('POST', '/api/auth/code', async ({ body, req }) => {
  const email = cleanEmail(body.email);
  if (!validEmail(email)) fail(400, 'bad-email', 'That email looks off');
  if (limited('ip:' + ipOf(req), 8, 3600e3) || limited('em:' + email, 4, 15 * 60e3) || limited('all', 100, 3600e3)) fail(429, 'slow-down', 'Too many codes. Try again later.');
  if (!S.allowed[email] && email !== S.settings.driverEmail) fail(403, 'not-on-list', 'Not on the list');
  const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
  codes.set(email, { hash: sha(code + email), exp: now() + 10 * 60e3, tries: 0 });
  const m = emails.code({ code, url: PUBLIC_URL });
  await mail.send(email, m.subject, m.text, m.html);
  return { ok: true };
}, { open: true });

on('POST', '/api/auth/verify', async ({ body, req, res }) => {
  const email = cleanEmail(body.email);
  const c = codes.get(email);
  const code = String(body.code || '').replace(/\D/g, '');
  if (!c || c.exp < now()) fail(400, 'code-expired', 'That code expired. Get a new one.');
  if (++c.tries > 5) { codes.delete(email); fail(429, 'too-many-tries', 'Too many tries. Get a new code.'); }
  if (sha(code + email) !== c.hash) fail(400, 'wrong-code', 'Wrong code');
  codes.delete(email);
  if (!S.allowed[email] && email !== S.settings.driverEmail) fail(403, 'not-on-list', 'Not on the list');
  const u = userFor(email);
  const token = newSession(res, req, u, body.device === 'android' ? 'android' : 'web');
  return { ok: true, token, view: viewFor(u) };
}, { open: true });

// ---- passwords (optional: the email code always works too) ---------------------------------
// scrypt, the hash and its salt and costs in one string. A username is optional and signs in like the email.
const SCRYPT = { N: 16384, r: 8, p: 1, len: 64 };
const scryptAsync = (pw, salt, o) => new Promise((ok, no) => crypto.scrypt(pw, salt, o.len, { N: o.N, r: o.r, p: o.p, maxmem: 64 * 1024 * 1024 }, (e, k) => (e ? no(e) : ok(k))));
async function hashPass(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scryptAsync(pw, salt, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}
async function checkPass(pw, stored) {
  const m = /^scrypt\$(\d+)\$(\d+)\$(\d+)\$([^$]+)\$([^$]+)$/.exec(String(stored || ''));
  if (!m) { await scryptAsync('x', 'y', SCRYPT); return false; }   // same time whether or not there's a password
  const want = Buffer.from(m[5], 'base64');
  const got = await scryptAsync(String(pw), Buffer.from(m[4], 'base64'), { N: +m[1], r: +m[2], p: +m[3], len: want.length });
  return crypto.timingSafeEqual(want, got);
}
const cleanUsername = (s) => String(s || '').trim().toLowerCase();
const validUsername = (s) => /^[a-z0-9][a-z0-9._-]{2,23}$/.test(s);
const tokenOf = (req) => { const h = String(req.headers.authorization || ''); return h.startsWith('Bearer ') ? h.slice(7).trim() : cookies(req).jb; };
const pwFails = new Map(); // login -> [times]

on('POST', '/api/auth/password', async ({ body, req, res }) => {
  const login = String(body.login || '').trim().toLowerCase().slice(0, 254);
  const pw = String(body.password || '').slice(0, 200);
  if (!login || !pw) fail(400, 'missing', 'Your email or username, and your password');
  if (limited('pw:' + ipOf(req), 12, 15 * 60e3)) fail(429, 'slow-down', 'Too many tries. Try again in a few minutes, or use a code.');
  const fails = (pwFails.get(login) || []).filter((t) => now() - t < 15 * 60e3);
  if (fails.length >= 8) fail(429, 'locked', 'Too many tries. Use a code, or try again in 15 minutes.');
  const u = Object.values(S.users).find((x) => x.email === login || (x.username && x.username === login));
  const ok = await checkPass(pw, u && u.pass);
  if (!ok || !u || (!S.allowed[u.email] && u.email !== S.settings.driverEmail)) {
    fails.push(now());
    pwFails.set(login, fails);
    fail(400, 'wrong-login', 'Wrong email, username or password');
  }
  pwFails.delete(login);
  const token = newSession(res, req, u, body.device === 'android' ? 'android' : 'web');
  return { ok: true, token, view: viewFor(u) };
}, { open: true });

// Username and password, from Account. A new password signs out everywhere else.
on('POST', '/api/me/login', async ({ u, body, req }) => {
  if (body.username !== undefined) {
    const name = cleanUsername(body.username);
    if (!name) delete u.username;
    else {
      if (!validUsername(name)) fail(400, 'bad-username', '3 to 24 letters, numbers, dots, dashes or underscores');
      if (Object.values(S.users).some((x) => x.id !== u.id && x.username === name)) fail(409, 'taken', 'That username is taken');
      u.username = name;
    }
  }
  if (body.password !== undefined) {
    const pw = String(body.password);
    if (pw.length < 8) fail(400, 'short', 'At least 8 characters');
    if (pw.length > 200) fail(400, 'long', 'That password is too long');
    if (u.pass && !(await checkPass(String(body.current || ''), u.pass))) fail(400, 'wrong-current', 'Your current password is wrong');
    u.pass = await hashPass(pw);
    u.passSet = now();
    const keep = sha(tokenOf(req) || '');
    for (const [k, s] of Object.entries(S.sessions)) if (s.uid === u.id && k !== keep) delete S.sessions[k];
  }
  store.save();
  changed();
  return viewFor(u);
});

on('DELETE', '/api/me/password', async ({ u, body }) => {
  if (u.pass && !(await checkPass(String(body.current || ''), u.pass))) fail(400, 'wrong-current', 'Your current password is wrong');
  delete u.pass;
  delete u.passSet;
  store.save();
  changed();
  return viewFor(u);
});

on('POST', '/api/auth/out', async ({ req, res }) => {
  const h = String(req.headers.authorization || '');
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : cookies(req).jb;
  if (token) delete S.sessions[sha(token)];
  store.save();
  res.setHeader('Set-Cookie', 'jb=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  return { ok: true };
}, { open: true });

on('GET', '/api/me', async ({ u }) => viewFor(u));

on('POST', '/api/me', async ({ u, body }) => {
  if (body.name !== undefined) u.name = clip(body.name, 40) || u.name;
  if (body.phone !== undefined) u.phone = clip(body.phone, 24).replace(/[^\d+()\- ]/g, '');
  if (body.pay !== undefined && rules.payOf(body.pay)) u.pay = body.pay;
  store.save();
  changed();
  return viewFor(u);
});

on('POST', '/api/me/profile', async ({ u, body }) => {
  for (const k of ['bio', 'shul', 'languages', 'fact']) if (body[k] !== undefined) u[k] = clip(body[k], k === 'bio' ? 200 : 80);
  for (const k of ['kugel', 'music', 'schmooze']) if (body[k] !== undefined) u[k] = rules.PROFILE[k].includes(body[k]) ? body[k] : '';
  store.save();
  changed();
  return viewFor(u);
});

// A profile picture: the page sends a small square JPEG (it crops and shrinks it first).
const PHOTOS = path.join(STATE, 'photos');
on('POST', '/api/me/photo', async ({ u, body }) => {
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(body.data || ''));
  if (!m) fail(400, 'bad-photo', "That photo didn't come through");
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 400 * 1024) fail(413, 'too-big', 'Photo is too big');
  fs.mkdirSync(PHOTOS, { recursive: true, mode: 0o700 });
  const name = `${u.id}-${crypto.randomBytes(6).toString('hex')}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
  fs.writeFileSync(path.join(PHOTOS, name), buf, { mode: 0o600 });
  if (u.photo) fs.rmSync(path.join(PHOTOS, path.basename(u.photo)), { force: true });
  u.photo = `/photos/${name}`;
  store.save();
  changed();
  return viewFor(u);
}, { big: true });

on('DELETE', '/api/me/photo', async ({ u }) => {
  if (u.photo) fs.rmSync(path.join(PHOTOS, path.basename(u.photo)), { force: true });
  u.photo = '';
  store.save();
  changed();
  return viewFor(u);
});

// A profile page: the driver sees anyone's; a friend sees the driver's and their own.
on('GET', '/api/profile/:uid', async ({ u, params }) => {
  const who = S.users[params.uid];
  if (!who) fail(404, 'no-profile');
  if (u.role !== 'driver' && who.id !== u.id && who.role !== 'driver') fail(403, 'not-yours');
  const isDriver = who.role === 'driver';
  const rides = Object.values(S.rides).filter((r) => r.state === 'done' && (isDriver || r.rider === who.id));
  const field = isDriver ? 'review' : 'riderReview';
  const reviews = rides.filter((r) => r[field]).sort((a, b) => b[field].at - a[field].at);
  const compliments = {};
  for (const r of reviews) for (const c of r[field].chips || []) compliments[c] = (compliments[c] || 0) + 1;
  return {
    id: who.id, name: who.name, role: who.role, color: who.color, ...profileFields(who),
    rides: rides.length,
    rating: isDriver ? ratingOf(null, 'rating') : ratingOf(who.id, 'riderRating'),
    car: isDriver ? S.settings.car : undefined,
    plate: isDriver ? S.settings.plate : undefined,
    mitzvahs: isDriver ? rides.filter((r) => r.payment && r.payment.method === 'mitzvah').length : undefined,
    compliments,
    reviews: reviews.slice(0, 30).map((r) => {
      const by = isDriver ? S.users[r.rider] : driverUser();
      return { stars: r[field].stars, text: r[field].text, chips: r[field].chips, at: r[field].at, by: { name: by ? by.name : '', photo: by ? by.photo || '' : '', color: by ? by.color : '' } };
    }),
  };
});

// A review: stars, the little badges, and words (or the page's ghostwritten ones).
on('POST', '/api/rides/:id/review', async ({ u, params, body }) => {
  const r = rideFor(params.id, u);
  if (r.state !== 'done') fail(409, 'not-done', "The ride isn't over yet");
  const stars = +body.stars;
  if (!rules.RATINGS[stars - 1]) fail(400, 'bad-rating');
  const list = rules.COMPLIMENTS[u.role === 'driver' ? 'rider' : 'driver'];
  const review = { stars, text: clip(body.text, 300), chips: (Array.isArray(body.chips) ? body.chips : []).filter((c) => list.includes(c)).slice(0, 6), at: now() };
  if (u.role === 'driver') { r.riderRating = stars; r.riderReview = review; } else { r.rating = stars; r.review = review; }
  store.save();
  changed();
  if (u.role !== 'driver' && review.text) notifyDriver(`${u.name} reviewed you: ${rules.RATINGS[stars - 1]}`, review.text, { tag: 'review' });
  return { ok: true };
});

on('POST', '/api/tzedakah/gave', async () => {
  S.tzedakahGiven = money((S.tzedakahGiven || 0) + tzedakahJar());
  store.save();
  changed();
  return { ok: true };
}, { driver: true });

on('POST', '/api/places', async ({ u, body }) => {
  const p = point(body, 'A saved place');
  u.places = (u.places || []).filter((x) => x.label.toLowerCase() !== p.label.toLowerCase());
  u.places.unshift({ id: rid(4), ...p, icon: ['home', 'shul', 'work', 'store', 'star'].includes(body.icon) ? body.icon : 'star' });
  u.places = u.places.slice(0, 12);
  store.save();
  changed();
  return viewFor(u);
});

on('DELETE', '/api/places/:id', async ({ u, params }) => {
  u.places = (u.places || []).filter((x) => x.id !== params.id);
  store.save();
  changed();
  return viewFor(u);
});

on('GET', '/api/search', async ({ url }) => {
  const near = { lat: url.searchParams.get('lat'), lng: url.searchParams.get('lng') };
  try { return { results: await geo.search(url.searchParams.get('q'), near) }; } catch { return { results: [], error: 'search-down' }; }
});

on('GET', '/api/reverse', async ({ url }) => {
  const p = { lat: +url.searchParams.get('lat'), lng: +url.searchParams.get('lng') };
  if (!geo.validPoint(p)) fail(400, 'bad-place');
  return geo.reverse(p);
});

async function quote(pickup, dropoff) {
  const rt = await geo.route([pickup, dropoff]);
  const prices = {};
  const minutes = {};
  for (const t of rules.TYPES) {
    prices[t.id] = rules.fare(S.settings, rt.meters, t.id);
    minutes[t.id] = Math.max(1, Math.round((rt.seconds * t.slow) / 60));
  }
  let pickupSeconds = null;
  const loc = S.driver.loc;
  if (S.driver.onDuty && loc && now() - loc.at < 10 * 60e3) {
    const toYou = await geo.route([loc, pickup]);
    pickupSeconds = Math.round(toYou.seconds);
  }
  return { meters: rt.meters, seconds: rt.seconds, line: rt.line, rough: !!rt.rough, prices, minutes, pickupSeconds };
}

on('POST', '/api/quote', async ({ u, body }) => ({ ...(await quote(point(body.pickup, 'Pickup'), point(body.dropoff, 'Drop-off'))), chai: u.role !== 'driver' && chaiOf(u.id).next }));

on('POST', '/api/rides', async ({ u, body }) => {
  if (u.role === 'driver') fail(400, 'driver', 'Drivers drive');
  const pickup = point(body.pickup, 'Pickup');
  const dropoff = point(body.dropoff, 'Drop-off');
  const type = rules.typeOf(body.type) ? body.type : 'schlep';
  const pay = rules.payOf(body.pay) ? body.pay : (u.pay || 'cashapp');
  const when = body.when ? +new Date(body.when) : null;
  if (when !== null) {
    if (!Number.isFinite(when) || when < now() + 10 * 60e3) fail(400, 'too-soon', 'Pick a time at least 10 minutes away');
    if (when > now() + 14 * 86400e3) fail(400, 'too-far', 'Two weeks ahead at most');
    if (await shabbat.closedAt(S.settings.city, S.driver.loc, when)) fail(409, 'shabbat-time', "That's during Shabbat");
  } else {
    if (shab.closed) fail(409, 'shabbat', 'Closed for Shabbat');
    if (!S.driver.onDuty) fail(409, 'off-duty', `${driverName()} is off duty`);
    if (activeForDriver()) fail(409, 'busy', `${driverName()} is on a ride`);
  }
  if (ridesOf(u.id).some((r) => ACTIVE.includes(r.state) && !r.when && !when)) fail(409, 'have-one', 'You already have a ride');
  const q = await quote(pickup, dropoff);
  const chai = chaiOf(u.id).next;
  const ride = {
    id: rid(8), rider: u.id, created: now(), state: 'requested', events: [{ state: 'requested', at: now() }],
    type, pay, pickup, dropoff, fare: q.prices[type], meters: q.meters, seconds: q.seconds * (rules.typeOf(type).slow || 1), line: q.line,
    when, expires: when ? null : now() + (S.settings.askSeconds || 90) * 1000, simcha: type === 'simcha',
    ...(chai ? { chai: true, fare: 0, pay: 'mitzvah' } : {}),
  };
  S.rides[ride.id] = ride;
  u.pay = pay;
  store.save();
  changed();
  const t = rules.typeOf(type).name;
  const p = rules.payOf(pay);
  const price = p.kind === 'treat' ? `1 ${p.unit}` : p.kind === 'free' ? 'a mitzvah' : `$${ride.fare.toFixed(2)} ${p.name}`;
  const at = when ? ` at ${new Date(when).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : '';
  notifyDriver(`${u.name} wants a ${t}${at}`, `${pickup.label} → ${dropoff.label} · ${price}`, { signal: true, tag: 'request' });
  return { ride: rideOut(ride, false) };
});

on('POST', '/api/rides/:id/cancel', async ({ u, params }) => {
  const r = rideFor(params.id, u);
  if (!['requested', 'booked', 'accepted', 'here'].includes(r.state)) fail(409, 'too-late', "Can't cancel now");
  const by = u.role === 'driver' ? 'driver' : 'rider';
  setState(r, 'cancelled', { cancelledBy: by });
  if (by === 'rider') notifyDriver(`${u.name} cancelled`, `${r.pickup.label} → ${r.dropoff.label}`, { tag: 'request' });
  else notify(r.rider, `${driverName()} cancelled`, 'Sorry! Try again in a bit.', { tag: 'ride' });
  return { ok: true };
});

on('POST', '/api/rides/:id/ok', async ({ u, params }) => {
  const r = rideFor(params.id, u);
  r.acked = true;
  store.save();
  changed();
  return { ok: true };
});

on('POST', '/api/rides/:id/simcha', async ({ u, params, body }) => {
  const r = rideFor(params.id, u);
  r.simcha = !!body.on;
  store.save();
  changed();
  return { ok: true };
});

on('POST', '/api/rides/:id/pay', async ({ u, params, body }) => {
  const r = rideFor(params.id, u);
  if (r.state !== 'done') fail(409, 'not-done', "The ride isn't over yet");
  const method = r.chai ? 'mitzvah' : rules.payOf(body.method) ? body.method : r.pay;
  const p = rules.payOf(method);
  const tip = tipFrom(body);
  const tipUsd = tip ? tip.usd : 0;
  let usd = p.kind === 'treat' || p.kind === 'free' ? tipUsd : money(r.fare + tipUsd);
  let tzedakah = 0;
  if (body.roundUp && usd > 0 && ['app', 'cash', 'tab'].includes(p.kind)) { const up = Math.ceil(usd + 0.001); tzedakah = money(up - usd); usd = up; }
  const state = p.kind === 'free' && !usd ? 'paid' : p.kind === 'tab' || p.kind === 'treat' ? 'owed' : 'claimed';
  r.payment = { method, usd, tip, tzedakah, state, at: now(), paidAt: state === 'paid' ? now() : null };
  if (rules.RATINGS[body.rating - 1]) r.rating = body.rating;
  store.save();
  changed();
  if (state === 'claimed') notifyDriver(`${u.name} paid`, `$${usd.toFixed(2)} by ${p.name}`, { tag: 'money' });
  const link = p.kind === 'app' ? rules.payLink(method, S.settings.handles, usd, `Jewber: ${r.pickup.label} → ${r.dropoff.label}`) : null;
  return { ok: true, link, zelle: method === 'zelle' ? S.settings.handles.zelle : null, usd };
});

on('POST', '/api/rides/:id/rate', async ({ u, params, body }) => {
  const r = rideFor(params.id, u);
  const n = +body.stars;
  if (!rules.RATINGS[n - 1]) fail(400, 'bad-rating');
  if (u.role === 'driver') r.riderRating = n; else r.rating = n;
  store.save();
  changed();
  return { ok: true };
});

on('POST', '/api/tab/pay', async ({ u, body }) => {
  const p = rules.payOf(body.method);
  if (!p || p.kind !== 'app' && p.kind !== 'cash') fail(400, 'bad-method');
  const owed = owedBy(u.id);
  let usd = 0;
  for (const o of owed.rides) {
    const r = S.rides[o.id];
    const kind = rules.payOf(r.payment ? r.payment.method : r.pay)?.kind;
    if (kind === 'treat' || kind === 'free') continue;
    const amount = r.payment ? r.payment.usd : r.fare;
    usd += amount;
    r.payment = { ...(r.payment || { tip: null }), method: body.method, usd: amount, state: 'claimed', at: now(), paidAt: null };
  }
  usd = money(usd);
  if (!usd) fail(400, 'nothing-owed', 'Nothing to pay');
  store.save();
  changed();
  notifyDriver(`${u.name} paid the tab`, `$${usd.toFixed(2)} by ${p.name}`, { tag: 'money' });
  return { ok: true, usd, link: p.kind === 'app' ? rules.payLink(body.method, S.settings.handles, usd, 'Jewber tab') : null, zelle: body.method === 'zelle' ? S.settings.handles.zelle : null };
});

on('POST', '/api/kvetch', async ({ u, body }) => {
  const text = clip(body.text, 500);
  if (!text) fail(400, 'empty');
  if (limited('kv:' + u.id, 10, 3600e3)) fail(429, 'slow-down', 'Enough kvetching for now');
  S.kvetches.push({ uid: u.id, text, ride: clip(body.ride, 20) || null, at: now() });
  S.kvetches = S.kvetches.slice(-100);
  store.save();
  changed();
  notifyDriver(`${u.name} is kvetching`, text, { tag: 'kvetch' });
  return { ok: true };
});

on('POST', '/api/push', async ({ u, body }) => {
  const sub = body.sub;
  if (!sub || !push.endpointAllowed(sub.endpoint) || !push.validKeys(sub.keys || {})) fail(400, 'bad-sub');
  const list = (S.push[u.id] || []).filter((s) => s.endpoint !== sub.endpoint);
  list.push({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } });
  S.push[u.id] = list.slice(-5);
  store.save();
  changed();
  return { ok: true };
});

on('POST', '/api/push/test', async ({ u }) => {
  await notify(u.id, 'Jewber', 'Notifications work.', { tag: 'test' });
  return { ok: true };
});

// ---- the driver's side -------------------------------------------------------------------
const driverOnly = { driver: true };

on('POST', '/api/driver/duty', async ({ body }) => {
  if (body.on && shab.closed) fail(409, 'shabbat', 'Shabbat Shalom');
  S.driver.onDuty = !!body.on;
  if (body.on) S.driver.status = 'driving';
  store.save();
  changed();
  return { ok: true };
}, driverOnly);

on('POST', '/api/driver/status', async ({ body }) => {
  if (!rules.STATUSES.some((s) => s.id === body.status)) fail(400, 'bad-status');
  S.driver.status = body.status;
  store.save();
  changed();
  return { ok: true };
}, driverOnly);

on('POST', '/api/driver/location', async ({ body }) => {
  if (!geo.validPoint(body)) fail(400, 'bad-place');
  const prev = S.driver.loc;
  S.driver.loc = {
    lat: +(+body.lat).toFixed(6), lng: +(+body.lng).toFixed(6),
    heading: Number.isFinite(+body.heading) && body.heading !== null ? Math.round(+body.heading) : (prev ? bearing(prev, body) : null),
    speed: Number.isFinite(+body.speed) ? Math.round(+body.speed * 10) / 10 : null,
    acc: Number.isFinite(+body.acc) ? Math.round(+body.acc) : null,
    at: now(),
  };
  if (!prev || geo.meters(prev, S.driver.loc) > 5 || now() - prev.at > 30000) store.save();
  changed();
  refreshEta().catch(() => {});
  return { ok: true, onDuty: S.driver.onDuty && !shab.closed, active: !!activeForDriver(), shabbat: shab.closed };
}, driverOnly);

function bearing(a, b) {
  if (geo.meters(a, b) < 8) return a.heading ?? null;
  const rad = Math.PI / 180;
  const y = Math.sin((b.lng - a.lng) * rad) * Math.cos(b.lat * rad);
  const x = Math.cos(a.lat * rad) * Math.sin(b.lat * rad) - Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos((b.lng - a.lng) * rad);
  return Math.round((Math.atan2(y, x) / rad + 360) % 360);
}

on('POST', '/api/rides/:id/accept', async ({ u, params }) => {
  const r = rideFor(params.id, u);
  if (r.state !== 'requested') fail(409, 'gone', 'That request is gone');
  if (r.when) {
    setState(r, 'booked', { accepted: now() });
    notify(r.rider, `${driverName()} booked it`, `${new Date(r.when).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })} · ${r.pickup.label}`, { tag: 'ride' });
  } else {
    if (activeForDriver()) fail(409, 'busy', 'Finish the ride you have');
    setState(r, 'accepted', { accepted: now(), expires: null });
    S.driver.status = 'driving';
    notify(r.rider, `${driverName()}'s on the way`, `${r.pickup.label}`, { tag: 'ride', urgent: true });
    refreshEta(true).catch(() => {});
  }
  return { ok: true };
}, driverOnly);

on('POST', '/api/rides/:id/decline', async ({ u, params }) => {
  const r = rideFor(params.id, u);
  if (r.state !== 'requested') fail(409, 'gone');
  setState(r, 'declined');
  notify(r.rider, `${driverName()} can't right now`, 'Sorry! Try again in a bit.', { tag: 'ride' });
  return { ok: true };
}, driverOnly);

on('POST', '/api/rides/:id/go', async ({ u, params }) => {
  const r = rideFor(params.id, u);
  if (r.state !== 'booked') fail(409, 'gone');
  if (activeForDriver()) fail(409, 'busy', 'Finish the ride you have');
  setState(r, 'accepted', { going: now() });
  S.driver.onDuty = true;
  S.driver.status = 'driving';
  notify(r.rider, `${driverName()}'s on the way`, `${r.pickup.label}`, { tag: 'ride', urgent: true });
  refreshEta(true).catch(() => {});
  return { ok: true };
}, driverOnly);

on('POST', '/api/rides/:id/here', async ({ u, params }) => {
  const r = rideFor(params.id, u);
  if (r.state !== 'accepted') fail(409, 'gone');
  setState(r, 'here', { here: now() });
  notify(r.rider, `${driverName()} is here`, [S.settings.car, S.settings.plate].filter(Boolean).join(' · ') || 'Out front.', { tag: 'ride', urgent: true });
  return { ok: true };
}, driverOnly);

on('POST', '/api/rides/:id/start', async ({ u, params }) => {
  const r = rideFor(params.id, u);
  if (!['accepted', 'here'].includes(r.state)) fail(409, 'gone');
  setState(r, 'riding', { started: now(), eta: null });
  refreshEta(true).catch(() => {});
  return { ok: true };
}, driverOnly);

on('POST', '/api/rides/:id/end', async ({ u, params }) => {
  const r = rideFor(params.id, u);
  if (r.state !== 'riding') fail(409, 'gone');
  setState(r, 'done', { ended: now(), eta: null });
  notify(r.rider, "You're here", `$${r.fare.toFixed(2)} · tap to pay and rate`, { tag: 'ride' });
  return { ok: true };
}, driverOnly);

on('POST', '/api/rides/:id/skip-rating', async ({ u, params }) => {
  const r = rideFor(params.id, u);
  r.riderRatingSkipped = true;
  store.save();
  changed();
  return { ok: true };
}, driverOnly);

on('POST', '/api/rides/:id/paid', async ({ u, params }) => {
  const r = rideFor(params.id, u);
  if (r.state !== 'done') fail(409, 'not-done');
  r.payment = { ...(r.payment || { method: r.pay, usd: rules.payOf(r.pay)?.kind === 'treat' ? 0 : r.fare, tip: null, at: now() }), state: 'paid', paidAt: now() };
  store.save();
  changed();
  return { ok: true };
}, driverOnly);

on('POST', '/api/friends/:uid/paid', async ({ params }) => {
  const owed = owedBy(params.uid);
  for (const o of owed.rides) {
    const r = S.rides[o.id];
    r.payment = { ...(r.payment || { method: r.pay, usd: rules.payOf(r.pay)?.kind === 'treat' ? 0 : r.fare, tip: null, at: now() }), state: 'paid', paidAt: now() };
  }
  store.save();
  changed();
  return { ok: true };
}, driverOnly);

on('POST', '/api/friends/:uid/nudge', async ({ params }) => {
  const fu = S.users[params.uid];
  if (!fu) fail(404, 'no-friend');
  if (fu.nudged && now() - fu.nudged < 6 * 3600e3) fail(429, 'nudged', 'Nudged already. Give it a few hours.');
  const o = owedBy(fu.id);
  const parts = [];
  if (o.usd) parts.push(`$${o.usd.toFixed(2)}`);
  for (const [k, n] of Object.entries(o.extras)) {
    const p = rules.payOf(k);
    parts.push(k === 'rugelach' ? `${n} rugelach` : `${n} ${n === 1 ? p.unit : p.units}`);
  }
  if (!parts.length) fail(400, 'nothing-owed', 'They owe nothing');
  fu.nudged = now();
  store.save();
  changed();
  const line = `${driverName()} says hi. Your tab: ${parts.join(' + ')}.`;
  notify(fu.id, 'A little nudge', line, { tag: 'nudge' });
  const nm = emails.nudge({ driver: driverName(), name: fu.name, owed: parts.join(' + '), url: PUBLIC_URL });
  mail.send(fu.email, nm.subject, nm.text, nm.html).catch((e) => console.error('nudge mail:', e.message));
  return { ok: true };
}, driverOnly);

// Adding a friend sends them an invitation (unless the driver says not to).
function invite(email, name) {
  const d = driverName();
  const m = emails.invite({ driver: d, name, email, url: PUBLIC_URL });
  mail.send(email, m.subject, m.text, m.html).catch((e) => console.error('invite mail:', e.message));
}

on('POST', '/api/friends', async ({ body }) => {
  const email = cleanEmail(body.email);
  if (!validEmail(email)) fail(400, 'bad-email', 'That email looks off');
  const name = clip(body.name, 40) || email.split('@')[0];
  const fresh = !S.allowed[email];
  S.allowed[email] = { name, added: now() };
  delete S.joins[email];
  store.save();
  changed();
  if (fresh && body.invite !== false) invite(email, name);
  return { ok: true };
}, driverOnly);

// Asking to join: someone not on the list leaves a name and an email; the driver says yes or no.
on('POST', '/api/auth/join', async ({ body, req }) => {
  const email = cleanEmail(body.email);
  const name = clip(body.name, 40);
  if (!validEmail(email)) fail(400, 'bad-email', 'That email looks off');
  if (!name) fail(400, 'no-name', 'Add your name');
  if (S.allowed[email] || email === S.settings.driverEmail) return { ok: true, allowed: true };
  if (S.joins[email]) return { ok: true };
  if (limited('join:' + ipOf(req), 3, 3600e3) || limited('join', 20, 86400e3) || Object.keys(S.joins).length >= 50) fail(429, 'slow-down', 'Too many asks. Try again later.');
  S.joins[email] = { email, name, at: now() };
  store.save();
  changed();
  notifyDriver(`${name} wants to join`, email, { signal: true, tag: 'join' });
  return { ok: true };
}, { open: true });

on('POST', '/api/joins/:email/yes', async ({ params }) => {
  const email = cleanEmail(decodeURIComponent(params.email));
  const j = S.joins[email];
  if (!j) fail(404, 'no-ask');
  S.allowed[email] = { name: j.name, added: now() };
  delete S.joins[email];
  store.save();
  changed();
  invite(email, j.name);
  return { ok: true };
}, driverOnly);

on('POST', '/api/joins/:email/no', async ({ params }) => {
  delete S.joins[cleanEmail(decodeURIComponent(params.email))];
  store.save();
  changed();
  return { ok: true };
}, driverOnly);

on('DELETE', '/api/friends/:email', async ({ params }) => {
  const email = cleanEmail(decodeURIComponent(params.email));
  if (email === S.settings.driverEmail) fail(400, 'driver');
  delete S.allowed[email];
  const fu = Object.values(S.users).find((x) => x.email === email);
  if (fu) for (const [k, s] of Object.entries(S.sessions)) if (s.uid === fu.id) delete S.sessions[k];
  store.save();
  changed();
  return { ok: true };
}, driverOnly);

on('POST', '/api/driver/settings', async ({ body }) => {
  const s = S.settings;
  for (const k of ['base', 'perMile', 'minFare']) if (body[k] !== undefined) {
    const n = +body[k];
    if (!Number.isFinite(n) || n < 0 || n > 100) fail(400, 'bad-fare');
    s[k] = Math.round(n * 100) / 100;
  }
  for (const k of ['car', 'plate', 'phone']) if (body[k] !== undefined) s[k] = clip(body[k], k === 'car' ? 40 : 24);
  if (body.handles) for (const k of Object.keys(s.handles)) if (body.handles[k] !== undefined) s.handles[k] = clip(body.handles[k], 60);
  if (body.signal !== undefined) s.signal = !!body.signal;
  if (body.paypalFee !== undefined && ['me', 'friend'].includes(body.paypalFee)) s.paypalFee = body.paypalFee;
  if (body.navApp !== undefined && ['jewber', 'waze', 'gmaps'].includes(body.navApp)) s.navApp = body.navApp;
  if (body.city !== undefined && ['auto', 'phoenix', 'jerusalem'].includes(body.city)) { s.city = body.city; refreshShabbat(); }
  if (body.name !== undefined) { const d = driverUser(); if (d) d.name = clip(body.name, 40) || d.name; }
  store.save();
  changed();
  return { ok: true };
}, driverOnly);

on('GET', '/api/nav', async () => {
  const r = activeForDriver();
  const loc = S.driver.loc;
  if (!r || !loc) return { nav: null };
  const target = r.state === 'riding' ? r.dropoff : r.pickup;
  const rt = await geo.route([loc, target], { steps: true });
  return { nav: { ride: r.id, target: r.state === 'riding' ? 'dropoff' : 'pickup', meters: rt.meters, seconds: rt.seconds, line: rt.line, steps: rt.steps, rough: !!rt.rough, at: now() } };
}, driverOnly);

on('GET', '/api/app', async () => ({ app: appInfo() }), { open: true });

// ---- PayPal Checkout ---------------------------------------------------------------------
// A ride (or the whole tab) becomes a PayPal order; the friend approves it on PayPal (account
// or card), comes back to /pp/return, and the order is captured there. A minute's check catches
// the ones whose way back got lost. Captured = paid, no "Got it" needed.
async function startPaypal(u, rides, { kind, tip = null, rating = null, fromApp = false, label }) {
  if (!pp.on) fail(400, 'no-paypal', "PayPal isn't set up");
  const base = money(rides.reduce((a, x) => a + x.usd, 0));
  if (base < 1) fail(400, 'too-small', 'Nothing to pay');
  const amount = S.settings.paypalFee === 'friend' ? paypal.withFee(base) : base;
  const invoiceId = `JWB-${kind === 'tab' ? 'T' : 'R'}-${rid(10)}`;
  const q = fromApp ? '?app=1' : '';
  let o;
  try {
    o = await pp.createOrder({ amount, description: label, customId: invoiceId, invoiceId, returnUrl: `${PUBLIC_URL}/pp/return${q}`, cancelUrl: `${PUBLIC_URL}/pp/cancel${q}` });
  } catch (e) {
    console.error('paypal order:', e.message);
    fail(502, 'paypal-down', "PayPal didn't answer. Try again.");
  }
  if (!o.url) fail(502, 'paypal-down', "PayPal didn't answer. Try again.");
  S.paypal[o.id] = { id: o.id, kind, uid: u.id, rides, tip, rating, base, amount, status: 'created', created: now(), invoiceId };
  store.save();
  changed();
  return { url: o.url, amount, order: o.id };
}

const settling = new Set();
async function settle(id) {
  const o = S.paypal[id];
  if (!o || !['created', 'pending'].includes(o.status) || settling.has(id)) return o;
  settling.add(id);
  try {
    const c = await pp.capture(id);
    if (c.status === 'PENDING') { o.status = 'pending'; store.save(); changed(); return o; }
    if (c.status !== 'COMPLETED') return o;
    o.status = 'paid';
    o.paidAt = now();
    o.capture = { id: c.captureId, gross: c.gross, fee: c.fee, net: c.net };
    for (const x of o.rides) {
      const r = S.rides[x.id];
      if (!r) continue;
      r.payment = { method: 'paypal', usd: x.usd, tip: o.kind === 'ride' ? o.tip : (r.payment && r.payment.tip) || null, tzedakah: x.tzedakah || (r.payment && r.payment.tzedakah) || 0, state: 'paid', at: now(), paidAt: now(), paypal: id };
      if (o.kind === 'ride' && o.rating) r.rating = o.rating;
    }
    store.save();
    changed();
    const net = c.net !== null && c.net !== undefined ? ` · $${c.net.toFixed(2)} after PayPal's fee` : '';
    notifyDriver(`${userName(o.uid)} paid with PayPal`, `$${o.amount.toFixed(2)}${net}`, { tag: 'money' });
    notify(o.uid, 'Paid', `$${o.amount.toFixed(2)} with PayPal. Thanks!`, { tag: 'money' });
    return o;
  } catch (e) {
    console.error('paypal capture:', e.message);
    if (['ORDER_EXPIRED', 'RESOURCE_NOT_FOUND', 'INSTRUMENT_DECLINED', 'PAYER_ACTION_REQUIRED'].includes(e.issue)) { o.status = 'failed'; store.save(); changed(); }
    return o;
  } finally {
    settling.delete(id);
  }
}

if (pp.on) setInterval(async () => {
  for (const o of Object.values(S.paypal)) {
    if (!['created', 'pending'].includes(o.status)) continue;
    if (now() - o.created > 6 * 3600e3) { o.status = 'expired'; store.save(); changed(); continue; }
    try {
      const j = await pp.getOrder(o.id);
      if (j.status === 'APPROVED' || j.status === 'COMPLETED') await settle(o.id);
      else if (j.status === 'VOIDED') { o.status = 'failed'; store.save(); changed(); }
    } catch {}
  }
}, +process.env.JEWBER_PAYPAL_POLL_MS || 60000).unref();

on('POST', '/api/rides/:id/paypal', async ({ u, params, body }) => {
  const r = rideFor(params.id, u);
  if (r.state !== 'done') fail(409, 'not-done', "The ride isn't over yet");
  if (r.payment && r.payment.state === 'paid') fail(409, 'paid', 'Already paid');
  const tip = tipFrom(body);
  let usd = money(r.fare + (tip ? tip.usd : 0));
  let tzedakah = 0;
  if (body.roundUp && usd > 0) { const up = Math.ceil(usd + 0.001); tzedakah = money(up - usd); usd = up; }
  const rating = rules.RATINGS[body.rating - 1] ? +body.rating : null;
  if (rating) { r.rating = rating; store.save(); }
  return startPaypal(u, [{ id: r.id, usd, tzedakah }], { kind: 'ride', tip, rating, fromApp: !!body.app, label: `Jewber: ${r.pickup.label} → ${r.dropoff.label}` });
});

on('POST', '/api/tab/paypal', async ({ u, body }) => {
  const rides = [];
  for (const o of owedBy(u.id).rides) {
    const r = S.rides[o.id];
    const kind = rules.payOf(r.payment ? r.payment.method : r.pay)?.kind;
    if (kind === 'treat' || kind === 'free') continue;
    rides.push({ id: r.id, usd: r.payment ? r.payment.usd : r.fare });
  }
  if (!rides.length) fail(400, 'nothing-owed', 'Nothing to pay');
  return startPaypal(u, rides, { kind: 'tab', fromApp: !!body.app, label: `Jewber tab: ${rides.length} ride${rides.length === 1 ? '' : 's'}` });
});

on('POST', '/api/paypal/:id/refund', async ({ params }) => {
  const o = S.paypal[params.id];
  if (!o) fail(404, 'no-payment');
  if (o.status !== 'paid' || !o.capture) fail(409, 'not-paid', 'Only a finished payment can be refunded');
  try {
    await pp.refund(o.capture.id);
  } catch (e) {
    console.error('paypal refund:', e.message);
    fail(502, 'paypal-refund', `PayPal said no (${e.issue || 'error'})`);
  }
  o.status = 'refunded';
  o.refundedAt = now();
  for (const x of o.rides) {
    const r = S.rides[x.id];
    if (r && r.payment && r.payment.paypal === o.id) r.payment = { ...r.payment, method: 'tab', state: 'owed', paidAt: null, refunded: now() };
  }
  store.save();
  changed();
  notify(o.uid, 'Refunded', `$${o.amount.toFixed(2)} back to your PayPal`, { tag: 'money' });
  return { ok: true };
}, driverOnly);

// Coming back from PayPal: capture, then back into the app. From the Android app PayPal opened in
// the browser, so this page sends the phone back to the app; on the web it's straight home.
async function paypalBack(req, res, url) {
  const id = url.searchParams.get('token') || '';
  const o = S.paypal[id];
  let result = 'no';
  if (o && url.pathname === '/pp/cancel') {
    if (o.status === 'created') { o.status = 'cancelled'; store.save(); changed(); }
    result = 'cancel';
  } else if (o) {
    await settle(id);
    result = o.status === 'paid' ? 'ok' : o.status === 'pending' ? 'pending' : 'no';
  }
  if (url.searchParams.get('app') !== '1') {
    res.writeHead(302, { Location: `/?paid=${result}`, 'Cache-Control': 'no-store' });
    return res.end();
  }
  const words = { ok: ['Paid', 'Thanks!'], pending: ['Almost', 'PayPal is still finishing it'], cancel: ['Cancelled', 'Nothing was paid'], no: ['Not paid', 'PayPal didn’t go through'] }[result];
  const back = `intent://open?paid=${result}#Intent;scheme=jewber;package=xyz.tiresia.jewber;end`;
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'", 'Referrer-Policy': 'no-referrer' });
  res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Jewber</title>
<meta http-equiv="refresh" content="1;url=${back}">
<body style="margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;background:#F2ECE0;color:#1C1A17;font-family:Georgia,serif;text-align:center;padding:24px">
<div style="font-size:44px;font-weight:600">${words[0]}</div><div style="font:16px system-ui,sans-serif;color:#6B6358">${words[1]}</div>
<a href="${back}" style="margin-top:12px;display:inline-flex;align-items:center;height:56px;padding:0 28px;border-radius:18px;background:#1C1A17;color:#fff;font:600 18px system-ui,sans-serif;text-decoration:none">Back to Jewber</a></body>`);
}

// ---- serving -----------------------------------------------------------------------------
const TYPES = { '.webp': 'image/webp', '.jpg': 'image/jpeg', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.apk': 'application/vnd.android.package-archive' };
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://tiles.openfreemap.org",
  "connect-src 'self' https://tiles.openfreemap.org",
  "worker-src 'self' blob:",
  "child-src blob:",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ');

function serveFile(req, res, file, extra = {}) {
  let st;
  try { st = fs.statSync(file); } catch { return false; }
  if (!st.isFile()) return false;
  const etag = `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
  const headers = {
    'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': 'private, no-cache',
    ETag: etag,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    ...extra,
  };
  if (file.endsWith('.html')) { headers['Content-Security-Policy'] = CSP; headers['Permissions-Policy'] = 'geolocation=(self), camera=(), microphone=()'; }
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); res.end(); return true; }
  headers['Content-Length'] = st.size;
  res.writeHead(200, headers);
  if (req.method === 'HEAD') res.end(); else fs.createReadStream(file).pipe(res);
  return true;
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (p === '/api/events' && req.method === 'GET') {
      const u = sessionUser(req);
      if (!u) return send(res, 401, { error: 'signed-out' });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      const c = { res, uid: u.id, last: '' };
      const body = JSON.stringify(viewFor(u));
      c.last = body.replace(/"now":\d+,/, '');
      res.write(`retry: 3000\ndata: ${body}\n\n`);
      clients.add(c);
      const ping = setInterval(() => res.write(': ping\n\n'), 25000);
      req.on('close', () => { clearInterval(ping); clients.delete(c); });
      return;
    }
    if (p.startsWith('/api/')) {
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = r.re.exec(p);
        if (!m) continue;
        const u = sessionUser(req);
        if (!r.open && !u) return send(res, 401, { error: 'signed-out' });
        if (r.driver && u.role !== 'driver') return send(res, 403, { error: 'driver-only' });
        // Writes come from our own page (a header other sites can't send without asking) or the app.
        if (req.method !== 'GET' && req.headers['x-jewber'] !== '1' && !String(req.headers.authorization || '').startsWith('Bearer ')) return send(res, 403, { error: 'csrf' });
        const body = req.method === 'GET' ? {} : await readBody(req, r.big ? 700 * 1024 : 64 * 1024);
        const out = await r.fn({ req, res, url, u, body, params: m.groups || {} });
        return send(res, 200, out);
      }
      return send(res, 404, { error: 'not-found' });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'method' });
    if (p === '/pp/return' || p === '/pp/cancel') return paypalBack(req, res, url);
    const photo = /^\/photos\/([A-Za-z0-9-]+\.(?:jpg|png|webp))$/.exec(p);
    if (photo && serveFile(req, res, path.join(PHOTOS, photo[1]), { 'Cache-Control': 'private, max-age=86400' })) return;
    // For Obtainium (and anyone): a page that links the newest APK by a name with its version in it.
    if (p === '/apk' || p === '/apk/') {
      const a = appInfo();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-cache', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" });
      return res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Jewber for Android</title>
<body style="margin:0;padding:32px 20px;background:#F2ECE0;color:#1C1A17;font:16px system-ui,sans-serif"><h1 style="font:600 34px Georgia,serif;margin:0 0 12px">Jewber for Android</h1>
${a ? `<p><a href="/apk/${a.file}" style="color:#2347D9;font-weight:600">${a.file}</a> · version ${a.version} · ${(a.size / 1024).toFixed(0)} KB</p><p style="color:#6B6358;font-size:14px">SHA-256 ${a.sha256}</p>` : '<p>No app yet</p>'}</body>`);
    }
    // Get the app: Android download and iPhone Home Screen steps, the visitor's own phone first.
    if (p === '/get' || p === '/get/') {
      let html;
      try { html = fs.readFileSync(path.join(WEB, 'get.html'), 'utf8'); } catch { return send(res, 404, { error: 'not-found' }); }
      const ua = String(req.headers['user-agent'] || '');
      const ios = /iPhone|iPad|iPod/.test(ua);
      const a = appInfo();
      html = html.replace('{{first}}', ios ? 'ios-first' : '').replaceAll('{{host}}', PUBLIC_URL.replace(/^https?:\/\//, '').replace(/[<>&"]/g, '')).replace('{{apk}}', a ? `Version ${String(a.version).replace(/[^\w.-]/g, "")} · ${a.size < 1048576 ? Math.round(a.size / 1024) + ' KB' : (a.size / 1048576).toFixed(1) + ' MB'}` : '&nbsp;');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-cache', 'Content-Security-Policy': CSP, 'Referrer-Policy': 'same-origin', 'X-Content-Type-Options': 'nosniff' });
      return res.end(req.method === 'HEAD' ? undefined : html);
    }
    const apk = /^\/apk\/(Jewber-[\d.]+\.apk)$/.exec(p);
    if (apk && serveFile(req, res, path.join(STATE, 'dist', apk[1]), { 'Content-Disposition': `attachment; filename="${apk[1]}"`, 'Cache-Control': 'no-store' })) return;
    if (p === '/Jewber.apk') {
      const a = appInfo();
      if (a && serveFile(req, res, path.join(STATE, 'dist', a.file), { 'Content-Disposition': `attachment; filename="Jewber-${a.version}.apk"`, 'Cache-Control': 'no-store' })) return;
      return send(res, 404, { error: 'no-app-yet' });
    }
    const rel = p === '/' ? '/index.html' : p;
    const file = path.normalize(path.join(WEB, rel));
    if (!file.startsWith(WEB + path.sep)) return send(res, 404, { error: 'not-found' });
    const extra = rel === '/sw.js' ? { 'Service-Worker-Allowed': '/' } : {};
    if (serveFile(req, res, file, extra)) return;
    if (!path.extname(p)) { serveFile(req, res, path.join(WEB, 'index.html')); return; }
    send(res, 404, { error: 'not-found' });
  } catch (e) {
    if (e instanceof Fail) return send(res, e.status, { error: e.code, message: e.message });
    console.error(req.method, p, e);
    if (!res.headersSent) send(res, 500, { error: 'oops', message: 'Something broke' });
  }
}

if (require.main === module) {
  refreshShabbat();
  for (const h of HOSTS) http.createServer(handle).listen(PORT, h, () => console.log(`jewber ${VERSION} on http://${h}:${PORT} (state ${STATE}${mail.on ? '' : ', no mail'}${pp.on ? ', PayPal on' : ''})`));
  const bye = () => { store.flush(); process.exit(0); };
  process.on('SIGTERM', bye);
  process.on('SIGINT', bye);
}

module.exports = { handle, store };
