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

  /* ---------- what is worth computing twice, and what is not ----------

     The gate below runs over every record the site knows about — around
     twenty-four thousand of them — and it runs again for each section on
     the page. A single tap on Sport spent two seconds in here, and most
     of it went on deriving the same two numbers about the same records
     over and over: `nameKey`, which decomposes a Unicode string, and
     `evidence`, which walks a sixteen-entry table.

     Both are pure functions of fields that never change after the record
     is built, so they are derived once, when the layers are handed over,
     and read from the record afterwards. Nothing about the answer
     changes; it is simply not recomputed twenty times a tap.

     `localScore` is deliberately *not* cached: it multiplies by distance,
     and distance changes whenever the reader moves. */

  function chainPenalty(i) {
    if (!i.discovered) return 0;                 // a curated chain is there on purpose
    if (i._chain !== undefined) return i._chain;
    const n = outlets.get(i._nk ?? nameKey(i.title)) || 1;
    const v = (i.branded && n < CHAIN_AT) ? 1.5  // OSM says branch, the city has one or two
            : n < CHAIN_AT ? 0 : Math.min(5, 1.5 + Math.log2(n));
    i._chain = v;
    return v;
  }

  /* Called once, after both layers are loaded and stamped with distances.
     The pass that counts outlets already visits every found record and
     already has its flattened name in hand, so that is where the name
     key is stamped — and where anything derived from a previous set of
     layers is dropped, since the outlet counts it was based on have just
     been recomputed. */
  function use(curated, discovered) {
    CURATED = curated;
    FOUND = discovered;
    outlets = new Map();
    FOUND.forEach(i => {
      const k = i._nk = nameKey(i.title);
      i._chain = undefined;
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
    if (i._ev !== undefined) return i._ev;
    let n = 0;
    for (const [weight, test] of SIGNALS) if (test(i)) n += weight;
    return (i._ev = n / SIGNAL_MAX);
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

  /* ---------- the bar ----------

     The contract this layer answers is "only things worth offering,
     nearest first" — and that is lexicographic, not weighted. Quality
     decides *membership*; distance decides *order*. Something below the
     bar is not shown at any distance, and nothing above it is reordered
     because it happens to be excellent.

     That is a real change from what this file used to do. Merit and
     distance used to be multiplied together, so a superb place across
     the city and a fair one round the corner could trade places
     depending on the arithmetic. Readable, defensible, and not what
     anybody standing on a street corner is asking.

     0.35 is about the top quarter of what OpenStreetMap knows: 6,340 of
     21,880 found records. Below that the record is a name, a position
     and very little else. The number is a judgement and it is meant to
     be adjusted — what is not adjustable is that it stays fixed while
     the radius moves, which is the whole of the locked decision. */

  const BAR = 0.35;

  /* An outlet of something is not a discovery. The chain penalty already
     scales with how many of them the city has; past this it is a brand,
     not a place. */
  const CHAIN_OUT = 3;

  /* Definitely shut — not "we cannot tell". Hours.isOpen returns null for
     a spec outside the subset it reads, and null must never exclude
     anything: more than half of Paris carries no hours at all, and a
     section that hid everything it could not read would hide the city. */
  function shutNow(i, when) {
    if (!i.hours || typeof Hours === 'undefined') return false;
    return Hours.isOpen(i.hours, when) === false;
  }

  function clears(i, when) {
    if (when && shutNow(i, when)) return false;
    /* Somebody looked at it — visited, researched, or a matter of record.
       That is a stronger claim than any count of tags, so these are in. */
    if (tierOf(i) !== 'found') return true;
    if (chainPenalty(i) >= CHAIN_OUT) return false;
    return evidence(i) >= BAR;
  }

  /* ---------- the pipeline, restated ----------

     gate → widen until the *recommendable* answer is worth giving →
     order by distance → hand back the recommendations and the bare names
     as two lists, never one

     `openNow` takes a Date and makes "definitely shut right now" a
     disqualification rather than a demotion. Sections about right now
     pass it; sections about the weekend must not.

     `wantKnown` is half of the fix for the complaint that started this.
     It used to be a flat 2: the ring stopped at the first radius holding
     six *places*, of which only two had to be places anybody had looked
     at — so the other four, and then the other twenty-two, were names off
     the map. Widening until the guide has a section's worth to say costs
     a few minutes of radius and is the difference between a
     recommendation and a directory.

     Four, and not more, because the radius is the price. Measured across
     ten quarters for cafés and bakeries, four settles almost everywhere
     at the middle walking ring; six drags the 12th out to half an hour
     for a coffee, and eight does the same to the 15th and the 16th.
     Reaching further than somebody would walk is its own way of not
     answering the question. */

  function pick(match, opts = {}) {
    const { rings = RINGS.near, want = 6, wantKnown = Math.min(want, 4), limit = 24,
            bare = 6, split = true, exclude = null, openNow = null } = opts;

    const ok = i => match(i) && !(exclude && exclude(i)) && clears(i, openNow);

    /* ---------- do not gate what the rings cannot reach ----------

       `ring` widens through the ring set and stops; nothing outside the
       widest ring is ever returned *except* in one case, which is when
       the widest ring caught nothing at all and returning something far
       away beats returning an empty section.

       So the expensive gate — hours, chain counts, evidence — only ever
       needs to run on what is inside the widest ring. It used to run on
       all twenty-four thousand records to produce a list drawn from the
       few hundred within an hour of the reader, which is the whole of
       why one tap on Sport took two seconds.

       The far case is preserved exactly: if nothing in range survives,
       fall back to the full scan and let `ring` reach for it, which is
       precisely the branch it takes today. */
    const far = rings[rings.length - 1];
    const gate = i => (i.minutesFromHome ?? 999) <= far && ok(i);

    let pool = CURATED.filter(gate).concat(FOUND.filter(gate));
    if (!pool.length) pool = CURATED.filter(ok).concat(FOUND.filter(ok));

    /* The ring counts what survives the gate, not what exists. Widening
       on raw counts would stop at the first ring merely full of places
       that are then all filtered away — an empty section drawn from a
       ten-minute radius, when twenty minutes had the answer. */
    const reached = ring(pool, rings, want, wantKnown);

    /* Membership: the nearest that clear the bar. Order: the same thing,
       which is the point — one sort, and it is distance. Ties go to the
       better-attested record, since two places on the same street corner
       have to be separated by something. */
    const near = dedupe(reached.items.slice().sort((a, b) =>
      (mins(a) - mins(b)) || (localScore(b) - localScore(a))));

/* ---------- two lists, and why they are not one ----------

       A place somebody visited, researched, or can point to a listing for
       is a recommendation. A name and a position off OpenStreetMap is
       coverage — it answers "is there a bakery near me at all", which is
       the reason the discovery layer exists, but not "where should we get
       coffee". Blended and sorted by distance they are indistinguishable,
       and since the city has twenty-two thousand names against a few
       hundred write-ups the names take every row.

       So they come back separate and the page decides how to say it.
       Neither is reordered — both are nearest-first and stay that way.
       The exception is the whole reason the coverage layer exists: where
       the guide has nothing to say about a quarter, the bare names *are*
       the answer, so they become `items` and `vouched` says false. */
    const good = near.filter(known);
    const rest = near.filter(i => !known(i));
    const has  = good.length > 0;

    /* `split: false` for the two callers that are genuinely asking "what
       is nearest", not "what do you suggest" — the assembled local
       mission, whose whole text is that nobody wrote it, and the shops at
       the end of an Invader hunt. Preferring a write-up there would make
       a route claim a doorstep it does not have. */
    if (!split) return {
      radius: reached.radius,
      widened: reached.radius != null && reached.radius > rings[0],
      vouched: has,
      items: near.slice(0, limit),
      found: []
    };

    return {
      radius: reached.radius,
      /* The locked rule is that the bar holds still and the radius moves.
         That is only honest if the page can say when it moved, so the
         fact travels with the answer rather than being inferred from the
         number by each caller. */
      widened: reached.radius != null && reached.radius > rings[0],
      vouched: has,
      items: (has ? good : rest).slice(0, limit),
      found: has ? rest.slice(0, bare) : []
    };
  }

/* Where the promotion rule used to be.

     It guaranteed that the nearest few known records survived the cut to
     `limit`, because twenty-two thousand bare names sit within minutes of
     anywhere and nearest-first handed them every slot. That was a thumb on
     the scale holding up a list whose shape was wrong: two write-ups among
     twenty-two names still reads as twenty-four suggestions. Splitting the
     answer in `pick` removes the need — the recommendations are their own
     list and cannot be crowded out of it.

     Noted because the failure it patched is real, and will look like a new
     bug the next time somebody blends the two layers. */

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
           chainPenalty, tierOf, AUTHORITY, evidence, EVIDENCE_WORTH,
           clears, BAR };
})();
