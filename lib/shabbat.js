'use strict';
// When Jewber is closed, and what day it is: from Hebcal for the driver's city.
// Closed: from candle lighting to havdalah, Shabbat and Yom Tov alike. A Shabbat that runs into
// Yom Tov is one long window, because Hebcal gives the second night's candle lighting instead of
// a havdalah. New rides stop 30 minutes before candle lighting so the driver gets home in time.
// The day: holidays (major, minor, modern, Rosh Chodesh) and this week's parsha, for the
// greetings, the holiday looks, and the Shabbat screen.
const { UA } = require('./geo');

const CITIES = {
  phoenix: { geonameid: 5308655, name: 'Phoenix', tz: 'America/Phoenix' },
  jerusalem: { geonameid: 281184, name: 'Jerusalem', tz: 'Asia/Jerusalem' },
};
const CUTOFF_MIN = 30;

const cache = {}; // city -> { at, windows: [{ start, end }], items }

function cityFor(setting, loc) {
  if (CITIES[setting]) return setting;
  return loc && loc.lng > 0 ? 'jerusalem' : 'phoenix';
}

async function load(city) {
  const c = cache[city];
  if (c && Date.now() - c.at < 12 * 3600e3) return c;
  const day = (d) => d.toISOString().slice(0, 10);
  const start = new Date(Date.now() - 3 * 86400e3);
  const end = new Date(Date.now() + 45 * 86400e3);
  try {
    const r = await fetch(`https://www.hebcal.com/hebcal?v=1&cfg=json&maj=on&min=on&mod=on&nx=on&s=on&c=on&M=on&geonameid=${CITIES[city].geonameid}&start=${day(start)}&end=${day(end)}`,
      { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error('hebcal ' + r.status);
    const items = (await r.json()).items || [];
    const windows = [];
    let open = null;
    for (const it of items) {
      const t = Date.parse(it.date);
      if (it.category === 'candles' && open === null) open = t;
      else if (it.category === 'havdalah' && open !== null) { windows.push({ start: open, end: t }); open = null; }
    }
    cache[city] = { at: Date.now(), windows, items };
    return cache[city];
  } catch {
    return c || { at: 0, windows: [], items: [] };
  }
}

// { city, closed, soon, start, end, cutoff } about now (or `at`): the window we're in, else the next one.
async function status(setting, loc, at = Date.now()) {
  const city = cityFor(setting, loc);
  const { windows } = await load(city);
  const w = windows.find((x) => x.end > at);
  if (!w) return { city, cityName: CITIES[city].name, closed: false, soon: false, start: null, end: null };
  const cutoff = w.start - CUTOFF_MIN * 60e3;
  return { city, cityName: CITIES[city].name, closed: at >= cutoff, lit: at >= w.start, soon: at < cutoff && w.start - at < 4 * 3600e3, start: w.start, end: w.end, cutoff };
}

// Is a ride at time t (ms) inside a closed window?
async function closedAt(setting, loc, t) {
  const { windows } = await load(cityFor(setting, loc));
  return windows.some((w) => t >= w.start - CUTOFF_MIN * 60e3 && t < w.end);
}

const HOLIDAYS = [
  [/chanukah/i, 'chanukah'], [/purim/i, 'purim'], [/pesach/i, 'pesach'], [/rosh hashana/i, 'roshhashana'],
  [/yom kippur/i, 'yomkippur'], [/sukkot|shmini atzeret|simchat torah/i, 'sukkot'], [/shavuot/i, 'shavuot'],
  [/yom haatzma/i, 'atzmaut'], [/tu bishvat/i, 'tubishvat'], [/lag baomer/i, 'lagbaomer'], [/tish.a b.av/i, 'tishabav'],
  [/rosh chodesh/i, 'roshchodesh'],
];

// Today in the city: { events: [titles], holiday: key|null, chanukah: night|null, parsha: 'Lech-Lecha' }
async function today(setting, loc, at = Date.now()) {
  const city = cityFor(setting, loc);
  const { items } = await load(city);
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: CITIES[city].tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at));
  const events = items.filter((it) => (it.category === 'holiday' || it.category === 'roshchodesh') && it.date.slice(0, 10) === ymd).map((it) => it.title);
  let holiday = null;
  for (const t of events) { const h = HOLIDAYS.find(([re]) => re.test(t)); if (h) { holiday = h[1]; break; } }
  const ch = events.map((t) => /Chanukah: (\d) Candles?/i.exec(t)).find(Boolean);
  const p = items.find((it) => it.category === 'parashat' && it.date.slice(0, 10) >= ymd);
  return { events, holiday, chanukah: ch ? +ch[1] : null, parsha: p ? p.title.replace(/^Parashat\s+/i, '') : null };
}

module.exports = { status, closedAt, today, CITIES };
