/* ---------------------------------------------------------
   nearby.js — candidate retrieval.

   The missing step. The catalogue is a list of places in Paris; it is
   not an answer to "what is near me". This turns one into the other.

   The order matters, and it is this:

     where you are → how far is worth reaching → which places exist
     in that reach → which of those are any good

   Not: take the whole catalogue, recompute the distances, re-sort. That
   second order is what the site used to do, and it is why moving to the
   5th still recommended the 10th's cafés with new numbers next to them.
   Re-sorting a list cannot change what is in the list.

   Two layers go in and one list comes out. Curated records carry the
   judgement — a reason, a photograph, something to order. Discovered
   records carry the coverage — fourteen thousand positions from
   OpenStreetMap, so a quarter the catalogue has never visited still has
   a bakery in it. Which layer wins is decided per location by the
   arithmetic below, not by which file the record lives in.
   --------------------------------------------------------- */

const Near = (() => {

  let CURATED = [], FOUND = [];

  /* ---------- telling a café from a branch of one ----------

     OpenStreetMap records the fortieth outlet of a coffee chain with
     exactly the same enthusiasm as the one good café on the street, and
     nothing in the data says which is which. But a name that appears all
     over the city is a chain, and that is derivable from the file itself
     rather than from a list somebody has to keep up to date. Demoted, not
     dropped: some chains are perfectly good bakeries, and a reader in a
     quiet quarter would rather be told about one than about nothing. */

  const CHAIN_AT = 3;
  let outlets = new Map();

  const nameKey = s => (s || '').toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').trim();

  function chainPenalty(i) {
    if (!i.discovered) return 0;                 // a curated chain is there on purpose
    const n = outlets.get(nameKey(i.title)) || 1;
    if (i.branded && n < CHAIN_AT) return 1.5;   // OSM says branch, the city has one or two
    return n < CHAIN_AT ? 0 : Math.min(5, 1.5 + Math.log2(n));
  }

  /* Called once, after both layers are loaded and stamped with distances. */
  function use(curated, discovered) {
    CURATED = curated;
    FOUND = discovered;
    outlets = new Map();
    FOUND.forEach(i => {
      const k = nameKey(i.title);
      outlets.set(k, (outlets.get(k) || 0) + 1);
    });
  }

  /* ---------- how much distance costs ----------

     A smooth decay rather than a cliff, so a place does not become
     worthless one minute past a boundary. HALF is the honest knob: the
     travel time at which something counts for half of what it would
     count for on your doorstep. Twelve minutes is about the point where
     "I'll pop out" turns into "let's make a trip of it". */

  const HALF = 12;
  const reach = m => 1 / (1 + Math.pow((m ?? 60) / HALF, 2));

  /* ---------- what a candidate is worth, here ----------

     Merit is the same scale the main ranking uses, so the two agree
     about which places are good. Authority is the premium for somebody
     having written a reason down.

     Authority is multiplied by reach along with everything else, and
     that is the whole point: being written about makes a place worth
     more, but it does not make it closer. A café somebody loved in the
     3rd stays a café in the 3rd when you are standing in the 5th. */

  const AUTHORITY = 7;

  function localScore(i) {
    const merit = (i.quality || 3) * 2.2 + (i.uniqueness || 3) * 2.0;
    /* OSM records vary from a maintained business listing to a name
       somebody dropped on a map in 2011. A website is the one signal in
       the data that separates them, and it is worth about that much. */
    const kept = i.discovered
      ? (i.url ? 1 : 0) + (i.noted ? 2 : 0) - chainPenalty(i)
      : AUTHORITY;
    return Math.max(0.5, merit + kept) * reach(i.minutesFromHome);
  }

  /* ---------- how far to reach ----------

     The radius is chosen by what is actually out there rather than by a
     constant. A dense quarter answers inside ten minutes; a quiet one
     has to reach further before it has anything to say. Sections pass
     the ring set that suits them: you walk to a bakery and you cross
     town for a concert. */

  const RINGS = {
    walk: [10, 18, 30],     // bakeries, cafés, markets — dense everywhere
    near: [15, 25, 40],     // the default: parks, museums, shops
    out:  [25, 40, 60]      // nightlife, sport, routes — worth a journey
  };

  const mins = i => i.minutesFromHome ?? 999;

  function ring(items, rings, want) {
    for (const r of rings) {
      const inside = items.filter(i => mins(i) <= r);
      if (inside.length >= want) return { items: inside, radius: r };
    }
    const last = rings[rings.length - 1];
    const inside = items.filter(i => mins(i) <= last);
    /* Nothing at all within the widest ring — return what exists rather
       than an empty section, and say so by reporting no radius. */
    return inside.length ? { items: inside, radius: last }
                         : { items: items.slice(), radius: null };
  }

  /* ---------- the pipeline ----------

     match    what kind of thing you are asking for
     rings    how far you are willing to go, in order of preference
     want     how many answers make a section worth printing
     exclude  anything the reader has ruled out

     Returns the list *and* the radius it had to use, because a heading
     that says "within about 10 minutes" is only honest if it is the
     radius the answer actually came from. */

  function pick(match, opts = {}) {
    const { rings = RINGS.near, want = 6, limit = 24, exclude = null } = opts;
    const ok = i => match(i) && !(exclude && exclude(i));
    const found = ring(CURATED.filter(ok).concat(FOUND.filter(ok)), rings, want);
    return {
      radius: found.radius,
      items: dedupe(found.items
        .map(i => ({ i, s: localScore(i) }))
        .sort((a, b) => b.s - a.s)
        .map(x => x.i)).slice(0, limit)
    };
  }

  /* One market that runs the length of a street is several nodes in OSM,
     and the build-time de-duplication only catches the ones that round to
     the same coordinates. Two entries with the same name a hundred metres
     apart are one place as far as a reader is concerned, so the list keeps
     the better-scoring of them and drops the rest. */
  function dedupe(items) {
    const seen = new Set();
    return items.filter(i => {
      const k = nameKey(i.title);
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  /* The counterweight to a radius. Curated only, outside the ring, and
     only the things good enough that the journey is the point — so that
     narrowing a section to your own neighbourhood loses nothing, it just
     moves it somewhere honest. */
  function beyond(match, radius, opts = {}) {
    const { limit = 4, floor = 4, exclude = null } = opts;
    if (radius == null) return [];
    return CURATED
      .filter(i => match(i) && mins(i) > radius && !(exclude && exclude(i)) &&
                   (i.quality || 0) >= floor && (i.uniqueness || 0) >= floor)
      .sort((a, b) => ((b.quality || 0) + (b.uniqueness || 0)) -
                      ((a.quality || 0) + (a.uniqueness || 0)) ||
                      mins(a) - mins(b))
      .slice(0, limit);
  }

  /* Retrieval by area rather than by radius — for the pages that are
     about somewhere else, like the neighbourhood dossier. */
  function inArr(arr, match, limit = 6) {
    const ok = i => i.arr === arr && match(i);
    return dedupe(CURATED.filter(ok).concat(FOUND.filter(ok))
      .map(i => ({ i, s: (i.quality || 3) * 2.2 + (i.uniqueness || 3) * 2.0 +
                         (i.discovered ? 0 : AUTHORITY) - chainPenalty(i) }))
      .sort((a, b) => b.s - a.s)
      .map(x => x.i)).slice(0, limit);
  }

  /* ---------- what counts as what ----------

     One definition, shared by every section that asks for a kind of
     place, so "a café" cannot mean two different things in two views.
     The curated files use narrow types; OSM uses its own. Both map here. */

  const KIND = {
    bakery:     i => i.type === 'bakery',
    cafe:       i => i.type === 'cafe',
    restaurant: i => i.type === 'restaurant',
    market:     i => i.type === 'market',
    deli:       i => i.type === 'deli',
    park:       i => i.type === 'park' || (i.categories || []).includes('park'),
    museum:     i => ['museum', 'gallery', 'culture'].includes(i.type),
    books:      i => i.type === 'books' || (i.categories || []).includes('books'),
    sport:      i => ['sport', 'play', 'run'].includes(i.type),
    nightlife:  i => ['nightlife', 'bar', 'jazz', 'venue', 'club', 'comedy'].includes(i.type)
  };

  return { use, pick, beyond, inArr, reach, localScore, ring, RINGS, KIND, HALF, chainPenalty };
})();
