'use strict';
// Everything Jewber knows, in one JSON file in the state directory (state.json, mode 600).
// A handful of friends and their rides fit in memory many times over; writes are debounced
// and atomic (a temp file, then rename), so a crash mid-write never leaves half a file.
const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = () => ({
  v: 1,
  // Who may sign in: email -> { name, added }. The driver's email is always allowed.
  allowed: {},
  users: {},     // id -> { id, email, name, role, phone, color, places: [], pay, created }
  sessions: {},  // sha256(token) -> { uid, created, seen, kind }
  driver: { onDuty: false, status: 'driving', loc: null },
  settings: {
    driverEmail: '',
    base: 3,
    perMile: 1.2,
    minFare: 5,
    car: '',
    plate: '',
    phone: '',
    handles: { cashapp: '', venmo: '', zelle: '', paypal: '' },
    signal: true,
    city: 'auto',
    askSeconds: 90,
    paypalFee: 'me',     // who pays PayPal's cut: 'me' (the driver) or 'friend'
    navApp: 'jewber',    // directions: Jewber's own, or open Waze / Google Maps on Accept
    chai: true,          // every 18th ride is on the house
  },
  rides: {},     // id -> ride
  paypal: {},    // PayPal order id -> { kind, uid, rides: [{id, usd}], amount, status, capture, ... }
  push: {},      // uid -> [subscription]
  kvetches: [],  // { uid, text, ride, at }
  joins: {},     // email -> { email, name, at }: people asking to be let in
});

class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'state.json');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    let data = null;
    try { data = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    const d = DEFAULTS();
    this.data = data ? { ...d, ...data, settings: { ...d.settings, ...(data.settings || {}), handles: { ...d.settings.handles, ...((data.settings || {}).handles || {}) } }, driver: { ...d.driver, ...(data.driver || {}) } } : d;
    this.timer = null;
  }

  save() {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, 200);
  }

  flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
}

module.exports = { Store };
