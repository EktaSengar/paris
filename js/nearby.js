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
     about which places are good. On top of it sits authority: how much
     anybody actually knows about this place.

     Four tiers, because "curated or not" was too blunt a question. The
     gap between somebody having stood in a shop and a name existing on a
     map is real, but so are the two states in between — a place with a
     verifiable distinction, and a place somebody researched and argued
     for without going. Collapsing those into "not curated" is what left
     the 5th ranked by walking time.

       personal   you went, you wrote it up
       editorial  researched and argued for, nobody visited
       sourced    a verifiable distinction — article, listing, award
       found      a name and a position, and no claim beyond that

     Authority is multiplied by reach along with everything else, and
     that is the whole point: knowing more about a place makes it worth
     more, but it does not make it closer. A café somebody loved in the
     3rd stays a café in the 3rd when you are standing in the 5th. */

  const AUTHORITY = {
    personal:  7,
    editorial: 5,
    sourced:   4,
    found:     0
  };

  /* Records predating the tiers say only whether they were discovered. */
  const tierOf = i => i.provenance || (i.discovered ? 'found' : 'personal');

  /* ---------- how well attested is this? ----------

     Every `found` record used to score identically: quality 3,
     uniqueness 2, both invented by the loader because OpenStreetMap does
     not rate anything. Fourteen thousand places tied on merit, separated
     only by distance — which is how an anonymous counter two minutes
     away beat a hundred-year-old boulangerie six minutes away.

     Nothing here is an opinion or a rating. It counts what somebody has
     bothered to record, which is a different and much weaker claim: a
     place with opening hours, a website, twenty tags and a mapper's
     check last year is being looked after, and one with a name and a
     position is not. That is all this measures, and it is the most the
     data supports.

     Returns 0–1. The weights are deliberately readable rather than
     tuned: if one of them is wrong it should be obvious which. */

  const NOW_YEAR = new Date().getFullYear();

  const SIGNALS = [
    // being open is a fact about the place *and* the strongest sign
    // anybody is maintaining the record
    [3.0, i => !!i.hours],
    [1.0, i => !!i.url],
    [0.5, i => !!i.phone],
    // somebody stood there and said "still here"
    [2.0, i => i.checked && NOW_YEAR - i.checked <= 3],
    [1.0, i => i.checked && NOW_YEAR - i.checked > 3 && NOW_YEAR - i.checked <= 6],
    // or at least touched the record recently
    [1.5, i => i.edited && NOW_YEAR - i.edited <= 2],
    [0.5, i => i.edited && NOW_YEAR - i.edited > 2 && NOW_YEAR - i.edited <= 5],
    // how much is written down at all
    [2.0, i => (i.tags || 0) >= 16],
    [1.0, i => (i.tags || 0) >= 9 && (i.tags || 0) < 16],
    // distinctions OSM occasionally records
    [1.5, i => !!i.noted],
    [1.0, i => !!i.heritage],
    [1.0, i => !!i.artisan],
    [0.5, i => !!i.organic],
    [1.0, i => i.since && i.since < 1980],
    [0.5, i => !!i.why]
  ];

  const SIGNAL_MAX = SIGNALS.reduce((n, [w]) => n + w, 0);

  function evidence(i) {
    let n = 0;
    for (const [weight, test] of SIGNALS) if (test(i)) n += weight;
    return n / SIGNAL_MAX;
  }

  /* Evidence is worth less than the weakest tier above it. A thoroughly
     documented café is still a café nobody has said anything about, and
     it should not outrank a place somebody researched — knowing more
     facts is not the same as knowing whether it is any good. */
  const EVIDENCE_WORTH = 3.5;

  function localScore(i) {
    const merit = (i.quality || 3) * 2.2 + (i.uniqueness || 3) * 2.0;
    const tier  = tierOf(i);
    let auth = AUTHORITY[tier] ?? 0;

    /* Only `found` needs this — the tiers above have been looked at by
       somebody, which is a stronger claim than any of these signals. */
    if (tier === 'found') auth += EVIDENCE_WORTH * evidence(i) - chainPenalty(i);

    /* A landmark is not a recommendation. Somewhere with a Wikipedia
       article and a coach party outside is a fine answer to "what should
       we see" and a poor one to "where should we get coffee", so the
       everyday sections push it down. Set from pageview counts at build
       time, or by hand on an editorial record. */
    if (i.touristy) auth -= 4;

    return Math.max(0.5, merit + auth) * reach(i.minutesFromHome);
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
  const known = i => tierOf(i) !== 'found';

  /* Two conditions, not one.

     Enough places is the obvious one. The second is enough places the
     site can say something about, and it exists because of a case in the
     19th: eight anonymous bakeries within two minutes, and the two the
     guide actually knows about thirteen minutes away. Stopping at the
     first ring that is merely *full* buries them, and hands the reader a
     list of names — which is the complaint this whole layer exists to
     answer.

     So the radius grows until the answer is worth giving, or until the
     rings run out. A quarter with nothing written about it still gets
     the widest ring and an honest heading rather than a wider search
     that would not have helped. */
  function ring(items, rings, want, wantKnown = 0) {
    let fallback = null;
    for (const r of rings) {
      const inside = items.filter(i => mins(i) <= r);
      if (inside.length >= want) {
        if (inside.filter(known).length >= wantKnown) return { items: inside, radius: r };
        fallback = fallback || { items: inside, radius: r };
      }
    }
    const last = rings[rings.length - 1];
    const inside = items.filter(i => mins(i) <= last);
    if (inside.length) return fallback && inside.length < want
      ? fallback : { items: inside, radius: last };
    /* Nothing at all within the widest ring — return what exists rather
       than an empty section, and say so by reporting no radius. */
    return { items: items.slice(), radius: null };
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
    const { rings = RINGS.near, want = 6, wantKnown = 2, limit = 24, exclude = null } = opts;
    const ok = i => match(i) && !(exclude && exclude(i));
    const found = ring(CURATED.filter(ok).concat(FOUND.filter(ok)), rings, want, wantKnown);
    const ranked = dedupe(found.items
      .map(i => ({ i, s: localScore(i) }))
      .sort((a, b) => b.s - a.s)
      .map(x => x.i));
    return { radius: found.radius, items: keepKnown(ranked, limit, wantKnown) };
  }

  /* The ring guarantees that `wantKnown` places the site knows something
     about are *inside* the radius. Nothing guaranteed they survived the
     cut to `limit`, and for most of the site's life nothing had to: there
     were few enough anonymous records nearby that the known ones scored
     their way into the top five on their own.

     Widening the discovery index to 22,635 places ended that. Twice as
     many bare names now sit within a few minutes of anywhere, the best of
     them scores well, and in the 5th, 12th and 19th they filled the whole
     section — burying the two cafés the guide actually has something to
     say about thirteen minutes away. Which is the original complaint this
     layer was built to answer, arriving by a new route.

     So the guarantee is made explicit rather than left to arithmetic: if
     the top `limit` does not contain `wantKnown` records above the `found`
     tier, the best ones that exist are promoted into it, displacing the
     weakest bare names. Everything else keeps its order. This is a
     deliberate editorial thumb on the scale and the whole premise of the
     site — a list of names is what the reader could have got from a map. */
  function keepKnown(ranked, limit, wantKnown) {
    const head = ranked.slice(0, limit);
    if (!wantKnown || head.filter(known).length >= wantKnown) return head;

    const missing = wantKnown - head.filter(known).length;
    const promote = ranked.slice(limit).filter(known).slice(0, missing);
    if (!promote.length) return head;

    /* Drop from the tail, worst first, and only ever bare names. */
    const kept = head.filter(known);
    const bare = head.filter(i => !known(i)).slice(0, Math.max(0, limit - kept.length - promote.length));
    return ranked.filter(i => kept.includes(i) || bare.includes(i) || promote.includes(i));
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

  /* The counterweight to a radius: what is outside it and worth the
     journey anyway, so narrowing a section to your own quarter loses
     nothing — it just moves it somewhere honest.

     The first version of this returned the curated list minus whatever
     happened to be nearby, which from anywhere in Paris is the 10th. It
     gave the same two cafés in the 5th and the 15th, which is the
     original bug wearing a different hat. Three things fix it:

       · anything above `found` may qualify, not only curated records,
         so the 15th can be pointed at Berthillon rather than at the
         10th's bakeries again;
       · one place per arrondissement, so it reads as the best of Paris
         rather than a tour of one postcode;
       · distance still counts a little, so the answer differs depending
         on where the journey would start from. */
  function beyond(match, radius, opts = {}) {
    const { limit = 4, floor = 4, exclude = null } = opts;
    if (radius == null) return [];

    const eligible = i =>
      match(i) && mins(i) > radius && !(exclude && exclude(i)) &&
      tierOf(i) !== 'found' &&
      (i.quality || 0) >= floor && (i.uniqueness || 0) >= floor;

    /* Merit first, then a gentle distance term — gentle because the
       whole premise of this section is that distance is not the point. */
    const worth = i => (i.quality || 0) + (i.uniqueness || 0)
      + (AUTHORITY[tierOf(i)] ?? 0) * 0.3
      - mins(i) / 45;

    const ranked = dedupe(CURATED.concat(FOUND).filter(eligible)
      .map(i => ({ i, s: worth(i) }))
      .sort((a, b) => b.s - a.s)
      .map(x => x.i));

    const perArr = new Set();
    const out = [];
    for (const i of ranked) {
      const key = i.arr ?? `x${out.length}`;      // no arrondissement — never collides
      if (perArr.has(key)) continue;
      perArr.add(key);
      out.push(i);
      if (out.length >= limit) break;
    }
    return out;
  }

  /* Retrieval by area rather than by radius — for the pages that are
     about somewhere else, like the neighbourhood dossier.

     No reach term: the dossier is about an arrondissement, and how far
     away it happens to be from you does not change which café in it is
     the best one. Authority still counts, on the same ladder the rest of
     the file uses — this asked `i.discovered ? 0 : AUTHORITY` for a
     while, which put the lookup *table* into the arithmetic and scored
     every curated record NaN. The dossier ordered itself arbitrarily and
     nothing said so, which is the argument for there being one ladder
     and one way to read it. */
  function inArr(arr, match, limit = 6) {
    const ok = i => i.arr === arr && match(i);
    const worth = i => (i.quality || 3) * 2.2 + (i.uniqueness || 3) * 2.0
      + (AUTHORITY[tierOf(i)] ?? 0) - chainPenalty(i);
    return dedupe(CURATED.filter(ok).concat(FOUND.filter(ok))
      .map(i => ({ i, s: worth(i) }))
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

  return { use, pick, beyond, inArr, reach, localScore, ring, RINGS, KIND, HALF,
           chainPenalty, tierOf, AUTHORITY, evidence, EVIDENCE_WORTH };
})();
