/* ---------------------------------------------------------
   app.js — loads the data, ranks it, renders one view at a time.
   The ranking lives in scoring.js; this file is presentation.
   --------------------------------------------------------- */

const App = (() => {

  const FILES = ['events', 'places', 'itineraries', 'daytrips', 'neighborhoods', 'quests'];
  const D = {};
  let ALL = [];
  let CTX = {};
  let WX = null;
  let VIEW = 'today';

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

  /* ---------- load ---------- */

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

    ALL = []
      .concat(D.events.items || [])
      .concat(D.places.items || [])
      .concat(D.itineraries.items || [])
      .concat(D.daytrips.items || [])
      .filter(i => !(i.end && i.end < TODAY_ISO));
  }

  function buildContext() {
    CTX = {
      today: TODAY_ISO,
      weatherMode: WX ? WX.mode : null,
      taste: Store.tasteWeights(ALL),
      exploredArrs: Store.arrs()
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
    if (!item.price) return 'Free';
    return `€${item.price}`;
  }

  function kicker(item) {
    const bits = [];
    if (item.arr) bits.push(`${item.arr}<sup>e</sup>`);
    else if (item.type === 'daytrip') bits.push('Out of town');
    if (item.minutesFromHome != null) bits.push(`${item.minutesFromHome} min`);
    bits.push(priceText(item));
    if (isRomantic(item)) bits.push('<span class="duo" title="Romantic">♥</span>');
    return bits.join(' · ');
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
    if (m >= 60) return `about ${Math.round(m / 60)} hours`;
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
    if (!item.image) return `<div class="shot">${badge(item)}</div>`;
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

    const stops = (item.stops || []).map(s =>
      `<li>${esc(s.text)}${s.walk ? ` <span class="w">· ${esc(s.walk)}</span>` : ''}</li>`).join('');

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
      <div class="links">
        ${item.url ? `<a href="${esc(item.url)}" target="_blank" rel="noopener">Official site</a>` : ''}
        <a href="${mapsLink(item)}" target="_blank" rel="noopener">Directions</a>
      </div>
      <div class="rate" role="group" aria-label="Rate ${esc(item.title)}">
        ${RATINGS.map(([v, e, t]) =>
          `<button type="button" data-rate="${v}" title="${t}" aria-label="${t}" class="${r === v ? 'on' : ''}">${e}</button>`).join('')}
      </div>
      <p class="credit">
        ${item.source ? `Source: ${esc(item.source)}${item.lastVerified ? ` · verified ${item.lastVerified}` : ''}<br>` : ''}
        ${item.image ? `Photo: ${esc(item.imageSubject || '')} — ${esc(item.imageCredit || 'Wikimedia Commons')}` : ''}
      </p>
    </div>`;
  }

  function card(item, cls = '', overline = '') {
    return `<article class="card ${Store.isDone(item.id) ? 'done' : ''} ${cls}" data-id="${esc(item.id)}">
      ${shot(item)}
      <p class="kicker">${overline ? `<b>${esc(overline)}</b> · ` : ''}${kicker(item)}</p>
      <h2 class="card-title">${esc(item.title)}</h2>
      <p class="why">${esc(item.why || '')}</p>
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

  function row(item) {
    const bits = [];
    if (item.area) bits.push(esc(item.area));
    if (item.priceNote) bits.push(esc(item.priceNote));
    else if (!item.price) bits.push('Free');
    return `<div class="row ${Store.isDone(item.id) ? 'done' : ''}" data-id="${esc(item.id)}">
      <h3 class="row-name">${esc(item.title)}${isRomantic(item) ? ' <span class="duo" title="Romantic">♥</span>' : ''}</h3>
      <span class="row-dist">${item.minutesFromHome != null ? `${item.minutesFromHome} min` : ''}</span>
      <p class="row-meta">${bits.join(' · ')}</p>
      <p class="row-why">${esc(item.why || '')}</p>
      ${detail(item)}
    </div>`;
  }

  const rows = (items, empty) => items.length
    ? `<div class="list">${items.map(row).join('')}</div>`
    : `<p class="empty">${esc(empty || 'Nothing here right now.')}</p>`;

  function routeCard(item) {
    const steps = (item.stops || []).map(s =>
      `<li>${esc(s.text)}${s.walk ? `<span class="w">${esc(s.walk)}</span>` : ''}</li>`).join('');
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
      <ol class="steps">${steps}</ol>
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
    weekend: '',
    eat:     'Coffee, bread and markets. Names and walking distances — the photographs would only be of the street.',
    explore: '',
    away:    'You live between Gare du Nord and Gare de l’Est. Some of these are closer than the other side of Paris.',
    quests:  'Long games. Progress is saved in this browser.',
    saved:   'What you have marked, and what you have already done.'
  };

  function render() {
    $$('.tab').forEach(t => t.classList.toggle('on', t.dataset.view === VIEW));
    const box = $('#view');
    const w = weekend();

    $('#lede').textContent = LEDE[VIEW] || '';

    if      (VIEW === 'today')   box.innerHTML = renderToday();
    else if (VIEW === 'weekend') { $('#lede').textContent = weekendLede(w); box.innerHTML = renderWeekend(w); }
    else if (VIEW === 'eat')     box.innerHTML = renderEat();
    else if (VIEW === 'explore') { $('#lede').textContent = exploreLede(); box.innerHTML = renderExplore(); }
    else if (VIEW === 'away')    box.innerHTML = renderAway();
    else if (VIEW === 'quests')  box.innerHTML = renderQuests();
    else if (VIEW === 'saved')   box.innerHTML = renderSaved();

    applyFilters();
    settleImages($('#view'));
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

    const also = ranked.filter(i => !used.has(i.id)).slice(0, 6);

    return hero(lead)
      + (also.length ? stripHead('Also today') + rows(also) : '')
      + (evening.length
          ? stripHead('This evening', 'Short trips, late openings')
            + `<div class="grid">${evening.map(i => card(i)).join('')}</div>`
          : '');
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

  /* ---------- eat ---------- */

  function renderEat() {
    const groups = [
      ['Coffee',    i => i.type === 'cafe'],
      ['Bakeries',  i => i.type === 'bakery'],
      ['Markets',   i => i.type === 'market'],
      ['Missions',  i => i.type === 'itinerary' && (i.labels || []).includes('foodmission')],
      ['And also',  i => !['cafe', 'bakery', 'market'].includes(i.type) && i.type !== 'itinerary' &&
                         ((i.categories || []).includes('food') || (i.labels || []).includes('foodmission'))]
    ];

    const taken = new Set();
    const out = groups.map(([name, test]) => {
      const items = Rank.rank(ALL, CTX, i => !taken.has(i.id) && test(i));
      items.forEach(i => taken.add(i.id));
      if (!items.length) return '';
      return `<div class="list-group"><h3>${name}</h3>${rows(items)}</div>`;
    }).join('');

    return out || `<p class="empty">Nothing to eat. Unlikely.</p>`;
  }

  /* ---------- explore ---------- */

  function exploreLede() {
    const n = Store.arrs().length;
    return n
      ? `${n} of 20 marked explored. Here is the nearest one you have not done.`
      : 'Twenty arrondissements, some walks, and the things you would never find on your own.';
  }

  function renderExplore() {
    const hoods = D.neighborhoods.items || [];
    const explored = Store.arrs();
    const pool = hoods.filter(h => !h.isHome && !explored.includes(h.arr));
    const f = (pool.length ? pool : hoods.filter(h => !h.isHome))
      .slice().sort((a, b) => a.minutesFromHome - b.minutesFromHome)[0];

    let dossier = '';
    if (f) {
      const local = ALL.find(i => i.arr === f.arr && hasRealPhoto(i)) || ALL.find(i => i.arr === f.arr && i.image);
      const facts = [
        ['Known for', f.famousFor], ['Streets', (f.streets || []).join(' · ')],
        ['Coffee', f.cafe], ['Bakery', f.bakery], ['Culture', f.culture],
        ['Green space', f.park], ['Unusual', f.unusual], ['Food', f.food],
        ['The walk', f.walk], ['Hidden gem', f.hidden]
      ].filter(([, v]) => v);

      dossier = `<div class="hood">
        ${local ? `<div class="hood-shot">${img(local, '(min-width: 1040px) 1000px, 96vw', 'loaded')}</div>` : ''}
        <h3>${f.arr}<sup>e</sup> — ${esc(f.name)}</h3>
        <p class="sub">About ${f.minutesFromHome} minutes from you${local ? ` · photo: ${esc(local.imageSubject)}` : ''}</p>
        <div class="facts-grid">
          ${facts.map(([k, v]) => `<dl class="f"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></dl>`).join('')}
        </div>
      </div>`;
    }

    const routes = Rank.rank(D.itineraries.items || [], CTX).slice(0, 4);
    const hidden = Rank.rank(ALL, CTX, i =>
      (i.labels || []).includes('hiddengem') && i.type !== 'itinerary').slice(0, 8);

    return dossier
      + stripHead('Walks and routes', 'Follow the order')
      + `<div class="routes">${routes.map(routeCard).join('')}</div>`
      + stripHead('Hidden Paris')
      + rows(hidden)
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
    return `<div class="quests">${quests.map(q => {
      const done = Store.questDone(q.id);
      const pct = Math.round(done.length / q.targets.length * 100);
      return `<div class="quest" data-quest="${esc(q.id)}">
        <div class="qtop"><h3>${esc(q.title)}</h3><span class="qn">${done.length}/${q.targets.length}</span></div>
        <p>${esc(q.description)}</p>
        <div class="bar-track"><span style="width:${pct}%"></span></div>
        <div class="targets">${q.targets.map(t =>
          `<button type="button" class="target ${done.includes(t) ? 'on' : ''}" data-target="${esc(t)}">${esc(t)}</button>`).join('')}</div>
      </div>`;
    }).join('')}</div>`;
  }

  /* ---------- saved ---------- */

  function renderSaved() {
    const groups = [['Want to visit', 'want'], ['Loved', 'loved'], ['Good', 'good'], ['Not for us', 'meh']];
    const html = groups.map(([label, key]) => {
      const items = ALL.filter(i => Store.rating(i.id) === key);
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

    const byId = new Map(ALL.map(i => [i.id, i]));
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
      Store.toggleQuest(t.closest('[data-quest]').dataset.quest, t.dataset.target);
      render();
    });

    // arrondissements
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-arr]'); if (!b) return;
      const n = Number(b.dataset.arr);
      if (n === 10) return;
      Store.toggleArr(n);
      buildContext();
      render();
      toast(Store.hasArr(n) ? `${n}e marked explored.` : `${n}e unmarked.`);
    });
  }

  /* ---------- boot ---------- */

  async function init() {
    initTheme();
    await load();
    try { WX = await Weather.load(); } catch (e) { console.warn('weather failed', e); }
    buildContext();
    renderHeader();
    render();
    wire();
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', App.init);
