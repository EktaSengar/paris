/* ---------------------------------------------------------
   invaders.js — the city as a board.

   Sport does not have to mean a gym. Invader has been cementing tile
   mosaics to Paris walls since 1998, each with its own code, and finding
   them is the best excuse anyone has invented for walking down a street
   you had no other reason to walk down. That is the same thing the Play
   section is for, so this lives there rather than in a novelty corner.

   What makes it a game rather than a card is that the positions are
   real: js/../data/invaders.json carries what OpenStreetMap knows, so
   "three within a ten-minute walk" is checked, not suggested. Progress
   is yours and stays in this browser, on the same shelf as the quests.

   The honest limit, repeated wherever a count appears: this is what the
   map knows, not what exists. Roughly 1,500 pieces have gone up in
   Paris; a few hundred are mapped and some of those are painted over.
   A hunt claiming completeness would be lying. One that says "here are
   four near you that the map knows about" is telling the truth, and is
   still a good afternoon.
   --------------------------------------------------------- */

const Invaders = (() => {

  const QUEST = 'invaders';          // shares the quest shelf in state.js
  const WALK_KMH = 4.5;              // strolling, stopping to look up

  let ALL = [];

  function use(items) {
    ALL = (items || []).map(p => ({
      code: p.c,
      coords: [p.lat, p.lon],
      arr: p.a,
      street: p.s || null,
      note: p.x || null,
      floor: p.l || null,
      lastSeen: p.v || null,
      /* A code the artist gave it, versus one we made from its position.
         Only the first is worth printing. */
      official: !/^at-/.test(p.c)
    }));
  }

  /* ---------- what you have found ---------- */

  const found = () => Store.questDone(QUEST);
  const isFound = code => found().includes(code);
  const toggle = code => Store.toggleQuest(QUEST, code);

  function progress() {
    const done = found();
    const byArr = {};
    ALL.forEach(i => {
      if (!done.includes(i.code)) return;
      byArr[i.arr] = (byArr[i.arr] || 0) + 1;
    });
    return {
      found: done.length,
      total: ALL.length,
      arrs: Object.keys(byArr).length,
      byArr
    };
  }

  /* ---------- where they are ----------

     Distances are walking distances, because nobody takes the Metro two
     stops to look at a mosaic. That is also why this does not use
     Loc.minutes: that function takes the quicker of walking and transit,
     which is the right answer for a museum and the wrong one here. */

  const walkMin = (from, to) => Math.max(1, Math.round(Loc.km(from, to) / WALK_KMH * 60));

  function stamped() {
    const here = Loc.active();
    if (!here) return [];
    return ALL.map(i => Object.assign({}, i, {
      minutes: walkMin([here.lat, here.lon], i.coords),
      km: Loc.km([here.lat, here.lon], i.coords)
    }));
  }

  /* Nearest first, optionally only the ones you have not found yet. */
  function nearby({ limit = 6, within = null, includeFound = false } = {}) {
    const done = found();
    return stamped()
      .filter(i => includeFound || !done.includes(i.code))
      .filter(i => within == null || i.minutes <= within)
      .sort((a, b) => a.minutes - b.minutes)
      .slice(0, limit);
  }

  function inArr(arr, { includeFound = false } = {}) {
    const done = found();
    return stamped()
      .filter(i => i.arr === arr && (includeFound || !done.includes(i.code)))
      .sort((a, b) => a.minutes - b.minutes);
  }

  /* ---------- a route ----------

     Nearest-neighbour from where you are standing. Not the shortest
     possible loop — that is a travelling-salesman problem and nobody
     walking around Belleville cares about the optimum — but it does stop
     the list zig-zagging across the same three streets, which a plain
     distance sort does constantly.

     Returns the order, the walking distance, and how long it takes at a
     pace that assumes you stop and look up. */
  function route(pool, count) {
    const here = Loc.active();
    if (!here || !pool.length) return { stops: [], km: 0, minutes: 0 };

    const left = pool.slice();
    const stops = [];
    let at = [here.lat, here.lon];
    let total = 0;

    while (stops.length < count && left.length) {
      let best = 0, bd = Infinity;
      left.forEach((i, n) => {
        const d = Loc.km(at, i.coords);
        if (d < bd) { bd = d; best = n; }
      });
      const next = left.splice(best, 1)[0];
      total += bd;
      stops.push(Object.assign({}, next, { leg: Math.max(1, Math.round(bd / WALK_KMH * 60)) }));
      at = next.coords;
    }

    return {
      stops,
      km: Math.round(total * 10) / 10,
      /* Walking time plus a couple of minutes per stop for the finding,
         the photographing and the looking up at the wrong wall. */
      minutes: Math.round(total / WALK_KMH * 60) + stops.length * 3
    };
  }

  /* ---------- the missions ----------

     Three, deliberately: one you can do before dinner, one that fills a
     Saturday, and one whose real subject is an arrondissement you have
     been neglecting. Each is generated against where you are actually
     standing and what you have actually found, so none of them can ask
     for something that is not there. A mission that cannot be filled is
     not offered.

     `exploredArrs` comes from the same store the arrondissement quest
     uses, so "somewhere you have barely been" means the same thing here
     as it does everywhere else on the site. */

  function missions({ exploredArrs = [], homeArr = null } = {}) {
    const out = [];
    const pool = nearby({ limit: 60, within: 45 });

    const quick = route(pool, 3);
    if (quick.stops.length === 3) out.push({
      id: 'invaders-quick',
      emoji: '🎯',
      title: '30-minute mission',
      line: 'Three of them, and back before the kettle cools.',
      stops: quick.stops, km: quick.km, minutes: quick.minutes,
      arr: quick.stops[0].arr
    });

    const long = route(pool, 10);
    if (long.stops.length >= 8) out.push({
      id: 'invaders-weekend',
      emoji: '🚶',
      title: 'Weekend mission',
      line: 'Ten of them, on foot, through whatever the walk goes through.',
      stops: long.stops, km: long.km, minutes: long.minutes,
      arr: long.stops[0].arr
    });

    /* The one that is really about the arrondissement. Pick the quarter
       with enough unfound mosaics that you have spent the least time in,
       preferring somewhere you have not ticked off at all. */
    const counts = {};
    stamped().filter(i => !found().includes(i.code))
      .forEach(i => { if (i.arr) (counts[i.arr] = counts[i.arr] || []).push(i); });

    const candidates = Object.entries(counts)
      .filter(([arr, list]) => list.length >= 5 && Number(arr) !== homeArr)
      .sort((a, b) => {
        const seenA = exploredArrs.includes(Number(a[0])) ? 1 : 0;
        const seenB = exploredArrs.includes(Number(b[0])) ? 1 : 0;
        if (seenA !== seenB) return seenA - seenB;      // unvisited first
        return b[1].length - a[1].length;               // then the richest
      });

    if (candidates.length) {
      const [arr, list] = candidates[0];
      const r = route(list, 5);
      out.push({
        id: 'invaders-newarr',
        emoji: '🗺️',
        title: `Explore the ${arr}${arr === '1' ? 'st' : 'e'}`,
        line: exploredArrs.includes(Number(arr))
          ? 'You have been, barely. Five of them are a reason to go back properly.'
          : 'Somewhere you have not been. Five mosaics are as good a reason as any.',
        stops: r.stops, km: r.km, minutes: r.minutes,
        arr: Number(arr),
        newArr: !exploredArrs.includes(Number(arr))
      });
    }

    return out;
  }

  return { use, nearby, inArr, route, missions, progress, found, isFound, toggle, walkMin, QUEST };
})();
