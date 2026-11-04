'use strict';
// Roads and addresses from free public services: routes from OSRM's demo server, address search
// from Photon (komoot). Both ask for light use, so routes are cached, OSRM calls are spaced at
// least a second apart, and every request names this app in its User-Agent.
// When a service doesn't answer, routes fall back to a straight line at city speed.

const UA = 'Jewber/0.1 (self-hosted ride app for a few friends)';
const OSRM = process.env.JEWBER_OSRM || 'https://router.project-osrm.org';
const PHOTON = process.env.JEWBER_PHOTON || 'https://photon.komoot.io';

async function getJSON(url, ms = 8000) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`${new URL(url).host} ${r.status}`);
  return r.json();
}

// Meters between two {lat, lng}.
function meters(a, b) {
  const R = 6371e3, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

const validPoint = (p) => p && Number.isFinite(+p.lat) && Number.isFinite(+p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;

// OSRM, one call at a time with a second between them.
let queue = Promise.resolve();
let last = 0;
function spaced(fn) {
  const run = queue.then(async () => {
    const wait = last + 1100 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    return fn();
  });
  queue = run.catch(() => {});
  return run;
}

const cache = new Map();
function remember(key, value, ms) {
  cache.set(key, { value, until: Date.now() + ms });
  if (cache.size > 500) for (const [k, v] of cache) if (v.until < Date.now()) cache.delete(k);
  return value;
}

function straight(points) {
  let m = 0;
  for (let i = 1; i < points.length; i++) m += meters(points[i - 1], points[i]);
  m *= 1.35;
  return { meters: m, seconds: m / 11, line: points.map((p) => [p.lng, p.lat]), steps: [], rough: true };
}

// route([{lat,lng}, ...], {steps}) -> { meters, seconds, line: [[lng,lat]...], steps: [...] }
async function route(points, { steps = false } = {}) {
  const coords = points.map((p) => `${(+p.lng).toFixed(5)},${(+p.lat).toFixed(5)}`).join(';');
  const key = `${coords}|${steps}`;
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  try {
    const j = await spaced(() => getJSON(`${OSRM}/route/v1/driving/${coords}?overview=full&geometries=geojson${steps ? '&steps=true' : ''}`));
    const rt = j.routes && j.routes[0];
    if (!rt) throw new Error('no route');
    return remember(key, {
      meters: rt.distance,
      seconds: rt.duration,
      line: rt.geometry.coordinates.map(([x, y]) => [+x.toFixed(5), +y.toFixed(5)]),
      steps: steps ? rt.legs.flatMap((l) => l.steps).map((s) => ({
        type: s.maneuver.type,
        modifier: s.maneuver.modifier || '',
        name: s.name || s.ref || '',
        meters: Math.round(s.distance),
        at: s.maneuver.location,
      })) : [],
    }, 60000);
  } catch {
    return straight(points);
  }
}

function place(f, preferStreet = false) {
  const p = f.properties || {};
  const street = [p.housenumber, p.street].filter(Boolean).join(' ');
  const label = (preferStreet && p.housenumber && street) || p.name || street || p.city || 'Pinned spot';
  const address = [p.name ? street : '', p.city || p.district, p.state].filter(Boolean).join(', ');
  const [lng, lat] = f.geometry.coordinates;
  return { label, address, lat: +lat.toFixed(6), lng: +lng.toFixed(6) };
}

async function search(q, near) {
  q = String(q || '').trim().slice(0, 120);
  if (q.length < 2) return [];
  const bias = validPoint(near) ? `&lat=${(+near.lat).toFixed(3)}&lon=${(+near.lng).toFixed(3)}` : '';
  const key = `s|${q}|${bias}`;
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  const j = await getJSON(`${PHOTON}/api?q=${encodeURIComponent(q)}&limit=7&lang=en${bias}`);
  return remember(key, (j.features || []).map(place), 10 * 60000);
}

async function reverse(p) {
  const key = `r|${(+p.lat).toFixed(4)},${(+p.lng).toFixed(4)}`;
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  try {
    const j = await getJSON(`${PHOTON}/reverse?lat=${(+p.lat).toFixed(6)}&lon=${(+p.lng).toFixed(6)}&limit=1&lang=en`);
    const f = (j.features || [])[0];
    return remember(key, f ? { ...place(f, true), lat: +p.lat, lng: +p.lng } : { label: 'Pinned spot', address: '', lat: +p.lat, lng: +p.lng }, 30 * 60000);
  } catch {
    return { label: 'Pinned spot', address: '', lat: +p.lat, lng: +p.lng };
  }
}

module.exports = { meters, validPoint, route, search, reverse, UA };
