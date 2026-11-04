'use strict';
// Jewber's page: the friends' screens (light) and the driver's (night), drawn from the view the
// server pushes over /api/events. The page keeps only what's being typed or picked (L); the rest
// is the server's (V). Inside the Android app, window.JewberApp carries the driver's GPS and the
// ride notifications (android/), and the page tells it what's going on with sync().
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const APP = window.JewberApp || null;
  const ui = $('#ui');
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const onAndroid = /Android/.test(navigator.userAgent);
  const getHref = isIOS ? '/get#iphone' : onAndroid ? '/get#android' : '/get';
  const offerApp = !APP && !standalone;
  const getPillOn = () => { if (!offerApp || !(isIOS || onAndroid)) return false; try { return !localStorage.getItem('jb.getapp'); } catch { return true; } };

  let V = null;
  let skew = 0;
  const T = () => Date.now() + skew;
  const L = {
    screen: 'home', modal: null, toast: '', here: null, pay: null,
    where: null, choose: null, arr: null, nav: null, busy: false,
  };

  // ---- icons ----------------------------------------------------------------------------
  const P = {
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
    shul: '<path d="M12 3l8 14H4z"/><path d="M12 21L4 7h16z"/>',
    store: '<path d="M3 4h2l2 12h11l2-8H6"/><circle cx="9" cy="20" r="1.5"/><circle cx="17" cy="20" r="1.5"/>',
    work: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>',
    star: '<path d="M12 21s7-6 7-12a7 7 0 0 0-14 0c0 6 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>',
    back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
    chev: '<path d="M9 6l6 6-6 6"/>',
    car: '<path d="M5 16v-5l2-5h10l2 5v5"/><path d="M3 16h18"/><path d="M5 11h14"/><circle cx="7.5" cy="18" r="1.6"/><circle cx="16.5" cy="18" r="1.6"/>',
    bag: '<path d="M6 8h12l-1 12H7z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
    quiet: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9l4 6M21 9l-4 6"/>',
    bowl: '<path d="M3 11h18a9 9 0 0 1-18 0z"/><path d="M9 7c0-1.2 1.2-1.2 1.2-2.4M13.5 7c0-1.2 1.2-1.2 1.2-2.4"/>',
    music: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
    wallet: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/><circle cx="16.5" cy="14.5" r="1"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    msg: '<path d="M4 5h16v11H9l-5 4z"/>',
    phone: '<path d="M5 4h4l2 5-3 2a11 11 0 0 0 5 5l2-3 5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
    share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4"/>',
    kvetch: '<path d="M3 10v4h3l7 4V6L6 10z"/><path d="M16.5 9a4 4 0 0 1 0 6M19 6.5a7.5 7.5 0 0 1 0 11"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    check: '<path d="M5 12l5 5 9-10"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    pin: '<path d="M12 21s7-6 7-12a7 7 0 0 0-14 0c0 6 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>',
    nav: '<path d="M3 11l18-8-8 18-2-8z"/>',
    cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/>',
    babka: '<path d="M4 18v-3c0-5 4-8 8-8s8 3 8 8v3z"/><path d="M8 11c2 1 3 3 3 7M13 9c2 1 3 4 3 9"/>',
    candles: '<path d="M8 21V11M16 21V11M5 21h14"/><path d="M8 4c-1.4 1.4-1.4 3 0 4.2 1.4-1.2 1.4-2.8 0-4.2zM16 4c-1.4 1.4-1.4 3 0 4.2 1.4-1.2 1.4-2.8 0-4.2z"/>',
    heart: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>',
    bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 21h4"/>',
    left: '<path d="M10 4L4 10l6 6"/><path d="M4 10h9a7 7 0 0 1 7 7v3"/>',
    right: '<path d="M14 4l6 6-6 6"/><path d="M20 10h-9a7 7 0 0 0-7 7v3"/>',
    sleft: '<path d="M8 4H4v4"/><path d="M4 4l8 8v8"/>',
    sright: '<path d="M16 4h4v4"/><path d="M20 4l-8 8v8"/>',
    straight: '<path d="M12 20V4M6 10l6-6 6 6"/>',
    uturn: '<path d="M8 20V9a5 5 0 0 1 10 0v4"/><path d="M14 10l4 4 4-4"/>',
    flag: '<path d="M5 21V4h11l-2 4 2 4H5"/>',
    round: '<circle cx="12" cy="9" r="5"/><path d="M12 14v7"/>',
    out: '<path d="M9 21H5V3h4"/><path d="M16 17l5-5-5-5M21 12H9"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
    android: '<rect x="5" y="9" width="14" height="10" rx="2"/><path d="M8 9a4 4 0 0 1 8 0M8 5l1 2M16 5l-1 2M9 13h.01M15 13h.01"/>',
    upload: '<path d="M12 15V3M7 8l5-5 5 5"/><path d="M5 13v6h14v-6"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M5 20h14"/>',
    iphone: '<rect x="6" y="2.5" width="12" height="19" rx="3"/><path d="M10.5 18.5h3"/>',
    volume: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
    mute: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9l5 6M22 9l-5 6"/>',
    bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
    crew: '<circle cx="9" cy="8" r="3.5"/><path d="M2 20a7 7 0 0 1 14 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M22 20a7 7 0 0 0-4-6.3"/>',
  };
  const icon = (n, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[n] || ''}</svg>`;
  const starOfDavid = (sz = 14, color = '#F5B82E') => `<svg width="${sz}" height="${sz}" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l8.5 14.7H3.5z" fill="${color}"/><path d="M12 21.5L3.5 6.8h17z" fill="${color}"/></svg>`;
  const TYPE_ICON = { schlep: 'car', mensch: 'bag', shhh: 'quiet', bubbe: 'bowl', simcha: 'music', chutzpah: 'bolt', shadchan: 'heart', mishpacha: 'crew' };
  const PLACE_ICON = { home: 'home', shul: 'shul', work: 'work', store: 'store', star: 'star' };
  const TOPPER = {
    chanukah: '<path d="M-6 4h12M0 4v-6M-5 4v-3M-2.5 4v-3M2.5 4v-3M5 4v-3" stroke="#F5B82E" stroke-width="1.3" stroke-linecap="round"/><circle cx="0" cy="-3" r="1.2" fill="#FFB347"/>',
    purim: '<path d="M-4 5L0 -4 4 5z" fill="#E94F6E"/><circle cx="0" cy="-4" r="1.3" fill="#F5B82E"/>',
  };
  const carSvg = (dark, hol) => `<svg width="22" height="38" viewBox="-11 -19 22 38" aria-hidden="true"><rect x="-10" y="-17" width="20" height="34" rx="7" fill="${dark ? '#fff' : '#111216'}" stroke="${dark ? '#171B22' : '#fff'}" stroke-width="2.5"/><rect x="-7" y="-10" width="14" height="7" rx="2" fill="${dark ? '#2347D9' : '#7F96F0'}"/><rect x="-7" y="8" width="14" height="4" rx="1.5" fill="${dark ? '#2347D9' : '#7F96F0'}"/>${TOPPER[hol] || '<circle cx="0" cy="2" r="3.2" fill="#F5B82E"/>'}</svg>`;

  // ---- people: a face (their photo) or their initial; tap it for their profile
  function avatar(p, cls = '', tap = true) {
    const inner = p && p.photo
      ? `<span class="av ${cls} photo" style="background-image:url('${esc(p.photo)}')"></span>`
      : `<span class="av ${cls}"${p && p.color && cls.includes('sm') ? ` style="background:${esc(p.color)}"` : ''}>${initial(p ? p.name : '?')}</span>`;
    return tap && p && p.id ? `<button type="button" class="avbtn" data-act="profile" data-uid="${esc(p.id)}" aria-label="${esc(p.name)}">${inner}</button>` : inner;
  }

  // ---- the Jewish calendar and the fun ---------------------------------------------------
  const hebDate = (ms) => { try { return new Intl.DateTimeFormat('en-u-ca-hebrew', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(ms)); } catch { return ''; } };
  const FUN = new URLSearchParams(location.search).get('fun'); // ?fun=chanukah: a holiday's look, for trying it out
  const cal = () => {
    const c = (V && V.cal) || { events: [], holiday: null, chanukah: null, parsha: null };
    return FUN ? { ...c, holiday: FUN, chanukah: FUN === 'chanukah' ? 3 : c.chanukah } : c;
  };
  const HOLIDAY_HELLO = { chanukah: 'Happy Chanukah', purim: 'Freilichen Purim', pesach: "Chag kasher v'sameach", roshhashana: 'Shana tova', yomkippur: "G'mar chatima tova", sukkot: 'Chag sameach', shavuot: 'Chag sameach', atzmaut: "Chag Atzma'ut sameach", tubishvat: 'Happy Tu BiShvat', lagbaomer: 'Happy Lag BaOmer', roshchodesh: 'Chodesh tov', tishabav: 'Tzom kal' };
  const HOLIDAY_CHIP = { chanukah: () => `Night ${cal().chanukah || ''}`.trim(), purim: () => 'Costumes welcome', pesach: () => 'Kosher for Pesach car', sukkot: () => 'Lulav rides free', atzmaut: () => 'Yom HaAtzmaut', lagbaomer: () => 'Bonfire run', tubishvat: () => 'Dried fruit accepted', roshhashana: () => 'Apples & honey', roshchodesh: () => 'Rosh Chodesh' };
  const CONFETTI = { atzmaut: ['#0038B8', '#FFFFFF', '#7FA2FF'], chanukah: ['#2347D9', '#F5B82E', '#FFFFFF'], purim: ['#E94F6E', '#F5B82E', '#2347D9', '#3BB273', '#9B5DE5'] };
  const YIDDISH = ['Oy vey!', 'Nu?', 'Mazel tov!', 'Gevalt!', 'Kein ayin hara', 'Yalla!', 'Sababa', "L'chaim!", 'Shalom aleichem', 'Tachles'];
  const FINDING = ['1 driver nearby. It\'s {n}. It\'s always {n}.', '{n} is looking for his keys', '{n} is finishing his coffee', 'Davening for green lights', '{n} is asking his mother if he can drive', 'Calculating a route past the bakery', '{n} is putting on his good shoes'];
  const RIDE_LINES = {
    bubbe: ['Did you eat?', "Wear a sweater, it's cold in here", 'You look thin', 'Call your mother', 'There\'s rugelach in the glovebox'],
    shadchan: ['Have I got someone for you', 'A doctor. Well, almost a doctor.', "You're not getting any younger", 'Nice family. Very nice family.', 'Just meet her for coffee'],
    mishpacha: ['Everyone buckled? Count the kids.', 'Nobody touch anybody', 'Are we there yet? Almost.'],
    chutzpah: ['Cut the line. Bold.', 'You skipped three people. Mazel tov.'],
    simcha: ['Siman tov u\'mazel tov!', 'Hands up for the hora'],
  };
  const rotate = (list, every = 3500) => list[Math.floor(T() / every) % list.length];

  // Reviews, ghostwritten. {n} is who it's about.
  const GHOST = {
    driver: {
      5: ["{n} drove like a tzaddik. Asked if I ate, didn't wait for the answer, handed me rugelach anyway.", "Arrived early, which I didn't know was halachically possible. Five Stars of David.", 'Smooth ride, smooth schmooze. My mother asked if he\'s single.', 'Found parking on the first try. Moshiach must be close.', 'Better than the real Uber. Fewer ratings, more rugelach.'],
      4: ['A real mensch. Carried my bags and only mentioned it twice.', 'Good ride. The "shortcut" was mostly a tour of his favorite bakeries.', 'Would ride again. Would also eat his rugelach again.'],
      3: ['It was fine. Like a shul kiddush: nobody complains, nobody raves.', 'Got there. Not on time, but on Jewish time.', 'Decent. Carlebach on loop. Again.'],
      2: ['Nu? He got lost in a parking lot. A small one.', 'Spent the ride kvetching about the Mets. I\'m a Yankees fan.', 'The car smelled like cholent. On a Tuesday.'],
      1: ['Oy. Took the long way past his mother\'s house. Twice.', 'Oy vey. He davened Mincha at a green light.', "I'd give zero Stars of David but the app won't let me."],
    },
    rider: {
      5: ['A delight. Ready on time, which I will be telling my grandchildren about.', 'Tipped in rugelach. Tzaddik behavior.', 'Ten out of ten schmooze. Would schlep again.'],
      4: ['Good passenger. Only asked "are we there yet" twice.', 'Mensch. Didn\'t slam the door.'],
      3: ['Fine passenger. Asked to change the music only four times.', 'Showed up. Eventually.'],
      2: ['Nu. Ate a tuna sandwich in my car.', 'Backseat-drove the whole way. From the front seat.'],
      1: ['Kept the door open "to talk" for ten minutes. Oy.', 'Made me wait so long I davened Maariv in the car.'],
    },
  };
  const ghostwrite = (about, stars, name) => { const l = GHOST[about][stars] || GHOST[about][5]; return l[Math.floor(Math.random() * l.length)].replace(/\{n\}/g, name); };

  // Sounds, made on the spot: a shofar for "on the way", a chime for "here".
  let audio = null;
  const soundsOn = () => { try { return localStorage.getItem('jb.sounds') !== 'off'; } catch { return true; } };
  function sound(kind) {
    if (!soundsOn()) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      const t = audio.currentTime;
      const out = audio.createGain();
      out.connect(audio.destination);
      if (kind === 'shofar') {
        const o = audio.createOscillator(), f = audio.createBiquadFilter(), lfo = audio.createOscillator(), lg = audio.createGain();
        o.type = 'sawtooth'; f.type = 'lowpass'; f.frequency.value = 1400;
        o.frequency.setValueAtTime(196, t); o.frequency.exponentialRampToValueAtTime(294, t + 0.35); o.frequency.setValueAtTime(294, t + 1.3); o.frequency.exponentialRampToValueAtTime(330, t + 1.6);
        lfo.frequency.value = 5.5; lg.gain.value = 4; lfo.connect(lg); lg.connect(o.frequency);
        out.gain.setValueAtTime(0, t); out.gain.linearRampToValueAtTime(0.18, t + 0.12); out.gain.setValueAtTime(0.18, t + 1.45); out.gain.exponentialRampToValueAtTime(0.001, t + 1.9);
        o.connect(f); f.connect(out); o.start(t); lfo.start(t); o.stop(t + 2); lfo.stop(t + 2);
      } else {
        [880, 1109, 1319].forEach((hz, i) => {
          const o = audio.createOscillator(), g = audio.createGain();
          o.type = 'sine'; o.frequency.value = hz; o.connect(g); g.connect(out);
          g.gain.setValueAtTime(0, t + i * 0.12); g.gain.linearRampToValueAtTime(0.16, t + i * 0.12 + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.12 + 0.9);
          o.start(t + i * 0.12); o.stop(t + i * 0.12 + 1);
        });
        out.gain.value = 1;
      }
    } catch {}
  }

  // ---- formatting -----------------------------------------------------------------------
  const usd = (n) => `$${(+n || 0).toFixed(2)}`;
  const miles = (m) => `${(m / 1609.344).toFixed(1)} mi`;
  const minsOf = (s) => Math.max(1, Math.round(s / 60));
  const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const whenText = (ms) => {
    const d = new Date(ms);
    const today = new Date(T()).toDateString() === d.toDateString();
    return `${today ? 'Today' : d.toLocaleDateString([], { weekday: 'short' })} ${clock(ms)}`;
  };
  const hms = (ms) => {
    const s = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
  };
  const hm = (ms) => { const m = Math.max(0, Math.round(ms / 60000)); return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}` : `${m} min`; };
  const initial = (n) => esc((String(n || '?').trim()[0] || '?').toUpperCase());
  const payOf = (id) => V.payMethods.find((p) => p.id === id) || V.payMethods[0];
  const typeOf = (id) => V.types.find((t) => t.id === id) || V.types[0];
  const priceText = (fare, pay) => {
    const p = payOf(pay);
    if (p.kind === 'treat') return `1 ${p.unit}`;
    if (p.kind === 'free') return 'Mitzvah';
    return usd(fare);
  };
  const owedText = (o) => {
    const parts = [];
    if (o.usd) parts.push(usd(o.usd));
    for (const [k, n] of Object.entries(o.extras || {})) {
      if (k === 'rugelach') parts.push(`${n} rugelach`);
      else { const p = payOf(k); parts.push(`${n} ${n === 1 ? p.unit : p.units}`); }
    }
    return parts.join(' + ');
  };
  const pmTile = (id) => {
    const letters = { cashapp: '$', venmo: 'V', zelle: 'Z', paypal: 'P' };
    const icons = { cash: 'cash', tab: 'wallet', babka: 'babka', shabbos: 'candles', mitzvah: 'heart' };
    return `<span class="pm ${id}">${letters[id] || icon(icons[id] || 'wallet')}</span>`;
  };
  const meters = (a, b) => {
    const R = 6371e3, r = Math.PI / 180;
    const s = Math.sin((b.lat - a.lat) * r / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin((b.lng - a.lng) * r / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  };
  const roughMin = (a, b) => (a && b ? minsOf((meters(a, b) * 1.35) / 11) : null);
  const etaLeft = (eta) => (eta ? Math.max(0, eta.seconds - (T() - eta.at) / 1000) : null);
  const dist = (m) => (m < 160 ? `${Math.max(50, Math.round(m * 3.28084 / 50) * 50)} ft` : `${(m / 1609.344).toFixed(1)} mi`);

  // ---- talking to the server ------------------------------------------------------------
  async function api(method, path, body) {
    const headers = { 'X-Jewber': '1' };
    if (body) headers['Content-Type'] = 'application/json';
    const r = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
    let j = {};
    try { j = await r.json(); } catch {}
    if (r.status === 401 && !path.startsWith('/api/auth')) { signedOut(); throw new Error('Signed out'); }
    if (!r.ok) { const e = new Error(j.message || 'Something broke'); e.code = j.error; throw e; }
    return j;
  }
  async function act(fn) {
    if (L.busy) return;
    L.busy = true;
    render();
    try { await fn(); } catch (e) { toast(e.message); } finally { L.busy = false; render(); }
  }
  function toast(msg) {
    L.toast = msg;
    render();
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { L.toast = ''; render(); }, 3200);
  }

  let es = null;
  function connect() {
    if (es) es.close();
    es = new EventSource('/api/events');
    es.onmessage = (e) => setView(JSON.parse(e.data));
    es.onerror = async () => {
      try {
        const r = await fetch('/api/me', { credentials: 'same-origin' });
        if (r.status === 401) { es.close(); es = null; signedOut(); }
      } catch {}
    };
  }
  function setView(v) {
    const was = V && V.me.role;
    const before = V && V.me.role !== 'driver' && V.ride ? `${V.ride.id}|${V.ride.state}` : '';
    const after = v.me.role !== 'driver' && v.ride ? `${v.ride.id}|${v.ride.state}` : '';
    if (before && after !== before && v.ride) {
      if (v.ride.state === 'accepted') { sound('shofar'); if (navigator.vibrate) navigator.vibrate([60, 40, 60]); }
      if (v.ride.state === 'here') { sound('chime'); if (navigator.vibrate) navigator.vibrate([120, 60, 120]); }
    }
    V = v;
    skew = v.now - Date.now();
    if (was !== v.me.role) { L.screen = v.me.role === 'driver' ? 'dhome' : 'home'; }
    document.body.classList.toggle('driver', v.me.role === 'driver');
    if (!L.pay) L.pay = v.me.pay;
    syncApp();
    driverGps();
    render();
  }
  function signedOut() {
    V = null;
    L.screen = 'signin';
    L.signin = L.signin || { email: '', sent: false, code: '', err: '', pw: (() => { try { return localStorage.getItem('jb.signin') === 'password'; } catch { return false; } })() };
    if (APP && APP.signedOut) APP.signedOut();
    render();
  }

  // ---- the Android app ------------------------------------------------------------------
  let lastSync = '';
  function syncApp() {
    if (!APP || !V) return;
    const r = V.me.role === 'driver' ? V.active : V.ride;
    let line = '';
    if (r && V.me.role !== 'driver') {
      const left = etaLeft(r.eta);
      if (r.state === 'accepted') line = `${V.driver.name} · ${left !== null ? minsOf(left) + ' min away' : 'on the way'}`;
      else if (r.state === 'here') line = `${V.driver.name} is here`;
      else if (r.state === 'riding') line = `Arriving ${left !== null ? clock(T() + left * 1000) : ''}`;
      else if (r.state === 'requested') line = `Asking ${V.driver.name}`;
    }
    const s = JSON.stringify({ role: V.me.role, dark: isDark(), onDuty: !!(V.driver && V.driver.onDuty), ride: r ? r.id : null, state: r ? r.state : null, line, shabbat: !!V.shabbat.closed });
    if (s === lastSync) return;
    lastSync = s;
    try { APP.sync(s); } catch {}
  }
  function openLink(url) {
    if (APP && APP.open) { APP.open(url); return; }
    window.open(url, '_blank', 'noopener');
  }

  // ---- where am I -----------------------------------------------------------------------
  function getHere() {
    return new Promise((ok) => {
      if (APP && APP.location) {
        try { const j = JSON.parse(APP.location() || 'null'); if (j && j.lat) return ok(j); } catch {}
      }
      if (!navigator.geolocation) return ok(null);
      navigator.geolocation.getCurrentPosition(
        (p) => ok({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }),
        () => ok(null),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
      );
    });
  }
  async function refreshHere() {
    const h = await getHere();
    if (h) { L.here = h; render(); }
  }

  // The driver's GPS from the page, when there's no Android app to do it.
  let watch = null, lastSent = 0, lastFix = null;
  function driverGps() {
    const want = V && V.me.role === 'driver' && V.driver.onDuty && !APP && navigator.geolocation;
    if (want && watch === null) {
      watch = navigator.geolocation.watchPosition((p) => {
        const fix = { lat: p.coords.latitude, lng: p.coords.longitude, heading: p.coords.heading, speed: p.coords.speed, acc: p.coords.accuracy };
        const moved = lastFix ? meters(lastFix, fix) : Infinity;
        if (Date.now() - lastSent < 3000 && moved < 15) return;
        lastSent = Date.now();
        lastFix = fix;
        api('POST', '/api/driver/location', fix).catch(() => {});
      }, (e) => { if (e.code === 1) toast('Location is blocked for this page'); }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
    } else if (!want && watch !== null) {
      navigator.geolocation.clearWatch(watch);
      watch = null;
    }
  }

  // ---- the map --------------------------------------------------------------------------
  const STYLES = { light: 'https://tiles.openfreemap.org/styles/positron', dark: 'https://tiles.openfreemap.org/styles/dark' };
  let map = null, mapKind = null, mapReady = false;
  const marks = {};
  let carAnim = null, carPos = null, lastFit = '', lastLines = '';
  function ensureMap(kind) {
    if (typeof maplibregl === 'undefined') return;
    if (!map) {
      map = new maplibregl.Map({ container: 'map', style: STYLES[kind], center: [-112.074, 33.45], zoom: 12, attributionControl: { compact: true }, pitchWithRotate: false, touchPitch: false });
      map.on('rotate', compassTick);
      map.on('rotatestart', (e) => { if (!e.originalEvent) return; L.userMoved = Date.now(); if (L.locate === 'heading') setLocate('center'); });
      makeCtl();
      map.on('style.load', () => { mapReady = true; recolor(); addLayers(); lastLines = ''; render(); });
      map.on('movestart', () => { if (L.pin) { L.pin.moving = true; render(); } });
      map.on('moveend', () => { if (L.pin && L.screen === 'pin') pinMoved(); });
      // the attribution stays (OpenStreetMap asks for it), folded to its (i) button
      map.on('load', () => { const a = document.querySelector('.maplibregl-ctrl-attrib'); if (a) a.classList.remove('maplibregl-compact-show'); });
      map.on('dragstart', () => { L.userMoved = Date.now(); if (L.locate) setLocate(null); });
    } else if (kind !== mapKind) {
      mapReady = false;
      map.setStyle(STYLES[kind]);
    }
    mapKind = kind;
  }
  // ---- the map buttons: where I am, and north ----------------------------------------------
  // Locate: one tap follows you with the blue dot, a second turns the map with the phone's
  // compass, a third goes back to north-up. The compass shows when the map is turned; a tap
  // points it north again. While the driver navigates they switch heading-up and north-up.
  let ctl = null, lastScene = {}, camPad = null, lastLoc = '', wasFollow = false;
  function makeCtl() {
    if (ctl) return;
    ctl = document.createElement('div');
    ctl.id = 'mapctl';
    ctl.hidden = true;
    ctl.innerHTML = `<button type="button" class="mc compass" data-mc="north" aria-label="North up"><svg viewBox="0 0 24 24" aria-hidden="true"><path class="n" d="M12 2.5l3.6 9.5H8.4z"/><path class="s" d="M12 21.5l-3.6-9.5h7.2z"/><circle cx="12" cy="12" r="1.6" fill="#fff"/></svg></button>`
      + `<button type="button" class="mc locate" data-mc="locate" aria-label="Where I am" aria-pressed="false"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11l18-8-8 18-2-8z"/></svg></button>`;
    document.body.insertBefore(ctl, ui);
    ctl.addEventListener('click', (e) => {
      const b = e.target.closest('[data-mc]');
      if (!b) return;
      if (b.dataset.mc === 'north') north(); else locateTap();
    });
  }
  const navving = () => !!(lastScene.follow);
  const moved = () => !!(L.userMoved && Date.now() - L.userMoved < 15000);
  function myPos() {
    if (V && V.me.role === 'driver' && V.driver.onDuty && V.driver.loc) return V.driver.loc;
    return L.here || null;
  }
  function compassTick() {
    if (!ctl || !map) return;
    const b = map.getBearing();
    ctl.querySelector('.compass svg').style.transform = `rotate(${-b}deg)`;
    ctl.classList.toggle('turned', Math.abs(b) > 0.5 || L.locate === 'heading');
  }
  function ctlState() {
    if (!ctl) return;
    const on = L.locate || (navving() && !moved() && !L.northUp);
    const b = ctl.querySelector('.locate');
    b.classList.toggle('on', !!on);
    b.classList.toggle('heading', L.locate === 'heading' || (navving() && !moved() && !L.northUp));
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    compassTick();
  }
  function placeCtl(sc) {
    if (!ctl) return;
    const covered = !V || !!ui.querySelector('.sheet.full, .dpage');
    let bottom = 24;
    const sheet = ui.querySelector('.sheet:not(.full), .card, .idle');
    if (sheet) { const r = sheet.getBoundingClientRect(); if (r.right > innerWidth - 80) bottom = Math.round(innerHeight - r.top + 12); }
    ctl.hidden = covered || innerHeight - bottom - 110 < 140;
    ctl.style.bottom = bottom + 'px';
    ctl.classList.toggle('nolocate', !!sc.pinMode);
    ctlState();
  }
  // Following you: the Android app hands over its freshest fix; a browser watches.
  let hereWatch = null, herePoll = null;
  function followHere(on) {
    if (on && APP && APP.location) { if (!herePoll) herePoll = setInterval(refreshHere, 2500); return; }
    if (on && navigator.geolocation) {
      if (hereWatch === null) hereWatch = navigator.geolocation.watchPosition((p) => { L.here = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }; render(); }, () => {}, { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
      return;
    }
    if (herePoll) { clearInterval(herePoll); herePoll = null; }
    if (hereWatch !== null) { navigator.geolocation.clearWatch(hereWatch); hereWatch = null; }
  }
  function setLocate(mode) {
    const was = L.locate;
    L.locate = mode || null;
    if (mode && !was) L.locateKey = lastScene.fitKey || '';
    lastLoc = '';
    followHere(!!mode);
    if (mode === 'heading') compassOn(); else compassOff();
    ctlState();
  }
  function locCam(duration) {
    const p = myPos();
    if (!p || !map) return;
    const o = { center: ll(p), duration };
    if (camPad) o.padding = camPad;
    if (map.getZoom() < 14.5) o.zoom = 16;
    if (L.locate === 'heading' && typeof L.heading === 'number') o.bearing = L.heading;
    map.easeTo(o);
  }
  function locateTap() {
    if (!map) return;
    if (navving()) { L.userMoved = 0; L.northUp = false; render(); return; }
    if (L.locate === 'center') { setLocate('heading'); locCam(400); return; }
    if (L.locate === 'heading') { setLocate('center'); map.easeTo({ bearing: 0, duration: 400 }); return; }
    const p = myPos();
    setLocate('center');
    if (p) { locCam(700); return; }
    getHere().then((h) => {
      if (!h) { setLocate(null); toast('Location is off'); return; }
      L.here = h;
      render();
    });
  }
  function north() {
    if (!map) return;
    if (L.locate === 'heading') setLocate('center');
    if (navving()) { L.northUp = true; L.userMoved = 0; render(); return; }
    map.easeTo({ bearing: 0, pitch: 0, duration: 450 });
  }
  // The phone's compass. iPhones ask first (inside the tap); Android just answers.
  let compassFn = null, compassEv = '', compassSeen = 0, lastHeadAt = 0, lastHead = null;
  function compassOn() {
    if (compassFn) return;
    compassSeen = 0;
    lastHead = null;
    L.heading = null;
    const D = window.DeviceOrientationEvent;
    const listen = () => {
      compassFn = (e) => {
        let h = null;
        if (typeof e.webkitCompassHeading === 'number' && e.webkitCompassHeading >= 0) h = e.webkitCompassHeading;
        else if (e.absolute && typeof e.alpha === 'number') h = 360 - e.alpha;
        if (h === null) return;
        const turn = (screen.orientation && screen.orientation.angle) || 0;
        compassSeen = Date.now();
        headingTo((h + turn + 360) % 360);
      };
      compassEv = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
      addEventListener(compassEv, compassFn);
    };
    if (!D) { noCompass(); return; }
    if (typeof D.requestPermission === 'function') D.requestPermission().then((r) => (r === 'granted' ? listen() : noCompass())).catch(noCompass);
    else listen();
    setTimeout(() => { if (L.locate === 'heading' && !compassSeen) noCompass(); }, 2500);
  }
  function compassOff() {
    if (compassFn) removeEventListener(compassEv, compassFn);
    compassFn = null;
  }
  function noCompass() {
    if (L.locate !== 'heading') return;
    setLocate('center');
    toast('No compass on this device');
  }
  function headingTo(h) {
    L.heading = h;
    if (L.locate !== 'heading' || !map) return;
    const now = Date.now();
    if (now - lastHeadAt < 120) return;
    if (lastHead !== null && Math.abs(((h - lastHead + 540) % 360) - 180) < 1.5) return;
    lastHeadAt = now;
    lastHead = h;
    locCam(250);
  }

  // The free styles, recoloured: Jerusalem stone by day for friends, Selene navy for the driver.
  function recolor() {
    const dark = mapKind === 'dark';
    const set = (id, prop, val) => { try { map.setPaintProperty(id, prop, val); } catch {} };
    for (const l of map.getStyle().layers) {
      const id = l.id;
      if (l.type === 'background') set(id, 'background-color', dark ? '#0B1328' : '#F2ECE0');
      else if (l.type === 'fill') {
        if (/water/.test(id)) set(id, 'fill-color', dark ? '#0A1C3A' : '#BCD3E8');
        else if (/park|wood|grass/.test(id)) set(id, 'fill-color', dark ? '#0E1F2E' : '#DCE6C9');
        else if (/building/.test(id)) set(id, 'fill-color', dark ? '#101A35' : '#E8DFCE');
        else if (/residential|landuse/.test(id)) set(id, 'fill-color', dark ? '#0D162F' : '#EFE8DB');
      } else if (l.type === 'line') {
        if (/waterway/.test(id)) set(id, 'line-color', dark ? '#0A1C3A' : '#BCD3E8');
        else if (/casing/.test(id)) set(id, 'line-color', dark ? '#0B1328' : '#E2D7C4');
        else if (/highway_minor|highway_path/.test(id)) set(id, 'line-color', dark ? '#1A2547' : '#FFFDF8');
        else if (/major_inner|major_subtle/.test(id)) set(id, 'line-color', dark ? '#25335E' : '#FFFFFF');
        else if (/rail/.test(id) && !/dash/.test(id)) set(id, 'line-color', dark ? '#1C2850' : '#E3DACA');
        else if (/boundary/.test(id)) set(id, 'line-color', dark ? '#2E3C68' : '#C9BCA6');
      } else if (l.type === 'symbol' && l.paint && 'text-color' in l.paint) {
        set(id, 'text-color', /water/.test(id) ? (dark ? '#5D7BB0' : '#5A7BA0') : (dark ? '#8C99C2' : '#6E6457'));
        set(id, 'text-halo-color', dark ? '#0B1328' : '#F6F1E7');
      }
    }
  }
  function addLayers() {
    if (map.getSource('route')) return;
    const dark = mapKind === 'dark';
    const main = ['==', ['get', 'k'], 'main'];
    const round = { 'line-cap': 'round', 'line-join': 'round' };
    map.addSource('route', { type: 'geojson', lineMetrics: true, data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'r-done', type: 'line', source: 'route', filter: ['==', ['get', 'k'], 'done'], layout: round, paint: { 'line-color': dark ? '#3A4670' : '#B5AC9C', 'line-width': 4, 'line-dasharray': [0.3, 2] } });
    map.addLayer({ id: 'r-preview', type: 'line', source: 'route', filter: ['==', ['get', 'k'], 'preview'], layout: { 'line-cap': 'round' }, paint: { 'line-color': '#F5B82E', 'line-width': 4, 'line-dasharray': [0.3, 2.5] } });
    if (dark) map.addLayer({ id: 'r-glow', type: 'line', source: 'route', filter: main, layout: round, paint: { 'line-color': '#F5B82E', 'line-width': 18, 'line-blur': 12, 'line-opacity': 0.45 } });
    map.addLayer({ id: 'r-case', type: 'line', source: 'route', filter: main, layout: round, paint: { 'line-color': dark ? '#0B1328' : '#FFFFFF', 'line-width': 10 } });
    map.addLayer({ id: 'r-main', type: 'line', source: 'route', filter: main, layout: round, paint: dark
      ? { 'line-color': '#F5B82E', 'line-width': 5.5 }
      : { 'line-width': 5.5, 'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, '#2347D9', 1, '#1C1A17'] } });
  }
  function marker(name, lngLat, make, opts = {}) {
    const m = marks[name];
    if (!lngLat) { if (m) { m.remove(); delete marks[name]; } return null; }
    const key = opts.key || '';
    if (m && m._jkey !== key) { m.remove(); delete marks[name]; }
    if (!marks[name]) {
      const el = document.createElement('div');
      el.innerHTML = make();
      const node = el.firstElementChild;
      if (opts.onClick) { node.style.cursor = 'pointer'; node.addEventListener('click', (e) => { e.stopPropagation(); opts.onClick(); }); }
      marks[name] = new maplibregl.Marker({ element: node, anchor: opts.anchor || 'center', offset: opts.offset || [0, 0], rotationAlignment: opts.rotate ? 'map' : 'viewport' }).setLngLat(lngLat).addTo(map);
      marks[name]._jkey = key;
    } else {
      marks[name].setLngLat(lngLat);
    }
    return marks[name];
  }
  const ll = (p) => (p ? [p.lng, p.lat] : null);

  function moveCar(loc, dark) {
    if (!loc) { marker('car', null); carPos = null; return; }
    const to = [loc.lng, loc.lat];
    const hol = cal().holiday;
    const m = marker('car', carPos || to, () => `<div class="mk-car"><span class="halo"></span>${carSvg(dark, hol)}</div>`, { rotate: true, key: (dark ? 'd' : 'l') + (hol || '') });
    if (loc.heading !== null && loc.heading !== undefined) m.setRotation(loc.heading);
    if (!carPos) { carPos = to; return; }
    if (carPos[0] === to[0] && carPos[1] === to[1]) return;
    const from = carPos.slice();
    const start = performance.now();
    cancelAnimationFrame(carAnim);
    const step = (t) => {
      const k = Math.min(1, (t - start) / 1000);
      carPos = [from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k];
      m.setLngLat(carPos);
      if (k < 1) carAnim = requestAnimationFrame(step);
    };
    carAnim = requestAnimationFrame(step);
  }

  // scene: { car, carTag, me, pick, pickPulse, pickGold, drop, dropTag, pickTag, main, done, preview, fit: [points], fitKey, follow }
  function drawScene(sc) {
    const dark = !!V && isDark();
    ensureMap(dark ? 'dark' : 'light');
    if (!map || !mapReady) return;
    moveCar(sc.car, dark);
    marker('carTag', sc.carTag ? ll(sc.car) : null, () => `<div class="mk-tag">${esc(sc.carTag)}</div>`, { anchor: 'bottom', offset: [0, -30], key: sc.carTag });
    const onDuty = V.me.role === 'driver' && V.driver.onDuty && V.driver.loc;
    marker('me', ll(sc.me || (L.locate && !onDuty ? L.here : null)), () => '<div class="mk-me"></div>');
    marker('pick', ll(sc.pick), () => `<div class="mk-pick ${sc.pickGold ? 'gold' : ''} ${sc.pickPulse ? 'pulse' : ''}"></div>`, { key: `${sc.pickGold}${sc.pickPulse}` });
    const edit = sc.tagsEdit ? `<svg class="i" viewBox="0 0 24 24" style="width:14px;height:14px;margin-left:6px;vertical-align:-2px">${P.pin}</svg>` : '';
    marker('pickTag', sc.pickTag ? ll(sc.pick) : null, () => `<div class="mk-tag white">${esc(sc.pickTag)}${edit}</div>`, { anchor: 'left', offset: [16, 0], key: sc.pickTag + edit, onClick: sc.tagsEdit ? () => startPin('pick') : null });
    marker('drop', ll(sc.drop), () => '<div class="mk-drop"></div>');
    marker('dropTag', sc.dropTag ? ll(sc.drop) : null, () => `<div class="mk-tag">${esc(sc.dropTag)}${edit}</div>`, { anchor: 'bottom', offset: [0, -14], key: sc.dropTag + edit, onClick: sc.tagsEdit ? () => startPin('drop') : null });
    const feats = [];
    if (sc.main) feats.push({ type: 'Feature', properties: { k: 'main' }, geometry: { type: 'LineString', coordinates: sc.main } });
    if (sc.done) feats.push({ type: 'Feature', properties: { k: 'done' }, geometry: { type: 'LineString', coordinates: sc.done } });
    if (sc.preview) feats.push({ type: 'Feature', properties: { k: 'preview' }, geometry: { type: 'LineString', coordinates: sc.preview } });
    const lk = JSON.stringify(feats);
    if (lk !== lastLines && map.getSource('route')) { lastLines = lk; map.getSource('route').setData({ type: 'FeatureCollection', features: feats }); }
    const sheet = ui.querySelector('.sheet:not(.full), .card, .idle');
    const top = ui.querySelector('.navban') ? 130 : ui.querySelector('.statuses') ? 130 : 84;
    const bottom = sheet ? Math.min(sheet.offsetHeight, innerHeight * 0.7) + 24 : 40;
    const wide = innerWidth >= 720;
    const pad = { top, bottom: wide ? 40 : bottom, left: wide ? 470 : 40, right: 40 };
    lastScene = sc;
    camPad = pad;
    placeCtl(sc);
    if (sc.pinMode) return;
    if (sc.follow) {
      if (L.locate) setLocate(null);
      // the driver looked around: the map stays put until Recenter (or 15 seconds)
      if (moved()) return;
      wasFollow = true;
      const o = { center: ll(sc.follow), zoom: Math.max(map.getZoom(), 16), padding: pad, duration: 900, pitch: L.northUp ? 0 : 50 };
      const h = sc.follow.heading;
      if (L.northUp) o.bearing = 0;
      else if (h !== null && h !== undefined && !((sc.follow.speed || 0) < 1.5 && sc.follow.speed !== null && sc.follow.speed !== undefined)) o.bearing = h;
      map.easeTo(o);
      return;
    }
    if (wasFollow) { wasFollow = false; L.northUp = false; map.jumpTo({ pitch: 0, bearing: 0 }); }
    if (map.getPitch()) map.jumpTo({ pitch: 0 });
    // something new on screen (a ride, a different page) takes the map back from Locate
    if (L.locate && (sc.fitKey || '') !== L.locateKey) setLocate(null);
    if (L.locate) {
      const p = myPos();
      const k = p ? `${p.lat.toFixed(5)},${p.lng.toFixed(5)}|${pad.top}|${pad.bottom}|${pad.left}` : '';
      if (k && k !== lastLoc) { lastLoc = k; locCam(700); }
      return;
    }
    const pts = (sc.fit || []).filter(Boolean);
    const key = `${sc.fitKey || ''}|${pad.bottom}|${pad.top}`;
    if (!pts.length || key === lastFit) return;
    lastFit = key;
    if (pts.length === 1) { map.easeTo({ center: ll(pts[0]), zoom: 14.5, padding: pad, duration: 700 }); return; }
    const b = new maplibregl.LngLatBounds(ll(pts[0]), ll(pts[0]));
    for (const p of pts) b.extend(ll(p));
    for (const c of sc.main || []) b.extend(c);
    map.fitBounds(b, { padding: pad, maxZoom: 16, duration: 700 });
  }

  // ---- drawing --------------------------------------------------------------------------
  let lastHtml = '';
  function patch(html) {
    if (html === lastHtml) return;
    lastHtml = html;
    const a = document.activeElement;
    const id = a && a.id && ui.contains(a) ? a.id : null;
    const sel = id && 'selectionStart' in a ? [a.selectionStart, a.selectionEnd] : null;
    const scrolls = [...ui.querySelectorAll('[data-keep]')].map((el) => [el.dataset.keep, el.scrollTop]);
    ui.innerHTML = html;
    for (const [k, top] of scrolls) { const el = ui.querySelector(`[data-keep="${k}"]`); if (el) el.scrollTop = top; }
    if (id) {
      const el = document.getElementById(id);
      if (el) { el.focus({ preventScroll: true }); if (sel && el.setSelectionRange) try { el.setSelectionRange(sel[0], sel[1]); } catch {} }
    }
  }

  // The sky at the top follows the hour.
  // Light, dark, or as the phone is. Friends start with the phone's choice, the driver with night.
  const themePref = () => { try { return localStorage.getItem('jb.theme') || (V && V.me.role === 'driver' ? 'dark' : 'auto'); } catch { return 'auto'; } };
  const isDark = () => { const p = themePref(); return p === 'dark' || (p === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches); };
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { lastSync = ''; syncApp(); render(); });

  function tod() {
    const d = new Date(T());
    const h = d.getHours() + d.getMinutes() / 60;
    return h >= 5 && h < 8 ? 'dawn' : h >= 8 && h < 16.5 ? 'day' : h >= 16.5 && h < 19 ? 'golden' : 'night';
  }
  function greeting() {
    const d = new Date(T());
    const h = d.getHours();
    if (HOLIDAY_HELLO[cal().holiday]) return HOLIDAY_HELLO[cal().holiday];
    if (d.getDay() === 5 && h >= 12) return 'Shabbat Shalom';
    if (d.getDay() === 6 && !V.shabbat.closed) return 'Shavua tov';
    return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  }

  let lastScreen = '';
  function render() {
    let out, key;
    if (!V) { key = L.screen === 'signin' ? 'signin' : 'none'; out = key === 'signin' ? scrSignin() : { html: '', scene: {} }; }
    else if (V.me.role === 'driver') { key = driverScreen(); out = DRIVER[key](); }
    else { key = riderScreen(); out = RIDER[key](); }
    document.body.classList.toggle('driver', !!(V && V.me.role === 'driver'));
    const dark = !!V && isDark();
    document.body.classList.toggle('dark', dark);
    const tc = document.querySelector('meta[name="theme-color"]');
    if (tc) tc.content = !V ? '#1A2E9A' : dark ? '#0B1328' : '#F2ECE0';
    for (const t of ['dawn', 'day', 'golden', 'night']) document.body.classList.toggle('t-' + t, t === tod());
    // a new screen rises into place; the same screen redrawn (a countdown ticking) doesn't
    const entering = key !== lastScreen;
    lastScreen = key;
    if (!entering) ui.classList.remove('enter');
    const extra = (L.modal ? MODALS[L.modal.kind]() : '') + (L.toast ? `<div class="toast" role="status">${esc(L.toast)}</div>` : '');
    if (entering) { ui.classList.add('enter'); lastHtml = ''; }
    patch(out.html + extra);
    if (V) drawScene(out.scene || {});
    else if (ctl) ctl.hidden = true;
  }

  // A burst of gold and blue Stars of David, once per arrival.
  const celebrated = new Set();
  function celebrate(key) {
    if (celebrated.has(key) || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    celebrated.add(key);
    const cv = document.createElement('canvas');
    cv.className = 'confetti';
    document.body.appendChild(cv);
    const dpr = Math.min(2, devicePixelRatio || 1);
    cv.width = innerWidth * dpr;
    cv.height = innerHeight * dpr;
    const g = cv.getContext('2d');
    g.scale(dpr, dpr);
    const colors = CONFETTI[cal().holiday] || ['#F5B82E', '#E9A92C', '#2347D9', '#7F96F0', '#FFE08A'];
    const parts = Array.from({ length: 70 }, () => ({ x: innerWidth / 2 + (Math.random() - 0.5) * 90, y: innerHeight * 0.58, vx: (Math.random() - 0.5) * 10, vy: -7 - Math.random() * 9, r: 5 + Math.random() * 6, a: Math.random() * 6.28, va: (Math.random() - 0.5) * 0.3, c: colors[Math.floor(Math.random() * colors.length)] }));
    const star = (x, y, r, a, c) => {
      g.save(); g.translate(x, y); g.rotate(a); g.fillStyle = c;
      for (const k of [0, Math.PI]) {
        g.beginPath();
        for (let i = 0; i < 3; i++) { const t = k + (i * 2 * Math.PI) / 3 - Math.PI / 2; if (i) g.lineTo(Math.cos(t) * r, Math.sin(t) * r); else g.moveTo(Math.cos(t) * r, Math.sin(t) * r); }
        g.closePath(); g.fill();
      }
      g.restore();
    };
    const t0 = performance.now();
    const step = (t) => {
      const k = (t - t0) / 1000;
      g.clearRect(0, 0, innerWidth, innerHeight);
      g.globalAlpha = Math.max(0, 1 - k / 2.6);
      for (const p of parts) { p.vy += 0.32; p.x += p.vx; p.y += p.vy; p.vx *= 0.99; p.a += p.va; star(p.x, p.y, p.r, p.a, p.c); }
      if (k < 2.6) requestAnimationFrame(step); else cv.remove();
    };
    requestAnimationFrame(step);
  }

  // ---- sign in --------------------------------------------------------------------------
  function scrSignin() {
    const s = L.signin;
    if (s.pw) return scrPassword(s);
    const digits = (s.code || '').split('');
    const boxes = Array.from({ length: 6 }, (_, i) => `<span class="${digits[i] ? 'f' : i === digits.length ? 'c' : ''}">${esc(digits[i] || '')}</span>`).join('');
    return {
      html: `
      ${scrSignin.hero}
      <form class="signin" data-form="${s.join ? 'join' : s.sent ? 'verify' : 'code'}">
        <div><label class="lab" for="email">Email</label>
        <input id="email" class="field" type="email" autocomplete="email" inputmode="email" data-bind="signin.email" value="${esc(s.email)}" ${s.sent ? 'readonly' : ''} required></div>
        ${s.sent ? `<div><label class="lab" for="code">Code</label><label class="code"><input id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" data-bind="signin.code" value="${esc(s.code)}" aria-label="Code">${boxes}</label></div>` : ''}
        ${s.join ? `<div><label class="lab" for="jname">Your name</label><input id="jname" class="field" autocomplete="name" data-bind="signin.name" value="${esc(s.name || '')}" required></div>` : ''}
        <div class="err" role="alert">${esc(s.err || '')}</div>
        <div class="spacer"></div>
        ${s.asked ? `<div class="say">${icon('check')}Sent. You'll get an email.</div>` : `<button class="btn" type="submit" ${L.busy ? 'disabled' : ''}>${s.join ? 'Ask to join' : s.sent ? 'Sign in' : 'Send code'}</button>`}
        ${s.sent ? '<button class="link" type="button" data-act="newCode">New code</button>' : s.join || s.asked ? '<button class="link muted" type="button" data-act="backToSignIn">Sign in</button>' : '<div class="row" style="justify-content:center;gap:18px"><button class="link" type="button" data-act="usePw">Use a password</button><button class="link muted" type="button" data-act="askJoin">New here? Ask to join</button></div>'}
        ${offerApp && !s.sent && !s.join && !s.asked ? `<a class="link muted getlink" href="${getHref}">${icon('download')}Get the app</a>` : ''}
      </form>`,
    };
  }

  scrSignin.hero = `
      <div class="hero">
        <svg class="skyline" viewBox="0 0 390 70" preserveAspectRatio="xMidYMax slice" aria-hidden="true"><path fill="#fff" d="M0 70V52h14v-6h6v6h10V40h8v-6h6v6h8v30zM60 70V48h6v-5h5v5h6v-5h5v5h6V30a14 14 0 0 1 28 0v40zM118 70V54h20v-8h6v8h14V44h4v-6h4v6h4v26zM176 70V50h8V30c0-4 6-4 6 0v14h6v-8c0-4 6-4 6 0v12h4v22zM212 70V56h22v-4h6v4h18V42h10v-6h10v6h10v28zM290 70V46h4v-5h5v5h5v-5h5v5h5V36h16v34zM342 70V44c0-5 7-5 7 0v8h7V34c0-5 7-5 7 0v18h8v-8c0-5 7-5 7 0v26z"/></svg>
        <div class="road"></div>
        <div class="logo">Jewber</div>
        <svg class="car" width="170" height="78" viewBox="0 0 170 78" aria-hidden="true"><rect x="70" y="2" width="30" height="13" rx="4" fill="#F5B82E"/><path d="M80 12h10" stroke="#111216" stroke-width="2.4" stroke-linecap="round"/><path d="M14 56V44c0-6 4-9 10-10l24-3 16-15c3-2 6-3 10-3h30c6 0 10 2 13 6l11 13 22 4c6 1 10 5 10 11v9z" fill="#fff"/><path d="M54 32l13-13c1.5-1 3-1.5 5-1.5h12V32z" fill="#9EB0F5"/><path d="M89 17.5h14c3 0 5.5 1 7 3l9 11.5H89z" fill="#9EB0F5"/><circle cx="44" cy="58" r="13" fill="#111216"/><circle cx="44" cy="58" r="5" fill="#C9CBD1"/><circle cx="128" cy="58" r="13" fill="#111216"/><circle cx="128" cy="58" r="5" fill="#C9CBD1"/><rect x="150" y="42" width="8" height="5" rx="2" fill="#F5B82E"/></svg>
      </div>
`;

  function scrPassword(s) {
    const html = scrSignin.hero + `
      <form class="signin" data-form="password">
        <div><label class="lab" for="login">Email or username</label>
        <input id="login" class="field" autocomplete="username" autocapitalize="none" spellcheck="false" data-bind="signin.login" value="${esc(s.login || s.email || '')}" required></div>
        <div><label class="lab" for="pass">Password</label>
        <input id="pass" class="field" type="password" autocomplete="current-password" data-bind="signin.pass" value="${esc(s.pass || '')}" required></div>
        <div class="err" role="alert">${esc(s.err || '')}</div>
        <div class="spacer"></div>
        <button class="btn" type="submit" ${L.busy ? 'disabled' : ''}>Sign in</button>
        <button class="link" type="button" data-act="useCode">Use a code instead</button>
      </form>`;
    return { html };
  }

  // ---- the friends' side ----------------------------------------------------------------
  function riderScreen() {
    const r = V.ride;
    if (r) {
      if (r.state === 'requested') return 'finding';
      if (r.state === 'accepted' || r.state === 'here') return 'coming';
      if (r.state === 'riding') return 'riding';
      if (r.state === 'done') return 'arrived';
      return 'nope';
    }
    if (['where', 'choose', 'tab', 'account', 'rides', 'pin', 'profile'].includes(L.screen)) return L.screen;
    if (V.shabbat.closed || (FUN === 'shabbat' && V.shabbat.end)) return 'shabbat';
    return 'home';
  }

  function shabbatChip() {
    const s = V.shabbat;
    if (!s || !s.soon || s.closed) return '';
    return `<div class="pill gold">${icon('candles')}Shabbat in ${hm(s.start - T())}</div>`;
  }

  function tabsNav(on) {
    const b = (id, ic, label) => `<button type="button" class="${on === id ? 'on' : ''}" data-act="go" data-to="${id}">${icon(ic)}${label}</button>`;
    return `<nav class="tabs" aria-label="Main">${b('home', 'home', 'Home')}${b('rides', 'list', 'Rides')}${b('tab', 'wallet', 'Tab')}${b('account', 'user', 'Account')}</nav>`;
  }

  function driverRow() {
    const d = V.driver;
    const st = V.statuses.find((x) => x.id === d.status);
    const sub = !d.onDuty ? 'Off duty' : d.busy ? 'On a ride' : st && st.id !== 'driving' ? st.name : 'On duty';
    const m = d.onDuty && !d.busy ? roughMin(d.loc, L.here) : null;
    return `<div class="drv">
      ${avatar(d)}
      <div class="col grow"><div style="font-weight:600">${esc(d.name)}</div><div class="row muted small" style="gap:6px">${d.onDuty ? '<span class="dot"></span>' : ''}${esc(sub)}</div></div>
      ${m ? `<div class="mins"><b>${m}</b><small>min</small></div>` : ''}
    </div>`;
  }

  function placeRow(p, actName, extra = '') {
    return `<button type="button" class="place" data-act="${actName}" ${extra}>
      <span class="ic">${icon(PLACE_ICON[p.icon] || 'pin')}</span>
      <span class="grow" style="min-width:0"><b>${esc(p.label)}</b>${p.address ? `<small>${esc(p.address)}</small>` : ''}</span>
      ${L.here ? `<span class="muted">${miles(meters(L.here, p) * 1.2)}</span>` : ''}
    </button>`;
  }

  const RIDER = {
    home() {
      const places = [...V.me.places, ...V.recent.filter((r) => !V.me.places.some((p) => p.label === r.label)).map((r) => ({ ...r, icon: 'clock' }))].slice(0, 4);
      const booked = V.booked.map((r) => `<div class="li"><span class="place"><span class="ic">${icon('clock')}</span></span><div class="grow"><b>${esc(whenText(r.when))} · ${esc(r.dropoff.label)}</b><small>${r.state === 'booked' ? 'Booked' : `Asking ${esc(V.driver.name)}`}</small></div><button class="link muted" data-act="cancelRide" data-id="${r.id}">Cancel</button></div>`).join('');
      const d = V.driver;
      return {
        html: `
        <div class="top"><button type="button" class="pill" data-act="logo" aria-label="Jewber"><span class="logo">Jewber</span></button><div class="row">${HOLIDAY_CHIP[cal().holiday] ? `<div class="pill gold">${esc(HOLIDAY_CHIP[cal().holiday]())}</div>` : getPillOn() ? `<button type="button" class="pill getapp" data-act="getApp">${icon('download')}Get the app</button>` : ''}${shabbatChip()}<button class="round" data-act="go" data-to="account" aria-label="Account" style="${V.me.photo ? `background:center/cover url('${esc(V.me.photo)}')` : ''}">${V.me.photo ? '' : initial(V.me.name)}</button></div></div>
        <section class="sheet flush" data-keep="home">
          <div class="handle"></div>
          <div class="hello"><div class="col"><div class="kicker">${esc(new Date(T()).toLocaleDateString([], { weekday: 'long' }))} · ${esc(hebDate(T()))}${cal().parsha && [4, 5, 6].includes(new Date(T()).getDay()) ? ` · ${esc(cal().parsha)}` : ''}</div><div class="display">${esc(greeting())}, ${esc(V.me.name)}</div></div></div>
          ${driverRow()}
          <button type="button" class="where" data-act="whereTo">${icon('search')}<b>Where to?</b><span class="now">${icon('clock')}${d.onDuty ? 'Now' : 'Later'}</span></button>
          ${booked ? `<div class="list">${booked}</div>` : ''}
          ${places.length ? `<div class="bento">${places.map((p, i) => `<button type="button" class="tile" data-act="goPlace" data-i="${i}"><span class="ic">${icon(PLACE_ICON[p.icon] || 'pin')}</span><span style="min-width:0;max-width:100%"><b class="ellipsis">${esc(p.label)}</b><small class="ellipsis">${L.here ? miles(meters(L.here, p) * 1.2) : esc(p.address || '')}</small></span></button>`).join('')}</div>` : ''}
          ${tabsNav('home')}
        </section>`,
        scene: {
          car: d.loc, carTag: d.loc && d.onDuty ? `${d.name}${roughMin(d.loc, L.here) ? ' · ' + roughMin(d.loc, L.here) + ' min' : ''}` : null,
          me: L.here, fit: [L.here, d.loc], fitKey: `home${!!L.here}${!!d.loc}`,
        },
        places,
      };
    },

    where() {
      const w = L.where;
      const pickLabel = w.pick ? w.pick.label : 'Current location';
      let rows = '';
      if (w.results && w.q) {
        rows = w.results.map((p, i) => placeRow({ ...p, icon: 'pin' }, 'pickResult', `data-i="${i}"`)).join('') || `<div class="muted" style="padding:12px 0">${w.searching ? '…' : 'Nothing found'}</div>`;
      } else {
        const list = [...V.me.places, ...V.recent.map((r) => ({ ...r, icon: 'clock' }))];
        if (w.focus === 'pick') rows += `<button type="button" class="place" data-act="pickHere"><span class="ic">${icon('nav')}</span><span class="grow"><b>Current location</b></span></button>`;
        rows += `<button type="button" class="place" data-act="pinStart"><span class="ic">${icon('pin')}</span><span class="grow"><b>Set on map</b></span></button>`;
        rows += list.map((p, i) => placeRow(p, 'pickSaved', `data-i="${i}"`)).join('');
      }
      return {
        html: `
        <section class="sheet full" data-keep="where">
          <div class="row"><button class="round flat" data-act="back" aria-label="Back">${icon('back')}</button>
          <div class="h2 grow">${w.save ? 'Add a place' : w.when ? esc(whenText(w.when)) : 'Where to?'}</div>
          ${w.save ? '' : `<button class="chip" data-act="openWhen">${icon('clock')}${w.when ? 'Change' : 'Later'}</button>`}</div>
          <div class="fields">
            ${w.save ? '' : '<div class="rail"><i></i><span></span><i class="sq"></i></div>'}
            <div class="ins">
              ${w.save ? '' : `<label class="sr" for="f-pick">Pickup</label><input id="f-pick" class="field" data-bind="where.qpick" data-focus="pick" placeholder="${esc(pickLabel)}" value="${w.focus === 'pick' ? esc(w.q) : ''}" autocomplete="off">`}
              <label class="sr" for="f-drop">Destination</label>
              <input id="f-drop" class="field" data-bind="where.qdrop" data-focus="drop" placeholder="${esc(w.drop ? w.drop.label : 'Where to?')}" value="${w.focus === 'drop' ? esc(w.q) : ''}" autocomplete="off">
            </div>
          </div>
          <div class="results">${rows}</div>
        </section>`,
        scene: {},
      };
    },

    pin() {
      const pn = L.pin;
      const title = pn.focus === 'pick' ? 'Pickup' : L.where && L.where.save ? 'New place' : 'Destination';
      return {
        html: `
        <div class="top"><button class="round" data-act="pinBack" aria-label="Back">${icon('back')}</button><div class="pill">${esc(title)}</div><button class="round" data-act="pinMe" aria-label="Where I am">${icon('nav')}</button></div>
        <div class="pinbox" aria-hidden="true"><span class="pinshadow"></span><div class="pinmark ${pn.focus === 'pick' ? 'pick' : 'drop'} ${pn.moving ? 'up' : ''}"><span class="head"></span><span class="stem"></span></div></div>
        <section class="sheet pinsheet">
          <div class="handle"></div>
          <div class="col" style="gap:4px"><div class="kicker">${esc(title)}</div><div class="h2 ellipsis">${pn.place && !pn.moving ? esc(pn.place.label) : '…'}</div><div class="muted ellipsis">${pn.place && !pn.moving ? esc(pn.place.address || '') : ''}&nbsp;</div></div>
          <button class="btn" data-act="pinOk" ${!pn.place || pn.moving ? 'disabled' : ''}>${pn.focus === 'pick' ? 'Set pickup' : L.where && L.where.save ? 'Use this spot' : 'Set destination'}</button>
        </section>`,
        scene: { me: L.here, pinMode: true },
      };
    },

    choose() {
      const c = L.choose;
      const q = c.quote;
      const w = L.where;
      const d = V.driver;
      const later = !!w.when;
      const canNow = d.onDuty && !d.busy && !V.shabbat.closed;
      const types = V.types.map((t) => `<button type="button" class="type ${c.type === t.id ? 'on' : ''}" data-act="pickType" data-id="${t.id}" aria-pressed="${c.type === t.id}">
        <span class="ic">${icon(TYPE_ICON[t.id])}</span>
        <span class="grow"><b>${esc(t.name)}</b><small>${esc(t.blurb)}</small></span>
        <span class="price"><b>${q ? (q.chai ? 'Free' : esc(priceText(q.prices[t.id], L.pay))) : '…'}</b><small>${q ? (later ? q.minutes[t.id] + ' min ride' : (q.pickupSeconds !== null ? minsOf(q.pickupSeconds) + ' min away' : q.minutes[t.id] + ' min')) : ''}</small></span>
      </button>`).join('');
      const p = payOf(L.pay);
      const tname = typeOf(c.type).name;
      let btn;
      if (later) btn = `<button class="btn" data-act="request" ${!q || L.busy ? 'disabled' : ''}>Book ${esc(tname)}</button>`;
      else if (canNow) btn = `<button class="btn" data-act="request" ${!q || L.busy ? 'disabled' : ''}>Request ${esc(tname)}</button>`;
      else btn = `<button class="btn" data-act="openWhen">${V.shabbat.closed ? 'Book for Motzei Shabbat' : d.busy ? `${esc(d.name)} is on a ride · Book` : `${esc(d.name)} is off duty · Book`}</button>`;
      return {
        html: `
        <div class="top"><button class="round" data-act="back" aria-label="Back">${icon('back')}</button></div>
        <section class="sheet" data-keep="choose">
          <div class="handle"></div>
          <div class="row between"><div class="col"><div class="kicker">${later ? esc(whenText(w.when)) : `To ${esc(c.drop.label)}`}</div><div class="h2">Choose a ride</div></div>${q ? `<span class="chip">${miles(q.meters)}</span>` : ''}</div>
          ${c.err ? `<div class="err">${esc(c.err)}</div>` : ''}
          ${q && q.chai ? `<div class="say">${starOfDavid(22)}<span>Ride #${V.chai.done + 1}: a chai ride. It's on the house.</span></div>` : ''}
          <div class="types">${types}</div>
          <button type="button" class="payrow" data-act="openPay">${pmTile(p.id)}<span class="grow" style="font-size:16px;font-weight:600">${esc(p.name)}</span>${icon('chev')}</button>
          <div class="row">${btn}${later || !canNow ? '' : `<button class="btn soft sq" data-act="openWhen" aria-label="Schedule for later">${icon('clock')}</button>`}</div>
        </section>`,
        scene: {
          pick: L.choose.pick, drop: L.choose.drop, pickTag: L.choose.pick.label, tagsEdit: true,
          dropTag: q ? `${L.choose.drop.label} · ${q.minutes[c.type]} min` : L.choose.drop.label,
          main: q ? q.line : null, car: d.loc, fit: [L.choose.pick, L.choose.drop], fitKey: `choose${L.choose.pick.lat}${L.choose.drop.lat}${!!q}`,
        },
      };
    },

    finding() {
      const r = V.ride;
      const left = r.expires ? r.expires - T() : null;
      return {
        html: `
        <section class="sheet">
          <div class="handle"></div>
          <div class="row between"><div class="col"><div class="kicker">${esc(typeOf(r.type).name)} · ${esc(priceText(r.fare, r.pay))}</div><div class="h1">Asking ${esc(V.driver.name)}…</div></div><span class="num" style="font-size:22px">${left !== null ? hms(left) : ''}</span></div>
          <div class="bar"><i></i></div>
          <div class="say">${avatar(V.driver, 'md', false)}<span>${esc(rotate(FINDING).replace(/\{n\}/g, V.driver.name))}</span></div>
          <div class="trip"><div class="rail"><i></i><span></span><i class="sq"></i></div>
            <div class="stops"><div class="ellipsis">${esc(r.pickup.label)}</div><div class="ellipsis">${esc(r.dropoff.label)}</div></div>
            <div class="stops" style="flex-grow:0;align-items:flex-end"><b>${esc(priceText(r.fare, r.pay))}</b><span class="muted">${esc(typeOf(r.type).name)} · ${esc(payOf(r.pay).name)}</span></div>
          </div>
          <button class="btn out" data-act="cancelRide" data-id="${r.id}">Cancel</button>
        </section>`,
        scene: { pick: r.pickup, pickPulse: true, car: V.driver.loc, fit: [r.pickup, V.driver.loc], fitKey: 'finding' + r.id },
      };
    },

    coming() {
      const r = V.ride;
      const d = V.driver;
      const here = r.state === 'here';
      const left = etaLeft(r.eta);
      const st = V.statuses.find((x) => x.id === d.status);
      const phone = d.phone ? d.phone.replace(/[^\d+]/g, '') : '';
      return {
        html: `
        <div class="center-top"><div class="pill ink">${here ? 'Meet at the car' : `Meet at ${esc(r.pickup.label)}`}</div>${shabbatChip()}</div>
        <section class="sheet">
          <div class="handle"></div>
          <div class="row between">
            <div class="col"><div class="h2">${here ? `${esc(d.name)} is here` : `${esc(d.name)}'s on the way`}</div>
            <div class="muted">${here ? esc([d.car, d.plate].filter(Boolean).join(' · ') || 'Out front') : st && st.id !== 'driving' ? esc(st.name) : esc(r.pickup.label)}</div></div>
            ${here ? '' : `<div class="col" style="align-items:center;gap:4px">${etaRing(r, left)}${left !== null ? `<span class="jst" title="Jewish Standard Time">JST ${Math.max(2, Math.round(minsOf(left) * 1.5 + 5))} min</span>` : ''}</div>`}
          </div>
          <div class="dcard">
            ${avatar(d, 'lg')}
            <div class="col grow"><div style="font-size:17px;font-weight:700">${esc(d.name)}</div>
            <div class="row muted small" style="gap:5px">${starOfDavid()}${d.rating ? `${d.rating.avg.toFixed(2)} · ${esc(d.rating.word)}` : 'New'}</div></div>
            ${d.plate || d.car ? `<div class="col" style="align-items:flex-end;gap:4px">${d.plate ? `<span class="plate">${esc(d.plate)}</span>` : ''}${d.car ? `<span class="muted small">${esc(d.car)}</span>` : ''}</div>` : ''}
          </div>
          <div class="acts">
            ${phone ? `<a class="act" href="sms:${esc(phone)}"><span>${icon('msg')}</span>Message</a><a class="act" href="tel:${esc(phone)}"><span>${icon('phone')}</span>Call</a>` : `<button class="act" disabled><span>${icon('msg')}</span>Message</button><button class="act" disabled><span>${icon('phone')}</span>Call</button>`}
            <button class="act" data-act="share"><span>${icon('share')}</span>Share</button>
            <button class="act" data-act="openKvetch"><span>${icon('kvetch')}</span>Kvetch</button>
          </div>
          <button class="link muted" data-act="cancelRide" data-id="${r.id}">Cancel ride</button>
        </section>`,
        scene: { car: d.loc, pick: r.pickup, main: here ? null : (r.eta ? r.eta.line : null), fit: [r.pickup, d.loc], fitKey: `coming${r.id}${r.state}${!!d.loc}` },
      };
    },

    riding() {
      const r = V.ride;
      const d = V.driver;
      const left = etaLeft(r.eta);
      const total = r.seconds || 1;
      const done = left !== null ? Math.min(98, Math.max(4, 100 - (left / total) * 100)) : 10;
      return {
        html: `
        <div class="center-top"><div class="pill ink">Heading to ${esc(r.dropoff.label)}</div>${shabbatChip()}</div>
        <section class="sheet">
          <div class="handle"></div>
          <div class="row between"><div class="col"><div class="kicker">Arriving</div><div class="num" style="font-size:46px;line-height:1">${left !== null ? esc(clock(T() + left * 1000)) : '…'}</div></div>${left !== null ? `<span class="chip">${minsOf(left)} min</span>` : ''}</div>
          <div class="ridebar" style="--w:${done.toFixed(0)}%"><span class="done"></span><span class="car">${icon('car')}</span><span class="flag"></span></div>
          ${RIDE_LINES[r.type] ? `<div class="say">${avatar(d, 'md', false)}<span>“${esc(rotate(RIDE_LINES[r.type], 6000))}”</span></div>` : ''}
          <div class="row">${avatar(d)}<div class="col grow"><div style="font-weight:600">${esc(d.name)}</div><div class="muted small">${esc([d.car, d.plate].filter(Boolean).join(' · '))}</div></div><span class="chip">${esc(typeOf(r.type).name)}</span></div>
          <button type="button" class="switchrow simcha ${r.simcha ? 'on' : ''}" data-act="simcha" aria-pressed="${r.simcha}">${icon('music')}<span class="grow">Simcha mode</span><span class="toggle"></span></button>
          <div class="pills3">
            <button class="opill" data-act="share">${icon('share')}Share</button>
            <button class="opill" data-act="openKvetch">${icon('kvetch')}Kvetch</button>
            ${d.phone ? `<a class="opill" href="tel:${esc(d.phone.replace(/[^\d+]/g, ''))}" style="text-decoration:none">${icon('phone')}Call</a>` : `<button class="opill" disabled>${icon('phone')}Call</button>`}
          </div>
        </section>`,
        scene: { car: d.loc, drop: r.dropoff, main: r.eta ? r.eta.line : r.line, fit: [d.loc, r.dropoff], fitKey: 'riding' + r.id },
      };
    },

    arrived() {
      const r = V.ride;
      const a = L.arr && L.arr.id === r.id ? L.arr : (L.arr = { id: r.id, rating: 5, tip: null, method: r.chai ? 'mitzvah' : r.pay, chips: [], text: '', words: false, roundUp: false });
      setTimeout(() => celebrate('arr' + r.id), 250);
      const p = payOf(a.method);
      const tipUsd = a.tip && a.tip.kind === 'usd' ? a.tip.usd : 0;
      let total = (p.kind === 'treat' || p.kind === 'free' ? 0 : r.fare) + tipUsd;
      const canRound = total > 0 && ['app', 'cash', 'tab'].includes(p.kind);
      const up = canRound && a.roundUp ? Math.ceil(total + 0.001) - total : 0;
      total += up;
      let label;
      if (p.kind === 'tab') label = 'Put it on my tab';
      else if (p.kind === 'treat') label = `Owe 1 ${p.unit}${tipUsd ? ` + ${usd(tipUsd)}` : ''}`;
      else if (p.kind === 'free') label = tipUsd ? `Pay ${usd(tipUsd)} tip` : r.chai ? 'Done · chai ride' : 'Done';
      else if (p.kind === 'cash') label = `Paid ${usd(total)} cash`;
      else label = `Pay ${usd(total)}`;
      const ppc = a.method === 'paypal' && V.paypalCheckout;
      const ppFee = ppc && V.paypalFee ? withFee(total) - total : 0;
      if (ppc) label = `Pay ${usd(total + ppFee)} with PayPal`;
      const rates = V.ratings.map((w, i) => `<button type="button" class="rate ${a.rating === i + 1 ? 'on' : ''}" data-act="rate" data-n="${i + 1}" aria-pressed="${a.rating === i + 1}"><span>${a.rating === i + 1 ? starOfDavid(28) : `<svg class="i" viewBox="0 0 24 24" style="width:${14 + i * 3}px;height:${14 + i * 3}px">${P.shul}</svg>`}</span>${esc(w)}</button>`).join('');
      const chips = V.compliments.driver.map((c) => `<button type="button" class="tip small ${a.chips.includes(c) ? 'on' : ''}" data-act="chip" data-c="${esc(c)}" aria-pressed="${a.chips.includes(c)}">${esc(c)}</button>`).join('');
      const tips = [['$2', { kind: 'usd', usd: 2 }], ['$5', { kind: 'usd', usd: 5 }], ['Rugelach', { kind: 'rugelach' }]].map(([t, v]) => {
        const on = a.tip && a.tip.kind === v.kind && (v.kind !== 'usd' || a.tip.usd === v.usd);
        return `<button type="button" class="tip ${on ? 'on' : ''}" data-act="tip" data-tip='${esc(JSON.stringify(v))}' aria-pressed="${on}">${t}</button>`;
      }).join('') + `<button type="button" class="tip ${a.tip && a.tip.kind === 'bracha' ? 'on' : ''}" data-act="openBracha">Bracha</button><button type="button" class="tip ${a.tip && a.tip.kind === 'usd' && ![2, 5].includes(a.tip.usd) ? 'on' : ''}" data-act="tipOther">${a.tip && a.tip.kind === 'usd' && ![2, 5].includes(a.tip.usd) ? usd(a.tip.usd) : 'Other'}</button>`;
      const extra = [tipUsd ? `+ ${usd(tipUsd)} tip` : '', a.tip && a.tip.kind === 'rugelach' ? '+ rugelach' : '', a.tip && a.tip.kind === 'bracha' ? '+ a bracha' : '', up ? `+ ${usd(up)} tzedakah` : '', ppFee ? `+ ${usd(ppFee)} PayPal fee` : ''].filter(Boolean).join(' ');
      return {
        html: `
        <section class="sheet" style="max-height:100%" data-keep="arrived">
          <div class="handle"></div>
          <div class="col"><div class="kicker">Mazel tov</div><div class="h1" style="font-size:36px">You're here</div><div class="muted">${esc(r.pickup.label)} → ${esc(r.dropoff.label)} · ${miles(r.meters)} · ${r.started && r.ended ? minsOf((r.ended - r.started) / 1000) : minsOf(r.seconds)} min</div></div>
          <div class="col" style="gap:12px"><div class="row between"><div class="h3">Rate ${esc(V.driver.name)}</div>${avatar(V.driver, 'sm')}</div><div class="rates">${rates}</div></div>
          <div class="tips">${chips}</div>
          ${a.words ? `<div class="col" style="gap:8px"><label class="sr" for="rv-text">Review</label><textarea id="rv-text" class="field" style="height:96px;padding:12px 14px;resize:none" maxlength="300" data-bind="arr.text">${esc(a.text)}</textarea><button type="button" class="link" style="align-self:flex-start;padding:0" data-act="ghost">${icon('kvetch')}Ghostwrite another</button></div>` : `<div class="row" style="gap:16px"><button type="button" class="link" style="padding:0" data-act="words">Write a review</button><button type="button" class="link" style="padding:0" data-act="ghost">${icon('kvetch')}Ghostwrite it</button></div>`}
          <div class="col" style="gap:12px"><div class="h3">Tip</div><div class="tips">${tips}</div></div>
          ${canRound || a.roundUp ? `<button type="button" class="switchrow ${a.roundUp ? 'on' : ''}" data-act="roundUp" aria-pressed="${a.roundUp}">${icon('heart')}<span class="grow">Round up for tzedakah</span><span class="toggle"></span></button>` : ''}
          ${r.chai ? '' : `<button type="button" class="payrow" data-act="openPay" data-for="arr">${pmTile(p.id)}<span class="col grow"><span style="font-size:16px;font-weight:600">${esc(p.name)}</span><span class="muted small">${esc(priceText(r.fare, a.method))} ${esc(extra)}</span></span><span style="font-size:14px;font-weight:600;color:var(--blue)">Change</span></button>`}
          <button class="btn" data-act="pay" ${L.busy ? 'disabled' : ''}>${esc(label)}</button>
          ${p.kind !== 'tab' && p.kind !== 'treat' && p.kind !== 'free' ? '<button class="link" data-act="payTab">Put it on my tab</button>' : ''}
        </section>`,
        scene: { pick: r.pickup, drop: r.dropoff, main: r.line, fit: [r.pickup, r.dropoff], fitKey: 'arr' + r.id },
      };
    },

    nope() {
      const r = V.ride;
      const n = V.driver.name;
      const title = r.state === 'missed' ? `${n} didn't answer` : r.state === 'declined' ? `${n} can't right now` : `${n} cancelled`;
      return {
        html: `
        <section class="sheet">
          <div class="handle"></div>
          <div class="h1">${esc(title)}</div>
          <div class="trip"><div class="rail"><i></i><span></span><i class="sq"></i></div><div class="stops"><div>${esc(r.pickup.label)}</div><div>${esc(r.dropoff.label)}</div></div></div>
          <button class="btn" data-act="again" ${L.busy ? 'disabled' : ''}>Try again</button>
          <button class="btn out" data-act="againLater">Book for later</button>
          <button class="link muted" data-act="ackRide">OK</button>
        </section>`,
        scene: { pick: r.pickup, drop: r.dropoff, main: r.line, fit: [r.pickup, r.dropoff], fitKey: 'nope' + r.id },
      };
    },

    tab() {
      const t = V.tab;
      const owes = owedText(t);
      const grid = V.payMethods.filter((p) => accepts(p)).map((p) => `<button type="button" class="payopt ${V.me.pay === p.id ? 'on' : ''}" data-act="setPay" data-id="${p.id}" aria-pressed="${V.me.pay === p.id}">${pmTile(p.id)}<span class="grow">${esc(p.name)}</span>${V.me.pay === p.id ? icon('check') : ''}</button>`).join('');
      return {
        html: `
        <section class="sheet full" data-keep="tab">
          <div class="row"><button class="round flat" data-act="go" data-to="home" aria-label="Back">${icon('back')}</button><div class="h1">Tab</div></div>
          <div class="balance"><div class="col" style="gap:6px"><div style="font-size:14px;opacity:.72">You owe ${esc(V.driver.name)}</div><div class="big">${usd(t.usd)}</div>${Object.keys(t.extras).length ? `<div style="font-size:15px;font-weight:600;color:var(--gold)">+ ${esc(owedText({ usd: 0, extras: t.extras }))}</div>` : ''}</div>
          ${t.usd ? '<button class="pill gold" style="height:44px;font-size:15px;padding:0 18px" data-act="openPay" data-for="tab">Pay now</button>' : ''}</div>
          ${!owes ? '' : ''}
          ${V.chai && V.chai.on ? `<div class="chai"><div class="row between"><span class="kicker">Chai ride</span><span class="small muted">${V.chai.toGo === 18 ? 'Just had one' : `${V.chai.toGo} to go`}</span></div><div class="chaibar">${Array.from({ length: 18 }, (_, i) => `<i class="${i < V.chai.done % 18 ? 'on' : ''}"></i>`).join('')}</div></div>` : ''}
          <div class="sec kicker">Pay with</div>
          <div class="paygrid">${grid}</div>
          <div class="spacer"></div>
          ${tabsNav('tab')}
        </section>`,
        scene: {},
      };
    },

    rides() {
      const chip = (r) => {
        if (r.state !== 'done') return `<span class="chip">${r.state === 'missed' ? 'Missed' : r.state === 'declined' ? "Couldn't" : 'Cancelled'}</span>`;
        const p = r.payment;
        if (p && p.state === 'paid') return '<span class="chip paid">Paid</span>';
        if (p && p.state === 'claimed') return '<span class="chip">Sent</span>';
        return '<span class="chip owed">Owed</span>';
      };
      const rows = V.rides.map((r) => `<div class="li"><div class="grow"><b>${esc(r.dropoff.label)}</b><small>${esc(whenText(r.created))} · ${esc(typeOf(r.type).name)}</small></div><span style="font-weight:600">${r.state === 'done' ? esc(priceText(r.payment ? r.payment.usd || r.fare : r.fare, r.payment ? r.payment.method : r.pay)) : ''}</span>${chip(r)}</div>`).join('');
      const booked = V.booked.map((r) => `<div class="li"><div class="grow"><b>${esc(r.dropoff.label)}</b><small>${esc(whenText(r.when))} · ${r.state === 'booked' ? 'Booked' : 'Asking'}</small></div><button class="link muted" data-act="cancelRide" data-id="${r.id}">Cancel</button></div>`).join('');
      return {
        html: `
        <section class="sheet full" data-keep="rides">
          <div class="row"><button class="round flat" data-act="go" data-to="home" aria-label="Back">${icon('back')}</button><div class="h1">Rides</div></div>
          ${booked ? `<div class="sec kicker">Coming up</div><div class="list">${booked}</div>` : ''}
          <div class="list">${rows || '<div class="muted" style="padding:20px 4px">No rides yet</div>'}</div>
          <div class="spacer"></div>
          ${tabsNav('rides')}
        </section>`,
        scene: {},
      };
    },

    account() {
      const me = V.me;
      const dark = V.me.role === 'driver';
      const places = me.places.map((p) => `<div class="li"><span class="place" style="width:auto;border:0"><span class="ic">${icon(PLACE_ICON[p.icon] || 'pin')}</span></span><div class="grow"><b>${esc(p.label)}</b><small>${esc(p.address)}</small></div><button class="round flat" style="width:36px;height:36px" data-act="delPlace" data-id="${p.id}" aria-label="Remove ${esc(p.label)}">${icon('x')}</button></div>`).join('');
      const pushOk = !APP && 'serviceWorker' in navigator && 'PushManager' in window;
      const pick = (key, list) => `<div class="col" style="gap:8px"><div class="kicker">${{ kugel: 'Kugel', music: 'In the car', schmooze: 'Schmooze' }[key]}</div><div class="tips">${list.map((o) => `<button type="button" class="tip small ${me[key] === o ? 'on' : ''}" data-act="setProfile" data-k="${key}" data-v="${esc(o)}" aria-pressed="${me[key] === o}">${esc(o)}</button>`).join('')}</div></div>`;
      const text = (key, label, ph, area) => `<div><label class="lab" for="a-${key}">${label}</label>${area ? `<textarea id="a-${key}" class="field" style="height:84px;padding:12px 14px;resize:none" maxlength="200" data-profile="${key}" placeholder="${esc(ph)}">${esc(me[key])}</textarea>` : `<input id="a-${key}" class="field" data-profile="${key}" value="${esc(me[key])}" placeholder="${esc(ph)}" maxlength="80">`}</div>`;
      return {
        html: `
        <section class="${dark ? 'dpage' : 'sheet full'}" data-keep="account">
          <div class="row"><button class="round ${dark ? 'dark' : 'flat'}" data-act="go" data-to="${dark ? 'ledger' : 'home'}" aria-label="Back">${icon('back')}</button><div class="h1 grow">Account</div><button class="chip" data-act="profile" data-uid="${esc(me.id)}">Profile</button></div>
          <div class="row" style="gap:16px">
            <label class="photo-pick" aria-label="Profile photo">${avatar({ ...me, id: null }, 'xl', false)}<input id="photo-in" type="file" accept="image/*" class="sr" data-photo="1"><span class="photo-edit">${icon('upload')}</span></label>
            <div class="col grow" style="gap:8px"><input id="a-name" class="field" data-save="name" value="${esc(me.name)}" autocomplete="name" aria-label="Name">${me.photo ? '<button class="link muted" style="align-self:flex-start;padding:0;height:30px" data-act="photoOff">Remove photo</button>' : ''}</div>
          </div>
          <div><label class="lab" for="a-phone">Phone</label><input id="a-phone" class="field" type="tel" data-save="phone" value="${esc(me.phone)}" autocomplete="tel"></div>
          <div class="col" style="gap:10px"><div class="kicker">Signing in</div>
            <div><label class="lab" for="a-username">Username</label><input id="a-username" class="field" data-login="username" value="${esc(me.username)}" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="24"></div>
            <button type="button" class="switchrow" data-act="mPassword" data-mode="set">${icon('gear')}<span class="grow">${me.hasPassword ? 'Change password' : 'Set a password'}</span>${icon('chev')}</button>
            ${me.hasPassword ? '<button type="button" class="link muted" style="align-self:flex-start;padding:0;height:32px" data-act="mPassword" data-mode="remove">Remove password</button>' : ''}
          </div>
          ${text('bio', 'About', 'Three words your Bubbe would use', true)}
          ${text('shul', 'Shul', 'Where you daven')}
          ${pick('kugel', V.profileOpts.kugel)}
          ${pick('music', V.profileOpts.music)}
          ${pick('schmooze', V.profileOpts.schmooze)}
          ${text('languages', 'Languages', 'English, Hebrew, Yiddish…')}
          ${text('fact', 'Fun fact', 'Once met a Rebbe')}
          ${dark ? '' : `<div class="sec kicker">Places</div><div class="list">${places}<button class="place" data-act="addPlace"><span class="ic">${icon('plus')}</span><b>Add a place</b></button></div>`}
          <div class="col" style="gap:8px"><div class="kicker">Theme</div><div class="themes">${['auto', 'light', 'dark'].map((t) => `<button type="button" class="tip ${themePref() === t ? 'on' : ''}" data-act="setTheme" data-id="${t}" aria-pressed="${themePref() === t}">${{ auto: 'Auto', light: 'Light', dark: 'Dark' }[t]}</button>`).join('')}</div></div>
          <button type="button" class="switchrow ${soundsOn() ? 'on' : ''}" data-act="sounds" aria-pressed="${soundsOn()}">${icon('volume')}<span class="grow">Sounds</span><span class="toggle"></span></button>
          ${pushOk ? `<button type="button" class="switchrow ${me.push ? 'on' : ''}" data-act="push">${icon('bell')}<span class="grow">Notifications</span><span class="toggle"></span></button>` : ''}
          ${offerApp ? `<a class="switchrow" href="${getHref}" style="text-decoration:none">${icon(isIOS ? 'iphone' : 'android')}<span class="grow">Get the app</span>${icon('chev')}</a>` : ''}
          <button class="btn out" data-act="signOut">${icon('out')}Sign out</button>
          <div class="spacer"></div>
          ${dark ? '' : tabsNav('account')}
        </section>`,
        scene: {},
      };
    },

    profile() {
      const pf = L.prof;
      const dark = V.me.role === 'driver';
      if (!pf || !pf.data) return { html: `<section class="${dark ? 'dpage' : 'sheet full'}"><div class="row"><button class="round ${dark ? 'dark' : 'flat'}" data-act="profileBack" aria-label="Back">${icon('back')}</button></div><div class="muted">…</div></section>`, scene: {} };
      const p = pf.data;
      const facts = [['Shul', p.shul], ['Kugel', p.kugel], ['In the car', p.music], ['Schmooze', p.schmooze], ['Languages', p.languages], ['Fun fact', p.fact], ['Car', [p.car, p.plate].filter(Boolean).join(' · ')]].filter(([, v]) => v);
      const comps = Object.entries(p.compliments || {}).sort((x, y) => y[1] - x[1]);
      const stars = (n) => Array.from({ length: n }, () => starOfDavid(14)).join('');
      const reviews = (p.reviews || []).map((rv) => `<div class="review"><div class="row">${avatar({ ...rv.by, id: null }, 'sm', false)}<div class="col grow"><b>${esc(rv.by.name)}</b><span class="row small muted" style="gap:2px">${stars(rv.stars)}<span style="margin-left:6px">${esc(V.ratings[rv.stars - 1])} · ${esc(whenText(rv.at))}</span></span></div></div>${rv.text ? `<p>${esc(rv.text)}</p>` : ''}${rv.chips && rv.chips.length ? `<div class="tips">${rv.chips.map((c) => `<span class="chip">${esc(c)}</span>`).join('')}</div>` : ''}</div>`).join('');
      const mine = p.id === V.me.id;
      return {
        html: `
        <section class="${dark ? 'dpage' : 'sheet full'}" data-keep="profile">
          <div class="row"><button class="round ${dark ? 'dark' : 'flat'}" data-act="profileBack" aria-label="Back">${icon('back')}</button><div class="grow"></div>${mine ? '<button class="chip" data-act="go" data-to="account">Edit</button>' : ''}</div>
          <div class="col" style="align-items:center;gap:10px;text-align:center">
            ${avatar({ ...p, id: null }, 'xxl', false)}
            <div class="h1">${esc(p.name)}</div>
            <div class="kicker">${p.role === 'driver' ? 'Driving' : 'Riding'} since ${esc(new Date(p.since).toLocaleDateString([], { month: 'long', year: 'numeric' }))}</div>
          </div>
          <div class="stats">
            <div><b class="num">${p.rating ? p.rating.avg.toFixed(2) : '—'}</b><small>${p.rating ? esc(p.rating.word) : 'New'}</small></div>
            <div><b class="num">${p.rides}</b><small>Rides</small></div>
            ${p.role === 'driver' ? `<div><b class="num">${p.mitzvahs || 0}</b><small>Mitzvahs</small></div>` : `<div><b class="num">${p.rating ? p.rating.count : 0}</b><small>Ratings</small></div>`}
          </div>
          ${p.bio ? `<p class="bio">${esc(p.bio)}</p>` : ''}
          ${facts.length ? `<div class="facts">${facts.map(([k, v]) => `<div><span class="kicker">${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div>` : ''}
          ${comps.length ? `<div class="col" style="gap:8px"><div class="kicker">Compliments</div><div class="tips">${comps.map(([c, n]) => `<span class="chip">${esc(c)}${n > 1 ? ` · ${n}` : ''}</span>`).join('')}</div></div>` : ''}
          <div class="col" style="gap:10px"><div class="kicker">Reviews</div>${reviews || '<div class="muted">No reviews yet</div>'}</div>
        </section>`,
        scene: {},
      };
    },

    shabbat() {
      const s = V.shabbat;
      return {
        html: `
        <div class="shabbat">
          <div class="logo gold">Jewber</div>
          <svg width="220" height="250" viewBox="0 0 220 250" role="img" aria-label="Two lit candles" style="margin-top:48px;flex-shrink:0">
            <ellipse cx="110" cy="80" rx="100" ry="70" fill="#F5B82E" opacity=".35" style="filter:blur(24px)"/>
            <g class="flame"><path d="M70 92C58 74 64 56 70 40c6 16 12 34 0 52z" fill="#F5B82E"/><path d="M70 90c-6-10-4-20 0-28 4 8 6 18 0 28z" fill="#FFF3CF"/></g>
            <g class="flame b"><path d="M150 92c-12-18-6-36 0-52 6 16 12 34 0 52z" fill="#F5B82E"/><path d="M150 90c-6-10-4-20 0-28 4 8 6 18 0 28z" fill="#FFF3CF"/></g>
            <path d="M70 92v8M150 92v8" stroke="#3A3A3A" stroke-width="2"/>
            <rect x="58" y="100" width="24" height="110" rx="4" fill="#F6F1E4"/><rect x="138" y="100" width="24" height="110" rx="4" fill="#F6F1E4"/>
            <path d="M50 210h40l-6 22H56zM130 210h40l-6 22h-28z" fill="#C9A44A"/><rect x="40" y="232" width="140" height="8" rx="4" fill="#C9A44A"/>
          </svg>
          <div class="col" style="align-items:center;gap:10px;margin-top:32px">
            <div class="display">Shabbat Shalom</div>
            <div class="muted" style="font-size:15px">Back in</div>
            <div class="count">${hms(s.end - T())}</div>
            <div class="muted" style="font-size:15px">Havdalah · ${esc(whenText(s.end))}</div>
            ${cal().parsha ? `<div class="muted" style="font-size:15px">Parashat ${esc(cal().parsha)}</div>` : ''}
          </div>
          <div class="spacer"></div>
          <button class="btn gold" data-act="motzei" style="max-width:440px">${icon('clock')}Book for Motzei Shabbat</button>
          <button class="link" style="color:#B9C2DE" data-act="go" data-to="rides">Rides</button>
        </div>`,
        scene: {},
      };
    },
  };

  function etaRing(r, left) {
    L.etaMax = L.etaMax || {};
    if (left !== null) L.etaMax[r.id] = Math.max(L.etaMax[r.id] || 0, left);
    const max = L.etaMax[r.id] || 1;
    const k = left !== null ? Math.max(0.04, Math.min(1, 1 - left / max)) : 0;
    const c = 2 * Math.PI * 34;
    return `<div class="eta" role="img" aria-label="${left !== null ? minsOf(left) + ' minutes' : ''}"><svg class="ring" width="76" height="76" viewBox="0 0 76 76" aria-hidden="true"><defs><linearGradient id="etag" x1="0" x2="1"><stop offset="0" stop-color="#2347D9"/><stop offset="1" stop-color="#E9A92C"/></linearGradient></defs><circle cx="38" cy="38" r="34" fill="rgba(255,255,255,.7)" stroke="#E9E1D2" stroke-width="5"/><circle cx="38" cy="38" r="34" fill="none" stroke="url(#etag)" stroke-width="5" stroke-linecap="round" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - k)).toFixed(1)}" transform="rotate(-90 38 38)"/></svg><span><b>${left !== null ? minsOf(left) : '…'}</b><small>min</small></span></div>`;
  }

  const accepts = (p) => (p.kind === 'app' ? (p.id === 'zelle' ? !!V.handles.zelle : !!V.handles[p.id]) : true);

  // ---- the driver's side ----------------------------------------------------------------
  function driverScreen() {
    if (['ledger', 'account', 'profile'].includes(L.screen)) return L.screen;
    if (V.active) return 'dride';
    if (V.ended) return 'drate';
    return 'dhome';
  }

  function ringSvg(left, total) {
    const c = 2 * Math.PI * 22;
    const k = Math.max(0, Math.min(1, left / total));
    return `<svg class="ring" width="52" height="52" viewBox="0 0 52 52" role="img" aria-label="${Math.ceil(left / 1000)} seconds left"><circle cx="26" cy="26" r="22" fill="none" stroke="#EDEDE8" stroke-width="5"/><circle cx="26" cy="26" r="22" fill="none" stroke="#F5B82E" stroke-width="5" stroke-linecap="round" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - k)).toFixed(1)}" transform="rotate(-90 26 26)"/><text x="26" y="31.5" text-anchor="middle" font-size="16" font-weight="700" fill="#111216" font-family="Rubik, sans-serif">${Math.ceil(left / 1000)}</text></svg>`;
  }

  function driverTop() {
    const d = V.driver;
    const st = V.statuses.map((s) => `<button type="button" class="st ${d.status === s.id ? 'on' : ''}" data-act="status" data-id="${s.id}" aria-pressed="${d.status === s.id}">${esc(s.name)}</button>`).join('');
    return `<div class="dtop">
        <button type="button" class="duty ${d.onDuty ? 'on' : ''}" data-act="duty" aria-pressed="${d.onDuty}">${d.onDuty ? 'On duty' : 'Off duty'}<span class="toggle"></span></button>
        <button type="button" class="pill dark" data-act="go" data-to="ledger">${icon('wallet')}${usd(V.ledger.weekUsd)}</button>
      </div>
      ${d.onDuty ? `<div class="statuses">${st}</div>` : ''}`;
  }

  function stopsBlock(r, fromLoc) {
    const away = roughMin(fromLoc, r.pickup);
    return `<div class="trip"><div class="rail"><i style="background:var(--gold);border:2px solid var(--ink)"></i><span style="height:30px"></span><i class="sq"></i></div>
      <div class="stops" style="gap:16px">
        <div class="row between"><span class="ellipsis" style="font-weight:600">${esc(r.pickup.label)}</span><span class="muted">${away ? away + ' min away' : ''}</span></div>
        <div class="row between"><span class="ellipsis" style="font-weight:600">${esc(r.dropoff.label)}</span><span class="muted">${miles(r.meters)} · ${minsOf(r.seconds)} min</span></div>
      </div></div>`;
  }

  const DRIVER = {
    account: () => RIDER.account(),
    profile: () => RIDER.profile(),
    dhome() {
      const d = V.driver;
      const r = V.requests[0];
      let bottom;
      if (r) {
        const rr = r.rider.rating;
        const total = (r.expires || 0) - r.created;
        bottom = `<section class="card">
          <div class="row">
            ${r.when ? `<span class="chip gold" style="height:52px;border-radius:14px;flex-direction:column;gap:0;line-height:1.1;padding:0 10px"><b>${esc(new Date(r.when).toLocaleDateString([], { weekday: 'short' }))}</b>${esc(clock(r.when))}</span>` : ringSvg(r.expires - T(), total)}
            ${avatar(r.rider)}
            <div class="col grow"><div class="row" style="gap:8px"><span class="h2">${esc(r.rider.name)}</span><span class="chip blue">${esc(typeOf(r.type).name)}</span></div>
            <div class="row muted small" style="gap:5px">${starOfDavid(13)}${rr ? `${rr.avg.toFixed(1)} · ${esc(rr.word)}` : 'New'}${typeOf(r.type).hint ? ` · ${esc(typeOf(r.type).hint)}` : ''}</div></div>
          </div>
          ${stopsBlock(r, d.loc)}
          <div class="payrow" style="background:var(--soft2)">${pmTile(r.pay)}<span class="grow" style="font-size:16px;font-weight:600">${esc(payOf(r.pay).name)}</span><span style="font-size:22px;font-weight:800">${esc(priceText(r.fare, r.pay))}</span></div>
          <div class="row"><button class="btn out" style="width:110px;flex-shrink:0" data-act="decline" data-id="${r.id}">Can't</button><button class="btn gold" data-act="accept" data-id="${r.id}" ${L.busy ? 'disabled' : ''}>${r.when ? 'Book it' : 'Accept'}</button></div>
          ${V.requests.length > 1 ? `<div class="muted t-center small">+${V.requests.length - 1} more</div>` : ''}
        </section>`;
      } else {
        const booked = V.booked.map((b) => {
          const soon = b.when - T() < 90 * 60e3;
          return `<div class="row"><div class="col grow"><b>${esc(whenText(b.when))} · ${esc(b.rider.name)}</b><span class="muted small ellipsis">${esc(b.pickup.label)} → ${esc(b.dropoff.label)}</span></div>${soon ? `<button class="gbtn fill" data-act="go2" data-id="${b.id}">Go</button>` : ''}<button class="gbtn" data-act="cancelRide" data-id="${b.id}">Cancel</button></div>`;
        }).join('');
        const sh = V.shabbat;
        bottom = `<section class="idle">
          <div class="row between"><div class="display">${sh.closed ? 'Shabbat Shalom' : d.onDuty ? 'Waiting for requests' : 'Off duty'}</div>${sh.soon ? `<span class="gchip">${icon('candles')}&nbsp;${esc(hm(sh.start - T()))}</span>` : ''}</div>
          ${booked}
        </section>`;
      }
      return {
        html: driverTop() + bottom,
        scene: {
          car: d.loc, pick: r ? r.pickup : null, pickGold: true, pickPulse: !!r,
          preview: r && d.loc ? [[d.loc.lng, d.loc.lat], [r.pickup.lng, r.pickup.lat]] : null,
          fit: r ? [d.loc, r.pickup] : [d.loc], fitKey: r ? 'req' + r.id : 'idle' + !!d.loc,
        },
      };
    },

    dride() {
      const r = V.active;
      const d = V.driver;
      const nav = L.nav && L.nav.ride === r.id && L.nav.target === (r.state === 'riding' ? 'dropoff' : 'pickup') ? L.nav : null;
      const target = r.state === 'riding' ? r.dropoff : r.pickup;
      let ban = '';
      const arrived = d.loc && r.state !== 'here' && meters(d.loc, target) < 50;
      if (r.state !== 'here') {
        const st = nextStep(nav, d.loc, r);
        ban = `<div class="navban">${icon(st.icon)}<div class="col grow"><b>${esc(st.dist)}</b><span>${esc(st.text)}</span></div><button class="navvoice" data-act="voice" aria-label="${voice.on ? 'Mute directions' : 'Speak directions'}" aria-pressed="${voice.on}">${icon(voice.on ? 'volume' : 'mute')}</button></div>`;
        if (L.userMoved && Date.now() - L.userMoved < 15000) ban += `<button class="pill recenter" data-act="recenter">${icon('nav')}Recenter</button>`;
      }
      const phone = r.rider.phone ? r.rider.phone.replace(/[^\d+]/g, '') : '';
      const left = etaLeft(r.eta);
      let head, sub, btn;
      if (r.state === 'accepted' && arrived) { head = 'At the pickup'; sub = r.pickup.label; btn = `<button class="btn gold big glow" data-act="here" data-id="${r.id}">I'm here</button>${phone ? `<a class="btn out" href="sms:${esc(phone)}?body=${encodeURIComponent("I'm outside!")}">${icon('msg')}Text "I'm outside"</a>` : ''}`; }
      else if (r.state === 'accepted') { head = `Picking up ${r.rider.name}`; sub = `${left !== null ? minsOf(left) + ' min · ' : ''}${r.pickup.label}`; btn = `<button class="btn gold big" data-act="here" data-id="${r.id}">I'm here</button>`; }
      else if (r.state === 'here') { head = `Waiting for ${r.rider.name}`; sub = `Here ${hms(T() - (r.here || T()))}`; btn = `<button class="btn gold big" data-act="start" data-id="${r.id}">Start trip</button>`; }
      else if (arrived) { head = `At ${r.dropoff.label}`; sub = `Dropping off ${r.rider.name}`; btn = `<button class="btn gold big glow" data-act="end" data-id="${r.id}">End trip</button>`; }
      else { head = `Dropping off ${r.rider.name}`; sub = `${r.dropoff.label}${left !== null ? ' · ' + clock(T() + left * 1000) : ''}`; btn = `<button class="btn gold big" data-act="end" data-id="${r.id}">End trip</button>`; }
      const apps = r.state !== 'here' ? `<div class="row" style="gap:8px"><button class="chip" data-act="waze">${icon('nav')}Waze <svg width="16" height="12" viewBox="0 0 16 12" aria-label="Made in Israel" role="img"><rect width="16" height="12" rx="1.5" fill="#fff" stroke="#D9CFBD" stroke-width=".6"/><rect y="1.6" width="16" height="1.4" fill="#0038B8"/><rect y="9" width="16" height="1.4" fill="#0038B8"/><path d="M8 3.6l1.7 2.9H6.3zM8 8.4L6.3 5.5h3.4z" fill="none" stroke="#0038B8" stroke-width=".7"/></svg></button><button class="chip" data-act="gmaps">${icon('pin')}Google Maps</button></div>` : '';
      return {
        html: `${ban}
        <section class="card" id="dcard">
          <div class="row"><div class="col grow"><div class="h2">${esc(head)}</div><div class="muted">${esc(sub)}</div></div>
          ${phone ? `<a class="round flat" href="sms:${esc(phone)}" aria-label="Text ${esc(r.rider.name)}">${icon('msg')}</a><a class="round flat" href="tel:${esc(phone)}" aria-label="Call ${esc(r.rider.name)}">${icon('phone')}</a>` : ''}</div>
          <div class="row" style="gap:8px;flex-wrap:wrap"><span class="chip blue">${esc(typeOf(r.type).name)}</span><span class="chip">${esc(priceText(r.fare, r.pay))} · ${esc(payOf(r.pay).name)}</span>${typeOf(r.type).hint ? `<span class="chip gold">${esc(typeOf(r.type).hint)}</span>` : ''}${r.simcha && r.type !== 'simcha' ? '<span class="chip gold">Simcha mode</span>' : ''}</div>
          ${apps}
          ${btn}
          ${r.state !== 'riding' ? `<button class="link muted" data-act="cancelRide" data-id="${r.id}">${r.state === 'here' ? 'No-show' : 'Cancel'}</button>` : ''}
        </section>`,
        scene: {
          car: d.loc, pick: r.state !== 'riding' ? r.pickup : null, pickGold: true, drop: r.state === 'riding' ? r.dropoff : null,
          main: nav ? nav.line : r.eta ? r.eta.line : null,
          follow: d.loc && r.state !== 'here' && !arrived ? d.loc : null,
          fit: [d.loc, target], fitKey: 'ride' + r.id + r.state,
        },
      };
    },

    drate() {
      const r = V.ended;
      const pay = r.payment ? payOf(r.payment.method) : payOf(r.pay);
      const a = L.rr && L.rr.id === r.id ? L.rr : (L.rr = { id: r.id, rating: 0, chips: [], text: '', words: false });
      setTimeout(() => celebrate('end' + r.id), 200);
      const rates = V.ratings.map((w, i) => `<button type="button" class="rate ${a.rating === i + 1 ? 'on' : ''}" data-act="rrRate" data-n="${i + 1}" aria-pressed="${a.rating === i + 1}"><span>${a.rating === i + 1 ? starOfDavid(28) : `<svg class="i" viewBox="0 0 24 24" style="width:${14 + i * 3}px;height:${14 + i * 3}px">${P.shul}</svg>`}</span>${esc(w)}</button>`).join('');
      const chips = V.compliments.rider.map((c) => `<button type="button" class="tip small ${a.chips.includes(c) ? 'on' : ''}" data-act="rrChip" data-c="${esc(c)}" aria-pressed="${a.chips.includes(c)}">${esc(c)}</button>`).join('');
      return {
        html: driverTop() + `<section class="card">
          <div class="row">${avatar(r.rider)}<div class="col grow"><div class="kicker">Ride done</div><div class="h2">Rate ${esc(r.rider.name)}</div></div></div>
          <div class="rates">${rates}</div>
          ${a.rating ? `<div class="tips">${chips}</div>` : ''}
          ${a.rating && a.words ? `<div class="col" style="gap:8px"><label class="sr" for="rr-text">Review</label><textarea id="rr-text" class="field" style="height:84px;padding:12px 14px;resize:none" maxlength="300" data-bind="rr.text">${esc(a.text)}</textarea><button type="button" class="link" style="align-self:flex-start;padding:0" data-act="rrGhost">${icon('kvetch')}Ghostwrite another</button></div>` : a.rating ? `<div class="row" style="gap:16px"><button type="button" class="link" style="padding:0" data-act="rrWords">Write a review</button><button type="button" class="link" style="padding:0" data-act="rrGhost">${icon('kvetch')}Ghostwrite it</button></div>` : ''}
          <div class="payrow">${pmTile(pay.id)}<span class="grow" style="font-weight:600">${esc(pay.name)}</span><b>${esc(r.chai ? 'Chai ride' : priceText(r.fare, pay.id))}</b></div>
          ${a.rating ? `<button class="btn gold" data-act="rrSend" data-id="${r.id}">Send</button>` : ''}
          <button class="link muted" data-act="skipRate" data-id="${r.id}">Skip</button>
        </section>`,
        scene: { car: V.driver.loc, drop: r.dropoff, fit: [V.driver.loc], fitKey: 'rate' + r.id },
      };
    },

    ledger() {
      const lg = V.ledger;
      const s = V.settings;
      const extras = Object.entries(lg.weekExtras).map(([k, n]) => {
        const p = k === 'rugelach' ? { unit: 'rugelach', units: 'rugelach' } : k === 'mitzvah' ? { unit: 'mitzvah', units: 'mitzvahs' } : payOf(k);
        return `<span class="gchip">${n} ${esc(n === 1 ? p.unit : p.units)}</span>`;
      }).join('');
      const claims = lg.claims.map((r) => `<div class="friend">${avatar(r.rider, 'sm')}<div class="grow"><b>${esc(r.rider.name)} sent ${usd(r.payment.usd)}</b><small>${esc(payOf(r.payment.method).name)} · ${esc(whenText(r.payment.at))}</small></div><button class="gbtn fill" data-act="gotIt" data-id="${r.id}">Got it</button></div>`).join('');
      const owed = V.friends.filter((f) => owedText(f.owed)).map((f) => `<div class="friend">${avatar({ id: f.uid, name: f.name, photo: f.photo, color: f.color }, 'sm')}<div class="grow"><b>${esc(f.name)}</b><small>${esc(owedText(f.owed))} · ${f.owed.rides.length} ride${f.owed.rides.length === 1 ? '' : 's'}</small></div><button class="gbtn" data-act="nudge" data-uid="${f.uid}">Nudge</button><button class="gbtn fill" data-act="allPaid" data-uid="${f.uid}">Paid</button></div>`).join('');
      const PPS = { created: 'Waiting', pending: 'Pending', paid: 'Paid', refunded: 'Refunded', cancelled: 'Cancelled', failed: "Didn't go through", expired: 'Expired' };
      const pps = (V.paypal || []).filter((o) => o.status !== 'cancelled' && o.status !== 'expired').map((o) => `<div class="friend"><span class="pm paypal" style="width:40px;height:40px;border-radius:20px">P</span><div class="grow"><b>${esc(o.name)} · ${usd(o.amount)}${o.kind === 'tab' ? ` · ${o.rides} rides` : ''}</b><small>${o.status === 'paid' ? `${o.net !== null ? usd(o.net) + ' after fee · ' : ''}${esc(whenText(o.paidAt))}` : esc(PPS[o.status] || o.status)}</small></div>${o.status === 'paid' ? `<button class="gbtn" data-act="ppRefund" data-id="${esc(o.id)}" data-amt="${o.amount}">Refund</button>` : ''}</div>`).join('');
      const joins = (V.joins || []).map((j) => `<div class="friend"><div class="av sm" style="background:var(--n-chip)">${initial(j.name)}</div><div class="grow"><b>${esc(j.name)}</b><small>${esc(j.email)}</small></div><button class="gbtn" data-act="joinNo" data-email="${esc(j.email)}">No</button><button class="gbtn fill" data-act="joinYes" data-email="${esc(j.email)}">Add</button></div>`).join('');
      const kv = V.kvetches.map((k) => `<div class="friend"><div class="grow"><b>${esc(k.name)}</b><small style="white-space:normal">${esc(k.text)}</small></div><span class="small" style="color:var(--n-muted)">${esc(whenText(k.at))}</span></div>`).join('');
      const handles = Object.entries(s.handles).filter(([, v]) => v).map(([k]) => payOf(k).name).join(', ');
      const pushOk = !APP && 'serviceWorker' in navigator && 'PushManager' in window;
      const row = (act, label, val) => `<button type="button" class="drow" data-act="${act}"><span class="grow">${esc(label)}</span><small>${esc(val)}</small>${icon('chev')}</button>`;
      return {
        html: `<div class="dpage" data-keep="ledger">
          <div class="row"><button class="round dark" data-act="go" data-to="dhome" aria-label="Back">${icon('back')}</button><div class="col grow"><div class="h1" style="font-size:28px">Ledger</div><div class="kicker">${esc(hebDate(T()))}</div></div><button class="avbtn" data-act="go" data-to="account" aria-label="Account">${avatar({ ...V.me, id: null }, '', false)}</button></div>
          <div class="dbox glow"><div class="kicker">This week</div><div class="big-num">${usd(lg.weekUsd)}</div>${extras ? `<div class="row" style="flex-wrap:wrap;gap:8px">${extras}</div>` : ''}
          ${V.rating ? `<div class="row small" style="gap:6px;color:var(--n-muted)">${starOfDavid(14)}${V.rating.avg.toFixed(2)} · ${esc(V.rating.word)} · ${V.rating.count} rating${V.rating.count === 1 ? '' : 's'}</div>` : ''}</div>
          ${joins ? `<div class="sec kicker">Wants to join</div><div class="col" style="gap:8px">${joins}</div>` : ''}
          ${claims ? `<div class="sec kicker">To check</div><div class="col" style="gap:8px">${claims}</div>` : ''}
          ${owed ? `<div class="sec kicker">Owed</div><div class="col" style="gap:8px">${owed}</div>` : ''}
          ${pps ? `<div class="sec kicker">PayPal</div><div class="col" style="gap:8px">${pps}</div>` : ''}
          <div class="dbox rows">
            ${row('mFares', 'Fares', `$${s.base} + $${s.perMile}/mi`)}
            ${row('mPaypal', 'PayPal', V.paypalCheckout ? (s.paypalFee === 'friend' ? 'Friends pay the fee' : 'You pay the fee') : 'Not connected')}
            ${row('mHandles', 'Pay me at', handles || 'Not set')}
            ${row('mCar', 'Car', [s.car, s.plate].filter(Boolean).join(' · ') || 'Not set')}
            ${row('mFriends', 'Friends', String(V.friends.length))}
            ${row('mTheme', 'Theme', { auto: 'Auto', light: 'Light', dark: 'Dark' }[themePref()])}
            ${row('mNavApp', 'Directions', { jewber: 'Jewber', waze: 'Waze', gmaps: 'Google Maps' }[s.navApp || 'jewber'])}
            ${row('mCity', 'Shabbat times', V.shabbat.cityName + (s.city === 'auto' ? ' (auto)' : ''))}
            <button type="button" class="drow" data-act="signalToggle"><span class="grow">Signal pings</span><span class="toggle ${s.signal ? 'on' : ''}" style="${s.signal ? 'background:var(--gold)' : ''}"></span></button>
            ${pushOk ? `<button type="button" class="drow" data-act="push"><span class="grow">Notifications here</span><span class="toggle ${V.me.push ? 'on' : ''}" style="${V.me.push ? 'background:var(--gold)' : ''}"></span></button>` : ''}
            <a class="drow" href="/get" style="text-decoration:none"><span class="grow">Get the app</span>${V.app ? `<small>${esc(V.app.version)}</small>` : ''}${icon('chev')}</a>
          </div>
          ${V.tzedakah ? `<div class="dbox glow"><div class="row between"><div class="col"><div class="kicker">Tzedakah jar</div><div class="big-num" style="font-size:34px">${usd(V.tzedakah)}</div></div><button class="gbtn fill" data-act="gave">Gave it</button></div></div>` : ''}
          ${(V.brachotGot || []).length ? `<div class="sec kicker">Brachot</div><div class="col" style="gap:8px">${V.brachotGot.slice(0, 5).map((b) => `<div class="friend"><span class="pm babka" style="width:40px;height:40px;border-radius:20px">${icon('heart')}</span><div class="grow"><b>${esc(b.text)}</b><small>${esc(b.name)} · ${esc(whenText(b.at))}</small></div></div>`).join('')}</div>` : ''}
          ${kv ? `<div class="sec kicker">Kvetches</div><div class="col" style="gap:8px">${kv}</div>` : ''}
          <button class="btn out" style="color:#fff;border-color:var(--n-edge)" data-act="signOut">${icon('out')}Sign out</button>
        </div>`,
        scene: {},
      };
    },
  };

  // ---- turn by turn ----------------------------------------------------------------------
  // OSRM's route and steps, followed along the line itself: where we are on it (how far along,
  // how far off), the next turn ahead of that point, a voice for it, and a new route when we
  // leave this one.
  function flat(o) {
    const k = Math.cos((o.lat * Math.PI) / 180);
    return (p) => ({ x: (p[0] - o.lng) * 111320 * k, y: (p[1] - o.lat) * 110540 });
  }
  function onLine(line, loc) {
    const P = flat(loc);
    let best = { off: Infinity, along: 0 }, acc = 0;
    for (let i = 1; i < line.length; i++) {
      const a = P(line[i - 1]), b = P(line[i]);
      const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy, seg = Math.sqrt(l2);
      const t = l2 ? Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / l2)) : 0;
      const off = Math.hypot(a.x + t * dx, a.y + t * dy);
      if (off < best.off) best = { off, along: acc + t * seg };
      acc += seg;
    }
    return { ...best, total: acc };
  }
  function prepNav(nav) {
    if (!nav || !nav.line || nav.line.length < 2) return nav;
    for (const s of nav.steps || []) s.along = onLine(nav.line, { lng: s.at[0], lat: s.at[1] }).along;
    return nav;
  }
  function navState(nav, loc) {
    if (!nav || !loc || !nav.line || nav.line.length < 2) return null;
    const pos = onLine(nav.line, loc);
    const steps = nav.steps || [];
    let i = steps.findIndex((s, k) => k > 0 && s.along > pos.along + 8);
    if (i < 0) i = steps.length - 1;
    const step = steps[i] || null;
    return { pos, i, step, dist: Math.max(0, (step && step.along !== undefined ? step.along : pos.total) - pos.along), left: Math.max(0, pos.total - pos.along) };
  }
  function turnWords(s, target) {
    const mod = s.modifier || '';
    const onto = s.name ? ` onto ${s.name}` : '';
    const side = mod.includes('left') ? 'left' : mod.includes('right') ? 'right' : '';
    if (s.type === 'arrive') return { icon: 'flag', text: target === 'pickup' ? 'Pickup' : 'Drop-off', say: target === 'pickup' ? 'arrive at the pickup' : 'arrive at the drop-off' };
    if (s.type === 'roundabout' || s.type === 'rotary' || s.type === 'exit roundabout') return { icon: 'round', text: `Roundabout${s.name ? ' to ' + s.name : ''}`, say: `at the roundabout, take the exit${onto}` };
    if (mod === 'uturn') return { icon: 'uturn', text: 'U-turn', say: 'make a U-turn' };
    if (s.type === 'merge') return { icon: side === 'left' ? 'sleft' : side === 'right' ? 'sright' : 'straight', text: `Merge${onto}`, say: `merge${onto}` };
    if (s.type === 'on ramp') return { icon: side === 'left' ? 'sleft' : 'sright', text: `Ramp${onto}`, say: `take the ramp${onto}` };
    if (s.type === 'off ramp') return { icon: side === 'left' ? 'sleft' : 'sright', text: `Exit${onto}`, say: `take the exit${onto}` };
    if (s.type === 'fork') return { icon: side === 'left' ? 'sleft' : 'sright', text: `Keep ${side}${onto}`, say: `keep ${side}${onto}` };
    if (mod === 'left' || mod === 'sharp left') return { icon: 'left', text: `Left${onto}`, say: `turn left${onto}` };
    if (mod === 'right' || mod === 'sharp right') return { icon: 'right', text: `Right${onto}`, say: `turn right${onto}` };
    if (mod === 'slight left') return { icon: 'sleft', text: `Bear left${onto}`, say: `bear left${onto}` };
    if (mod === 'slight right') return { icon: 'sright', text: `Bear right${onto}`, say: `bear right${onto}` };
    return { icon: 'straight', text: `Continue${onto}`, say: `continue${onto}` };
  }
  const spoken = (m) => (m < 160 ? `${Math.max(50, Math.round((m * 3.28084) / 50) * 50)} feet` : m < 480 ? 'a quarter mile' : m < 900 ? 'half a mile' : `${(m / 1609.344).toFixed(1)} miles`);
  const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);

  // What the banner says right now.
  function nextStep(nav, loc, r) {
    const target = r.state === 'riding' ? r.dropoff : r.pickup;
    if (loc && meters(loc, target) < 50) return { icon: 'flag', dist: 'Arrived', text: target.label };
    const st = navState(nav, loc);
    if (!st || !st.step) return { icon: 'straight', dist: nav ? dist(nav.meters) : '…', text: nav && nav.rough ? 'Head there' : 'Getting directions' };
    const w = turnWords(st.step, nav.target);
    return { icon: w.icon, dist: dist(st.dist), text: w.text };
  }

  // The voice: Android's own text-to-speech in the app, the browser's elsewhere. Off by a tap.
  const voice = { on: (() => { try { return localStorage.getItem('jb.voice') !== 'off'; } catch { return true; } })(), said: new Set() };
  function say(text) {
    if (!voice.on || !text) return;
    if (APP && APP.speak) { try { APP.speak(text); } catch {} return; }
    if ('speechSynthesis' in window) {
      try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.rate = 1.02; speechSynthesis.speak(u); } catch {}
    }
  }
  const sayOnce = (key, text) => { if (voice.said.has(key)) return; voice.said.add(key); say(text); };

  let navAt = 0, offCount = 0;
  async function refreshNav(force = false) {
    if (!V || V.me.role !== 'driver' || !V.active || V.active.state === 'here' || !V.driver.loc) return;
    const stale = !L.nav || L.nav.ride !== V.active.id || L.nav.target !== (V.active.state === 'riding' ? 'dropoff' : 'pickup');
    if (!stale && !force && Date.now() - navAt < 90000) return;
    if (force && Date.now() - navAt < 6000) return;
    navAt = Date.now();
    try { const j = await api('GET', '/api/nav'); L.nav = prepNav(j.nav); offCount = 0; render(); } catch {}
  }

  // Called with every fix and every second: re-route when off the line, speak the turns, notice arrival.
  function navTick() {
    if (!V || V.me.role !== 'driver' || !V.active) return;
    const r = V.active;
    const loc = V.driver.loc;
    if (!loc || r.state === 'here') return;
    const target = r.state === 'riding' ? r.dropoff : r.pickup;
    const tKey = `${r.id}|${r.state}`;
    const nav = L.nav && L.nav.ride === r.id && L.nav.target === (r.state === 'riding' ? 'dropoff' : 'pickup') ? L.nav : null;
    if (meters(loc, target) < 50) {
      sayOnce(tKey + '|arrived', r.state === 'riding' ? `You've arrived at ${target.label}.` : `You've arrived. ${r.rider.name} is up next.`);
      return;
    }
    if (!nav) { refreshNav(); return; }
    sayOnce(tKey + '|start', `${r.state === 'riding' ? 'Heading to' : 'Picking up ' + r.rider.name + ' at'} ${target.label}. ${spoken(nav.meters)}.`);
    const st = navState(nav, loc);
    if (!st) return;
    // off the route twice in a row (and the fix is good enough to believe): ask for a new one
    if (st.pos.off > 40 && !(loc.acc > 60)) {
      offCount += 1;
      if (offCount >= 2) { say('Rerouting.'); refreshNav(true); }
    } else offCount = 0;
    if (!st.step || st.step.type === 'arrive') return;
    const w = turnWords(st.step, nav.target);
    const sKey = `${tKey}|${st.step.at.join(',')}`;
    const fast = (loc.speed || 0) > 15;
    if (st.dist <= (fast ? 900 : 420) && st.dist > (fast ? 200 : 110)) sayOnce(sKey + '|far', `In ${spoken(st.dist)}, ${w.say}.`);
    if (st.dist <= (fast ? 120 : 60)) sayOnce(sKey + '|now', cap(w.say) + '.');
  }

  // Opening Waze or Google Maps by itself on Accept and on Start trip, if that's the setting.
  const opened = new Set();
  function autoNav() {
    if (!V || V.me.role !== 'driver' || !V.active || document.hidden) return;
    const r = V.active;
    const app = V.settings.navApp;
    if (!app || app === 'jewber' || !['accepted', 'riding'].includes(r.state)) return;
    const key = `${r.id}|${r.state}`;
    if (opened.has(key)) return;
    opened.add(key);
    const t = r.state === 'riding' ? r.dropoff : r.pickup;
    openLink(app === 'waze' ? `https://waze.com/ul?ll=${t.lat},${t.lng}&navigate=yes` : `https://www.google.com/maps/dir/?api=1&destination=${t.lat},${t.lng}&travelmode=driving`);
  }

  // ---- modals ---------------------------------------------------------------------------
  const MODALS = {
    pay() {
      const forWhat = L.modal.for;
      const list = V.payMethods.filter((p) => accepts(p) && (forWhat !== 'tab' || p.kind === 'app' || p.kind === 'cash'));
      const cur = forWhat === 'arr' ? L.arr.method : forWhat === 'tab' ? null : L.pay;
      return `<div class="scrim" data-act="closeModal"></div><div class="modal" role="dialog" aria-label="Pay with">
        <div class="handle"></div><div class="h3">${forWhat === 'tab' ? `Pay ${usd(V.tab.usd)} with` : 'Pay with'}</div>
        <div class="paygrid">${list.map((p) => `<button type="button" class="payopt ${cur === p.id ? 'on' : ''}" data-act="choosePay" data-id="${p.id}">${pmTile(p.id)}<span class="grow">${esc(p.name)}</span></button>`).join('')}</div>
      </div>`;
    },
    when() {
      const m = L.modal;
      const quick = [];
      const s = V.shabbat;
      if (s.end && s.end - T() < 7 * 86400e3) quick.push(['Motzei Shabbat', s.end + 15 * 60e3]);
      quick.push(['In 1 hour', Math.ceil((T() + 3600e3) / 300e3) * 300e3]);
      const tm = new Date(T() + 86400e3); tm.setHours(9, 0, 0, 0); quick.push(['Tomorrow 9 AM', tm.getTime()]);
      return `<div class="scrim" data-act="closeModal"></div><div class="modal" role="dialog" aria-label="When">
        <div class="handle"></div><div class="h3">When</div>
        <div class="tips">${quick.map(([t, ms]) => `<button class="tip" data-act="setWhen" data-ms="${ms}">${esc(t)}</button>`).join('')}</div>
        <div><label class="lab" for="m-when">Pick a time</label><input id="m-when" class="field" type="datetime-local" data-bind="modal.value" value="${esc(m.value || '')}"></div>
        <button class="btn" data-act="setWhen">Set</button>
        ${L.where && L.where.when ? '<button class="link muted" data-act="setWhen" data-ms="0">Now</button>' : ''}
      </div>`;
    },
    kvetch() {
      return `<div class="scrim" data-act="closeModal"></div><div class="modal" role="dialog" aria-label="Kvetch">
        <div class="handle"></div><div class="h2">Kvetch</div>
        <div class="tips">${V.kvetchList.map((k) => `<button type="button" class="tip small" data-act="kvetchPick" data-k="${esc(k)}">${esc(k)}</button>`).join('')}</div>
        <label class="sr" for="m-kv">Kvetch</label><textarea id="m-kv" class="field" style="height:120px;padding:12px 14px;resize:none" data-bind="modal.text" maxlength="500">${esc(L.modal.text || '')}</textarea>
        <button class="btn" data-act="sendKvetch" ${L.busy ? 'disabled' : ''}>Send</button>
      </div>`;
    },
    password() {
      const m = L.modal;
      const dark = V.me.role === 'driver';
      const remove = m.mode === 'remove';
      const field = (id, label, key, auto) => `<div><label class="lab" for="${id}">${label}</label><input id="${id}" class="field" type="password" autocomplete="${auto}" data-bind="modal.${key}" value="${esc(m[key])}"></div>`;
      return `<div class="scrim" data-act="closeModal"></div><form class="modal ${dark ? 'night' : ''}" role="dialog" aria-label="Password" data-form="savePassword">
        <div class="handle"></div><div class="h2">${remove ? 'Remove password' : V.me.hasPassword ? 'Change password' : 'Set a password'}</div>
        <input type="text" class="sr" autocomplete="username" value="${esc(V.me.username || V.me.email)}" tabindex="-1" aria-hidden="true">
        ${V.me.hasPassword ? field('pw-current', 'Current password', 'current', 'current-password') : ''}
        ${remove ? '' : field('pw-next', 'New password', 'next', 'new-password') + field('pw-again', 'Again', 'again', 'new-password')}
        <div class="err" role="alert">${esc(m.err || '')}</div>
        <button class="btn ${dark ? 'gold' : ''}" type="submit" ${L.busy ? 'disabled' : ''}>${remove ? 'Remove' : 'Save'}</button>
      </form>`;
    },
    bracha() {
      return `<div class="scrim" data-act="closeModal"></div><div class="modal" role="dialog" aria-label="Bracha">
        <div class="handle"></div><div class="h2">Tip with a bracha</div>
        <div class="col" style="gap:8px">${V.brachot.map((b) => `<button type="button" class="payrow" data-act="pickBracha" data-b="${esc(b)}">${icon('heart')}<span class="grow" style="font-weight:600">${esc(b)}</span></button>`).join('')}</div>
      </div>`;
    },
    zelle() {
      const m = L.modal;
      return `<div class="scrim" data-act="closeModal"></div><div class="modal" role="dialog" aria-label="Zelle">
        <div class="handle"></div><div class="h2">Zelle ${usd(m.usd)}</div>
        <div class="payrow">${pmTile('zelle')}<span class="grow" style="font-weight:600">${esc(m.to)}</span><button class="chip" data-act="copy" data-text="${esc(m.to)}">${icon('copy')}Copy</button></div>
        <div class="payrow"><span class="grow" style="font-weight:600">${usd(m.usd)}</span><button class="chip" data-act="copy" data-text="${esc(m.usd.toFixed(2))}">${icon('copy')}Copy</button></div>
        <button class="btn" data-act="closeModal">Done</button>
      </div>`;
    },
    tipOther() {
      return `<div class="scrim" data-act="closeModal"></div><div class="modal" role="dialog" aria-label="Tip">
        <div class="handle"></div><div class="h3">Tip</div>
        <label class="sr" for="m-tip">Dollars</label><input id="m-tip" class="field" type="number" inputmode="decimal" min="0" max="100" step="0.5" data-bind="modal.value" value="${esc(L.modal.value || '')}">
        <button class="btn" data-act="setTipOther">Set</button>
      </div>`;
    },
    savePlace() {
      const m = L.modal;
      const ics = ['home', 'shul', 'work', 'store', 'star'];
      return `<div class="scrim" data-act="closeModal"></div><div class="modal" role="dialog" aria-label="Save place">
        <div class="handle"></div><div class="h3">${esc(m.place.address || m.place.label)}</div>
        <div><label class="lab" for="m-label">Name</label><input id="m-label" class="field" data-bind="modal.label" value="${esc(m.label || '')}" maxlength="40"></div>
        <div class="tips">${ics.map((i) => `<button class="tip ${m.icon === i ? 'on' : ''}" data-act="placeIcon" data-id="${i}" aria-label="${i}" aria-pressed="${m.icon === i}">${icon(PLACE_ICON[i])}</button>`).join('')}</div>
        <button class="btn" data-act="savePlace">Save</button>
      </div>`;
    },
    // driver settings
    fares() {
      const s = L.modal;
      return `<div class="scrim" data-act="closeModal"></div><div class="modal night" role="dialog" aria-label="Fares">
        <div class="handle"></div><div class="h2">Fares</div>
        <div><label class="lab" for="m-base">Base ($)</label><input id="m-base" class="field" type="number" inputmode="decimal" step="0.1" data-bind="modal.base" value="${esc(s.base)}"></div>
        <div><label class="lab" for="m-mile">Per mile ($)</label><input id="m-mile" class="field" type="number" inputmode="decimal" step="0.05" data-bind="modal.perMile" value="${esc(s.perMile)}"></div>
        <div><label class="lab" for="m-min">Minimum ($)</label><input id="m-min" class="field" type="number" inputmode="decimal" step="0.5" data-bind="modal.minFare" value="${esc(s.minFare)}"></div>
        <button class="btn gold" data-act="saveSettings" data-keys="base,perMile,minFare">Save</button>
      </div>`;
    },
    handles() {
      const s = L.modal;
      const f = (k, label, ph) => `<div><label class="lab" for="m-${k}">${label}</label><input id="m-${k}" class="field" data-bind="modal.${k}" value="${esc(s[k] || '')}" placeholder="${ph}" autocomplete="off"></div>`;
      return `<div class="scrim" data-act="closeModal"></div><div class="modal night" role="dialog" aria-label="Pay me at">
        <div class="handle"></div><div class="h2">Pay me at</div>
        ${f('cashapp', 'Cash App', '$cashtag')}${f('venmo', 'Venmo', '@username')}${f('zelle', 'Zelle', 'Email or phone')}${V.paypalCheckout ? '' : f('paypal', 'PayPal.me', 'username')}
        <button class="btn gold" data-act="saveHandles">Save</button>
      </div>`;
    },
    car() {
      const s = L.modal;
      return `<div class="scrim" data-act="closeModal"></div><div class="modal night" role="dialog" aria-label="Car">
        <div class="handle"></div><div class="h2">You and the car</div>
        <div><label class="lab" for="m-dname">Name</label><input id="m-dname" class="field" data-bind="modal.name" value="${esc(s.name || '')}"></div>
        <div><label class="lab" for="m-car">Car</label><input id="m-car" class="field" data-bind="modal.car" value="${esc(s.car || '')}"></div>
        <div><label class="lab" for="m-plate">Plate</label><input id="m-plate" class="field" data-bind="modal.plate" value="${esc(s.plate || '')}" style="text-transform:uppercase"></div>
        <div><label class="lab" for="m-dphone">Phone</label><input id="m-dphone" class="field" type="tel" data-bind="modal.phone" value="${esc(s.phone || '')}"></div>
        <button class="btn gold" data-act="saveSettings" data-keys="name,car,plate,phone">Save</button>
      </div>`;
    },
    friends() {
      const m = L.modal;
      const rows = V.friends.map((f) => `<div class="friend">${avatar({ id: f.uid, name: f.name, photo: f.photo, color: f.color }, 'sm')}<div class="grow"><b>${esc(f.name)}</b><small>${esc(f.email)}${f.uid ? '' : ' · not signed in yet'}</small></div><button class="gbtn" data-act="unfriend" data-email="${esc(f.email)}">Remove</button></div>`).join('');
      return `<div class="scrim" data-act="closeModal"></div><div class="modal night" role="dialog" aria-label="Friends">
        <div class="handle"></div><div class="h2">Friends</div>
        <div class="col" style="gap:8px">${rows}</div>
        <div><label class="lab" for="m-fname">Name</label><input id="m-fname" class="field" data-bind="modal.name" value="${esc(m.name || '')}"></div>
        <div><label class="lab" for="m-femail">Email</label><input id="m-femail" class="field" type="email" data-bind="modal.email" value="${esc(m.email || '')}"></div>
        <button class="btn gold" data-act="addFriend" ${L.busy ? 'disabled' : ''}>Add</button>
      </div>`;
    },
    paypal() {
      const cur = V.settings.paypalFee;
      const b = (id, label) => `<button class="tip ${cur === id ? 'on' : ''}" data-act="setPpFee" data-id="${id}" aria-pressed="${cur === id}">${label}</button>`;
      return `<div class="scrim" data-act="closeModal"></div><div class="modal night" role="dialog" aria-label="PayPal">
        <div class="handle"></div><div class="h2">PayPal</div>
        <div class="row"><span class="pm paypal">P</span><span class="grow" style="font-weight:600">${V.paypalCheckout ? 'Connected' : 'Not connected'}</span></div>
        ${V.paypalCheckout ? `<div class="kicker">PayPal's fee · 3.49% + $0.49</div><div class="tips">${b('me', 'I pay it')}${b('friend', 'Friends pay it')}</div>` : ''}
      </div>`;
    },
    theme() {
      const b = (id, label) => `<button class="tip ${themePref() === id ? 'on' : ''}" data-act="setTheme" data-id="${id}" aria-pressed="${themePref() === id}">${label}</button>`;
      return `<div class="scrim" data-act="closeModal"></div><div class="modal night" role="dialog" aria-label="Theme">
        <div class="handle"></div><div class="h2">Theme</div>
        <div class="themes">${b('auto', 'Auto')}${b('light', 'Light')}${b('dark', 'Dark')}</div>
      </div>`;
    },
    navApp() {
      const cur = V.settings.navApp || 'jewber';
      const b = (id, label) => `<button class="tip ${cur === id ? 'on' : ''}" data-act="setNavApp" data-id="${id}" aria-pressed="${cur === id}">${label}</button>`;
      return `<div class="scrim" data-act="closeModal"></div><div class="modal night" role="dialog" aria-label="Directions">
        <div class="handle"></div><div class="h2">Directions</div>
        <div class="kicker">On Accept and Start trip, open</div>
        <div class="tips">${b('jewber', 'Jewber')}${b('waze', 'Waze')}${b('gmaps', 'Google Maps')}</div>
      </div>`;
    },
    city() {
      const cur = V.settings.city;
      const b = (id, label) => `<button class="tip ${cur === id ? 'on' : ''}" data-act="setCity" data-id="${id}">${label}</button>`;
      return `<div class="scrim" data-act="closeModal"></div><div class="modal night" role="dialog" aria-label="Shabbat times">
        <div class="handle"></div><div class="h2">Shabbat times</div>
        <div class="tips">${b('auto', 'Where I am')}${b('phoenix', 'Phoenix')}${b('jerusalem', 'Jerusalem')}</div>
      </div>`;
    },
  };

  // ---- actions --------------------------------------------------------------------------
  function startWhere(opts = {}) {
    L.where = { pick: null, drop: null, focus: 'drop', q: '', results: null, when: null, save: false, ...opts };
    L.screen = 'where';
    render();
    setTimeout(() => { const el = $('#f-drop'); if (el) el.focus(); }, 50);
  }
  async function toChoose() {
    const w = L.where;
    let pick = w.pick;
    if (!pick) {
      const h = L.here || await getHere();
      if (!h) { toast('Pick a pickup spot'); w.focus = 'pick'; render(); return; }
      L.here = h;
      pick = await api('GET', `/api/reverse?lat=${h.lat}&lng=${h.lng}`).catch(() => ({ label: 'Current location', address: '', lat: h.lat, lng: h.lng }));
      w.pick = pick;
    }
    L.choose = { type: (L.choose && L.choose.type) || 'schlep', quote: null, pick, drop: w.drop, err: '' };
    L.screen = 'choose';
    render();
    try {
      L.choose.quote = await api('POST', '/api/quote', { pickup: pick, dropoff: w.drop });
    } catch (e) { L.choose.err = e.message; }
    render();
  }
  async function choosePlace(p) {
    const w = L.where;
    if (w.save) { L.modal = { kind: 'savePlace', place: p, label: p.label, icon: 'star' }; render(); return; }
    if (w.focus === 'pick') { w.pick = p; w.focus = 'drop'; w.q = ''; w.results = null; render(); if (!w.drop) { const el = $('#f-drop'); if (el) el.focus(); return; } }
    else { w.drop = p; w.q = ''; w.results = null; }
    if (w.drop) toChoose();
  }
  let searchT = null;
  function search() {
    const w = L.where;
    clearTimeout(searchT);
    if (!w.q || w.q.length < 2) { w.results = null; render(); return; }
    w.searching = true;
    searchT = setTimeout(async () => {
      const near = L.here || V.driver.loc;
      const q = w.q;
      try {
        const j = await api('GET', `/api/search?q=${encodeURIComponent(q)}${near ? `&lat=${near.lat}&lng=${near.lng}` : ''}`);
        if (L.where === w && w.q === q) { w.results = j.results; w.searching = false; render(); }
      } catch { w.searching = false; render(); }
    }, 250);
  }

  // ---- a pin on the map: drag the map under it, the address follows
  const PIN_SHEET = 236;
  function pinPadding() {
    const wide = innerWidth >= 720;
    return { top: 0, bottom: wide ? 0 : PIN_SHEET, left: wide ? 452 : 0, right: 0 };
  }
  function startPin(focus) {
    if (!L.where) L.where = { pick: L.choose ? L.choose.pick : null, drop: L.choose ? L.choose.drop : null, focus, q: '', results: null, when: null };
    focus = focus || L.where.focus || 'drop';
    const from = (focus === 'pick' ? L.where.pick : L.where.drop) || L.here || (V.driver && V.driver.loc) || { lat: 33.45, lng: -112.074 };
    L.pin = { focus, back: L.screen === 'pin' ? 'where' : L.screen, place: null, moving: false };
    L.modal = null;
    L.screen = 'pin';
    lastFit = '';
    render();
    if (map) map.easeTo({ center: [from.lng, from.lat], zoom: Math.max(16.5, map.getZoom()), padding: pinPadding(), duration: 600 });
    setTimeout(pinMoved, 750);
  }
  let pinT = null;
  function pinMoved() {
    const pn = L.pin;
    if (!pn || !map) return;
    const c = map.getCenter();
    const at = { lat: +c.lat.toFixed(6), lng: +c.lng.toFixed(6) };
    if (pn.at && pn.at.lat === at.lat && pn.at.lng === at.lng && pn.place) { pn.moving = false; render(); return; }
    pn.moving = false;
    pn.at = at;
    pn.place = null;
    render();
    clearTimeout(pinT);
    pinT = setTimeout(async () => {
      try {
        const r = await api('GET', `/api/reverse?lat=${at.lat}&lng=${at.lng}`);
        if (L.pin === pn && pn.at === at) { pn.place = { label: r.label, address: r.address, lat: at.lat, lng: at.lng }; render(); }
      } catch {
        if (L.pin === pn && pn.at === at) { pn.place = { label: 'Pinned spot', address: '', ...at }; render(); }
      }
    }, 250);
  }

  // PayPal: same window on the web (it comes back to /?paid=...), the browser from the Android app
  // (it comes back to the app through jewber://open).
  const withFee = (n) => Math.ceil(((n + 0.49) / (1 - 0.0349)) * 100) / 100;
  function goPaypal(url) {
    if (APP && APP.open) { APP.open(url); toast('Finish in PayPal'); return; }
    location.href = url;
  }
  const PAID_WORDS = { ok: 'Paid with PayPal. Thanks!', pending: 'PayPal is still finishing it', cancel: 'PayPal cancelled', no: "PayPal didn't go through" };
  window.jewberPaid = (r) => { if (PAID_WORDS[r]) toast(PAID_WORDS[r]); window.jewberRefresh && window.jewberRefresh(); };

  async function openProfile(uid) {
    if (!uid) return;
    L.prof = { uid, data: null, back: L.screen };
    L.modal = null;
    L.screen = 'profile';
    render();
    try { const d = await api('GET', `/api/profile/${encodeURIComponent(uid)}`); if (L.prof && L.prof.uid === uid) { L.prof.data = d; render(); } } catch (e) { toast(e.message); }
  }
  // A photo: cropped to a square in the middle and shrunk to 320 px before it leaves the phone.
  async function sendPhoto(file) {
    if (!file) return;
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = url; });
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const cv = document.createElement('canvas');
      cv.width = cv.height = 320;
      cv.getContext('2d').drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 320, 320);
      await act(async () => { await api('POST', '/api/me/photo', { data: cv.toDataURL('image/jpeg', 0.86) }); toast('Looking good'); });
    } catch { toast("That photo didn't open"); } finally { URL.revokeObjectURL(url); }
  }

  async function payResult(j) {
    if (j.link) openLink(j.link);
    else if (j.zelle) { L.modal = { kind: 'zelle', to: j.zelle, usd: j.usd }; render(); }
  }

  const b64 = (s) => { const p = '='.repeat((4 - (s.length % 4)) % 4); const raw = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(raw, (c) => c.charCodeAt(0)); };
  async function togglePush() {
    const reg = await navigator.serviceWorker.register('/sw.js');
    if (V.me.push) { const s = await reg.pushManager.getSubscription(); if (s) await s.unsubscribe(); toast('Off on this device'); return; }
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('Notifications are blocked');
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(V.vapid) });
    await api('POST', '/api/push', { sub: sub.toJSON() });
    await api('POST', '/api/push/test');
  }

  const ACTS = {
    go: (el) => { L.screen = el.dataset.to; L.modal = null; render(); },
    back: () => {
      if (L.screen === 'choose') { L.screen = 'where'; L.where.focus = 'drop'; render(); return; }
      L.screen = 'home'; L.where = null; render();
    },
    whereTo: () => startWhere(),
    goPlace: (el) => { const p = RIDER.home().places[+el.dataset.i]; startWhere({ drop: p }); toChoose(); },
    pickResult: (el) => choosePlace(L.where.results[+el.dataset.i]),
    pickSaved: (el) => { const list = [...V.me.places, ...V.recent]; choosePlace(list[+el.dataset.i]); },
    pickHere: () => { const w = L.where; w.pick = null; w.focus = 'drop'; w.q = ''; w.results = null; render(); if (w.drop) toChoose(); },
    pickType: (el) => { L.choose.type = el.dataset.id; render(); },
    pinStart: (el) => startPin(el.dataset.focus || (L.where && L.where.focus)),
    pinBack: () => { const back = L.pin ? L.pin.back : 'where'; L.pin = null; L.screen = back === 'choose' && L.choose ? 'choose' : 'where'; lastFit = ''; render(); },
    pinMe: async () => { const h = await getHere(); if (h && map) { L.here = h; map.easeTo({ center: [h.lng, h.lat], zoom: 17, padding: pinPadding(), duration: 500 }); } },
    pinOk: () => {
      const pn = L.pin;
      if (!pn || !pn.place) return;
      L.pin = null;
      L.where.focus = pn.focus;
      L.where.q = '';
      L.where.results = null;
      L.screen = 'where';
      lastFit = '';
      choosePlace(pn.place);
    },
    openPay: (el) => { L.modal = { kind: 'pay', for: el.dataset.for || 'ride' }; render(); },
    choosePay: (el) => act(async () => {
      const id = el.dataset.id;
      const f = L.modal.for;
      L.modal = null;
      if (f === 'arr') { L.arr.method = id; return; }
      if (f === 'tab' && id === 'paypal' && V.paypalCheckout) { const pj = await api('POST', '/api/tab/paypal', { app: !!APP }); goPaypal(pj.url); return; }
      if (f === 'tab') { const j = await api('POST', '/api/tab/pay', { method: id }); await payResult(j); toast('Thanks!'); return; }
      L.pay = id;
      api('POST', '/api/me', { pay: id }).catch(() => {});
    }),
    setPay: (el) => act(async () => { L.pay = el.dataset.id; await api('POST', '/api/me', { pay: el.dataset.id }); }),
    openWhen: () => {
      if (!L.where) L.where = { pick: L.choose ? L.choose.pick : null, drop: L.choose ? L.choose.drop : null, focus: 'drop', q: '', results: null, when: null };
      L.modal = { kind: 'when', value: '' };
      render();
    },
    setWhen: (el) => {
      let ms = el.dataset.ms !== undefined ? +el.dataset.ms : (L.modal.value ? +new Date(L.modal.value) : NaN);
      if (Number.isNaN(ms)) { toast('Pick a time'); return; }
      L.where.when = ms || null;
      L.modal = null;
      if (L.screen === 'choose' || (L.where.drop && L.screen !== 'where')) { toChoose(); return; }
      if (L.screen !== 'where') L.screen = 'where';
      render();
    },
    request: () => act(async () => {
      const c = L.choose;
      const body = { pickup: c.pick, dropoff: c.drop, type: c.type, pay: L.pay };
      if (L.where && L.where.when) body.when = new Date(L.where.when).toISOString();
      try {
        await api('POST', '/api/rides', body);
      } catch (e) {
        if (e.code === 'off-duty' || e.code === 'busy' || e.code === 'shabbat') { c.err = e.message; return; }
        throw e;
      }
      if (body.when) toast(`Sababa. Asked ${V.driver.name} for ${whenText(L.where.when)}`);
      L.screen = 'home';
      L.where = null;
      L.choose = null;
    }),
    cancelRide: (el) => act(async () => { if (!confirm('Cancel this ride?')) return; await api('POST', `/api/rides/${el.dataset.id}/cancel`); }),
    ackRide: () => act(async () => { await api('POST', `/api/rides/${V.ride.id}/ok`); }),
    again: () => act(async () => {
      const r = V.ride;
      await api('POST', `/api/rides/${r.id}/ok`);
      await api('POST', '/api/rides', { pickup: r.pickup, dropoff: r.dropoff, type: r.type, pay: r.pay });
    }),
    againLater: () => act(async () => {
      const r = V.ride;
      await api('POST', `/api/rides/${r.id}/ok`);
      L.where = { pick: r.pickup, drop: r.dropoff, focus: 'drop', q: '', results: null, when: null };
      L.choose = { type: r.type, quote: null, pick: r.pickup, drop: r.dropoff, err: '' };
      L.screen = 'choose';
      L.modal = { kind: 'when', value: '' };
    }),
    motzei: () => {
      L.where = { pick: null, drop: null, focus: 'drop', q: '', results: null, when: V.shabbat.end + 15 * 60e3 };
      L.screen = 'where';
      render();
    },
    share: async () => {
      const r = V.ride;
      const left = etaLeft(r.eta);
      const text = r.state === 'riding' ? `I'm in ${V.driver.name}'s car, heading to ${r.dropoff.label}. Arriving ${left !== null ? clock(T() + left * 1000) : 'soon'}.` : `${V.driver.name} is picking me up at ${r.pickup.label}.`;
      try { if (navigator.share) await navigator.share({ title: 'Jewber', text }); else { await navigator.clipboard.writeText(text); toast('Copied'); } } catch {}
    },
    openKvetch: () => { L.modal = { kind: 'kvetch', text: '' }; render(); },
    sendKvetch: () => act(async () => { await api('POST', '/api/kvetch', { text: L.modal.text, ride: V.ride ? V.ride.id : null }); L.modal = null; toast(`Noted. ${V.driver.name} will feel terrible about it.`); }),
    simcha: () => act(async () => { await api('POST', `/api/rides/${V.ride.id}/simcha`, { on: !V.ride.simcha }); }),
    rate: (el) => { L.arr.rating = +el.dataset.n; if (L.arr.words && L.arr.ghosted) { L.arr.text = ghostwrite('driver', L.arr.rating, V.driver.name); } render(); },
    chip: (el) => { const c = el.dataset.c, a = L.arr; a.chips = a.chips.includes(c) ? a.chips.filter((x) => x !== c) : [...a.chips, c]; render(); },
    words: () => { L.arr.words = true; render(); setTimeout(() => { const t = $('#rv-text'); if (t) t.focus(); }, 50); },
    ghost: () => { L.arr.words = true; L.arr.ghosted = true; L.arr.text = ghostwrite('driver', L.arr.rating, V.driver.name); render(); },
    roundUp: () => { L.arr.roundUp = !L.arr.roundUp; render(); },
    openBracha: () => { L.modal = { kind: 'bracha' }; render(); },
    pickBracha: (el) => { L.arr.tip = { kind: 'bracha', text: el.dataset.b }; L.modal = null; render(); },
    rrRate: (el) => { L.rr.rating = +el.dataset.n; if (L.rr.words && L.rr.ghosted) L.rr.text = ghostwrite('rider', L.rr.rating, V.ended.rider.name); render(); },
    rrChip: (el) => { const c = el.dataset.c, a = L.rr; a.chips = a.chips.includes(c) ? a.chips.filter((x) => x !== c) : [...a.chips, c]; render(); },
    rrWords: () => { L.rr.words = true; render(); },
    rrGhost: () => { L.rr.words = true; L.rr.ghosted = true; L.rr.text = ghostwrite('rider', L.rr.rating, V.ended.rider.name); render(); },
    rrSend: (el) => act(async () => { const a = L.rr; await api('POST', `/api/rides/${el.dataset.id}/review`, { stars: a.rating, chips: a.chips, text: a.words ? a.text : '' }); toast('Sent. Yasher koach.'); }),
    profile: (el) => openProfile(el.dataset.uid),
    profileBack: () => { L.screen = (L.prof && L.prof.back) || (V.me.role === 'driver' ? 'dhome' : 'home'); L.prof = null; render(); },
    setProfile: (el) => act(async () => { const k = el.dataset.k; await api('POST', '/api/me/profile', { [k]: V.me[k] === el.dataset.v ? '' : el.dataset.v }); }),
    photoOff: () => act(async () => { await api('DELETE', '/api/me/photo'); }),
    sounds: () => { try { localStorage.setItem('jb.sounds', soundsOn() ? 'off' : 'on'); } catch {} if (soundsOn()) sound('chime'); render(); },
    logo: () => { L.logoTaps = (L.logoTaps || []).filter((t) => Date.now() - t < 1200).concat(Date.now()); if (L.logoTaps.length >= 3) { L.logoTaps = []; toast(YIDDISH[Math.floor(Math.random() * YIDDISH.length)]); celebrate('logo' + Date.now()); } },
    kvetchPick: (el) => { const k = el.dataset.k; L.modal.text = L.modal.text ? `${L.modal.text}. ${k}` : k; render(); },
    gave: () => act(async () => { await api('POST', '/api/tzedakah/gave'); toast('Tizku l\'mitzvot'); }),
    tip: (el) => { const v = JSON.parse(el.dataset.tip); const a = L.arr; a.tip = a.tip && a.tip.kind === v.kind && a.tip.usd === v.usd ? null : v; render(); },
    tipOther: () => { L.modal = { kind: 'tipOther', value: '' }; render(); },
    setTipOther: () => { const n = Math.round(+L.modal.value * 100) / 100; L.arr.tip = n > 0 ? { kind: 'usd', usd: Math.min(100, n) } : null; L.modal = null; render(); },
    pay: () => act(async () => {
      const a = L.arr;
      await api('POST', `/api/rides/${V.ride.id}/review`, { stars: a.rating, chips: a.chips, text: a.words ? a.text : '' }).catch(() => {});
      if (a.method === 'paypal' && V.paypalCheckout) {
        const pj = await api('POST', `/api/rides/${V.ride.id}/paypal`, { tip: a.tip, rating: a.rating, roundUp: a.roundUp, app: !!APP });
        goPaypal(pj.url);
        return;
      }
      const j = await api('POST', `/api/rides/${V.ride.id}/pay`, { method: a.method, tip: a.tip, rating: a.rating, roundUp: a.roundUp });
      await payResult(j);
      toast(a.tip && a.tip.kind === 'bracha' ? 'Amen. Toda raba!' : 'Toda raba!');
    }),
    payTab: () => act(async () => { const a = L.arr; await api('POST', `/api/rides/${V.ride.id}/pay`, { method: 'tab', tip: a.tip, rating: a.rating }); toast('On your tab'); }),
    copy: async (el) => { try { await navigator.clipboard.writeText(el.dataset.text); toast('Copied'); } catch { toast(el.dataset.text); } },
    closeModal: () => { L.modal = null; render(); },
    addPlace: () => startWhere({ save: true }),
    placeIcon: (el) => { L.modal.icon = el.dataset.id; render(); },
    savePlace: () => act(async () => {
      const m = L.modal;
      await api('POST', '/api/places', { ...m.place, label: m.label || m.place.label, icon: m.icon });
      L.modal = null;
      L.screen = 'account';
      L.where = null;
    }),
    delPlace: (el) => act(async () => { await api('DELETE', `/api/places/${el.dataset.id}`); }),
    push: () => act(togglePush),
    signOut: () => act(async () => { await api('POST', '/api/auth/out'); if (es) es.close(); es = null; L.signin = { email: '', sent: false, code: '', err: '' }; signedOut(); }),
    usePw: () => { const s = L.signin; L.signin = { ...s, pw: true, err: '', login: s.email }; render(); setTimeout(() => { const el = $(L.signin.login ? '#pass' : '#login'); if (el) el.focus(); }, 50); },
    useCode: () => { const s = L.signin; L.signin = { email: s.login && s.login.includes('@') ? s.login : s.email || '', sent: false, code: '', err: '', pw: false }; try { localStorage.setItem('jb.signin', 'code'); } catch {} render(); },
    mPassword: (el) => { L.modal = { kind: 'password', mode: el.dataset.mode || 'set', current: '', next: '', again: '', err: '' }; render(); setTimeout(() => { const f = $('#pw-current') || $('#pw-next'); if (f) f.focus(); }, 50); },
    savePassword: () => act(async () => {
      const m = L.modal;
      if (m.mode === 'remove') { await api('DELETE', '/api/me/password', { current: m.current }); L.modal = null; toast('Password removed. Codes it is.'); return; }
      if (m.next !== m.again) { m.err = "The two passwords don't match"; return; }
      await api('POST', '/api/me/login', { password: m.next, current: m.current });
      L.modal = null;
      toast(V.me.hasPassword ? 'Password changed' : 'Password set. Sababa.');
    }),
    newCode: () => { L.signin = { email: L.signin.email, sent: false, code: '', err: '' }; render(); },
    askJoin: () => { L.signin.join = true; L.signin.err = ''; render(); setTimeout(() => { const el = $('#email'); if (el && !el.value) el.focus(); else { const n = $('#jname'); if (n) n.focus(); } }, 50); },
    backToSignIn: () => { L.signin = { email: L.signin.email, sent: false, code: '', err: '' }; render(); },
    joinYes: (el) => act(async () => { await api('POST', `/api/joins/${encodeURIComponent(el.dataset.email)}/yes`); toast('Added. Invite sent.'); }),
    joinNo: (el) => act(async () => { await api('POST', `/api/joins/${encodeURIComponent(el.dataset.email)}/no`); }),

    // driver
    duty: () => act(async () => { await api('POST', '/api/driver/duty', { on: !V.driver.onDuty }); if (!V.driver.onDuty && !APP) getHere(); }),
    status: (el) => act(async () => { await api('POST', '/api/driver/status', { status: el.dataset.id }); }),
    accept: (el) => act(async () => { await api('POST', `/api/rides/${el.dataset.id}/accept`); sound('shofar'); }),
    decline: (el) => act(async () => { await api('POST', `/api/rides/${el.dataset.id}/decline`); }),
    go2: (el) => act(async () => { await api('POST', `/api/rides/${el.dataset.id}/go`); }),
    here: (el) => act(async () => { await api('POST', `/api/rides/${el.dataset.id}/here`); }),
    start: (el) => act(async () => { await api('POST', `/api/rides/${el.dataset.id}/start`); L.nav = null; }),
    end: (el) => act(async () => { if (!confirm('End the trip?')) return; await api('POST', `/api/rides/${el.dataset.id}/end`); L.nav = null; }),
    rateRider: (el) => act(async () => { await api('POST', `/api/rides/${el.dataset.id}/rate`, { stars: +el.dataset.n }); }),
    skipRate: (el) => act(async () => { await api('POST', `/api/rides/${el.dataset.id}/skip-rating`); }),
    voice: () => { voice.on = !voice.on; try { localStorage.setItem('jb.voice', voice.on ? 'on' : 'off'); } catch {} if (!voice.on) { if (APP && APP.stopSpeaking) try { APP.stopSpeaking(); } catch {} else if ('speechSynthesis' in window) speechSynthesis.cancel(); } else say('Directions on.'); render(); },
    recenter: () => { L.userMoved = 0; render(); },
    getApp: () => { try { localStorage.setItem('jb.getapp', '1'); } catch {} location.href = getHref; },
    mTheme: () => { L.modal = { kind: 'theme' }; render(); },
    setTheme: (el) => { try { localStorage.setItem('jb.theme', el.dataset.id); } catch {} lastSync = ''; syncApp(); render(); },
    mNavApp: () => { L.modal = { kind: 'navApp' }; render(); },
    setNavApp: (el) => act(async () => { await api('POST', '/api/driver/settings', { navApp: el.dataset.id }); L.modal = null; }),
    waze: () => { const r = V.active; const t = r.state === 'riding' ? r.dropoff : r.pickup; openLink(`https://waze.com/ul?ll=${t.lat},${t.lng}&navigate=yes`); },
    gmaps: () => { const r = V.active; const t = r.state === 'riding' ? r.dropoff : r.pickup; openLink(`https://www.google.com/maps/dir/?api=1&destination=${t.lat},${t.lng}&travelmode=driving`); },
    gotIt: (el) => act(async () => { await api('POST', `/api/rides/${el.dataset.id}/paid`); }),
    allPaid: (el) => act(async () => { await api('POST', `/api/friends/${el.dataset.uid}/paid`); }),
    nudge: (el) => act(async () => { await api('POST', `/api/friends/${el.dataset.uid}/nudge`); toast('Nudged. Gently, like a Bubbe.'); }),
    mFares: () => { const s = V.settings; L.modal = { kind: 'fares', base: s.base, perMile: s.perMile, minFare: s.minFare }; render(); },
    mHandles: () => { L.modal = { kind: 'handles', ...V.settings.handles }; render(); },
    mCar: () => { const s = V.settings; L.modal = { kind: 'car', name: V.me.name, car: s.car, plate: s.plate, phone: s.phone }; render(); },
    mFriends: () => { L.modal = { kind: 'friends', name: '', email: '' }; render(); },
    mCity: () => { L.modal = { kind: 'city' }; render(); },
    mPaypal: () => { L.modal = { kind: 'paypal' }; render(); },
    setPpFee: (el) => act(async () => { await api('POST', '/api/driver/settings', { paypalFee: el.dataset.id }); }),
    ppRefund: (el) => act(async () => { if (!confirm(`Refund ${usd(+el.dataset.amt)} to their PayPal?`)) return; await api('POST', `/api/paypal/${encodeURIComponent(el.dataset.id)}/refund`); toast('Refunded'); }),
    saveSettings: (el) => act(async () => {
      const body = {};
      for (const k of el.dataset.keys.split(',')) body[k] = L.modal[k];
      if (body.plate) body.plate = String(body.plate).toUpperCase();
      await api('POST', '/api/driver/settings', body);
      L.modal = null;
    }),
    saveHandles: () => act(async () => {
      const m = L.modal;
      await api('POST', '/api/driver/settings', { handles: { cashapp: m.cashapp, venmo: m.venmo, zelle: m.zelle, paypal: m.paypal } });
      L.modal = null;
    }),
    addFriend: () => act(async () => { await api('POST', '/api/friends', { name: L.modal.name, email: L.modal.email }); L.modal.name = ''; L.modal.email = ''; }),
    unfriend: (el) => act(async () => { if (!confirm(`Remove ${el.dataset.email}?`)) return; await api('DELETE', `/api/friends/${encodeURIComponent(el.dataset.email)}`); }),
    setCity: (el) => act(async () => { await api('POST', '/api/driver/settings', { city: el.dataset.id }); L.modal = null; }),
    signalToggle: () => act(async () => { await api('POST', '/api/driver/settings', { signal: !V.settings.signal }); }),
  };

  // ---- events ---------------------------------------------------------------------------
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || !ui.contains(el)) return;
    if (el.tagName === 'A' && el.getAttribute('href')) return;
    e.preventDefault();
    const fn = ACTS[el.dataset.act];
    if (fn) fn(el);
  });

  function setPath(path, value) {
    const keys = path.split('.');
    let o = L;
    for (const k of keys.slice(0, -1)) o = o[k];
    o[keys.at(-1)] = value;
  }
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (!ui.contains(el)) return;
    const b = el.dataset.bind;
    if (!b) return;
    if (b === 'where.qpick' || b === 'where.qdrop') {
      L.where.focus = el.dataset.focus;
      L.where.q = el.value;
      search();
      return;
    }
    if (b === 'signin.code') {
      L.signin.code = el.value.replace(/\D/g, '').slice(0, 6);
      render();
      if (L.signin.code.length === 6) verify();
      return;
    }
    setPath(b, el.value);
  });
  document.addEventListener('focusin', (e) => {
    const el = e.target;
    if (el.dataset && el.dataset.focus && L.where && L.where.focus !== el.dataset.focus) {
      L.where.focus = el.dataset.focus;
      L.where.q = '';
      L.where.results = null;
      render();
    }
  });
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (ui.contains(el) && el.dataset.photo) { sendPhoto(el.files && el.files[0]); el.value = ''; return; }
    if (ui.contains(el) && el.dataset.login) { api('POST', '/api/me/login', { username: el.value }).then(() => toast('Saved')).catch((err) => { toast(err.message); el.value = V.me.username || ''; }); return; }
    if (ui.contains(el) && el.dataset.profile) { api('POST', '/api/me/profile', { [el.dataset.profile]: el.value }).then(() => toast('Saved')).catch((err) => toast(err.message)); return; }
    if (!ui.contains(el) || !el.dataset.save) return;
    const k = el.dataset.save;
    api('POST', '/api/me', { [k]: el.value }).then(() => toast('Saved')).catch((err) => toast(err.message));
  });
  document.addEventListener('submit', (e) => {
    const f = e.target;
    if (!ui.contains(f)) return;
    e.preventDefault();
    if (f.dataset.form === 'code') sendCode();
    if (f.dataset.form === 'verify') verify();
    if (f.dataset.form === 'join') askToJoin();
    if (f.dataset.form === 'password') passwordIn();
    if (f.dataset.form === 'savePassword') ACTS.savePassword();
  });

  async function sendCode() {
    const s = L.signin;
    s.err = '';
    L.busy = true;
    render();
    try {
      await api('POST', '/api/auth/code', { email: s.email });
      s.sent = true;
      s.code = '';
      render();
      setTimeout(() => { const el = $('#code'); if (el) el.focus(); }, 50);
    } catch (e) {
      // not on the list: offer to ask
      if (e.code === 'not-on-list') { s.join = true; s.err = ''; setTimeout(() => { const el = $('#jname'); if (el) el.focus(); }, 50); } else s.err = e.message;
    } finally { L.busy = false; render(); }
  }
  async function passwordIn() {
    const s = L.signin;
    if (L.busy) return;
    s.err = '';
    L.busy = true;
    render();
    try {
      const j = await api('POST', '/api/auth/password', { login: s.login || s.email, password: s.pass, device: APP ? 'android' : 'web' });
      try { localStorage.setItem('jb.signin', 'password'); } catch {}
      if (APP && APP.setToken) APP.setToken(j.token);
      s.pass = '';
      L.screen = j.view.me.role === 'driver' ? 'dhome' : 'home';
      setView(j.view);
      connect();
      refreshHere();
    } catch (e) { s.err = e.message; s.pass = ''; } finally { L.busy = false; render(); }
  }
  async function askToJoin() {
    const s = L.signin;
    s.err = '';
    L.busy = true;
    render();
    try {
      const j = await api('POST', '/api/auth/join', { email: s.email, name: s.name });
      if (j.allowed) { s.join = false; L.busy = false; sendCode(); return; }
      s.join = false;
      s.asked = true;
    } catch (e) { s.err = e.message; } finally { L.busy = false; render(); }
  }
  async function verify() {
    const s = L.signin;
    if (L.busy) return;
    s.err = '';
    L.busy = true;
    render();
    try {
      const j = await api('POST', '/api/auth/verify', { email: s.email, code: s.code, device: APP ? 'android' : 'web' });
      try { localStorage.setItem('jb.signin', 'code'); } catch {}
      if (APP && APP.setToken) APP.setToken(j.token);
      L.screen = j.view.me.role === 'driver' ? 'dhome' : 'home';
      setView(j.view);
      connect();
      refreshHere();
    } catch (e) { s.err = e.message; s.code = ''; } finally { L.busy = false; render(); }
  }

  // Android: Back goes through the page first.
  window.jewberBack = () => {
    if (L.modal) { L.modal = null; render(); return true; }
    if (L.screen === 'pin') { ACTS.pinBack(); return true; }
    if (L.screen === 'profile') { ACTS.profileBack(); return true; }
    if (V && V.me.role === 'driver' && L.screen === 'account') { L.screen = 'ledger'; render(); return true; }
    if (V && ['where', 'choose', 'tab', 'rides', 'account', 'ledger'].includes(L.screen)) { ACTS.back(); if (L.screen === 'ledger') { L.screen = 'dhome'; render(); } return true; }
    return false;
  };
  // Android: the app answered a notification button (accept, can't) or came back to the front.
  window.jewberRefresh = () => { api('GET', '/api/me').then(setView).catch(() => {}); };

  // ---- ticking --------------------------------------------------------------------------
  setInterval(() => {
    if (!V) return;
    const s = V.me.role === 'driver' ? driverScreen() : riderScreen();
    if (['finding', 'coming', 'riding', 'shabbat', 'dhome', 'dride', 'home'].includes(s)) render();
    if (s === 'dride') { refreshNav(); navTick(); autoNav(); }
    syncApp();
  }, 1000);
  setInterval(() => { if (V && V.me.role !== 'driver') refreshHere(); }, 60000);
  window.addEventListener('resize', () => { lastFit = ''; render(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && V && !es) connect(); });

  // ---- start ----------------------------------------------------------------------------
  (async () => {
    if ('serviceWorker' in navigator && !APP) navigator.serviceWorker.register('/sw.js').catch(() => {});
    const paid = new URLSearchParams(location.search).get('paid');
    if (paid) { history.replaceState(null, '', '/'); if (PAID_WORDS[paid]) setTimeout(() => toast(PAID_WORDS[paid]), 600); }
    try {
      const r = await fetch('/api/me', { credentials: 'same-origin' });
      if (r.status === 401) { signedOut(); return; }
      setView(await r.json());
      connect();
      refreshHere();
    } catch {
      L.toast = 'No connection';
      signedOut();
    }
  })();
})();
