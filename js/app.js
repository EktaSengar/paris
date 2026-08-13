/* ---------------------------------------------------------
   app.js — loads the data, ranks it, renders the page.
   --------------------------------------------------------- */

const App = (() => {

  const FILES = ['events', 'places', 'itineraries', 'daytrips', 'neighborhoods', 'quests'];
  const D = {};                 // raw payloads by name
  let ALL = [];                 // every rankable item, flattened
  let CTX = {};                 // scoring context
  let WX = null;                // weather, or null if it failed

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
  const fmtDay = d => d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const fmtShort = d => d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

  const HOLIDAYS = Rank.HOLIDAYS;

  /* Ranking context for a specific future day, so the weekend planner
     uses Saturday's weather for Saturday rather than today's. */
  function ctxFor(dateISO) {
    const wx = WX && WX.byDate[dateISO];
    return Object.assign({}, CTX, { today: dateISO, weatherMode: wx ? wx.mode : CTX.weatherMode });
  }

  /* Is this genuinely something you eat or drink, rather than a shop
     that happens to be filed under food? */
  const isEdible = i =>
    ['bakery', 'cafe', 'market'].includes(i.type) ||
    (i.labels || []).includes('foodmission');

  /* Best thing across a weekend, each candidate scored under the weather of
     whichever of the two days it is actually open. Used by both the brief and
     the weekend picks so the two never contradict each other. */
  function bestForWeekend(pool, satISO, sunISO, filter) {
    const satCtx = ctxFor(satISO), sunCtx = ctxFor(sunISO);
    let best = null, bestScore = -Infinity;
    pool.forEach(i => {
      if (filter && !filter(i)) return;
      const openSat = Rank.isOpenOn(i, satISO);
      const openSun = Rank.isOpenOn(i, sunISO);
      if (!openSat && !openSun) return;
      const s = Math.max(
        openSat ? Rank.score(i, satCtx) : -Infinity,
        openSun ? Rank.score(i, sunCtx) : -Infinity
      );
      if (Number.isFinite(s) && s > bestScore) { bestScore = s; best = i; }
    });
    return best;
  }

  function nextWeekend() {
    const dow = TODAY.getDay();                 // 0 Sun … 6 Sat
    let sat;
    if (dow === 6) sat = TODAY;                 // it is Saturday
    else if (dow === 0) sat = addDays(TODAY, -1); // Sunday — this weekend
    else sat = addDays(TODAY, 6 - dow);
    return { sat, sun: addDays(sat, 1) };
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

    // Flatten everything rankable into one pool, dropping anything expired.
    ALL = []
      .concat(D.events.items || [])
      .concat(D.places.items || [])
      .concat(D.itineraries.items || [])
      .concat(D.daytrips.items || [])
      .filter(i => !(i.end && i.end < TODAY_ISO));
  }

  /* ---------- rendering helpers ---------- */

  function labelTags(item) {
    const wanted = (item.labels || []).slice(0, 4);
    return wanted.map(l => {
      const def = Rank.LABEL_TEXT[l];
      if (!def) return '';
      return `<span class="tag ${def[1]}">${esc(def[0])}</span>`;
    }).join('');
  }

  function priceText(item) {
    if (item.priceNote) return item.priceNote;
    if (!item.price) return 'Free';
    return `~€${item.price}`;
  }

  function whenText(item) {
    if (item.times) return item.times;
    if (item.start && item.end) {
      if (item.start === item.end) return fmtShort(new Date(item.start + 'T12:00:00'));
      return `Until ${fmtShort(new Date(item.end + 'T12:00:00'))}`;
    }
    if (item.startTime) return `Start ${item.startTime}`;
    return 'Open year round';
  }

  function durText(m) {
    if (!m) return '';
    if (m >= 480) return 'Full day';
    if (m >= 300) return 'Half a day';
    if (m >= 60)  return `~${Math.round(m / 60)} hr`;
    return `~${m} min`;
  }

  function mapsLink(item) {
    const q = encodeURIComponent(`${item.title} ${item.area || ''} Paris`);
    return `https://www.google.com/maps/search/?api=1&query=${q}`;
  }

  function programmeBlock(item) {
    if (!item.programme || !item.programme.length) return '';
    const rows = item.programme
      .filter(p => p.date >= TODAY_ISO)
      .slice(0, 4)
      .map(p => {
        const isToday = p.date === TODAY_ISO;
        const d = new Date(p.date + 'T12:00:00');
        return `<div class="${isToday ? 'prog-today' : ''}">
          <b>${isToday ? 'Tonight' : d.toLocaleDateString('en-GB', { weekday: 'short' })}</b> · ${esc(p.text)}
        </div>`;
      }).join('');
    return rows ? `<div class="card-programme">${rows}</div>` : '';
  }

  function stopsBlock(item) {
    if (!item.stops || !item.stops.length) return '';
    return `<ul class="stops">${item.stops.map(s => `
      <li><span>${s.emoji || '·'}</span><span>${esc(s.text)}
      ${s.walk ? `<span class="stop-walk"> — ${esc(s.walk)}</span>` : ''}</span></li>`).join('')}</ul>`;
  }

  function nearbyBlock(item) {
    if (!item.nearby || !item.nearby.length) return '';
    return `<div class="card-nearby">${item.nearby
      .map(n => `<span>${n.emoji} ${esc(n.text)}</span>`).join('')}</div>`;
  }

  const RATINGS = [
    ['want',  '📍', 'Want to visit'],
    ['loved', '❤️', 'Loved it'],
    ['good',  '👍', 'Good'],
    ['meh',   '😐', 'Not for us'],
    ['never', '❌', "Don't show again"]
  ];

  function card(item, extraClass = '') {
    const rating = Store.rating(item.id);
    const done = Store.isDone(item.id);
    const mins = item.minutesFromHome;

    return `<article class="card ${done ? 'is-done' : ''} ${extraClass}" data-id="${esc(item.id)}">
      <div class="card-labels">${labelTags(item)}</div>
      <h3 class="card-title">${item.emoji ? item.emoji + ' ' : ''}${esc(item.title)}</h3>
      <div class="card-meta">
        ${item.area ? `<span>📍 ${esc(item.area)}${item.arr ? ` · ${item.arr}<sup>e</sup>` : ''}</span>` : ''}
        <span>🕐 ${esc(whenText(item))}</span>
        <span>💶 ${esc(priceText(item))}</span>
        ${mins != null ? `<span>🚶 ~${mins} min from you</span>` : ''}
        ${item.durationMin ? `<span>⏳ ${durText(item.durationMin)}</span>` : ''}
      </div>
      ${programmeBlock(item)}
      <p class="card-why">${esc(item.why || '')}</p>
      ${stopsBlock(item)}
      ${nearbyBlock(item)}
      <div class="card-foot">
        <div class="card-links">
          ${item.url ? `<a href="${esc(item.url)}" target="_blank" rel="noopener">Official site ↗</a>` : ''}
          <a href="${mapsLink(item)}" target="_blank" rel="noopener">Directions ↗</a>
        </div>
        <div class="rate" role="group" aria-label="Rate ${esc(item.title)}">
          ${RATINGS.map(([v, e, t]) =>
            `<button type="button" data-rate="${v}" title="${t}" aria-label="${t}"
              class="${rating === v ? 'on' : ''}">${e}</button>`).join('')}
        </div>
      </div>
      ${item.source ? `<div class="card-source">Source: ${esc(item.source)}${item.lastVerified ? ` · verified ${item.lastVerified}` : ''}</div>` : ''}
    </article>`;
  }

  function fill(sel, items, emptyMsg) {
    const el = $(sel);
    if (!el) return;
    el.innerHTML = items.length
      ? items.map(i => card(i)).join('')
      : `<p class="empty">${esc(emptyMsg || 'Nothing here right now.')}</p>`;
  }

  /* ---------- context ---------- */

  function buildContext() {
    CTX = {
      today: TODAY_ISO,
      weatherMode: WX ? WX.mode : null,
      taste: Store.tasteWeights(ALL),
      exploredArrs: Store.arrs()
    };
  }

  /* ---------- header ---------- */

  function renderHeader() {
    $('#dateline').textContent = fmtDay(TODAY);

    if (WX) {
      $('#weather').innerHTML = `
        <span class="temp">${WX.now.icon} ${WX.now.temp}°</span>
        ${esc(WX.now.label)} · high ${WX.days[0].tmax}°
        <span class="wx-advice">${esc(WX.advice)}</span>`;
    } else {
      $('#weather').innerHTML = `<span class="wx-advice">Weather unavailable — ranking without it.</span>`;
    }

    // Holiday and closure notices for the coming week
    const notices = [];
    for (let i = 0; i < 8; i++) {
      const d = addDays(TODAY, i);
      const name = HOLIDAYS[iso(d)];
      if (name) {
        const when = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : fmtShort(d);
        notices.push(`<strong>${when} is ${esc(name)}</strong> — a public holiday. Most shops, bakeries and markets will be shut; museums, parks and big events generally stay open.`);
      }
    }
    if (notices.length) {
      $('#notice-slot').innerHTML = notices.map(n => `<div class="notice">${n}</div>`).join('');
    }
  }

  /* ---------- brief ---------- */

  function renderBrief() {
    const { sat } = nextWeekend();
    $('#brief-sub').textContent =
      `Three things worth knowing today, and where the weekend is heading.`;

    const todayItems = Rank.rank(ALL, CTX, i =>
      Rank.isOpenOn(i, TODAY_ISO) && (i.minutesFromHome ?? 99) <= 45).slice(0, 3);

    // Four different answers, not the same answer four times.
    const satISO = iso(sat), sunISO = iso(addDays(sat, 1));
    const taken = new Set();
    const one = (pool, filter) => {
      const found = bestForWeekend(pool, satISO, sunISO, i => !taken.has(i.id) && filter(i));
      if (found) taken.add(found.id);
      return found;
    };

    const weekendBest = one(ALL, () => true);
    const gem  = one(ALL, i => (i.labels || []).includes('hiddengem'));
    const free = one(ALL, i => !i.price);
    const trip = one(D.daytrips.items || [], () => true);

    const line = it => it
      ? `<b>${esc(it.title)}</b> — ${esc((it.why || '').split('. ')[0])}.`
      : '<span class="empty">nothing suitable</span>';

    $('#brief-body').innerHTML = `
      <h3>Three things today</h3>
      <ol>${todayItems.map(i => `<li>${i.emoji || ''} ${line(i)}</li>`).join('') ||
        '<li class="empty">Nothing close by today — try the weekend section.</li>'}</ol>
      <h3>The weekend, in four lines</h3>
      <ul>
        <li>🏆 <b>Best pick:</b> ${weekendBest ? esc(weekendBest.title) : '—'}</li>
        <li>💎 <b>Hidden gem:</b> ${gem ? esc(gem.title) : '—'}</li>
        <li>🆓 <b>Free:</b> ${free ? esc(free.title) : '—'}</li>
        <li>🚆 <b>Outside Paris:</b> ${trip ? esc(trip.title) : '—'}</li>
      </ul>`;
  }

  /* ---------- main sections ---------- */

  function renderSections() {
    const { sat, sun } = nextWeekend();
    const satISO = iso(sat), sunISO = iso(sun);

    // Today
    fill('#today-grid',
      Rank.rank(ALL, CTX, i => Rank.isOpenOn(i, TODAY_ISO) && (i.durationMin ?? 120) <= 360).slice(0, 6),
      'Nothing is scheduled for today — look at the weekend.');

    // Tonight
    fill('#tonight-grid',
      Rank.rank(ALL, CTX, i =>
        Rank.isOpenOn(i, TODAY_ISO) &&
        (i.minutesFromHome ?? 99) <= 40 &&
        ((i.labels || []).includes('afterwork') ||
         (i.goodFor || []).includes('evening') ||
         (i.goodFor || []).includes('spontaneous'))
      ).slice(0, 6),
      'Nothing obvious tonight — the canal is always there.');

    // Weekend
    renderWeekend(sat, sun, satISO, sunISO);

    // Free this week
    const weekEnd = iso(addDays(TODAY, 7));
    fill('#free-grid',
      Rank.rank(ALL, CTX, i =>
        !i.price && (!i.start || i.start <= weekEnd) && (!i.end || i.end >= TODAY_ISO)
      ).slice(0, 6));

    // Itineraries
    fill('#itinerary-grid', Rank.rank(D.itineraries.items || [], CTX).slice(0, 6));

    // Hidden
    fill('#hidden-grid',
      Rank.rank(ALL, CTX, i => (i.labels || []).includes('hiddengem')).slice(0, 6));

    // Food
    fill('#food-grid',
      Rank.rank(ALL, CTX, i =>
        (i.categories || []).some(c => ['food', 'coffee', 'bakery', 'market'].includes(c))
      ).slice(0, 6));

    // Worth leaving the 10th for
    fill('#outside-grid',
      Rank.rank(ALL, CTX, i =>
        i.arr && i.arr !== 10 && (i.minutesFromHome ?? 0) >= 15 && i.type !== 'daytrip'
      ).slice(0, 6));

    renderExplore();
    renderDaytrips('all');
    renderQuests();
    renderSaved();

    const stamp = D.events.generated;
    $('#data-stamp').textContent = stamp
      ? `Event data generated ${stamp}. Expired entries are removed automatically.` : '';
  }

  /* ---------- weekend ---------- */

  function renderWeekend(sat, sun, satISO, sunISO) {
    const openThen = i => Rank.isOpenOn(i, satISO) || Rank.isOpenOn(i, sunISO);
    const wxSat = WX && WX.byDate[satISO];
    const wxSun = WX && WX.byDate[sunISO];

    let sub = `${fmtShort(sat)} and ${fmtShort(sun)}.`;
    if (wxSat && wxSun) {
      sub += ` Saturday ${wxSat.icon} ${wxSat.label.toLowerCase()}, ${wxSat.tmax}°.`
           + ` Sunday ${wxSun.icon} ${wxSun.label.toLowerCase()}, ${wxSun.tmax}°.`;
    }
    if (HOLIDAYS[satISO]) sub += ` Note: Saturday is ${HOLIDAYS[satISO]}, so most shops will be closed.`;
    $('#weekend-sub').textContent = sub;

    const pick = (label, filter) => {
      const found = bestForWeekend(ALL, satISO, sunISO, filter);
      return found ? { label, item: found } : null;
    };

    const picks = [
      pick('Best overall',  () => true),
      pick('Best free',     i => !i.price),
      pick('Best food',     isEdible),
      pick('Most unusual',  i => (i.uniqueness || 0) >= 5),
      pick('Best day trip', i => i.type === 'daytrip')
    ].filter(Boolean);

    // de-duplicate so the same thing does not win three categories
    const used = new Set();
    const unique = [];
    picks.forEach(p => {
      if (used.has(p.item.id)) {
        const alt = bestForWeekend(ALL, satISO, sunISO, i => !used.has(i.id));
        if (alt) { used.add(alt.id); unique.push({ label: p.label, item: alt }); }
      } else {
        used.add(p.item.id);
        unique.push(p);
      }
    });

    $('#weekend-picks').innerHTML = unique.map(p => `
      <div class="pick">
        <div class="pick-rank">${esc(p.label)}</div>
        <div class="pick-body">
          <h4>${p.item.emoji || ''} ${esc(p.item.title)}</h4>
          <p>${esc((p.item.why || '').split('. ').slice(0, 2).join('. '))}</p>
          <div class="pick-meta">
            ${p.item.area ? esc(p.item.area) + ' · ' : ''}
            ${priceText(p.item)} ·
            ~${p.item.minutesFromHome ?? '?'} min from you
          </div>
        </div>
      </div>`).join('');

    // Saturday / Sunday shape.
    // `used` is shared across both days so the two days never come out identical,
    // and each day is ranked against its own forecast rather than today's.
    const usedInPlan = new Set();

    const isEvening = i => (i.labels || []).includes('afterwork') || (i.goodFor || []).includes('evening');
    const isMorning = i => (i.goodFor || []).includes('morning') || (i.categories || []).includes('market');
    const isDaytime = i => !isEvening(i) && (i.durationMin ?? 120) >= 90;

    function dayPlan(d, dayISO, wx) {
      const dayCtx = ctxFor(dayISO);
      const rows = [];

      [['Morning', isMorning], ['Afternoon', isDaytime], ['Evening', isEvening]].forEach(([when, test]) => {
        const it = Rank.rank(ALL, dayCtx, i =>
          Rank.isOpenOn(i, dayISO) && !usedInPlan.has(i.id) && test(i))[0];
        if (!it) return;
        usedInPlan.add(it.id);
        rows.push(`<div class="slot">
          <div class="slot-when">${when}</div>
          <div class="slot-what"><b>${it.emoji || ''} ${esc(it.title)}</b> — ${esc((it.why || '').split('. ')[0])}.</div>
        </div>`);
      });

      const holiday = HOLIDAYS[dayISO];
      return `<div class="day">
        <h4>${d.toLocaleDateString('en-GB', { weekday: 'long' })}</h4>
        <p class="day-date">${fmtShort(d)}${wx ? ` · ${wx.icon} ${wx.tmax}°, ${esc(wx.label.toLowerCase())}${wx.rain >= 40 ? `, ${wx.rain}% rain` : ''}` : ''}${holiday ? ` · ${esc(holiday)} — shops shut` : ''}</p>
        ${rows.join('') || '<p class="empty">Keep it open.</p>'}
      </div>`;
    }

    $('#weekend-plan').innerHTML = dayPlan(sat, satISO, wxSat) + dayPlan(sun, sunISO, wxSun);
  }

  /* ---------- explore ---------- */

  function renderExplore() {
    const hoods = D.neighborhoods.items || [];
    const explored = Store.arrs();
    const unexplored = hoods.filter(h => !h.isHome && !explored.includes(h.arr));

    $('#explore-sub').textContent = explored.length
      ? `You have marked ${explored.length} of 20 explored. Here is the next one worth a Sunday.`
      : `Twenty arrondissements. Start ticking them off — here is a good first one.`;

    // Feature the closest unexplored one, since a short trip is the one you will actually make.
    const pool = unexplored.length ? unexplored : hoods.filter(h => !h.isHome);
    const feature = pool.slice().sort((a, b) => a.minutesFromHome - b.minutesFromHome)[0];

    if (feature) {
      const facts = [
        ['Known for', feature.famousFor],
        ['Streets to walk', (feature.streets || []).join(' · ')],
        ['Coffee', feature.cafe],
        ['Bakery', feature.bakery],
        ['Culture', feature.culture],
        ['Green space', feature.park],
        ['Something unusual', feature.unusual],
        ['Food', feature.food],
        ['The walk', feature.walk],
        ['Hidden gem', feature.hidden]
      ].filter(([, v]) => v);

      $('#explore-feature').innerHTML = `
        <div class="arr-card">
          <h3>${feature.arr}<sup>e</sup> — ${esc(feature.name)}</h3>
          <p class="arr-famous">~${feature.minutesFromHome} min from you</p>
          <div class="arr-facts">
            ${facts.map(([k, v]) => `<dl class="fact"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></dl>`).join('')}
          </div>
        </div>`;
    }

    $('#arr-list').innerHTML = hoods.map(h => `
      <div class="arr-row">
        <span class="arr-num">${h.arr}<sup>e</sup></span>
        <span class="arr-name">${esc(h.name)}</span>
        <button type="button" data-arr="${h.arr}" class="${Store.hasArr(h.arr) || h.isHome ? 'on' : ''}">
          ${h.isHome ? 'Home' : (Store.hasArr(h.arr) ? '✓ Explored' : 'Mark')}
        </button>
      </div>`).join('');
  }

  /* ---------- day trips ---------- */

  function renderDaytrips(band) {
    const items = (D.daytrips.items || []).filter(t =>
      band === 'all' ? true :
      band === 'under1' ? t.travelBand === 'under1' :
      ['under1', 'under1_5'].includes(t.travelBand));
    fill('#daytrip-grid', Rank.rank(items, CTX));
  }

  /* ---------- quests ---------- */

  function renderQuests() {
    const quests = D.quests.items || [];
    quests.forEach(q => Store.seedQuest(q.id, q.preCompleted));

    $('#quest-list').innerHTML = quests.map(q => {
      const done = Store.questDone(q.id);
      const pct = Math.round((done.length / q.targets.length) * 100);
      return `<div class="quest" data-quest="${esc(q.id)}">
        <div class="quest-head">
          <h3>${q.emoji} ${esc(q.title)}</h3>
          <span class="quest-count">${done.length}/${q.targets.length}</span>
        </div>
        <p>${esc(q.description)}</p>
        <div class="bar"><span style="width:${pct}%"></span></div>
        <div class="targets">
          ${q.targets.map(t => `<button type="button" class="target ${done.includes(t) ? 'on' : ''}"
            data-target="${esc(t)}">${esc(t)}</button>`).join('')}
        </div>
      </div>`;
    }).join('');
  }

  /* ---------- saved ---------- */

  function renderSaved() {
    const byId = new Map(ALL.map(i => [i.id, i]));
    const groups = [
      ['📍 Want to visit', 'want'],
      ['❤️ Loved', 'loved'],
      ['👍 Good', 'good'],
      ['😐 Not for us', 'meh']
    ];
    const html = groups.map(([label, key]) => {
      const ids = Object.keys(localStorageRatings()).filter(id => localStorageRatings()[id] === key);
      const names = ids.map(id => byId.get(id)?.title).filter(Boolean);
      if (!names.length) return '';
      return `<div class="saved-group">
        <h3>${label}</h3>
        <div class="saved-items">${names.map(n => `<span class="saved-chip">${esc(n)}</span>`).join('')}</div>
      </div>`;
    }).join('');

    $('#saved-body').innerHTML = html ||
      `<p class="empty">Nothing marked yet. Use the buttons on any card — the ranking learns from them.</p>`;
  }

  function localStorageRatings() {
    const out = {};
    ALL.forEach(i => { const r = Store.rating(i.id); if (r) out[i.id] = r; });
    return out;
  }

  /* ---------- filters ---------- */

  const filters = { time: null, moods: new Set(), flags: new Set() };

  function applyFilters() {
    const active = filters.time || filters.moods.size || filters.flags.size;
    const box = $('#filter-results');

    if (!active) {
      box.hidden = true;
      $('#filter-count').textContent = '';
      return;
    }

    const results = Rank.rank(ALL, CTX, i => {
      if (filters.time && (i.durationMin ?? 90) > filters.time) return false;

      if (filters.moods.size) {
        const hay = [].concat(i.categories || [], i.goodFor || [], i.labels || []).join(' ');
        let ok = false;
        filters.moods.forEach(m => {
          if (m === 'relax'    && /relax|park|outdoors|walk/.test(hay)) ok = true;
          else if (m === 'explore'  && /walk|explore|hidden|unusual|explorenew/.test(hay)) ok = true;
          else if (m === 'food'     && /food|coffee|bakery|market|foodmission/.test(hay)) ok = true;
          else if (m === 'learn'    && /learn/.test(hay)) ok = true;
          else if (m === 'culture'  && /culture|art|history|architecture|photography|film|music|theatre/.test(hay)) ok = true;
          else if (m === 'outdoors' && /outdoor|park|walk/.test(hay)) ok = true;
          else if (m === 'shop'     && /shop|design|market|vintage|home/.test(hay)) ok = true;
          else if (m === 'romantic' && /romantic/.test(hay)) ok = true;
          else if (m === 'unusual'  && /unusual|hiddengem/.test(hay)) ok = true;
        });
        if (!ok) return false;
      }

      if (filters.flags.has('free')    && i.price) return false;
      if (filters.flags.has('cheap')   && (i.price ?? 0) > 20) return false;
      if (filters.flags.has('near')    && (i.minutesFromHome ?? 99) > 30) return false;
      if (filters.flags.has('couple')  && !(i.goodFor || []).includes('couple')) return false;
      if (filters.flags.has('indoor')  && i.indoor !== true) return false;
      if (filters.flags.has('outdoor') && i.indoor !== false) return false;
      if (filters.flags.has('new')     && Store.isDone(i.id)) return false;

      return true;
    });

    box.hidden = false;
    box.innerHTML = results.length
      ? results.slice(0, 12).map(i => card(i)).join('')
      : `<p class="empty">Nothing matches that combination. Try loosening one filter.</p>`;
    $('#filter-count').textContent = `${results.length} match${results.length === 1 ? '' : 'es'}`;
  }

  /* ---------- surprise ---------- */

  function surprise() {
    const pool = Rank.rank(ALL, CTX, i =>
      !Store.isDone(i.id) &&
      !Store.seenRecently(i.id) &&
      Rank.isLive(i, TODAY_ISO)
    );
    if (!pool.length) {
      toast('You have seen everything recently. Try again tomorrow.');
      return;
    }
    // Weighted towards the top of the ranking, but not deterministic.
    const top = pool.slice(0, 12);
    const chosen = top[Math.floor(Math.pow(Math.random(), 1.7) * top.length)];
    Store.markSeen(chosen.id);

    const box = $('#filter-results');
    box.hidden = false;
    box.innerHTML = card(chosen, 'surprise-card');
    $('#filter-count').textContent = 'Surprise pick';
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /* ---------- toast ---------- */

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  /* ---------- events ---------- */

  function wire() {
    $('#surprise').addEventListener('click', surprise);

    $('#time-pills').addEventListener('click', e => {
      const b = e.target.closest('[data-time]'); if (!b) return;
      const v = Number(b.dataset.time);
      const on = filters.time === v;
      filters.time = on ? null : v;
      $$('#time-pills .pill').forEach(p => p.classList.remove('active'));
      if (!on) b.classList.add('active');
      applyFilters();
    });

    $('#mood-pills').addEventListener('click', e => {
      const b = e.target.closest('[data-mood]'); if (!b) return;
      const m = b.dataset.mood;
      if (filters.moods.has(m)) { filters.moods.delete(m); b.classList.remove('active'); }
      else { filters.moods.add(m); b.classList.add('active'); }
      applyFilters();
    });

    $('#flag-pills').addEventListener('click', e => {
      const b = e.target.closest('[data-flag]'); if (!b) return;
      const f = b.dataset.flag;
      if (filters.flags.has(f)) { filters.flags.delete(f); b.classList.remove('active'); }
      else { filters.flags.add(f); b.classList.add('active'); }
      applyFilters();
    });

    $('#clear-filters').addEventListener('click', () => {
      filters.time = null; filters.moods.clear(); filters.flags.clear();
      $$('.pill').forEach(p => { if (!p.dataset.band) p.classList.remove('active'); });
      applyFilters();
    });

    $('#trip-pills').addEventListener('click', e => {
      const b = e.target.closest('[data-band]'); if (!b) return;
      $$('#trip-pills .pill').forEach(p => p.classList.remove('active'));
      b.classList.add('active');
      renderDaytrips(b.dataset.band);
    });

    // Ratings — delegated so it works for every card anywhere on the page
    document.addEventListener('click', e => {
      const btn = e.target.closest('[data-rate]');
      if (!btn) return;
      const cardEl = btn.closest('.card');
      const id = cardEl.dataset.id;
      const value = btn.dataset.rate;
      const now = Store.setRating(id, value);

      cardEl.querySelectorAll('[data-rate]').forEach(b =>
        b.classList.toggle('on', b.dataset.rate === now));
      cardEl.classList.toggle('is-done', Store.isDone(id));

      const msgs = {
        want: 'Added to your list.', loved: 'Noted — more like this.',
        good: 'Noted.', meh: 'Fewer like this.', never: 'Hidden from now on.'
      };
      toast(now ? msgs[now] : 'Cleared.');

      buildContext();
      renderBrief();
      renderSaved();
      if (now === 'never') setTimeout(renderSections, 400);
    });

    // Quest targets
    document.addEventListener('click', e => {
      const t = e.target.closest('.target'); if (!t) return;
      const qid = t.closest('[data-quest]').dataset.quest;
      Store.toggleQuest(qid, t.dataset.target);
      renderQuests();
    });

    // Arrondissement marking
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-arr]'); if (!b) return;
      const n = Number(b.dataset.arr);
      if (n === 10) return;
      Store.toggleArr(n);
      buildContext();
      renderExplore();
      toast(Store.hasArr(n) ? `${n}e marked explored.` : `${n}e unmarked.`);
    });
  }

  /* ---------- boot ---------- */

  async function init() {
    await load();

    // Weather is a nice-to-have; the site must work without it.
    try { WX = await Weather.load(); } catch (e) { console.warn('weather failed', e); }

    buildContext();
    renderHeader();
    renderBrief();
    renderSections();
    wire();
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', App.init);
