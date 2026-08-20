/* ---------------------------------------------------------
   app.js — loads the data, ranks it, renders one view at a time.
   The ranking lives in scoring.js; this file is presentation.
   --------------------------------------------------------- */

const App = (() => {

  const FILES = ['home', 'events', 'places', 'nightlife', 'sports', 'food', 'itineraries', 'daytrips', 'neighborhoods', 'quests', 'discovered', 'civic', 'notable', 'editorial', 'notes'];
  const D = {};
  let ALL = [];
  let CTX = {};
  let WX = null;
  let VIEW = 'today';
  let HOME = { label: 'Paris' };        // replaced by the location engine
  let DISCOVERED = [];                  // OpenStreetMap layer, positions only

  const $  = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- dates ---------- */

  const TODAY = new Date();
  const iso = d => {
    const t = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return t.toISOString().slice(0, 10);
  };
  const TODAY_ISO = iso(TODAY);
  const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
  const fmtLong  = d => d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const fmtShort = d => d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

  const HOLIDAYS = Rank.HOLIDAYS;

  function weekend() {
    const dow = TODAY.getDay();
    let sat;
    if (dow === 6) sat = TODAY;
    else if (dow === 0) sat = addDays(TODAY, -1);
    else sat = addDays(TODAY, 6 - dow);
    return { sat, sun: addDays(sat, 1), satISO: iso(sat), sunISO: iso(addDays(sat, 1)) };
  }

  function ctxFor(dateISO) {
    const wx = WX && WX.byDate[dateISO];
    return Object.assign({}, CTX, { today: dateISO, weatherMode: wx ? wx.mode : CTX.weatherMode });
  }

  const isEdible = i =>
    ['bakery', 'cafe', 'market'].includes(i.type) || (i.labels || []).includes('foodmission');

  /* Broad — used by the filter, because almost everything here suits two people. */
  const isForTwo = i =>
    (i.labels || []).includes('romantic') ||
    (i.goodFor || []).includes('romantic') ||
    (i.goodFor || []).includes('couple');

  /* Narrow — used for the ♥ mark. If nearly every item carries it the mark
     stops meaning anything, so only the genuinely romantic ones get it. */
  const isRomantic = i =>
    (i.labels || []).includes('romantic') || (i.goodFor || []).includes('romantic');

  /* One line under the wordmark, chosen by the date so it changes daily
     but stays the same all day. Written for the two of them, not for a
     brochure — the aim is a nudge out of the door, not a poem. */
  const EPIGRAPHS = [
    'Somewhere to walk, and each other to walk with. That is the whole plan.',
    'The canal is four minutes away and the light is best around seven.',
    'Paris rewards the second look more than the first. Go somewhere twice.',
    'Nothing here needs booking. Put your shoes on and see what happens.',
    'The best evenings start with no particular destination.',
    'You live here. That means the good things can wait for a Tuesday.',
    'Take the long way. It is the same distance and a better story.',
    'Two coffees, one wander, no itinerary.',
    'Somewhere in this city there is a street you will love and have never seen.',
    'The city is at its best when you are not trying to see it.',
    'Go for the bread. Stay for the afternoon.',
    'A short trip you actually take beats the grand one you keep postponing.',
    'Sit by the water. Let the evening do the rest.',
    'Every arrondissement has one thing worth crossing town for.'
  ];

  function epigraph() {
    const start = new Date(TODAY.getFullYear(), 0, 0);
    const day = Math.floor((TODAY - start) / 86400000);
    return EPIGRAPHS[day % EPIGRAPHS.length];
  }

  /* Best across the weekend, each candidate judged under the weather of
     whichever day it is actually open. */
  function bestForWeekend(pool, satISO, sunISO, filter) {
    const satCtx = ctxFor(satISO), sunCtx = ctxFor(sunISO);
    let best = null, top = -Infinity;
    pool.forEach(i => {
      if (filter && !filter(i)) return;
      const oSat = Rank.isOpenOn(i, satISO), oSun = Rank.isOpenOn(i, sunISO);
      if (!oSat && !oSun) return;
      const s = Math.max(oSat ? Rank.score(i, satCtx) : -Infinity,
                         oSun ? Rank.score(i, sunCtx) : -Infinity);
      if (Number.isFinite(s) && s > top) { top = s; best = i; }
    });
    return best;
  }

  /* ---------- load ----------

     What a record is, and how the six data files stack into two layers,
     lives in js/record.js. It is shared with scripts/check-location.mjs
     rather than copied into it, so the site and the test that grades it
     cannot disagree about what actually shipped. */

  async function load() {
    const results = await Promise.all(FILES.map(async name => {
      try {
        const r = await fetch(`data/${name}.json`, { cache: 'no-cache' });
        if (!r.ok) throw new Error(r.status);
        return [name, await r.json()];
      } catch (e) {
        console.warn('could not load', name, e);
        return [name, { items: [] }];
      }
    }));
    results.forEach(([name, payload]) => { D[name] = payload; });

    /* home.json is only the *default* — the location engine owns the
       answer from here, because it may be overridden by a saved home or
       a temporary "exploring from". */
    const fallback = (D.home && D.home.lat)
      ? { lat: D.home.lat, lon: D.home.lon, arr: D.home.arr, area: D.home.label, label: D.home.label }
      : Loc.fromArr(1);
    Loc.boot(fallback);
    HOME = Loc.active();

    const built = Rec.build(D, TODAY_ISO);
    ALL = built.all;
    DISCOVERED = built.discovered;

    /* The retrieval layer holds both layers from here on. Every section
       that asks "what is near me" goes through it, so there is one place
       that decides what counts as near and one place to change. */
    Near.use(ALL, DISCOVERED);
  }

  /* Distance is a property of *where you are*, not of the record. Stamping
     it once per location change keeps every existing call site correct
     without teaching each of them about the location engine. */
  function applyLocation() {
    HOME = Loc.active();
    [...ALL, ...DISCOVERED].forEach(i => {
      const m = Loc.minutesTo(i);
      if (m != null) i.minutesFromHome = m;
    });
    // Neighbourhood profiles carry their own distance, and "which
    // arrondissement should we do next" is meaningless if it is measured
    // from somewhere you no longer are.
    const here = Loc.active()?.arr ?? null;
    (D.neighborhoods?.items || []).forEach(h => {
      const c = Loc.arrCoords(h.arr);
      if (c) h.minutesFromHome = (h.arr === here) ? 0 : Loc.minutes(c);
      h.isHome = h.arr === here;
    });
  }

  function buildContext() {
    CTX = {
      today: TODAY_ISO,
      weatherMode: WX ? WX.mode : null,
      taste: Store.tasteWeights([...ALL, ...DISCOVERED]),
      exploredArrs: Store.arrs(),
      homeArr: Loc.active()?.arr ?? null
    };
  }

  /* ---------- card ---------- */

  /* One badge only, and only when it says something the rest of the card does not. */
  const BADGES = [
    ['dontmiss',    "Don't miss", 'hot'],
    ['closingsoon', 'Ends soon',  'hot'],
    ['bookahead',   'Book ahead', 'hot'],
    ['hiddengem',   'Hidden gem', ''],
    ['free',        'Free',       '']
  ];

  function badge(item) {
    const labels = item.labels || [];
    for (const [key, text, cls] of BADGES) {
      if (labels.includes(key)) return `<span class="badge ${cls}">${text}</span>`;
    }
    return '';
  }

  function priceText(item) {
    /* Free is a claim, and it needs evidence. Every curated record states
       a price — fifty-two of them state zero — so an absent price means
       nobody checked rather than nothing to pay, and the honest output is
       silence. Saying "Free" under a café because no source mentioned
       money would be an invention, and it is the kind nobody would think
       to check. */
    if (item.price == null) return '';
    if (item.price === 0) return 'Free';
    return `€${item.price}`;
  }

  /* ---------- how much anybody knows about this place ----------

     Four tiers, one definition, used by every card shape. The reader
     should never have to guess whether a recommendation comes from
     somebody who went, somebody who read up on it, or a row in a
     database — so each one carries its own mark and its own wording,
     and the wording is the honest version rather than the flattering
     one. See the ladder in nearby.js for how they rank. */

  const TIER = {
    personal:  { mark: '★', cls: 'personal',   note: null },
    editorial: { mark: '◆', cls: 'researched', note: 'Researched, not visited' },
    sourced:   { mark: '◆', cls: 'researched', note: 'From the record, not a visit' },
    found:     { mark: '·', cls: 'found',      note: 'Found on the map' }
  };

  const tier     = i => TIER[Near.tierOf(i)] || TIER.found;

  /* Spelled out where the reader has stopped to look properly. The short
     label on the card is a hint; this is the actual claim being made. */
  const PROVENANCE = {
    personal:  'Written from a visit.',
    editorial: 'Researched and recommended, but nobody here has been — so treat it as a good lead rather than a promise.',
    sourced:   'A matter of record rather than a recommendation. The facts are checked; the opinion is yours to form.',
    found:     'Found on the map. Nothing here vouches for it beyond the fact that it exists.'
  };
  const provenanceLine = i => `<b>${esc(PROVENANCE[Near.tierOf(i)] || PROVENANCE.found)}</b><br>`;
  const tierCls  = i => tier(i).cls;
  const tierMark = i => tier(i).mark;

  /* OSM cuisine values are machine strings — "coffee_shop", "sushi;ramen".
     Worth showing, because "Vietnamese" is the single most useful word
     you can put next to an unfamiliar restaurant, but not raw, and not
     when it only repeats the category the section is already about. */
  const CUISINE_NOISE = { coffee_shop: 1, cafe: 1, bakery: 1, pastry: 1, restaurant: 1, bar: 1 };

  function cuisineText(item) {
    const raw = (item.cuisine || '').split(';')[0].trim().toLowerCase();
    if (!raw || CUISINE_NOISE[raw]) return '';
    return raw.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
  }

  /* The line under a name. Anything with a reason written down shows it,
     whoever wrote it. A place with nothing but a position says so. */
  function blurb(item) {
    if (item.why) return item.why;
    if (Near.tierOf(item) !== 'found') return '';
    const what = [cuisineText(item), item.area].filter(Boolean).join(' · ');
    return what ? `${what} — found on the map, nobody has vouched for it.`
                : 'Found on the map, nobody has vouched for it.';
  }

  function kicker(item) {
    const bits = [];
    if (item.arr) bits.push(`${item.arr}<sup>e</sup>`);
    else if (item.type === 'daytrip') bits.push('Out of town');
    if (item.minutesFromHome != null) bits.push(`${item.minutesFromHome} min`);
    bits.push(priceText(item));
    if (tier(item).note) bits.push(tier(item).note.toLowerCase());
    if (isRomantic(item)) bits.push('<span class="duo" title="Romantic">♥</span>');
    return bits.filter(Boolean).join(' · ');
  }

  function whenLine(item) {
    if (item.times) return item.times;
    if (item.start && item.end) return `Until ${fmtShort(new Date(item.end + 'T12:00:00'))}`;
    if (item.startTime) return `Best started around ${item.startTime}`;
    return 'Open year round';
  }

  function durText(m) {
    if (!m) return '';
    if (m >= 480) return 'a full day';
    if (m >= 300) return 'half a day';
    if (m >= 60) { const h = Math.round(m / 60); return `about ${h} hour${h === 1 ? '' : 's'}`; }
    return `about ${m} minutes`;
  }

  const mapsLink = i =>
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${i.title} ${i.area || ''} Paris`)}`;

  /* Commons renders only a fixed set of thumbnail widths — anything else is a
     400. Keep in sync with THUMB_WIDTHS in scripts/images.mjs. */
  const THUMB_WIDTHS = [250, 500, 960, 1280];

  function srcset(url) {
    const m = url.match(/^(.*\/thumb\/.*\/)\d+px-(.+)$/);
    if (!m) return '';
    return THUMB_WIDTHS.map(w => `${m[1]}${w}px-${m[2]} ${w}w`).join(', ');
  }

  function img(item, sizes, cls = '') {
    const set = srcset(item.image);
    return `<img src="${esc(item.image)}"${set ? ` srcset="${esc(set)}" sizes="${sizes}"` : ''}
      alt="${esc(item.imageSubject || item.title)}" class="${cls}"
      loading="lazy" decoding="async"
      onload="this.classList.add('loaded')" onerror="this.classList.add('loaded')">`;
  }

  /* Images served from cache can finish loading before the inline onload is
     wired up, which would leave them stuck at opacity 0 on every revisit.
     Sweep after each render and reveal anything already decoded. */
  function settleImages(root = document) {
    root.querySelectorAll('img:not(.loaded)').forEach(i => {
      if (i.complete) i.classList.add('loaded');
    });
  }

  // three columns at 1040px, two from 620px, otherwise nearly full width
  const CARD_SIZES = '(min-width: 940px) 320px, (min-width: 620px) 45vw, 92vw';

  function shot(item) {
    // No free photograph exists for some things. Rather than invent one or
    // drop the frame (which breaks the grid's rhythm), draw a tinted tile at
    // the same aspect ratio. It is clearly not a photograph, which is the point.
    if (!item.image) {
      return `<div class="shot ph"><span class="ph-mark">${item.emoji || '·'}</span>${badge(item)}</div>`;
    }
    return `<div class="shot">${img(item, CARD_SIZES)}${badge(item)}</div>`;
  }

  const RATINGS = [
    ['want',  '📍', 'Want to visit'],
    ['loved', '❤️', 'Loved it'],
    ['good',  '👍', 'Good'],
    ['meh',   '😐', 'Not for us'],
    ['never', '✕',  'Never show again']
  ];

  function detail(item) {
    const r = Store.rating(item.id);

    const prog = (item.programme || [])
      .filter(p => p.date >= TODAY_ISO).slice(0, 4)
      .map(p => {
        const today = p.date === TODAY_ISO;
        const d = new Date(p.date + 'T12:00:00');
        return `<div class="${today ? 'now' : ''}">${today ? 'Tonight' : d.toLocaleDateString('en-GB', { weekday: 'short' })} — ${esc(p.text)}</div>`;
      }).join('');

    const stops = (item.stops || []).map((s, n) => {
      const w = stopWalk(item, s, n);
      return `<li>${esc(s.text)}${w ? ` <span class="w">· ${esc(w)}</span>` : ''}</li>`;
    }).join('');

    const near = (item.nearby || []).map(n => `<div>${n.emoji} ${esc(n.text)}</div>`).join('');

    return `<div class="detail">
      <div class="facts">
        <div>${esc(whenLine(item))}</div>
        ${item.area ? `<div>${esc(item.area)}</div>` : ''}
        ${item.priceNote ? `<div>${esc(item.priceNote)}</div>` : ''}
        ${item.transit ? `<div>${esc(item.transit)}</div>` : ''}
        ${item.durationMin ? `<div>Allow ${durText(item.durationMin)}</div>` : ''}
      </div>
      ${prog ? `<div class="prog">${prog}</div>` : ''}
      ${stops ? `<ul class="stops">${stops}</ul>` : ''}
      ${near ? `<div class="near">${near}</div>` : ''}
      ${pairings(item)}
      ${item.spectator ? `<p class="fx-spec"><b>Where to stand.</b> ${esc(item.spectator)}</p>` : ''}
      <div class="links">
        ${item.url ? `<a href="${esc(item.url)}" target="_blank" rel="noopener">Official site</a>` : ''}
        <a href="${mapsLink(item)}" target="_blank" rel="noopener">Directions</a>
      </div>
      <div class="rate" role="group" aria-label="Rate ${esc(item.title)}">
        ${RATINGS.map(([v, e, t]) =>
          `<button type="button" data-rate="${v}" title="${t}" aria-label="${t}" class="${r === v ? 'on' : ''}">${e}</button>`).join('')}
      </div>
      <p class="credit">
        ${provenanceLine(item)}
        ${item.source ? `Source: ${esc(item.source)}${item.lastVerified ? ` · checked ${item.lastVerified}` : ''}<br>` : ''}
        ${item.image ? `Photo: ${esc(item.imageSubject || '')} — ${esc(item.imageCredit || 'Wikimedia Commons')}` : ''}
      </p>
    </div>`;
  }

  function card(item, cls = '', overline = '') {
    return `<article class="card ${Store.isDone(item.id) ? 'done' : ''} ${tierCls(item)} ${cls}" data-id="${esc(item.id)}">
      ${shot(item)}
      <p class="kicker">${overline ? `<b>${esc(overline)}</b> · ` : ''}${kicker(item)}</p>
      <h2 class="card-title">${esc(item.title)}</h2>
      <p class="why">${esc(blurb(item))}</p>
      <button class="more" type="button">Details</button>
      ${detail(item)}
    </article>`;
  }

  const grid = (items, empty) => items.length
    ? `<div class="grid">${items.map(i => card(i)).join('')}</div>`
    : `<p class="empty">${esc(empty || 'Nothing here right now.')}</p>`;

  /* ---------- presentation pieces ----------
     Five shapes, chosen by what the content is:
       hero   one lead item, only where the photograph is really of the place
       row    a name and a distance — for things read by scanning
       route  a numbered sequence
       trip   wide editorial
       card   the photo card, kept for events and exhibitions
  */

  /* A photograph earns the lead only if it shows the thing itself. Cafés
     borrow a picture of their street, which is honest but says nothing —
     those never take the hero slot. */
  const hasRealPhoto = i => i.image && i.imageKind === 'subject';

  function hero(item) {
    return `<a class="hero" data-id="${esc(item.id)}" href="${item.url ? esc(item.url) : mapsLink(item)}"
        target="_blank" rel="noopener">
      <div class="hero-img">${img(item, '(min-width: 1040px) 1000px, 96vw', 'loaded')}</div>
      <div class="hero-body">
        <p class="hero-kicker">${kicker(item)}</p>
        <h2 class="hero-title">${esc(item.title)}</h2>
        <p class="hero-why">${esc(item.why || '')}</p>
      </div>
    </a>`;
  }

  function row(item, thumb = false) {
    const bits = [];
    if (item.arr) bits.push(`${item.arr}<sup>e</sup>`);
    if (item.area) bits.push(esc(item.area));
    if (item.priceNote) bits.push(esc(item.priceNote));
    else bits.push(priceText(item));
    bits.push(esc(cuisineText(item)));
    const pic = thumb && item.image
      ? `<div class="row-thumb">${img(item, '96px', 'loaded')}</div>`
      : (thumb ? `<div class="row-thumb ph"><span class="e">${item.emoji || (item.discovered ? '·' : '·')}</span></div>` : '');
    return `<div class="row ${thumb ? 'has-thumb' : ''} ${tierCls(item)} ${Store.isDone(item.id) ? 'done' : ''}" data-id="${esc(item.id)}">
      ${pic}
      <h3 class="row-name">${esc(item.title)}${isRomantic(item) ? ' <span class="duo" title="Romantic">♥</span>' : ''}</h3>
      <span class="row-dist">${item.minutesFromHome != null ? `${item.minutesFromHome} min` : ''}</span>
      <p class="row-meta">${bits.filter(Boolean).join(' · ')}</p>
      <p class="row-why">${esc(blurb(item))}</p>
      ${detail(item)}
    </div>`;
  }

  const rows = (items, empty, thumb = false) => items.length
    ? `<div class="list">${items.map(i => row(i, thumb)).join('')}</div>`
    : `<p class="empty">${esc(empty || 'Nothing here right now.')}</p>`;

  const hasStops = i => Array.isArray(i.stops) && i.stops.length > 0;

  /* Every stop after the first is measured from the stop before it, which is
     true wherever you live. The first is measured from *you*, so it is
     computed rather than stored — whatever line the data names is kept. */
  function stopWalk(item, s, n) {
    const stored = (s.walk || '').trim();
    if (n > 0) return stored;
    const mins = item.minutesFromHome;
    if (mins == null) return stored;
    return stored ? `${stored} · ~${mins} min to get there` : `~${mins} min to get there`;
  }

  function routeCard(item) {
    const steps = (item.stops || []).map((s, n) => {
      const w = stopWalk(item, s, n);
      return `<li>${esc(s.text)}${w ? `<span class="w">${esc(w)}</span>` : ''}</li>`;
    }).join('');
    const meta = [
      item.arr ? `${item.arr}e` : null,
      item.startTime ? `from ${item.startTime}` : null,
      durText(item.durationMin),
      item.priceNote || (item.price ? `€${item.price}` : 'Free')
    ].filter(Boolean).join(' · ');

    return `<div class="route" data-id="${esc(item.id)}">
      <div class="route-head">
        <h3>${esc(item.title)}</h3>
        <p class="route-meta">${esc(meta)}</p>
        <p class="route-why">${esc(item.why || '')}</p>
      </div>
      ${steps ? `<ol class="steps">${steps}</ol>` : ''}
    </div>`;
  }

  function tripBlock(item) {
    return `<article class="trip" data-id="${esc(item.id)}">
      <div class="trip-img">
        ${item.image ? img(item, '(min-width: 760px) 520px, 94vw', 'loaded') : ''}
        <span class="trip-time">${item.minutesFromHome} min away</span>
      </div>
      <div class="trip-body">
        <h3>${esc(item.title)}</h3>
        <p class="trip-meta">${esc([item.transit, item.priceNote].filter(Boolean).join(' · '))}</p>
        <p class="trip-why">${esc(item.why || '')}</p>
        <div class="links">
          ${item.url ? `<a href="${esc(item.url)}" target="_blank" rel="noopener">Official site</a>` : ''}
          <a href="${mapsLink(item)}" target="_blank" rel="noopener">Directions</a>
        </div>
      </div>
    </article>`;
  }

  const stripHead = (title, note) =>
    `<div class="strip-head"><h2>${esc(title)}</h2>${note ? `<p>${esc(note)}</p>` : ''}</div>`;

  /* ---------- views ---------- */

  const LEDE = {
    today:   'What is open, close, and worth leaving the flat for.',
    nights:  'Concerts, jazz rooms, dancing and a drink first. Doors, prices and how far each one is from where you are.',
    sport:   'Two halves: things we can play, and things we can go and watch.',
    weekend: '',
    eat:     '',
    explore: '',
    away:    'Six mainline stations, and most of them reach somewhere worth a whole day. Some of these are closer than the other side of Paris.',
    quests:  'Long games. Progress is saved in this browser.',
    saved:   'What you have marked, and what you have already done.'
  };

  function render() {
    $$('.tab').forEach(t => t.classList.toggle('on', t.dataset.view === VIEW));
    // Each section gets its own accent; the CSS keys off this.
    document.body.setAttribute('data-view', VIEW);
    const box = $('#view');
    const w = weekend();

    $('#lede').textContent = LEDE[VIEW] || '';

    if      (VIEW === 'today')   box.innerHTML = renderToday();
    else if (VIEW === 'nights')  box.innerHTML = renderNights();
    else if (VIEW === 'sport')   box.innerHTML = renderSport();
    else if (VIEW === 'weekend') { $('#lede').textContent = weekendLede(w); box.innerHTML = renderWeekend(w); }
    else if (VIEW === 'eat')     { $('#lede').textContent = eatLede(); box.innerHTML = renderEat(); }
    else if (VIEW === 'explore') { $('#lede').textContent = exploreLede(); box.innerHTML = renderExplore(); }
    else if (VIEW === 'away')    box.innerHTML = renderAway();
    else if (VIEW === 'quests')  box.innerHTML = renderQuests();
    else if (VIEW === 'saved')   box.innerHTML = renderSaved();

    applyFilters();
    settleImages($('#view'));
  }

  /* ---------- around you ----------
     The strip that first made location matter, and now the shape every
     other section follows: ask nearby.js what exists in reach, rather
     than asking the catalogue what it has and hoping some of it is close. */

  const NEAR_MIN = 15, WIDER_MIN = 30;

  const AROUND = [
    ['bakery',     '🥐', 'Bakery'],
    ['cafe',       '☕', 'Coffee'],
    ['restaurant', '🍽️', 'Somewhere to eat'],
    ['market',     '🧺', 'Market'],
    ['park',       '🌳', 'Green space'],
    ['museum',     '🏛️', 'Culture'],
    ['books',      '📚', 'Books'],
    ['sport',      '🏃', 'Something active'],
    ['nightlife',  '🍸', 'A drink']
  ];

  /* Anything the reader has ruled out, or already done. Passed to every
     retrieval call so an exclusion means the same thing everywhere. */
  const notWanted = i => Store.rating(i.id) === 'never';
  const spent     = i => notWanted(i) || Store.isDone(i.id);

  /* Best answer of a kind within reach. Reach-weighted merit rather than
     pure nearest: "the best bakery you can walk to" is a better answer
     than "the bakery with the smallest number next to it", and the decay
     in Near.reach is steep enough that it never means crossing town. */
  function nearestOfKind(cat, maxMin) {
    const { items } = Near.pick(Near.KIND[cat], {
      rings: [maxMin], want: 1, limit: 1, exclude: spent
    });
    return items[0] || null;
  }

  function aroundYouCard(item, label, emoji) {
    const mins = item.minutesFromHome;
    const line = item.why ? item.why.split('. ')[0] + '.' : blurb(item);
    return `<div class="near-card ${tierCls(item)}" data-id="${esc(item.id)}">
      <p class="near-label"><span class="e">${emoji}</span>${esc(label)}</p>
      <h4 class="near-name">${esc(item.title)}</h4>
      <p class="near-meta">~${mins} min${item.arr ? ` · ${item.arr}<sup>e</sup>` : ''}${tier(item).note ? ` · ${esc(tier(item).note.toLowerCase())}` : ''}</p>
      <p class="near-why">${esc(line)}</p>
      <a class="near-link" href="${item.url ? esc(item.url) : mapsLink(item)}" target="_blank" rel="noopener">
        ${item.url ? 'Look it up' : 'Directions'}</a>
    </div>`;
  }

  function renderAroundYou() {
    const loc = Loc.active();
    const picks = [];
    const used = new Set();

    for (const [cat, emoji, label] of AROUND) {
      let it = nearestOfKind(cat, NEAR_MIN);
      if (it && used.has(it.id)) it = null;
      if (!it) it = nearestOfKind(cat, WIDER_MIN);
      if (!it || used.has(it.id)) continue;
      used.add(it.id);
      picks.push(aroundYouCard(it, label, emoji));
      if (picks.length >= 6) break;
    }

    if (!picks.length) return '';
    return stripHead(`Around ${Loc.displayName(loc)}`,
                     `Within about ${NEAR_MIN} minutes`)
      + `<div class="near-grid">${picks.join('')}</div>`;
  }

  /* The counterweight: things good enough that distance is not the point.
     Through Near.beyond so it inherits the one-per-arrondissement cap —
     three suggestions that turn out to be three stops on the same street
     is not a counterweight, it is a rut. */
  function worthGoingFurther() {
    const far = Near.beyond(i => i.type !== 'daytrip', WIDER_MIN, {
      limit: 3, floor: 5, exclude: i => spent(i) || !Rank.isOpenOn(i, TODAY_ISO)
    });
    if (!far.length) return '';
    return stripHead('Worth going further for', 'Good enough that the journey is not the point')
      + `<div class="grid">${far.map(i => card(i)).join('')}</div>`;
  }

  /* ---------- today ---------- */

  function renderToday() {
    const openNow = i => Rank.isOpenOn(i, TODAY_ISO);
    const ranked = Rank.rank(ALL, CTX, i => openNow(i) && (i.durationMin ?? 120) <= 420);
    if (!ranked.length) return `<p class="empty">Nothing scheduled today — try the weekend.</p>`;

    const used = new Set();
    // The lead needs a photograph that is actually of the place.
    const lead = ranked.find(hasRealPhoto) || ranked[0];
    used.add(lead.id);

    const evening = Rank.rank(ALL, CTX, i =>
      openNow(i) && !used.has(i.id) && (i.minutesFromHome ?? 99) <= 40 &&
      ((i.labels || []).includes('afterwork') ||
       (i.goodFor || []).includes('evening') ||
       (i.goodFor || []).includes('spontaneous'))).slice(0, 3);
    evening.forEach(i => used.add(i.id));

    /* The hero and "worth going further" are allowed to send you across
       Paris. This list is not — it is the rest of today where you are. */
    const also = Near.pick(i => openNow(i) && (i.durationMin ?? 120) <= 420 && !used.has(i.id), {
      rings: Near.RINGS.near, want: 5, limit: 6, exclude: spent
    });

    return hero(lead)
      + renderAroundYou()
      + (also.items.length
          ? stripHead(`Also around ${Loc.displayName(Loc.active())}`, radiusNote(also.radius, also.items))
            + rows(also.items)
          : '')
      + worthGoingFurther()
      + (evening.length
          ? stripHead('This evening', 'Short trips, late openings')
            + `<div class="grid">${evening.map(i => card(i)).join('')}</div>`
          : '');
  }

  /* ---------- nights ---------- */

  const isNight = i => (i.categories || []).includes('nightlife');

  function renderNights() {
    const nightlife = D.nightlife.items || [];

    /* Dated gigs read better in date order than in score order — you are
       choosing a night, not browsing. Score decides the hero; the calendar
       decides the rest. */
    const gigs = (D.events.items || [])
      .filter(i => isNight(i) && (!i.end || i.end >= TODAY_ISO))
      .sort((a, b) => (a.start || '').localeCompare(b.start || ''));

    const lead = Rank.rank(gigs, CTX, hasRealPhoto)[0];
    const rest = gigs.filter(g => !lead || g.id !== lead.id);

    /* A night out is worth a journey in a way a croissant is not, so the
       ring is wide — but it is still a ring, and inside it the nearest
       good room leads. Ordering by reach is the difference between "the
       jazz cellars of Paris" and "the jazz cellars you could be in by
       ten". */
    const group = (title, note, test) => {
      const items = Rank.rank(nightlife, CTX, test)
        .sort((a, b) => Near.localScore(b) - Near.localScore(a));
      if (!items.length) return '';
      return stripHead(title, note) + rows(items);
    };

    /* What is open around you tonight that nobody wrote about. */
    const localNight = Near.pick(i => i.discovered && Near.KIND.nightlife(i), {
      rings: Near.RINGS.walk, want: 6, limit: 10, exclude: notWanted
    });

    const routes = Rank.rank(
      (D.itineraries.items || []).filter(i => isNight(i)), CTX);

    return (lead ? hero(lead) : '')
      + (rest.length
          ? stripHead('On sale now', 'Dated, and they sell out in this order')
            + `<div class="grid">${rest.slice(0, 6).map(i => card(i)).join('')}</div>`
          : '')
      + group('Comedy', 'English, French, and who to follow for Hindi', i => i.type === 'comedy')
      + group('Jazz rooms', 'Two sets a night, most nights', i => i.type === 'jazz')
      + group('Live music', 'Check the listing, then buy blind', i => i.type === 'venue')
      + group('Late', 'Doors at midnight — earlier is a beginner’s error', i => i.type === 'club')
      + group('A drink first', 'Wine, cocktails, and one taqueria with a secret door', i => i.type === 'bar')
      + (localNight.items.length
          ? stripHead(`Open around ${Loc.displayName(Loc.active())}`,
                      radiusNote(localNight.radius, localNight.items))
            + rows(localNight.items, null, false)
          : '')
      + (routes.length
          ? stripHead('Two nights out', 'Follow the order')
            + `<div class="routes">${routes.map(routeCard).join('')}</div>`
          : '');
  }
  /* ---------- pairings ----------
     The "what could we do before and after this?" layer. A recommendation
     on its own is a listing; a recommendation with a coffee after it is a
     plan, which is the whole difference this site is trying to make. */

  function pairings(item) {
    const list = item.pairings || item.then || [];
    if (!list.length) return '';
    return `<div class="pairs">
      <span class="pairs-label">Then</span>
      <div class="pairs-row">${list.map(x =>
        `<span class="pair"><span class="e">${x.emoji || '·'}</span>${esc(x.text)}</span>`).join('')}</div>
    </div>`;
  }

  /* ---------- sport ---------- */

  const isSport = i => (i.categories || []).includes('sport');
  let SPORT_MODE = 'play';
  const SPORT_INTENT = new Set();

  const INTENTS = [
    ['try',     'Try something new'],
    ['casual',  'Exercise casually'],
    ['group',   'Join a group'],
    ['compete', 'Compete'],
    ['learn',   'Learn']
  ];

  /* Sport of the week — deterministic by ISO week, so it changes on Mondays
     and stays put in between. Skips anything already rated. */
  function sportOfTheWeek(pool) {
    const week = Math.floor((TODAY - new Date(TODAY.getFullYear(), 0, 1)) / 604800000);
    const candidates = pool.filter(i =>
      (i.intent || []).includes('try') && !Store.isDone(i.id));
    if (!candidates.length) return null;
    const ranked = Rank.rank(candidates, CTX);
    return ranked[Math.floor(week) % ranked.length] || ranked[0];
  }

  /* A week you would actually keep, built from time budgets rather than
     from a training plan. */
  const WEEK_SLOTS = [
    ['Monday evening',   30,  i => (i.durationMin ?? 60) <= 60 && (i.minutesFromHome ?? 99) <= 15],
    ['Wednesday',        60,  i => (i.intent || []).includes('try') || (i.intent || []).includes('learn')],
    ['Saturday morning', 120, i => (i.goodFor || []).includes('morning') || (i.goodFor || []).includes('weekend')],
    ['Sunday',           240, i => (i.durationMin ?? 60) >= 90]
  ];

  function weekPlan(pool) {
    const used = new Set();
    const rows = WEEK_SLOTS.map(([when, mins, test]) => {
      const it = Rank.rank(pool, CTX, i => !used.has(i.id) && test(i))[0];
      if (!it) return '';
      used.add(it.id);
      const pair = (it.pairings || [])[0];
      return `<div class="slot" data-id="${esc(it.id)}">
        <div class="t">${esc(when)}</div>
        <div class="s"><b><span class="e">${it.emoji || ''}</span>${esc(it.title)}</b>
          ${durText(it.durationMin) || mins + ' min'} · ${esc(priceText(it))}
          ${pair ? ` · then ${pair.emoji} ${esc(pair.text)}` : ''}</div>
      </div>`;
    }).join('');
    return rows ? `<div class="day week-plan">${rows}</div>` : '';
  }

  function renderSport() {
    const sports = D.sports.items || [];
    const play = sports.filter(i => i.type === 'play' || i.type === 'run');

    const modeBar = `<div class="mode" id="sport-mode">
      <button class="mode-btn ${SPORT_MODE === 'play' ? 'on' : ''}" data-mode="play">
        <span class="mode-emoji">🏃</span> Play
        <em>things we can do</em>
      </button>
      <button class="mode-btn ${SPORT_MODE === 'watch' ? 'on' : ''}" data-mode="watch">
        <span class="mode-emoji">🏟️</span> Watch
        <em>things we can go and see</em>
      </button>
    </div>`;

    return modeBar + (SPORT_MODE === 'play' ? renderPlay(play) : renderWatch(sports));
  }

  function renderPlay(play) {
    const featured = sportOfTheWeek(play);

    const chips = `<div class="chips sport-chips" id="sport-intent">
      ${INTENTS.map(([k, label]) =>
        `<button class="chip ${SPORT_INTENT.has(k) ? 'on' : ''}" data-intent="${k}">${label}</button>`).join('')}
    </div>`;

    const matches = i => !SPORT_INTENT.size ||
      [...SPORT_INTENT].some(k => (i.intent || []).includes(k));

    const allRuns = Rank.rank(play, CTX, i => i.type === 'run' && matches(i));
    const runs = allRuns.filter(hasStops);
    const plainRuns = allRuns.filter(i => !hasStops(i));

    /* Both layers, one radius. A pool you can get to beats a climbing gym
       across the city, and the OSM layer is what stops this section being
       empty in a quarter the catalogue never visited. */
    const local = Near.pick(i => Near.KIND.sport(i) && i.type !== 'run' && matches(i), {
      rings: Near.RINGS.out, want: 8, limit: 20,
      exclude: i => notWanted(i) || (featured && i.id === featured.id)
    });
    const activities = local.items;
    const furtherSport = Near.beyond(
      i => i.type === 'play', local.radius,
      { exclude: i => notWanted(i) || (featured && i.id === featured.id) });

    const feature = featured ? `
      <div class="sotw">
        <p class="sotw-kicker">This week — try something you haven’t</p>
        <div class="sotw-body">
          ${featured.image ? `<div class="sotw-img">${img(featured, '(min-width: 760px) 420px, 94vw', 'loaded')}</div>` : ''}
          <div>
            <h3>${featured.emoji || ''} ${esc(featured.title)}</h3>
            <p class="sotw-meta">${esc(featured.area || '')} · ${featured.minutesFromHome} min away · ${esc(priceText(featured))}${featured.difficulty ? ` · ${featured.difficulty}` : ''}</p>
            <p class="sotw-why">${esc(featured.why || '')}</p>
            ${pairings(featured)}
            <div class="links">
              ${featured.url ? `<a href="${esc(featured.url)}" target="_blank" rel="noopener">Book or check</a>` : ''}
              <a href="${mapsLink(featured)}" target="_blank" rel="noopener">Directions</a>
            </div>
          </div>
        </div>
      </div>` : '';

    return feature
      + stripHead('Add sport to the week', 'Four slots you would actually keep')
      + weekPlan(play)
      + stripHead('What do you want out of it?')
      + chips
      + (activities.length
          ? stripHead(`Around ${Loc.displayName(Loc.active())}`, radiusNote(local.radius, activities))
            + `<div class="grid play-grid">${activities.map(i => card(i)).join('')}</div>`
          : `<p class="empty">Nothing matches that. Try another intent.</p>`)
      + (furtherSport.length
          ? stripHead('Worth the trip', `Further than ${local.radius} minutes, and still worth it`)
            + rows(furtherSport, null, true)
          : '')
      + (allRuns.length
          ? stripHead('Run Paris', 'Nearest first, and getting longer')
            + (runs.length ? `<div class="routes">${runs.map(routeCard).join('')}</div>` : '')
            + (plainRuns.length ? rows(plainRuns, null, true) : '')
          : '')
      + stripHead('Everything you could play', 'The whole list, wherever it is')
      + rows(Rank.rank(play, CTX, i => i.type === 'play'), null, true)
      + questBlock('quest-play');
  }

  /* Events are not like places: an exceptional thing an hour away still
     belongs on the page. Three tiers rather than one distance sort. */
  function eventTier(item) {
    const m = item.minutesFromHome ?? 99;
    if (m <= WIDER_MIN) return 'near';
    if ((item.uniqueness || 0) >= 5 && (item.quality || 0) >= 5) return 'worth';
    return 'around';
  }

  function renderWatch(sports) {
    const watch = sports.filter(i => i.type === 'watch');

    const fixtures = (D.events.items || [])
      .filter(i => isSport(i) && (!i.end || i.end >= TODAY_ISO))
      .sort((a, b) => (a.start || '').localeCompare(b.start || ''));

    const big = Rank.rank(fixtures, CTX, hasRealPhoto)[0];
    const rest = fixtures.filter(f => !big || f.id !== big.id);

    /* A fixture is only useful if you know where to stand. */
    const fixtureRow = it => `<div class="fixture" data-id="${esc(it.id)}">
      <div class="fx-date">
        <span class="fx-day">${new Date(it.start + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric' })}</span>
        <span class="fx-mon">${new Date(it.start + 'T12:00:00').toLocaleDateString('en-GB', { month: 'short' })}</span>
      </div>
      <div class="fx-body">
        <h3>${it.emoji || ''} ${esc(it.title)}</h3>
        <p class="fx-meta">${esc(it.area || '')} · ${it.minutesFromHome} min · ${esc(priceText(it))}</p>
        <p class="fx-why">${esc(it.why || '')}</p>
        ${it.spectator ? `<p class="fx-spec"><b>Where to stand.</b> ${esc(it.spectator)}</p>` : ''}
        ${pairings(it)}
        <div class="links">
          ${it.url ? `<a href="${esc(it.url)}" target="_blank" rel="noopener">Tickets & info</a>` : ''}
          <a href="${mapsLink(it)}" target="_blank" rel="noopener">Directions</a>
        </div>
      </div>
    </div>`;

    const tiers = [
      ['near',  `Near ${Loc.displayName(Loc.active())}`, `Within about ${WIDER_MIN} minutes`],
      ['worth', 'Worth crossing Paris for', 'Distance is not the point'],
      ['around','Elsewhere in Paris', 'Further out, still worth knowing']
    ];

    return (big ? hero(big) : '')
      + tiers.map(([k, title, note]) => {
          const inTier = rest.filter(f => eventTier(f) === k);
          return inTier.length
            ? stripHead(title, note) + `<div class="fixtures">${inTier.map(fixtureRow).join('')}</div>`
            : '';
        }).join('')
      + stripHead('Where sport happens', 'Fixtures change weekly — the link goes to the club')
      + rows(Rank.rank(watch, CTX), null, true)
      + questBlock('quest-watch');
  }

  /* Pull one quest out of quests.json and show it where it is relevant,
     rather than making them walk to the Quests tab to find it. */
  function questBlock(id) {
    const q = (D.quests.items || []).find(x => x.id === id);
    if (!q) return '';
    Store.seedQuest(q.id, q.preCompleted);
    return stripHead('Keep score', 'Progress saves in this browser')
      + `<div class="quests one">${questCard(q)}</div>`;
  }
  /* ---------- weekend ---------- */

  function weekendLede(w) {
    let s = `${fmtShort(w.sat)} and ${fmtShort(w.sun)}.`;
    const a = WX && WX.byDate[w.satISO], b = WX && WX.byDate[w.sunISO];
    if (a && b) s += ` Saturday ${a.label.toLowerCase()}, ${a.tmax}°. Sunday ${b.label.toLowerCase()}, ${b.tmax}°.`;
    if (HOLIDAYS[w.satISO]) s += ` Saturday is ${HOLIDAYS[w.satISO]} — most shops shut.`;
    return s;
  }

  function renderWeekend(w) {
    const used = new Set();
    const pick = (label, filter) => {
      const it = bestForWeekend(ALL, w.satISO, w.sunISO, i => !used.has(i.id) && (!filter || filter(i)));
      if (!it) return null;
      used.add(it.id);
      return { label, it };
    };

    const best = pick('Best overall');
    const rest = [
      pick('Best free',     i => !i.price),
      pick('Best food',     isEdible),
      pick('Most unusual',  i => (i.uniqueness || 0) >= 5),
      pick('Best day trip', i => i.type === 'daytrip')
    ].filter(Boolean);

    // Two days, each ranked against its own forecast, never repeating.
    const planned = new Set();
    const isEvening = i => (i.labels || []).includes('afterwork') || (i.goodFor || []).includes('evening');
    const isMorning = i => (i.goodFor || []).includes('morning') || (i.categories || []).includes('market');
    const isDay     = i => !isEvening(i) && (i.durationMin ?? 120) >= 90;

    const day = (d, dISO) => {
      const c = ctxFor(dISO);
      const wx = WX && WX.byDate[dISO];
      const slots = [['Morning', isMorning], ['Afternoon', isDay], ['Evening', isEvening]].map(([when, test]) => {
        const it = Rank.rank(ALL, c, i => Rank.isOpenOn(i, dISO) && !planned.has(i.id) && test(i))[0];
        if (!it) return '';
        planned.add(it.id);
        return `<div class="slot"><div class="t">${when}</div>
          <div class="s"><b>${esc(it.title)}</b>${esc((it.why || '').split('. ')[0])}.</div></div>`;
      }).join('');

      const holiday = HOLIDAYS[dISO];
      return `<div class="day">
        <h3>${d.toLocaleDateString('en-GB', { weekday: 'long' })}</h3>
        <p class="when">${fmtShort(d)}${wx ? ` · ${wx.tmax}°, ${esc(wx.label.toLowerCase())}${wx.rain >= 40 ? `, ${wx.rain}% rain` : ''}` : ''}${holiday ? ` · ${esc(holiday)}, shops shut` : ''}</p>
        ${slots || '<p class="empty">Keep it open.</p>'}
      </div>`;
    };

    return (best && hasRealPhoto(best.it) ? hero(best.it) : '')
      + stripHead('How the two days could go')
      + `<div class="plan">${day(w.sat, w.satISO)}${day(w.sun, w.sunISO)}</div>`
      + stripHead('And if you want one thing')
      + `<div class="list">${rest.map(p => {
          const r = row(p.it);
          return r.replace('<p class="row-meta">', `<p class="row-meta"><b class="pick-label">${esc(p.label)}</b> · `);
        }).join('')}</div>`;
  }

  /* ---------- eat ----------
     Same idea as Sport: the subsections are the navigation, not a footer.
     Missions is the default because a mission is more useful than a list,
     but coffee / bakeries / restaurants / markets are one tap away rather
     than one long scroll away. */

  let MOOD = null;
  let EAT_MODE = 'missions';

  const MOODS = [
    ['french',        '🥐', 'Something French'],
    ['coffee',        '☕', 'Coffee + pastry'],
    ['cheap',         '💸', 'Cheap & good'],
    ['international', '🍜', 'International'],
    ['dinner',        '🍷', 'A nice dinner'],
    ['special',       '✨', 'Special'],
    ['walk',          '🚶', 'Food + a walk']
  ];

  /* Each subsection: what it is, what it holds, and the quest that goes with it. */
  const EAT_MODES = [
    ['missions',   '🎯', 'Missions',    'assignments, not listings', null,         null],
    ['cafe',       '☕', 'Coffee',      'specialty and roasters',    'cafe',       'quest-coffee'],
    ['bakery',     '🥐', 'Bakeries',    'bread and pastry',          'bakery',     'quest-croissant'],
    ['restaurant', '🍽️', 'Restaurants', 'where to actually eat',     'restaurant', null],
    ['market',     '🧺', 'Markets',     'food, flea and flower',     'market',     'quest-markets']
  ];

  /* A mission happens in a particular neighbourhood — the bakeries are where
     they are. Say so when that is not where you are, otherwise "8 min on"
     reads as eight minutes from your door. */
  function missionWhere(m) {
    const mins = m.minutesFromHome;
    const here = Loc.active()?.arr ?? null;
    if (m.generated) return 'right where you are';
    if (m.arr && m.arr === here) return `in the ${ordinal(m.arr)}, where you are`;
    if (mins == null) return '';
    const place = m.arr ? `in the ${ordinal(m.arr)}` : 'across town';
    return mins <= 12 ? `${place} · ~${mins} min to the first stop`
                      : `${place} · ~${mins} min to get there`;
  }

  const ordinal = n => `${n}${n === 1 ? 'er' : 'e'}`;

  function missionCard(m, lead = false) {
    const cands = (m.candidates || []).map((c, n) => `
      <li>
        <span class="cand-n">${n + 1}</span>
        <span class="cand-body">
          <b><span class="e">${c.emoji || ''}</span>${esc(c.name)}</b>
          ${c.order ? `<span class="cand-order">Order: ${esc(c.order)}</span>` : ''}
          ${c.step  ? `<span class="cand-order">${esc(c.step)}</span>` : ''}
          ${c.note ? `<span class="cand-note">${esc(c.note)}</span>` : ''}
        </span>
        ${c.walk ? `<span class="cand-walk">${esc(c.walk)}</span>` : ''}
      </li>`).join('');

    const sched = (m.schedule || []).map(s => `
      <li><span class="sch-time">${esc(s.time)}</span>
        <span class="cand-body"><b><span class="e">${s.emoji || ''}</span>${esc(s.text)}</b></span></li>`).join('');

    return `<article class="mission ${lead ? 'lead' : ''}" data-id="${esc(m.id)}">
      ${m.image ? `<div class="mission-img">${img(m, lead ? '(min-width: 1040px) 1000px, 96vw' : '(min-width: 760px) 480px, 94vw', 'loaded')}</div>` : ''}
      <div class="mission-body">
        <p class="mission-kicker">${m.generated ? 'Put together from what is nearby' : (lead ? 'Today’s food mission' : 'Food mission')} · ${durText(m.durationMin)} · ${esc(m.priceNote || priceText(m))}</p>
        ${missionWhere(m) ? `<p class="mission-where">📍 ${esc(missionWhere(m))}</p>` : ''}
        <h3 class="mission-title">${m.emoji || ''} ${esc(m.title)}</h3>
        <p class="mission-brief">${esc(m.brief || m.why || '')}</p>
        ${m.test ? `<p class="mission-test"><b>How to judge it.</b> ${esc(m.test)}</p>` : ''}
        ${cands ? `<ol class="cands">${cands}</ol>` : ''}
        ${sched ? `<ol class="cands sched">${sched}</ol>` : ''}
        ${pairings(m)}
        <div class="mission-foot">
          <div class="rate" role="group" aria-label="Rate ${esc(m.title)}">
            ${RATINGS.map(([v, e, t]) =>
              `<button type="button" data-rate="${v}" title="${t}" aria-label="${t}"
                class="${Store.rating(m.id) === v ? 'on' : ''}">${e}</button>`).join('')}
          </div>
          <span class="mission-why">${esc((m.why || '').split('. ')[0])}.</span>
        </div>
      </div>
    </article>`;
  }

  /* One editorial pick, then the rest as rows — the Sport of the Week shape,
     applied to a category. */
  function featured(item, kicker) {
    if (!item) return '';
    return `<div class="sotw">
      <p class="sotw-kicker">${esc(kicker)}</p>
      <div class="sotw-body">
        ${item.image ? `<div class="sotw-img">${img(item, '(min-width: 760px) 420px, 94vw', 'loaded')}</div>` : ''}
        <div>
          <h3>${item.emoji || ''} ${esc(item.title)}</h3>
          <p class="sotw-meta">${[item.area, item.minutesFromHome != null ? `${item.minutesFromHome} min away` : '',
                                  item.priceNote || priceText(item), tier(item).note || '']
                                  .filter(Boolean).map(esc).join(' · ')}</p>
          <p class="sotw-why">${esc(blurb(item))}</p>
          ${pairings(item)}
          <div class="links">
            ${item.url ? `<a href="${esc(item.url)}" target="_blank" rel="noopener">Look it up</a>` : ''}
            <a href="${mapsLink(item)}" target="_blank" rel="noopener">Directions</a>
          </div>
        </div>
      </div>
    </div>`;
  }

  function eatLede() {
    const here = Loc.displayName(Loc.active());
    return EAT_MODE === 'missions'
      ? `Missions rather than listings. Pick one, do it properly, rate it.`
      : `Coffee, bread, dinner and markets around ${here} — nearest and best first.`;
  }

  function renderEat() {
    const modeBar = `<div class="mode mode-wide" id="eat-mode">
      ${EAT_MODES.map(([k, e, label, sub]) =>
        `<button class="mode-btn ${EAT_MODE === k ? 'on' : ''}" data-eatmode="${k}">
          <span class="mode-emoji">${e}</span> ${label}
          <em>${esc(sub)}</em>
        </button>`).join('')}
    </div>`;

    return modeBar + (EAT_MODE === 'missions' ? renderMissions() : renderEatCategory());
  }

  /* A mission is a route between named shops, so unlike a café it cannot
     be moved — "Find Your Croissant" is four specific bakeries in the
     10th and would be a lie anywhere else. What can move is the order
     they are offered in, and whether the page has anything to say about
     where you are actually standing. Hence the split, and hence the
     generated one below it. */
  function renderMissions() {
    const missions = D.food.items || [];

    const moodBar = `<div class="moods" id="mood-row">
      <span class="moods-label">What are you in the mood for?</span>
      <div class="chips">
        ${MOODS.map(([k, e, label]) =>
          `<button class="chip mood ${MOOD === k ? 'on' : ''}" data-mood2="${k}"><span class="e">${e}</span>${label}</button>`).join('')}
      </div>
    </div>`;

    const matching = MOOD ? missions.filter(m => (m.moods || []).includes(MOOD)) : missions;
    const pool = matching.length ? matching : missions;

    /* One ordering for both kinds. A written mission carries the same
       authority as any curated record and wins easily when it is nearby;
       the generated one wins when the nearest written one is a journey,
       which is exactly when a reader in the 5th needs something to do
       that is not in the 10th. No threshold, no special case. */
    const mine = localMission();
    const ranked = [...pool, ...(mine ? [mine] : [])]
      .sort((a, b) => Near.localScore(b) - Near.localScore(a));

    const lead = ranked[0];
    const rest = ranked.slice(1);
    const away = rest.filter(m => !m.generated && (m.minutesFromHome ?? 99) > 20).length;

    return moodBar
      + (lead ? missionCard(lead, true) : '')
      + (rest.length
          ? stripHead(away === rest.length ? 'Missions elsewhere in Paris' : 'More missions',
                      'Written for a particular set of streets — the walk is the point')
            + `<div class="missions">${rest.map(m => missionCard(m)).join('')}</div>`
          : '');
  }

  /* A mission the site has no opinion about, built out of the discovery
     layer around wherever you are: a bakery, a coffee, something to carry
     home. It exists so that Eat has an answer in a quarter nobody wrote
     about, and it says plainly that nobody wrote about it. */
  function localMission() {
    const legs = [
      ['bakery', '🥐', 'Breakfast'],
      ['cafe',   '☕', 'Sit down with it'],
      ['market', '🧺', 'Something to carry home'],
      ['deli',   '🧀', 'Something to carry home']
    ];

    const used = new Set();
    const candidates = [];
    for (const [kind, emoji, step] of legs) {
      if (candidates.length >= 3) break;
      if (candidates.some(c => c.step === step)) continue;
      const { items } = Near.pick(Near.KIND[kind], {
        rings: [12, 20], want: 1, limit: 3, exclude: i => used.has(i.id) || notWanted(i)
      });
      const it = items[0];
      if (!it) continue;
      used.add(it.id);
      candidates.push({
        emoji, step,
        name: it.title,
        note: [it.area, cuisineText(it)].filter(Boolean).join(' · ') || null,
        walk: it.minutesFromHome != null ? `~${it.minutesFromHome} min` : ''
      });
    }
    if (candidates.length < 2) return null;

    const where = Loc.displayName(Loc.active());
    return {
      id: 'mission-local',
      title: `A morning around ${where}`,
      emoji: '🗺️',
      durationMin: 90,
      priceNote: 'Whatever you spend',
      arr: Loc.active()?.arr ?? null,
      minutesFromHome: 0,
      /* Scored as a found thing rather than a written one — it is on your
         doorstep, which is its whole claim, and nobody vouched for it. */
      discovered: true, generated: true,
      quality: 3, uniqueness: 3,
      brief: `Nobody wrote this one. It is the nearest bakery, the nearest coffee and the nearest place to buy something to take home, in the order you would actually do them — a starting point for a quarter the guide has not been to yet.`,
      test: 'If one of the three turns out to be good, rate it. That is how this list stops being generic.',
      why: 'Assembled from what is within walking distance of you right now.',
      candidates
    };
  }

  function renderEatCategory() {
    const [, emoji, label, , type, questId] = EAT_MODES.find(m => m[0] === EAT_MODE);
    const here = Loc.displayName(Loc.active());

    /* Retrieval, not re-sorting. Both layers, one radius, chosen by what
       is actually there — so this list is a list of places near you that
       happen to include the ones somebody wrote about, rather than the
       written-about list with your distances printed on it. */
    const { items, radius } = Near.pick(Near.KIND[type], {
      rings: Near.RINGS.walk, want: 8, limit: 24, exclude: notWanted
    });

    /* Nothing is lost by drawing a radius — the classics move here. */
    const further = Near.beyond(Near.KIND[type], radius, { exclude: notWanted });

    if (!items.length && !further.length) return `<p class="empty">Nothing here yet.</p>`;

    /* "Start here — the one to try first" is a recommendation, so it needs
       a record that makes some kind of claim — visited, researched or
       distinguished. Where nothing does, the honest page is the list
       itself: these are the places near you, and the guide has no opinion
       about them yet. */
    const vouched = items.filter(i => Near.tierOf(i) !== 'found');
    const lead = vouched.filter(hasRealPhoto)[0] || vouched[0] || null;
    const rest = items.filter(i => i.id !== (lead && lead.id));

    const KICKERS = {
      cafe:       'Start here — the one to try first',
      bakery:     'Start here — the one to try first',
      restaurant: 'Start here — the one to book first',
      market:     'Start here — the one to go to first'
    };

    return (lead ? featured(lead, KICKERS[EAT_MODE] || 'Start here') : '')
      + (rest.length
          ? stripHead(`${label} around ${here}`, radiusNote(radius, items))
            + rows(rest, null, true)
          : '')
      + (further.length
          ? stripHead('Worth the trip', `Further than ${radius} minutes, and still worth it`)
            + rows(further, null, true)
          : '')
      + (questId ? questBlock(questId) : '');
  }

  /* Say which radius the answer came from, and how much of it is vouched
     for. A heading that claims "near you" while listing the other side of
     Paris is the bug this whole layer exists to prevent, so the number is
     printed rather than implied. */
  function radiusNote(radius, items) {
    const where = radius == null ? 'anywhere in reach' : `within about ${radius} minutes`;
    const n = t => items.filter(i => Near.tierOf(i) === t).length;
    const been = n('personal'), read = n('editorial') + n('sourced');

    if (!been && !read)
      return `${items.length} ${where} — nobody has written this quarter up yet, so these are names on the map, nearest first`;

    const bits = [];
    if (been) bits.push(`${been} written up`);
    if (read) bits.push(`${read} researched`);
    const rest = items.length - been - read;
    if (rest) bits.push(`${rest} found on the map`);
    return `${items.length} ${where} · ${bits.join(', ')}`;
  }
  /* ---------- quests ----------
     A checklist is not an achievement. These get a progress ring, a
     completion state, and — for the arrondissements — a map, because
     Paris spirals outward from the 1st like a snail shell and watching
     that shell fill in is a far better reward than a counter. */

  /* Approximate centroids of the twenty arrondissements, normalised to a
     100×100 box. Not survey-accurate, but the spiral is the point. */
  const ARR_MAP = {
    1:[47,50],  2:[46,42],  3:[54,44],  4:[54,54],  5:[50,63],
    6:[42,59],  7:[32,55],  8:[36,40],  9:[45,34],  10:[57,34],
    11:[65,48], 12:[72,61], 13:[56,72], 14:[42,72], 15:[28,64],
    16:[17,50], 17:[27,30], 18:[46,22], 19:[67,25], 20:[73,40]
  };
  /* The middle of Paris is genuinely cramped, so push everything out from the
     centre a little — otherwise the 1st through 4th sit on top of each other. */
  const SPREAD = 1.3, CX = 50, CY = 52;
  const spread = ([x, y]) => [CX + (x - CX) * SPREAD, CY + (y - CY) * SPREAD];

  function progressRing(pct) {
    const r = 15, c = 2 * Math.PI * r;
    return `<svg class="ring" viewBox="0 0 36 36" aria-hidden="true">
      <circle class="ring-bg" cx="18" cy="18" r="${r}"></circle>
      <circle class="ring-fg" cx="18" cy="18" r="${r}"
        stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct / 100)}"></circle>
    </svg>`;
  }

  /* The arrondissement quest gets a map instead of a list of chips. */
  const arrLabel = (q, num) =>
    (q.targets || []).find(t => new RegExp('^' + num + '(st|nd|rd|th)\\b').test(t)) || String(num);

  /* One source of truth: an arrondissement is done if it is in Store.arrs().
     Home counts. */
  const arrDone = num => num === Loc.active()?.arr || Store.hasArr(num);
  const arrCount = () => new Set([Loc.active()?.arr, ...Store.arrs()].filter(n => n != null)).size;

  function arrMap(q) {
    const dots = Object.entries(ARR_MAP).map(([n, xy]) => {
      const num = Number(n);
      const [x, y] = spread(xy);
      const isHome = num === Loc.active()?.arr;
      return `<g class="arr-dot ${arrDone(num) ? 'on' : ''} ${isHome ? 'home' : ''}"
                 data-target="${esc(arrLabel(q, num))}" data-arrnum="${num}"
                 transform="translate(${x.toFixed(1)} ${y.toFixed(1)})">
        <circle r="5"></circle>
        <text y="1.7">${num}</text>
        <title>${esc(arrLabel(q, num))}</title>
      </g>`;
    }).join('');

    return `<div class="arr-map-wrap">
      <svg class="arr-map" viewBox="2 6 84 78" role="group" aria-label="Arrondissements explored">
        <path class="seine" d="M4,58 C26,50 36,63 50,58 C64,53 76,63 92,52" />
        ${dots}
      </svg>
      <p class="arr-map-note">Tap one as you do it. You are in the ${Loc.active()?.arr ?? '—'}<sup>e</sup>, so that one is free.</p>
    </div>`;
  }

  function questCard(q) {
    const isMap = q.id === 'quest-arrondissements';
    const done = Store.questDone(q.id);
    const total = q.targets.length;
    const count = isMap ? arrCount() : done.length;
    const pct = Math.round(count / total * 100);
    const complete = count >= total;

    return `<div class="quest ${complete ? 'complete' : ''} ${isMap ? 'is-map' : ''}" data-quest="${esc(q.id)}">
      <div class="qtop">
        <div class="qhead">
          <h3><span class="e">${q.emoji || ''}</span>${esc(q.title)}</h3>
          <p class="qdesc">${esc(q.description)}</p>
        </div>
        <div class="qprog" title="${count} of ${total}">
          ${progressRing(pct)}
          <span class="qn">${count}<span class="qn-total">/${total}</span></span>
        </div>
      </div>
      ${complete ? `<p class="qdone">✦ Finished. Pick another one.</p>` : ''}
      ${isMap
        ? arrMap(q)
        : `<div class="targets">${q.targets.map(t =>
            `<button type="button" class="target ${done.includes(t) ? 'on' : ''}" data-target="${esc(t)}">${esc(t)}</button>`).join('')}</div>`}
    </div>`;
  }

  /* ---------- explore ---------- */

  function exploreLede() {
    const n = Store.arrs().length;
    const here = Loc.displayName(Loc.active());
    return n
      ? `${n} of 20 marked explored. Here is where you are, and the nearest one you have not done.`
      : `Where you are, where to go next, and the walks within reach of ${here}.`;
  }

  function renderExplore() {
    const hoods = D.neighborhoods.items || [];
    const explored = Store.arrs();
    const pool = hoods.filter(h => !h.isHome && !explored.includes(h.arr));
    const f = (pool.length ? pool : hoods.filter(h => !h.isHome))
      .slice().sort((a, b) => a.minutesFromHome - b.minutesFromHome)[0];

    let dossier = '', standing = '';
    if (f) {
      const local = ALL.find(i => i.arr === f.arr && hasRealPhoto(i)) || ALL.find(i => i.arr === f.arr && i.image);
      const facts = [
        ['Known for', f.famousFor], ['Streets', (f.streets || []).join(' · ')],
        ['Coffee', f.cafe], ['Bakery', f.bakery], ['Culture', f.culture],
        ['Green space', f.park], ['Unusual', f.unusual], ['Food', f.food],
        ['The walk', f.walk], ['Hidden gem', f.hidden]
      ].filter(([, v]) => v);

      /* The prose above is written once and stays true; this is retrieved
         from the map every load, so the dossier for an arrondissement
         nobody has written much about still names real places in it. */
      const found = [
        ['🥐', 'Bakeries', Near.inArr(f.arr, Near.KIND.bakery, 3)],
        ['☕', 'Coffee',    Near.inArr(f.arr, Near.KIND.cafe, 3)],
        ['🧺', 'Markets',   Near.inArr(f.arr, Near.KIND.market, 2)],
        ['🌳', 'Green',     Near.inArr(f.arr, Near.KIND.park, 2)]
      ].filter(([, , list]) => list.length);

      dossier = `<div class="hood">
        ${local ? `<div class="hood-shot">${img(local, '(min-width: 1040px) 1000px, 96vw', 'loaded')}</div>` : ''}
        <h3>${f.arr}<sup>e</sup> — ${esc(f.name)}</h3>
        <p class="sub">About ${f.minutesFromHome} minutes from you${local ? ` · photo: ${esc(local.imageSubject)}` : ''}</p>
        <div class="facts-grid">
          ${facts.map(([k, v]) => `<dl class="f"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></dl>`).join('')}
          ${found.map(([e, k, list]) => `<dl class="f"><dt>${e} ${esc(k)} on the map</dt>
            <dd>${list.map(i => esc(i.title)).join(' · ')}</dd></dl>`).join('')}
        </div>
      </div>`;
    }

    /* Where you are right now, as opposed to where to go next. Without
       this the Explore tab is entirely about somewhere else. */
    const hereArr = Loc.active()?.arr ?? null;
    const mine = hoods.find(h => h.arr === hereArr);
    if (mine) {
      const bits = [
        ['🥐', Near.inArr(hereArr, Near.KIND.bakery, 2)],
        ['☕', Near.inArr(hereArr, Near.KIND.cafe, 2)],
        ['🧺', Near.inArr(hereArr, Near.KIND.market, 1)],
        ['📚', Near.inArr(hereArr, Near.KIND.books, 1)]
      ].filter(([, l]) => l.length)
       .map(([e, l]) => `<span class="pair"><span class="e">${e}</span>${esc(l.map(i => i.title).join(' · '))}</span>`);
      standing = stripHead(`You are in the ${hereArr}${hereArr === 1 ? 'er' : 'e'} — ${esc(mine.name)}`,
                           esc(mine.famousFor || ''))
        + (bits.length ? `<div class="pairs"><div class="pairs-row">${bits.join('')}</div></div>` : '');
    }

    /* Routes and gems come from a radius like everything else, so the
       walks offered in the 15th are not the walks written for the 10th. */
    const walk = Near.pick(i => i.type === 'itinerary', {
      rings: Near.RINGS.out, want: 3, limit: 4, exclude: notWanted
    });
    const gems = Near.pick(i => (i.labels || []).includes('hiddengem') && i.type !== 'itinerary', {
      rings: Near.RINGS.out, want: 5, limit: 8, exclude: notWanted
    });

    return standing
      + dossier
      + (walk.items.length
          ? stripHead('Walks and routes', radiusNote(walk.radius, walk.items))
            + `<div class="routes">${walk.items.map(routeCard).join('')}</div>`
          : '')
      + (gems.items.length
          ? stripHead('Hidden Paris', radiusNote(gems.radius, gems.items))
            + rows(gems.items)
          : '')
      + stripHead('All twenty')
      + `<div class="arr-grid">${hoods.map(h => `<div class="arr">
          <span class="n">${h.arr}<sup>e</sup></span>
          <span class="nm">${esc(h.name)}</span>
          <button type="button" data-arr="${h.arr}" class="${Store.hasArr(h.arr) || h.isHome ? 'on' : ''}">
            ${h.isHome ? 'Home' : (Store.hasArr(h.arr) ? 'Explored' : 'Mark')}
          </button>
        </div>`).join('')}</div>`;
  }

  /* ---------- away ---------- */

  function renderAway() {
    const trips = Rank.rank(D.daytrips.items || [], CTX);
    const featured = trips.slice(0, 6);
    const rest = trips.slice(6);

    return `<div class="trips">${featured.map(tripBlock).join('')}</div>`
      + (rest.length ? stripHead('Also reachable') + rows(rest) : '');
  }

  /* ---------- quests ---------- */

  function renderQuests() {
    const quests = D.quests.items || [];
    quests.forEach(q => Store.seedQuest(q.id, q.preCompleted));
    return `<div class="quests">${quests.map(questCard).join('')}</div>`;
  }

  /* ---------- saved ---------- */

  function renderSaved() {
    const groups = [['Want to visit', 'want'], ['Loved', 'loved'], ['Good', 'good'], ['Not for us', 'meh']];
    /* Discovered places can be rated wherever they are shown, so they have
       to come back here too — otherwise marking one is a black hole. */
    const rateable = [...ALL, ...DISCOVERED];
    const html = groups.map(([label, key]) => {
      const items = rateable.filter(i => Store.rating(i.id) === key);
      if (!items.length) return '';
      return `<div class="list-group"><h3>${label}</h3>${rows(items)}</div>`;
    }).join('');
    return html || `<p class="empty">Nothing marked yet. Open anything and use the buttons — the ranking learns from them.</p>`;
  }
  /* ---------- filters ---------- */

  const F = { time: null, moods: new Set(), flags: new Set() };

  function filterActive() { return F.time || F.moods.size || F.flags.size; }

  function matches(i) {
    if (F.time && (i.durationMin ?? 90) > F.time) return false;

    if (F.moods.size) {
      const hay = [].concat(i.categories || [], i.goodFor || [], i.labels || []).join(' ');
      let ok = false;
      F.moods.forEach(m => {
        if (m === 'relax'    && /relax|park|outdoors|walk/.test(hay)) ok = true;
        else if (m === 'explore'  && /walk|explore|hidden|unusual/.test(hay)) ok = true;
        else if (m === 'food'     && /food|coffee|bakery|market|foodmission/.test(hay)) ok = true;
        else if (m === 'culture'  && /culture|art|history|architecture|photography|film|music|theatre/.test(hay)) ok = true;
        else if (m === 'outdoors' && /outdoor|park|walk/.test(hay)) ok = true;
        else if (m === 'shop'     && /shop|design|market|vintage|home/.test(hay)) ok = true;
        else if (m === 'learn'    && /learn/.test(hay)) ok = true;
        else if (m === 'romantic' && /romantic/.test(hay)) ok = true;
      });
      if (!ok) return false;
    }

    if (F.flags.has('free')    && i.price) return false;
    if (F.flags.has('cheap')   && (i.price ?? 0) > 20) return false;
    if (F.flags.has('near')    && (i.minutesFromHome ?? 99) > 30) return false;
    if (F.flags.has('fortwo')  && !isForTwo(i)) return false;
    if (F.flags.has('hidden')  && !(i.labels || []).includes('hiddengem')) return false;
    if (F.flags.has('indoor')  && i.indoor !== true) return false;
    if (F.flags.has('outdoor') && i.indoor !== false) return false;
    if (F.flags.has('new')     && Store.isDone(i.id)) return false;
    return true;
  }

  /* Filtering narrows whatever view you are in rather than replacing it,
     so it has to work across every layout, not just the card grid. */
  const FILTERABLE = '#view .card, #view .row, #view .trip, #view .route, #view .hero';

  function applyFilters() {
    const nodes = $$(FILTERABLE);

    if (!filterActive()) {
      $('#count').textContent = '';
      nodes.forEach(n => { n.style.display = ''; });
      $$('#view .list-group, #view .strip-head').forEach(g => { g.style.display = ''; });
      return;
    }

    const byId = new Map([...ALL, ...DISCOVERED].map(i => [i.id, i]));
    let shown = 0;
    nodes.forEach(n => {
      const item = byId.get(n.dataset.id);
      const ok = item ? matches(item) : true;
      n.style.display = ok ? '' : 'none';
      if (ok) shown++;
    });

    // Hide a group heading once everything under it has been filtered away.
    $$('#view .list-group').forEach(g => {
      const any = Array.from(g.querySelectorAll('.row')).some(r => r.style.display !== 'none');
      g.style.display = any ? '' : 'none';
    });

    $('#count').textContent = `${shown} shown`;
  }

  /* ---------- header ---------- */

  function renderHeader() {
    $('#dateline').textContent = fmtLong(TODAY);
    $('#epigraph').textContent = epigraph();
    const hf = $('#home-foot');
    if (hf) hf.textContent = Loc.displayName(Loc.active());

    const bits = [];
    if (WX) {
      bits.push(`${WX.now.icon} ${WX.now.temp}°, ${WX.now.label.toLowerCase()}`);
      bits.push(WX.advice);
    }
    $('#conditions').textContent = bits.join(' · ');

    const notes = [];
    for (let i = 0; i < 8; i++) {
      const d = addDays(TODAY, i);
      const name = HOLIDAYS[iso(d)];
      if (name) {
        const when = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : fmtShort(d);
        notes.push(`<p class="note"><b>${when} is ${esc(name)}.</b> Shops, bakeries and markets will be shut. Museums, parks and ticketed events carry on.</p>`);
      }
    }
    $('#notice').innerHTML = notes.join('');
    $('#stamp').textContent = D.events.generated ? `Event data generated ${D.events.generated}.` : '';
  }

  /* Finishing a quest is the only real achievement here — say so. */
  function celebrate(qid, before, after) {
    const q = (D.quests.items || []).find(x => x.id === qid);
    if (!q) return;
    if (after === q.targets.length && before < after) {
      toast(`✦ ${q.title} complete — all ${q.targets.length} done`);
    } else if (after > before) {
      const left = q.targets.length - after;
      toast(left ? `${after} of ${q.targets.length} · ${left} to go` : 'Done');
    }
  }

  /* ---------- location ---------- */

  function renderLocation() {
    const a = Loc.active();
    $('#loc-name').textContent = Loc.displayName(a);
    $('#loc-kicker').textContent = Loc.isExploring() ? 'Exploring from' : 'Home';
    $('#loc-reset').hidden = !Loc.isExploring();

    const arrs = $('#loc-arrs');
    if (arrs && !arrs.children.length) {
      arrs.innerHTML = Loc.presets().map(p =>
        `<button class="chip" data-arr-pick="${p.arr}" title="${esc(p.name)}">${p.arr}${p.arr === 1 ? 'er' : 'e'}</button>`).join('');
    }
    const rec = Loc.recents();
    $('#loc-recent-wrap').hidden = !rec.length;
    $('#loc-recent').innerHTML = rec.map((r, i) =>
      `<button class="chip" data-recent="${i}">${esc(Loc.displayName(r))}</button>`).join('');
  }

  /* Everything that depends on where you are, re-derived in one place.

     Painted twice, deliberately. Everything except the forecast is known
     the moment the location changes, and waiting on a network call to
     show it meant the header could sit there naming the old
     arrondissement while the page underneath had already moved — worse
     than slow, because it reads as a bug. So: paint, then fetch, then
     repaint only if the weather actually arrived and changed anything. */
  async function moveTo(loc, { asHome = false } = {}) {
    if (asHome) Loc.setHome(loc); else Loc.explore(loc);
    applyLocation();
    buildContext();
    renderLocation();
    renderHeader();
    render();
    renderDebug();          // a panel that reports the old location is worse than none
    toast(`Now exploring from ${Loc.displayName(Loc.active())}`);

    Weather.setHome(Loc.active().lat, Loc.active().lon);
    const before = WX;
    try { WX = await Weather.load(); } catch (e) { return; }
    if (WX === before) return;
    buildContext();         // the forecast feeds the ranking
    renderHeader();
    render();
  }

  /* ---------- toast ---------- */

  let tt;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(tt);
    tt = setTimeout(() => t.classList.remove('show'), 2400);
  }

  /* ---------- surprise ---------- */

  function surprise() {
    const pool = Rank.rank(ALL, CTX, i =>
      !Store.isDone(i.id) && !Store.seenRecently(i.id) && Rank.isLive(i, TODAY_ISO));
    if (!pool.length) { toast('You have seen everything recently. Try tomorrow.'); return; }

    const top = pool.slice(0, 12);
    const chosen = top[Math.floor(Math.pow(Math.random(), 1.7) * top.length)];
    Store.markSeen(chosen.id);

    $('#lede').textContent = 'One thing, picked for today.';
    $('#view').innerHTML = `<div class="grid">${card(chosen, 'surprise open')}</div>`;
    settleImages($('#view'));
    $$('.tab').forEach(t => t.classList.remove('on'));
    $('#count').textContent = '';
    window.scrollTo({ top: $('#main').offsetTop - 60, behavior: 'smooth' });
  }

  /* ---------- wiring ---------- */

  /* ---------- theme ---------- */

  const THEME_KEY = 'paris-for-you.theme';

  function applyTheme(mode) {
    const dark = mode === 'dark';
    if (dark) document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');

    const b = $('#theme');
    b.textContent = dark ? '☀' : '☾';
    b.title = dark ? 'Switch to light' : 'Switch to dark';
    b.setAttribute('aria-label', b.title);

    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#17120f' : '#fdfaf5');
  }

  function initTheme() {
    let saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch (e) {}
    applyTheme(saved === 'dark' ? 'dark' : 'light');   // light unless asked otherwise
  }

  function wire() {
    const panel = $('#locpanel'), err = $('#loc-err');
    const fail = m => { err.textContent = m; err.hidden = false; };

    $('#loc-open').addEventListener('click', e => {
      const open = panel.hidden;
      panel.hidden = !open;
      e.currentTarget.setAttribute('aria-expanded', String(open));
      if (open) $('#loc-input').focus();
    });

    $('#loc-reset').addEventListener('click', async () => {
      Loc.resetToHome();
      await moveTo(Loc.home(), { asHome: true });
    });

    const doSearch = async () => {
      const q = $('#loc-input').value.trim();
      if (!q) return;
      err.hidden = true;
      $('#loc-go').textContent = '…';
      try {
        const loc = await Loc.search(q);
        panel.hidden = true;
        $('#loc-open').setAttribute('aria-expanded', 'false');
        await moveTo(loc);
      } catch (e) { fail(e.message); }
      $('#loc-go').textContent = 'Go';
    };
    $('#loc-go').addEventListener('click', doSearch);
    $('#loc-input').addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });

    $('#loc-here').addEventListener('click', async () => {
      err.hidden = true;
      try {
        const loc = await Loc.locate();
        panel.hidden = true;
        await moveTo(loc);
      } catch (e) { fail(e.message); }
    });

    $('#loc-sethome').addEventListener('click', async () => {
      await moveTo(Loc.active(), { asHome: true });
      toast('Saved as home.');
    });

    document.addEventListener('click', async e => {
      const a = e.target.closest('[data-arr-pick]');
      if (a) { panel.hidden = true; await moveTo(Loc.fromArr(Number(a.dataset.arrPick))); return; }
      const r = e.target.closest('[data-recent]');
      if (r) { panel.hidden = true; await moveTo(Loc.recents()[Number(r.dataset.recent)]); }
    });

    $('#theme').addEventListener('click', () => {
      const dark = document.documentElement.getAttribute('data-theme') === 'dark';
      const next = dark ? 'light' : 'dark';
      applyTheme(next);
      try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
    });

    // Both the nav bar and the footer links change view.
    document.addEventListener('click', e => {
      const t = e.target.closest('.tab, .tab-link'); if (!t) return;
      VIEW = t.dataset.view;
      render();
      window.scrollTo({ top: $('#main').offsetTop - 60, behavior: 'smooth' });
    });

    $('#surprise').addEventListener('click', surprise);

    $('#filters-toggle').addEventListener('click', e => {
      const open = $('#filters').hidden;
      $('#filters').hidden = !open;
      e.currentTarget.setAttribute('aria-expanded', String(open));
    });

    $('#time-chips').addEventListener('click', e => {
      const b = e.target.closest('[data-time]'); if (!b) return;
      const v = Number(b.dataset.time), on = F.time === v;
      F.time = on ? null : v;
      $$('#time-chips .chip').forEach(c => c.classList.remove('on'));
      if (!on) b.classList.add('on');
      applyFilters();
    });

    const toggleSet = (sel, key, attr) => $(sel).addEventListener('click', e => {
      const b = e.target.closest(`[data-${attr}]`); if (!b) return;
      const v = b.dataset[attr];
      if (F[key].has(v)) { F[key].delete(v); b.classList.remove('on'); }
      else { F[key].add(v); b.classList.add('on'); }
      applyFilters();
    });
    toggleSet('#mood-chips', 'moods', 'mood');
    toggleSet('#flag-chips', 'flags', 'flag');

    $('#clear').addEventListener('click', () => {
      F.time = null; F.moods.clear(); F.flags.clear();
      $$('.chip').forEach(c => c.classList.remove('on'));
      applyFilters();
    });

    // expand / collapse a card
    document.addEventListener('click', e => {
      const b = e.target.closest('.more'); if (!b) return;
      const c = b.closest('.card');
      const open = c.classList.toggle('open');
      b.textContent = open ? 'Less' : 'Details';
    });

    // Sport: Play vs Watch
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-mode]'); if (!b) return;
      SPORT_MODE = b.dataset.mode;
      render();
    });

    // Sport: what do you want out of it
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-intent]'); if (!b) return;
      const k = b.dataset.intent;
      if (SPORT_INTENT.has(k)) SPORT_INTENT.delete(k); else SPORT_INTENT.add(k);
      render();
    });

    // Eat: prominent subsections
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-eatmode]'); if (!b) return;
      EAT_MODE = b.dataset.eatmode;
      render();
      window.scrollTo({ top: $('#main').offsetTop - 60, behavior: 'smooth' });
    });

    // Eat: mood chooser — clicking the active one clears it
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-mood2]'); if (!b) return;
      MOOD = (MOOD === b.dataset.mood2) ? null : b.dataset.mood2;
      render();
    });

    // a list row opens on click — but not when the click was meant for a
    // link or one of the rating buttons inside it
    document.addEventListener('click', e => {
      const r = e.target.closest('.row'); if (!r) return;
      if (e.target.closest('a, button')) return;
      r.classList.toggle('open');
    });

    // ratings
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-rate]'); if (!b) return;
      const c = b.closest('.card');
      const id = c.dataset.id;
      const now = Store.setRating(id, b.dataset.rate);
      c.querySelectorAll('[data-rate]').forEach(x => x.classList.toggle('on', x.dataset.rate === now));
      c.classList.toggle('done', Store.isDone(id));
      toast({ want: 'Saved to your list.', loved: 'Noted — more like this.', good: 'Noted.',
              meh: 'Fewer like this.', never: 'Hidden from now on.' }[now] || 'Cleared.');
      buildContext();
      if (now === 'never') setTimeout(render, 350);
    });

    // quests
    document.addEventListener('click', e => {
      const t = e.target.closest('.target'); if (!t) return;
      const qid = t.closest('[data-quest]').dataset.quest;
      const before = Store.questDone(qid).length;
      const after = Store.toggleQuest(qid, t.dataset.target).length;
      celebrate(qid, before, after);
      render();
    });

    // the arrondissement map — one tap marks it in the quest and in Explore
    document.addEventListener('click', e => {
      const g = e.target.closest('.arr-dot'); if (!g) return;
      const n = Number(g.dataset.arrnum);
      if (n === Loc.active()?.arr) { toast(`You are in the ${n}${n===1?'er':'e'} — that one is free.`); return; }
      const before = arrCount();
      Store.toggleArr(n);
      const after = arrCount();
      celebrate(g.closest('[data-quest]').dataset.quest, before, after);
      buildContext();
      render();
    });

    // arrondissements
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-arr]'); if (!b) return;
      const n = Number(b.dataset.arr);
      if (n === Loc.active()?.arr) return;
      Store.toggleArr(n);
      buildContext();
      render();
      toast(Store.hasArr(n) ? `${n}e marked explored.` : `${n}e unmarked.`);
    });
  }

  /* ---------- debug ----------
     Hidden unless ?debug=1. Exists because "did the location actually
     change anything?" is otherwise a question you answer by squinting —
     so it prints what the retrieval layer returned, not only how many
     records exist. Two locations that produce the same three names here
     have not really moved, whatever the distances say. */
  function renderDebug() {
    if (!/[?&]debug=1/.test(location.search)) return;
    const a = Loc.active();
    const near = n => [...ALL, ...DISCOVERED].filter(i => (i.minutesFromHome ?? 999) <= n).length;

    const MARK = { personal: '★', editorial: '◆', sourced: '◇', found: '·' };
    const probe = kind => {
      const r = Near.pick(Near.KIND[kind], { rings: Near.RINGS.walk, want: 6, limit: 3 });
      const names = r.items.map(i => `${MARK[Near.tierOf(i)]}${i.title}`).join(', ');
      return `${kind.padEnd(11)} ≤${String(r.radius ?? '∞').padStart(2)}m  ${names || '—'}`;
    };

    /* How much the site actually knows about where you are standing —
       the number that says whether this quarter has been done properly. */
    const tiers = () => {
      const within = [...ALL, ...DISCOVERED].filter(i => (i.minutesFromHome ?? 999) <= 15);
      const n = t => within.filter(i => Near.tierOf(i) === t).length;
      return `personal ${n('personal')}   editorial ${n('editorial')}   `
           + `sourced ${n('sourced')}   found ${n('found')}`;
    };

    const el = document.querySelector('.debug') || document.createElement('pre');
    el.className = 'debug';
    el.textContent = [
      `location    ${Loc.displayName(a)}${Loc.isExploring() ? '  (exploring)' : '  (home)'}`,
      `raw label   ${a.label || '—'}`,
      `lat / lon   ${a.lat}, ${a.lon}`,
      `arr         ${a.arr ?? 'unknown'}`,
      `home        ${Loc.displayName(Loc.home())}`,
      ``,
      `curated     ${ALL.length}      discovered  ${DISCOVERED.length}`,
      `≤15 min     ${near(15)}      ≤30 min     ${near(30)}`,
      ``,
      `within 15 min, by tier`,
      `  ${tiers()}`,
      ``,
      `what comes back  (★ visited  ◆ researched  ◇ on record  · on the map)`,
      probe('bakery'), probe('cafe'), probe('restaurant'), probe('market'),
      probe('books'), probe('park'), probe('sport')
    ].join('\n');
    document.querySelector('.foot .wrap').prepend(el);
  }

  /* ---------- boot ---------- */

  async function init() {
    initTheme();
    await load();
    applyLocation();
    Weather.setHome(HOME.lat, HOME.lon);
    try { WX = await Weather.load(); } catch (e) { console.warn('weather failed', e); }
    buildContext();
    renderLocation();
    renderHeader();
    render();
    wire();
    renderDebug();
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', App.init);
