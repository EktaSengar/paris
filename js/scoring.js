/* ---------------------------------------------------------
   scoring.js — the ranking engine.

   The point of this file is that the site does not simply list
   everything. Each candidate is scored against today's date,
   today's weather, how far it is from wherever you currently are,
   what it costs, how soon it disappears, and what you have already
   told the site you like. The sections then take the top of that ranking.

   This answers "is this good today". It is not the same question as
   "what is around me" — that one lives in nearby.js, which decides
   *which* candidates reach this ranking in the first place.
   --------------------------------------------------------- */

const Rank = (() => {

  const DAY_MS = 86400000;
  const iso = d => d.toISOString().slice(0, 10);
  const parse = s => new Date(s + 'T12:00:00');
  const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / DAY_MS);

  /* French public holidays. Shops, bakeries and markets largely shut;
     museums, parks and ticketed events carry on. */
  const HOLIDAYS = {
    '2026-08-15': 'Assumption',
    '2026-11-01': "All Saints' Day",
    '2026-11-11': 'Armistice Day',
    '2026-12-25': 'Christmas Day',
    '2027-01-01': "New Year's Day",
    '2027-04-05': 'Easter Monday',
    '2027-05-01': 'Labour Day',
    '2027-05-06': 'Ascension',
    '2027-05-08': 'VE Day',
    '2027-05-17': 'Whit Monday',
    '2027-07-14': 'Bastille Day',
    '2027-08-15': 'Assumption'
  };

  /* Things that shut on a public holiday. */
  const SHUTS_ON_HOLIDAY = ['bakery', 'cafe', 'shop', 'market'];

  /* --- is this thing available on a given date? --- */

  function isLive(item, dateStr) {
    if (item.start && dateStr < item.start) return false;
    if (item.end && dateStr > item.end) return false;
    return true;
  }

  function isOpenOn(item, dateStr) {
    if (!isLive(item, dateStr)) return false;
    const dow = parse(dateStr).getDay();               // 0 = Sunday
    if (Array.isArray(item.days) && !item.days.includes(dow)) return false;
    if (item.closedWeekends && (dow === 0 || dow === 6)) return false;

    /* A record that carries real opening hours can answer this properly
       rather than by assumption. Only ever used to rule a day *out* —
       an unparseable or absent spec leaves the answer where it was,
       because "we cannot read this" is not the same as "it is shut". */
    if (item.hours) {
      const shut = Hours.closedDays(item.hours);
      if (shut && shut.includes(dow)) return false;
    }

    // Do not send them to a bakery on a day the bakery is shut.
    if (HOLIDAYS[dateStr]) {
      if (SHUTS_ON_HOLIDAY.includes(item.type)) return false;
      // Itineraries that hinge on shopping or markets are equally pointless.
      if (item.type === 'itinerary' &&
          (item.categories || []).some(c => ['shop', 'market', 'design'].includes(c))) return false;
    }
    return true;
  }

  /* --- how urgently is it about to vanish? --- */

  function urgency(item, today) {
    if (!item.end) return 0;
    const left = daysBetween(today, item.end);
    if (left < 0)  return -999;
    if (left <= 3) return 8;
    if (left <= 7) return 6;
    if (left <= 21) return 3;
    return 0;
  }

  /* --- does it suit the sky? --- */

  function weatherFit(item, mode) {
    if (!mode) return 0;
    const outdoor = item.indoor === false || item.weatherSensitive;
    const indoor  = item.indoor === true;

    if (mode === 'rain') {
      if (item.rainyDayPick) return 9;
      if (indoor) return 6;
      if (outdoor) return -12;
    }
    if (mode === 'fine') {
      if (outdoor) return 6;
      if (indoor) return -2;
    }
    if (mode === 'hot') {
      if (indoor) return 4;
      if (outdoor && /evening|afterwork/.test((item.labels || []).join(' '))) return 3;
      if (outdoor) return -3;
    }
    if (mode === 'cold') {
      if (indoor) return 5;
      if (outdoor) return -5;
    }
    return 0;
  }

  /* --- does it suit the season? --- */

  function seasonOf(dateStr) {
    const m = parse(dateStr).getMonth() + 1;
    if (m <= 2 || m === 12) return 'winter';
    if (m <= 5) return 'spring';
    if (m <= 8) return 'summer';
    return 'autumn';
  }

  function seasonFit(item, dateStr) {
    if (!item.seasonal) return 0;
    return item.seasonal.includes(seasonOf(dateStr)) ? 3 : -6;
  }

  /* --- the main event --- */

  function score(item, ctx) {
    const { today, weatherMode, taste = {}, exploredArrs = [], homeArr = null } = ctx;

    const rating = Store.rating(item.id);
    if (rating === 'never') return -Infinity;          // hard exclude

    let s = 0;

    // intrinsic worth
    s += (item.quality    || 3) * 2.2;
    s += (item.uniqueness || 3) * 2.0;

    // How much anybody actually knows about this place. The same ladder
    // the retrieval layer uses, expressed as a penalty against the
    // best-known tier, so the two rankings cannot disagree about whether
    // a researched place beats a name on a map.
    s -= 7 - (Near.AUTHORITY[Near.tierOf(item)] ?? 0);

    // A landmark is not a recommendation — see the note in nearby.js.
    if (item.touristy) s -= 4;

    // proximity — a great thing 15 minutes away beats a great thing an hour
    // away. minutesFromHome is stamped from the *current* location on load.
    //
    // This used to be a straight line that flattened out below ten minutes
    // and was worth at most ten points against a merit term worth twenty.
    // Two consequences, both wrong: nothing separated a place on your street
    // from one three Metro stops away, and no amount of distance could stop
    // an excellent thing across the city outranking a good thing nearby.
    // Near.reach is the same curve the retrieval layer uses, so the two
    // agree about what "close" means.
    s += 14 * Near.reach(item.minutesFromHome ?? 30);

    // price
    const p = item.price ?? 0;
    if (p === 0) s += 5;
    else if (p <= 10) s += 3;
    else if (p <= 20) s += 1.5;
    else if (p > 60)  s -= 2;

    // time pressure
    s += urgency(item, today);
    if (item.bookAhead && item.start && daysBetween(today, item.start) > 0 &&
        daysBetween(today, item.start) <= 45) s += 4;

    // conditions
    s += weatherFit(item, weatherMode);
    s += seasonFit(item, today);

    // suits a couple
    if ((item.goodFor || []).includes('couple')) s += 2;

    // somewhere you have not been — your own arrondissement is not "new"
    if (item.arr && !exploredArrs.includes(item.arr) && item.arr !== homeArr) s += 3;

    // learned taste
    let tasteBump = 0;
    (item.labels || []).forEach(l => { tasteBump += (taste[l] || 0); });
    (item.categories || []).forEach(c => { tasteBump += (taste['cat:' + c] || 0) * 0.6; });
    s += Math.min(10, tasteBump * 0.9);

    // your own verdicts
    if (rating === 'want')  s += 14;
    if (rating === 'loved') s -= 6;    // you know about it — nudge something new forward
    if (rating === 'good')  s -= 10;
    if (rating === 'meh')   s -= 30;

    return s;
  }

  /* --- ranked list with optional filtering --- */

  function rank(items, ctx, filter) {
    return items
      .filter(i => (typeof filter === 'function' ? filter(i) : true))
      .map(i => ({ item: i, s: score(i, ctx) }))
      .filter(x => Number.isFinite(x.s))
      .sort((a, b) => b.s - a.s)
      .map(x => x.item);
  }

  /* --- the display labels --- */

  const LABEL_TEXT = {
    dontmiss:   ['🔥 Don\'t miss', 'hot'],
    hiddengem:  ['💎 Hidden gem', 'gem'],
    free:       ['🆓 Free', 'free'],
    cheap:      ['💶 Cheap', ''],
    explorenew: ['🗺️ Somewhere new', ''],
    afterwork:  ['🌙 After work', ''],
    couple:     ['❤️ Good for two', ''],
    outdoor:    ['🌳 Outdoor', ''],
    indoor:     ['🏛️ Indoor', ''],
    foodmission:['☕ Food mission', ''],
    romantic:   ['🌹 Romantic', ''],
    learn:      ['🎓 Learn something', ''],
    unusual:    ['🎪 Unusual', ''],
    weekend:    ['📅 Weekend', ''],
    daytrip:    ['🚆 Day trip', ''],
    bookahead:  ['📌 Book ahead', 'soon'],
    closingsoon:['⏳ Closing soon', 'soon']
  };

  /* Open at this moment: true, false, or null when the record does not
     say. Three states on purpose — a section that hides everything it
     cannot read would hide most of the city. */
  function openRightNow(item, when = new Date()) {
    if (!item.hours) return null;
    if (!isOpenOn(item, iso(when))) return false;
    return Hours.isOpen(item.hours, when);
  }

  return { score, rank, isLive, isOpenOn, openRightNow, urgency, daysBetween, iso, parse,
           seasonOf, LABEL_TEXT, HOLIDAYS };
})();
