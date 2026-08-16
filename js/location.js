/* ---------------------------------------------------------
   location.js — where you are exploring from.

   The old design stored a distance on every record, which is only true
   from one flat. This stores a *position* instead and computes distance
   in the browser, so the same catalogue works from anywhere.

   Two distinct ideas, deliberately:

     home       your saved default. Changed rarely.
     exploring  a temporary somewhere-else. A hotel, a Sunday in the 13th,
                a friend's sofa. Overrides home until you reset it.

   Privacy: a precise address is kept in memory and localStorage for the
   maths, and is never what the interface shows. Enter "12 rue de X" and
   the site says "5ᵉ arrondissement". The coordinates sent to the weather
   service are rounded to two decimals — about a kilometre.
   --------------------------------------------------------- */

const Loc = (() => {
  const KEY = 'paris-for-you.location.v1';
  const UA_NOTE = 'paris-for-you (personal site)';

  /* Arrondissement centroids — the preset list, and the fallback when a
     record has no coordinates of its own. */
  const ARR = {
    1:[48.8626,2.3363],  2:[48.8683,2.3413],  3:[48.8637,2.3615],  4:[48.8546,2.3572],
    5:[48.8448,2.3501],  6:[48.8496,2.3329],  7:[48.8565,2.3120],  8:[48.8726,2.3120],
    9:[48.8768,2.3374],  10:[48.8760,2.3595], 11:[48.8578,2.3792], 12:[48.8351,2.4212],
    13:[48.8283,2.3626], 14:[48.8331,2.3264], 15:[48.8412,2.3000], 16:[48.8637,2.2769],
    17:[48.8872,2.3070], 18:[48.8925,2.3444], 19:[48.8871,2.3828], 20:[48.8635,2.3985]
  };

  const ARR_NAMES = {
    1:'Louvre · Palais-Royal', 2:'Bourse · Sentier', 3:'Haut Marais', 4:'Marais · Île Saint-Louis',
    5:'Latin Quarter', 6:'Saint-Germain', 7:'Invalides · Eiffel', 8:'Champs-Élysées · Monceau',
    9:'SoPi · Pigalle', 10:'Canal Saint-Martin', 11:'Oberkampf · Bastille', 12:'Bastille · Bercy',
    13:'Butte-aux-Cailles', 14:'Montparnasse · Denfert', 15:'Vaugirard', 16:'Passy · Trocadéro',
    17:'Batignolles', 18:'Montmartre', 19:'Buttes-Chaumont · La Villette', 20:'Belleville · Ménilmontant'
  };

  let state = { home: null, exploring: null, recents: [] };

  /* ---------- persistence ---------- */

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }

  function boot(defaultHome) {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) state = Object.assign({ home: null, exploring: null, recents: [] }, JSON.parse(raw));
    } catch (e) {}
    if (!state.home) state.home = defaultHome;
    return active();
  }

  /* ---------- the current answer ---------- */

  const active = () => state.exploring || state.home;
  const home = () => state.home;
  const isExploring = () => !!state.exploring;
  const recents = () => state.recents.slice(0, 5);

  function setHome(loc)      { state.home = loc; state.exploring = null; save(); }
  function explore(loc)      { state.exploring = loc; remember(loc); save(); }
  function resetToHome()     { state.exploring = null; save(); }

  function remember(loc) {
    if (!loc) return;
    state.recents = [loc, ...state.recents.filter(r => r.label !== loc.label)].slice(0, 5);
  }

  /* ---------- geometry ---------- */

  function km(a, b) {
    if (!a || !b) return Infinity;
    const R = 6371, rad = d => d * Math.PI / 180;
    const dLat = rad(b[0] - a[0]), dLon = rad(b[1] - a[1]);
    const x = Math.sin(dLat / 2) ** 2 +
              Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }

  /* Door-to-door, roughly. Short hops are walked; longer ones assume the
     Metro, where the access and waiting time dominates far more than the
     ride does. An estimate, and the interface says "~" because of it. */
  function minutes(coords) {
    const a = active();
    if (!a || !coords) return null;
    const d = km([a.lat, a.lon], coords);
    if (!isFinite(d)) return null;
    const walk = d / 4.8 * 60;
    const transit = 4 + (d / 16) * 60 + 3;
    return Math.max(2, Math.round(Math.min(walk, transit)));
  }

  /* Distance for a record: its own coordinates if it has them, otherwise
     its arrondissement, otherwise whatever was hand-written. */
  function minutesTo(item) {
    if (item.coords) return minutes(item.coords);
    if (item.arr && ARR[item.arr]) return minutes(ARR[item.arr]);
    return item.minutesFromHome ?? null;
  }

  const kmTo = item => {
    const a = active();
    const c = item.coords || (item.arr && ARR[item.arr]);
    return (a && c) ? km([a.lat, a.lon], c) : Infinity;
  };

  /* ---------- naming things ---------- */

  /* Never show the street they typed. An arrondissement is specific
     enough to be useful and vague enough to be nobody's business. */
  function displayName(loc) {
    if (!loc) return 'Paris';
    if (loc.arr) return `${loc.arr}${loc.arr === 1 ? 'er' : 'e'} · ${ARR_NAMES[loc.arr] || 'Paris'}`;
    return loc.area || loc.label || 'Paris';
  }

  const arrName = n => ARR_NAMES[n] || `${n}e`;
  const arrCoords = n => ARR[n];
  const presets = () => Object.keys(ARR).map(Number)
    .map(n => ({ arr: n, name: ARR_NAMES[n] }));

  /* ---------- finding a place ---------- */

  function fromAddress(hit) {
    const a = hit.address || {};
    const post = String(a.postcode || '');
    let arr = null;
    if (/^75\d{3}$/.test(post)) arr = Number(post.slice(3));       // 75005 → 5
    if (!(arr >= 1 && arr <= 20)) arr = null;
    return {
      lat: +(+hit.lat).toFixed(5),
      lon: +(+hit.lon).toFixed(5),
      arr,
      // a quarter or suburb if OSM knows one — never the house number
      area: a.suburb || a.quarter || a.neighbourhood || a.city_district || null,
      label: (hit.display_name || '').split(',')[0],
      city: a.city || a.town || a.municipality || 'Paris'
    };
  }

  async function search(query) {
    const q = /paris|france/i.test(query) ? query : `${query}, Paris, France`;
    const url = 'https://nominatim.openstreetmap.org/search'
      + `?q=${encodeURIComponent(q)}&format=json&limit=1&addressdetails=1`;
    const res = await fetch(url, { headers: { 'accept-language': 'en' } });
    if (!res.ok) throw new Error('Could not reach the place finder.');
    const [hit] = await res.json();
    if (!hit) throw new Error(`Nothing found for “${query}”.`);
    return fromAddress(hit);
  }

  async function locate() {
    if (!navigator.geolocation) throw new Error('This browser will not share a location.');
    const pos = await new Promise((ok, no) =>
      navigator.geolocation.getCurrentPosition(ok, () => no(new Error('Location permission refused.')),
        { timeout: 12000, maximumAge: 300000 }));
    const { latitude: lat, longitude: lon } = pos.coords;
    // reverse-geocode so we can name an arrondissement rather than a dot
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&addressdetails=1`;
      const res = await fetch(url, { headers: { 'accept-language': 'en' } });
      if (res.ok) return fromAddress(await res.json());
    } catch (e) {}
    return { lat: +lat.toFixed(5), lon: +lon.toFixed(5), arr: null, area: 'Where you are', label: 'Current location' };
  }

  const fromArr = n => ({ lat: ARR[n][0], lon: ARR[n][1], arr: n, area: ARR_NAMES[n], label: ARR_NAMES[n] });

  return {
    boot, save, active, home, isExploring, setHome, explore, resetToHome, recents,
    minutes, minutesTo, kmTo, km, displayName, arrName, arrCoords, presets,
    search, locate, fromArr, ARR_NAMES
  };
})();
