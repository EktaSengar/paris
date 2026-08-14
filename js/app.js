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

  function shot(item) {
    if (!item.image) return `<div class="shot">${badge(item)}</div>`;
    return `<div class="shot">
      <img src="${esc(item.image)}" alt="${esc(item.imageSubject || item.title)}"
           loading="lazy" decoding="async" onload="this.classList.add('loaded')">
      ${badge(item)}
    </div>`;
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

  /* ---------- views ---------- */

  const LEDE = {
    today:   'Open today, close to home, and worth the trip out of the flat.',
    tonight: 'After work. Low effort, short distance.',
    weekend: '',
    free:    'Costs nothing. Several of these are better than the things that do.',
    routes:  'Sequences, not lists. Leave at the stated time and follow the order.',
    food:    'Coffee, bread, markets and things worth crossing the city to eat.',
    hidden:  'Small, odd or overlooked — the ones you would not find on your own.',
    trips:   'You live between Gare du Nord and Gare de l’Est. Use them.',
    explore: '',
    quests:  'Long games. Progress is saved in this browser.',
    saved:   'What you have marked, and what you have already done.'
  };

  function render() {
    $$('.tab').forEach(t => t.classList.toggle('on', t.dataset.view === VIEW));
    const box = $('#view');
    const w = weekend();

    if (VIEW === 'weekend') {
      $('#lede').textContent = weekendLede(w);
      box.innerHTML = renderWeekend(w);
    } else if (VIEW === 'explore') {
      $('#lede').textContent = exploreLede();
      box.innerHTML = renderExplore();
    } else if (VIEW === 'quests') {
      $('#lede').textContent = LEDE.quests;
      box.innerHTML = renderQuests();
    } else if (VIEW === 'saved') {
      $('#lede').textContent = LEDE.saved;
      box.innerHTML = renderSaved();
    } else {
      $('#lede').textContent = LEDE[VIEW] || '';
      box.innerHTML = grid(listFor(VIEW), emptyFor(VIEW));
    }

    applyFilters();
  }

  function listFor(view) {
    const weekEnd = iso(addDays(TODAY, 7));
    switch (view) {
      case 'today':
        return Rank.rank(ALL, CTX, i =>
          Rank.isOpenOn(i, TODAY_ISO) && (i.durationMin ?? 120) <= 360).slice(0, 9);
      case 'tonight':
        return Rank.rank(ALL, CTX, i =>
          Rank.isOpenOn(i, TODAY_ISO) && (i.minutesFromHome ?? 99) <= 40 &&
          ((i.labels || []).includes('afterwork') ||
           (i.goodFor || []).includes('evening') ||
           (i.goodFor || []).includes('spontaneous'))).slice(0, 9);
      case 'free':
        return Rank.rank(ALL, CTX, i =>
          !i.price && (!i.start || i.start <= weekEnd)).slice(0, 12);
      case 'routes':
        return Rank.rank(D.itineraries.items || [], CTX);
      case 'food':
        return Rank.rank(ALL, CTX, i =>
          isEdible(i) || (i.categories || []).includes('food')).slice(0, 12);
      case 'hidden':
        return Rank.rank(ALL, CTX, i => (i.labels || []).includes('hiddengem')).slice(0, 12);
      case 'trips':
        return Rank.rank(D.daytrips.items || [], CTX);
      default:
        return [];
    }
  }

  const emptyFor = v => ({
    today:   'Nothing scheduled today — try the weekend.',
    tonight: 'Nothing obvious tonight. The canal is always there.'
  }[v]);

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

    const picks = [
      pick('Best overall'),
      pick('Best free',     i => !i.price),
      pick('Best food',     isEdible),
      pick('Most unusual',  i => (i.uniqueness || 0) >= 5),
      pick('Best day trip', i => i.type === 'daytrip')
    ].filter(Boolean);

    // Two different days, ranked against their own forecasts.
    const planned = new Set();
    const isEvening = i => (i.labels || []).includes('afterwork') || (i.goodFor || []).includes('evening');
    const isMorning = i => (i.goodFor || []).includes('morning') || (i.categories || []).includes('market');
    const isDay     = i => !isEvening(i) && (i.durationMin ?? 120) >= 90;

    const day = (d, dISO) => {
      const c = ctxFor(dISO);
      const wx = WX && WX.byDate[dISO];
      const rows = [['Morning', isMorning], ['Afternoon', isDay], ['Evening', isEvening]].map(([when, test]) => {
        const it = Rank.rank(ALL, c, i => Rank.isOpenOn(i, dISO) && !planned.has(i.id) && test(i))[0];
        if (!it) return '';
        planned.add(it.id);
        return `<div class="slot"><div class="t">${when}</div>
          <div class="s"><b>${esc(it.title)}</b>${esc((it.why || '').split('. ')[0])}.</div></div>`;
      }).join('');

      return `<div class="day">
        <h3>${d.toLocaleDateString('en-GB', { weekday: 'long' })}</h3>
        <p class="when">${fmtShort(d)}${wx ? ` · ${wx.tmax}°, ${esc(wx.label.toLowerCase())}${wx.rain >= 40 ? `, ${wx.rain}% rain` : ''}` : ''}${HOLIDAYS[dISO] ? ` · ${esc(HOLIDAYS[dISO])}, shops shut` : ''}</p>
        ${rows || '<p class="empty">Keep it open.</p>'}
      </div>`;
    };

    return `<div class="plan">${day(w.sat, w.satISO)}${day(w.sun, w.sunISO)}</div>
      <p class="sub-head">The five picks</p>
      <div class="grid">${picks.map(p => card(p.it, '', p.label)).join('')}</div>`;
  }

  /* ---------- explore ---------- */

  function exploreLede() {
    const n = Store.arrs().length;
    return n
      ? `${n} of 20 marked explored. Here is the nearest one you have not done.`
      : 'Twenty arrondissements. Here is a good place to start.';
  }

  function renderExplore() {
    const hoods = D.neighborhoods.items || [];
    const explored = Store.arrs();
    const pool = hoods.filter(h => !h.isHome && !explored.includes(h.arr));
    const f = (pool.length ? pool : hoods.filter(h => !h.isHome))
      .slice().sort((a, b) => a.minutesFromHome - b.minutesFromHome)[0];

    let feature = '';
    if (f) {
      // Borrow a photograph from something we already have in that arrondissement.
      const local = ALL.find(i => i.arr === f.arr && i.image);
      const facts = [
        ['Known for', f.famousFor], ['Streets', (f.streets || []).join(' · ')],
        ['Coffee', f.cafe], ['Bakery', f.bakery], ['Culture', f.culture],
        ['Green space', f.park], ['Unusual', f.unusual], ['Food', f.food],
        ['The walk', f.walk], ['Hidden gem', f.hidden]
      ].filter(([, v]) => v);

      feature = `<div class="hood">
        ${local ? `<div class="hood-shot"><img src="${esc(local.image)}" alt="${esc(local.imageSubject || f.name)}" loading="lazy" decoding="async"></div>` : ''}
        <h3>${f.arr}<sup>e</sup> — ${esc(f.name)}</h3>
        <p class="sub">About ${f.minutesFromHome} minutes from you${local ? ` · photo: ${esc(local.imageSubject)}` : ''}</p>
        <div class="facts-grid">
          ${facts.map(([k, v]) => `<dl class="f"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></dl>`).join('')}
        </div>
      </div>`;
    }

    return feature + `<p class="sub-head">All twenty</p><div class="arr-grid">${
      hoods.map(h => `<div class="arr">
        <span class="n">${h.arr}<sup>e</sup></span>
        <span class="nm">${esc(h.name)}</span>
        <button type="button" data-arr="${h.arr}" class="${Store.hasArr(h.arr) || h.isHome ? 'on' : ''}">
          ${h.isHome ? 'Home' : (Store.hasArr(h.arr) ? 'Explored' : 'Mark')}
        </button>
      </div>`).join('')}</div>`;
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
    const byId = new Map(ALL.map(i => [i.id, i]));
    const groups = [['Want to visit', 'want'], ['Loved', 'loved'], ['Good', 'good'], ['Not for us', 'meh']];
    const html = groups.map(([label, key]) => {
      const names = ALL.filter(i => Store.rating(i.id) === key).map(i => i.title);
      if (!names.length) return '';
      return `<div class="saved-group"><h3>${label}</h3><ul>${
        names.map(n => `<li>${esc(n)}</li>`).join('')}</ul></div>`;
    }).join('');
    return html || `<p class="empty">Nothing marked yet. Open any card's details and use the buttons — the ranking learns from them.</p>`;
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
    if (F.flags.has('indoor')  && i.indoor !== true) return false;
    if (F.flags.has('outdoor') && i.indoor !== false) return false;
    if (F.flags.has('new')     && Store.isDone(i.id)) return false;
    return true;
  }

  /* Filtering narrows whatever view you are in, rather than replacing it. */
  function applyFilters() {
    if (!filterActive()) {
      $('#count').textContent = '';
      $$('#view .card').forEach(c => { c.style.display = ''; });
      return;
    }
    const byId = new Map(ALL.map(i => [i.id, i]));
    let shown = 0;
    $$('#view .card').forEach(c => {
      const item = byId.get(c.dataset.id);
      const ok = item ? matches(item) : true;
      c.style.display = ok ? '' : 'none';
      if (ok) shown++;
    });
    $('#count').textContent = `${shown} shown`;
  }

  /* ---------- header ---------- */

  function renderHeader() {
    $('#dateline').textContent = fmtLong(TODAY);

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
    $$('.tab').forEach(t => t.classList.remove('on'));
    $('#count').textContent = '';
    window.scrollTo({ top: $('#main').offsetTop - 60, behavior: 'smooth' });
  }

  /* ---------- wiring ---------- */

  function wire() {
    $('#tabs').addEventListener('click', e => {
      const t = e.target.closest('.tab'); if (!t) return;
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
