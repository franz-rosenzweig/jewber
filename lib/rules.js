'use strict';
// The house rules: ride types, ways to pay, fares, and the rating words. Shared with the page
// through /api/me, so there's one list.

// hint: what the driver sees on the request. Chutzpah requests jump the queue.
const TYPES = [
  { id: 'schlep', name: 'Schlep', blurb: 'The usual', add: 0, slow: 1 },
  { id: 'mensch', name: 'Mensch', blurb: 'Carries your bags', add: 2, slow: 1, hint: 'Carry the bags' },
  { id: 'shhh', name: 'Shhh', blurb: 'No small talk', add: 0, slow: 1, hint: 'No small talk' },
  { id: 'bubbe', name: 'Bubbe', blurb: 'Slow. Asks if you ate.', add: 0, slow: 1.4, hint: 'Ask if they ate' },
  { id: 'simcha', name: 'Simcha', blurb: 'Music up', add: 1, slow: 1, hint: 'Music up' },
  { id: 'chutzpah', name: 'Chutzpah', blurb: 'Cuts the line', add: 3, slow: 1, hint: 'In a rush' },
  { id: 'shadchan', name: 'Shadchan', blurb: 'Free dating advice', add: 0, slow: 1, hint: 'Ask about their love life' },
  { id: 'mishpacha', name: 'Mishpacha', blurb: 'The whole crew', add: 2, slow: 1, hint: 'Make room' },
];

// kind: 'app' opens a payment app with the amount filled in; 'cash' is handed over;
// 'tab' waits; 'treat' is paid in something baked or cooked; 'free' is a mitzvah.
const PAY = [
  { id: 'cashapp', name: 'Cash App', kind: 'app' },
  { id: 'venmo', name: 'Venmo', kind: 'app' },
  { id: 'zelle', name: 'Zelle', kind: 'app' },
  { id: 'paypal', name: 'PayPal', kind: 'app' },
  { id: 'cash', name: 'Cash', kind: 'cash' },
  { id: 'tab', name: 'My tab', kind: 'tab' },
  { id: 'babka', name: 'Babka', kind: 'treat', unit: 'babka', units: 'babkas' },
  { id: 'shabbos', name: 'Shabbos meal', kind: 'treat', unit: 'Shabbos meal', units: 'Shabbos meals' },
  { id: 'mitzvah', name: 'Mitzvah', kind: 'free' },
];

const STATUSES = [
  { id: 'driving', name: 'Driving' },
  { id: 'davening', name: 'Davening' },
  { id: 'eating', name: 'Eating' },
  { id: 'kiddush', name: 'Kiddush' },
  { id: 'costco', name: 'Costco run' },
  { id: 'simcha', name: 'At a simcha' },
  { id: 'shiva', name: 'Shiva call' },
  { id: 'errands', name: 'Errands' },
  { id: 'soon', name: 'Back soon' },
];

// A tip in blessings.
const BRACHOT = [
  'May you always find parking',
  'May all your lights be green',
  'May your kugel never burn',
  'May your check engine light stay off',
  'Health, wealth, and a parking spot',
  'May you merit a car wash',
  'Mazel tov on whatever it is',
];

// One tap and the driver feels terrible.
const KVETCHES = ['Too hot', 'Too cold', 'The music', 'Took the long way', 'Drove like a Tel Aviv cab', 'Smells like cholent', 'Too much schmooze', 'Not enough schmooze'];

// Little badges in reviews: friends give the driver, the driver gives friends.
const COMPLIMENTS = {
  driver: ['Great schmooze', 'Mensch with the bags', 'Drove like Bubbe', 'Kosher playlist', 'Car smelled like challah', 'On Jewish time', 'Shortcut genius', 'Fed me'],
  rider: ['Ready on time', 'Brought snacks', 'Great schmooze', 'Tipped in rugelach', "Didn't kvetch", 'Mensch'],
};

// Things to say about yourself.
const PROFILE = {
  kugel: ['Potato', 'Lokshen', 'Yerushalmi', 'All of them'],
  music: ['Klezmer', 'Israeli pop', 'Carlebach', 'Jewish rock', 'Podcasts', 'Silence please'],
  schmooze: ['Shhh', 'Some schmooze', 'Full schmooze'],
};

const RATINGS = ['Oy', 'Nu', 'Fine', 'Mensch', 'Tzaddik'];

const typeOf = (id) => TYPES.find((t) => t.id === id);
const payOf = (id) => PAY.find((p) => p.id === id);

// Dollars for a ride of `meters` in type `type`, rounded to the dime.
function fare(settings, meters, typeId) {
  const t = typeOf(typeId) || TYPES[0];
  const miles = meters / 1609.344;
  const raw = Math.max(+settings.minFare || 0, (+settings.base || 0) + (+settings.perMile || 0) * miles) + t.add;
  return Math.round(raw * 10) / 10;
}

function ratingWord(avg) {
  if (!avg) return '';
  return RATINGS[Math.min(4, Math.max(0, Math.round(avg) - 1))];
}

// A link that opens the payment app with the amount filled in, or null (Zelle has no such link).
function payLink(method, handles, amount, note) {
  const amt = amount.toFixed(2);
  const h = (s) => String(s || '').trim().replace(/^[@$]/, '');
  if (method === 'cashapp' && h(handles.cashapp)) return `https://cash.app/$${encodeURIComponent(h(handles.cashapp))}/${amt}`;
  if (method === 'venmo' && h(handles.venmo)) return `https://venmo.com/${encodeURIComponent(h(handles.venmo))}?txn=pay&amount=${amt}&note=${encodeURIComponent(note)}`;
  if (method === 'paypal' && h(handles.paypal)) return `https://paypal.me/${encodeURIComponent(h(handles.paypal))}/${amt}USD`;
  return null;
}

module.exports = { TYPES, PAY, STATUSES, RATINGS, BRACHOT, KVETCHES, COMPLIMENTS, PROFILE, typeOf, payOf, fare, ratingWord, payLink };
