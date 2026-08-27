/* ---------------------------------------------------------
   record.js — one definition of what a record is.

   Six files arrive in three different shapes and have to end up as one
   kind of thing before anything can rank them. That conversion used to
   exist twice: once in app.js, for the browser, and once in
   check-location.mjs, so the test could build the same two layers the
   site builds.

   Two copies of the same logic is the ordinary kind of duplication. Two
   copies where one of them is the test is a worse kind: the copies had
   already drifted apart on `categories`, which meant the test was
   quietly grading a slightly different site than the one that ships.
   A test that can pass while the site is wrong is the exact failure
   check-location.mjs was written to catch, so it should not be the thing
   committing it.

   So: one module, loaded by the browser as a script and by the Node
   scripts through the same `new Function` shim they already use for
   location.js and nearby.js. If the shape of a record changes it changes
   here, and both sides change with it.
   --------------------------------------------------------- */

const Rec = (() => {

  /* Names arrive accented, capitalised and spaced however their source
     felt like it. Everything that compares two names — de-duplication,
     the chain count, matching a note to a place — compares them flat.

     Memoised, because building the two layers flattens the same twenty
     thousand names three separate times — once to collect the curated
     set, once inside compactId, once more in dropDuplicates — and
     `normalize('NFD')` is the single most expensive thing this file
     does. Seventy thousand Unicode decompositions become twenty
     thousand, and a Map lookup for the rest. The cache is keyed on the
     input and the function is pure, so it cannot change an answer.

     Bounded because it is not: names come from a fixed set of data files
     and top out in the low tens of thousands. */
  const flatCache = new Map();
  const flatten = s => {
    const k = s || '';
    let v = flatCache.get(k);
    if (v === undefined) {
      v = k.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
      if (flatCache.size < 65536) flatCache.set(k, v);
    }
    return v;
  };

  /* The id has to survive the weekly rebuild. An array position does not
     — places come and go and everything after them shifts, which would
     quietly repoint a saved rating, or a handwritten note, at a
     different shop. A name and a position do survive.

     scripts/draft.mjs and scripts/editorial.mjs compute this too. If it
     changes here it changes there, and every existing note id changes
     with it. */
  const compactId = p => 'osm-' + flatten(p.n)
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32)
    + '-' + Math.round(p.lat * 2000) + '-' + Math.round(p.lon * 2000);

  const FOOD = ['cafe', 'bakery', 'restaurant', 'market', 'deli'];

/* ---------- what a kind of place is like ----------

     js/scoring.js marks records on `indoor` and `goodFor`. The curated
     files state them because a person wrote them down; the generated
     tiers cannot, because no such field exists in OpenStreetMap or
     Wikidata. So sourced records were being marked on questions they had
     no way to answer — a park could not earn the fine-weather bonus or
     fill a morning — and came out a median of twelve points behind.
     Widening the weekend pool without this changes nothing at all.

     Nothing here is an opinion: a museum is indoors, that is what a
     museum is. Where a category genuinely varies — a café may have a
     terrace or may not — the field stays unset, because "nobody knows"
     is not "no". Anything the record states for itself wins. */

  const NATURE = {
    park:       { indoor: false, goodFor: ['morning', 'afternoon'] },
    market:     { indoor: false, goodFor: ['morning'] },
    museum:     { indoor: true,  goodFor: ['afternoon'] },
    gallery:    { indoor: true,  goodFor: ['afternoon'] },
    books:      { indoor: true,  goodFor: ['afternoon'] },
    culture:    { indoor: true,  goodFor: ['evening'] },
    nightlife:  { indoor: true,  goodFor: ['evening'] },
    bar:        { indoor: true,  goodFor: ['evening'] },
    jazz:       { indoor: true,  goodFor: ['evening'] },
    club:       { indoor: true,  goodFor: ['evening'] },
    bakery:     { goodFor: ['morning'] },
    deli:       { goodFor: ['morning'] },
    cafe:       { goodFor: ['morning', 'afternoon'] },
    restaurant: { goodFor: ['evening'] }
  };

/* ---------- does it say anything? ----------

     Most sourced records state only that the place is the kind of thing
     it is: "Museum in France.", "City park or garden, run by the City of
     Paris." A weekend built out of those is a directory with a date on it.

     A hand-written list of patterns to strike out rots every time a
     generator changes its wording, so the templates are derived instead:
     count every sentence across the tier, and anything repeated a dozen
     times is a template by demonstration. ("Hours and closures are on the
     city's own page." appears 1,037 times.)

     Length is not used — a bad proxy both ways, since "Arpège is a 3
     Michelin-star French restaurant in Paris." is 65 characters and worth
     crossing town for. Age is the one rescue for a record made entirely
     of templates, because age is the kind of interest people mean by the
     word: open since 1921 counts, established in 2002 does not. */

  const TEMPLATE_AT = 12;
  const HISTORIC_BEFORE = 1950;
  const FOUNDED = /\b(?:established|founded|opened)\s+(\d{4})/i;

  const sentences = why => String(why || '').trim()
    .split(/(?<=\.)\s+/).map(x => x.trim()).filter(Boolean);
/* Digits collapse so the twenty arrondissement variants of "Movie
     theater in Paris 15e Arrondissement" group together. */
/* And everything after "on", because the address is the part that does
     not distinguish one municipal gymnasium from the next — forty-eight of
     them each name a different street. Enumerating French street types
     does not hold: the city writes "bd", "Rte", "Cité", "Rond point", and
     `\b` does not fire after an accented letter. Real prose survives it,
     keeping the half that carries the name. */
  const shape = s => s.toLowerCase()
    .replace(/\d+/g, '#')
    .replace(/\s+(?:on|at)\s+[^.]*\.$/, ' on <somewhere>.');

  /* Memoised for the same reason `flatten` is, a few lines up: `rebuild()`
     runs three times a load — once on the first paint, once when the city
     files land, once when the last shards do — and each pass rebuilds
     every record from scratch. The shapes are a pure function of the
     description, so splitting and normalising the same four thousand
     sentences three times is work with no answer attached to it.

     Bounded, like the other one: descriptions come from a fixed set of
     files and top out in the low thousands. */
  const shapeCache = new Map();
  const shapesOf = why => {
    const k = why || '';
    let v = shapeCache.get(k);
    if (v === undefined) {
      v = sentences(k).map(shape);
      if (shapeCache.size < 32768) shapeCache.set(k, v);
    }
    return v;
  };

  /* Stamps `tells` across a tier. Two passes, because the first record
     cannot know what the thousandth one says. */
  function stampTells(list) {
    /* The shapes are kept from the counting pass rather than recomputed
       in the testing one. Splitting and normalising four thousand
       sentences twice cost about thirty milliseconds of the boot, which
       is the sort of thing §12 of the performance notes exists to stop. */
    const freq = new Map();
    const shapes = list.map(i => {
      const out = shapesOf(i.why);
      out.forEach(k => freq.set(k, (freq.get(k) || 0) + 1));
      return out;
    });

    list.forEach((i, n) => {
      const why = String(i.why || '');
      /* Two ways through, and heritage is deliberately not one of them.
         A listing arrives as uniqueness 5 (see scripts/notable.mjs), and
         letting that alone carry a record admits things like the Immeuble
         du Journal, whose entire description is "A listed building." —
         protected, genuinely historic, and nothing a reader can do with.
         Being old enough to say so in words still counts. */
      i.tells = shapes[n].some(k => (freq.get(k) || 0) < TEMPLATE_AT)
        || ((m => m && +m[1] < HISTORIC_BEFORE)(FOUNDED.exec(why)));
    });
    return list;
  }

/* ---------- not there any more, in the softer sense ----------

     `CLOSED` above drops records that state plainly that they shut. This
     is the weaker claim that matters just as much when proposing somewhere
     to go: "Former cinema in Paris.", "Stade Bergeyre was a former sports
     stadium." Neither says it closed; both are gone.

     Matched on the copula, not on a bare `former` — the Maison de Balzac
     "is a writer's house museum" in the former residence of Balzac, and is
     very much open. */
  const PAST_TENSE = /^\s*former\b|\b(?:is|are)\s+(?:a|an|the)\s+former\b|\bwas\s+(?:a|an|the)\b/i;

  const stillStanding = i => !PAST_TENSE.test(String(i.why || ''));

/* ---------- where a photograph lives ----------

     `i` is a Commons path fragment — `2/29/MG-Paris-Champ_de_Mars.jpg` —
     not a URL: a quarter of the bytes, and it leaves the width out of the
     data so `img()` can cap each slot. `ik: 'c'` means the frame holds
     the surroundings rather than the thing, which `hasRealPhoto` reads to
     decide what may lead a section. Full reasoning in the README, and in
     the performance notes as invariant 14. */

  const COMMONS = 'https://upload.wikimedia.org/wikipedia/commons/thumb/';

  function withPhoto(item, p) {
    if (!p.i) return item;
    const seg = p.i.split('/');
    const file = encodeURIComponent(seg.pop());
    item.image = `${COMMONS}${seg.join('/')}/${file}/500px-${file}`;
    item.imageKind = p.ik === 'c' ? 'context' : 'subject';
    item.imageSubject = p.ik === 'c' ? (p.s || item.area || item.title) : item.title;
    item.imageCredit = 'Wikimedia Commons';
    return item;
  }

  /* ---------- the compact shape ----------

     Three files arrive in it — the OpenStreetMap index, the city's own
     facilities, and the places that are a matter of record. Compact
     because there are fourteen thousand of them and every byte ships to
     the browser; one shape because to everything downstream they are the
     same kind of thing. */

  function fromCompact(p) {
    const kind = NATURE[p.c];
    return withPhoto({
      id: compactId(p),
      title: p.n,
      type: p.c,
      arr: p.a,
      coords: [p.lat, p.lon],
      area: p.s || null,
      url: p.w || null,
      cuisine: p.k || null,
      emoji: p.emoji || null,
      discovered: true,
      /* A record with a factual line has something to say; one without is
         a name and a position, and the interface says so. */
      why: p.why || p.x || '',
      days: p.days || undefined,
      branded: !!p.b, noted: !!p.d,
      heritage: !!p.h, artisan: !!p.r, organic: !!p.o, since: p.y || null,
      /* Anything the generating script did not rate stays at the floor.
         What separates those is distance and the weak signals nearby.js
         reads off the record — never a number invented here. */
      quality: p.q ?? 3,
      uniqueness: p.u ?? 2,
      categories: [FOOD.includes(p.c) ? 'food' : p.c],
      /* Filled in from what kind of place it is. Written out rather than
         spread: `{ ...NATURE[p.c] }` reads better and is twelve times
         slower — measured at 100 ms against 8 ms over 240,000 records —
         and this runs for every one of the twenty-four thousand, three
         times a load. `indoor` stays undefined where a category has no
         honest answer, which is not the same as false. */
      indoor: kind ? kind.indoor : undefined,
      goodFor: (kind && kind.goodFor) || [],
      labels: [],


      /* ---- what the place is actually like ----
         Carried, not interpreted. js/hours.js reads `hours`; the gate in
         js/nearby.js reads the rest. */
      hours: p.oh || null,
      houseNumber: p.hn || null,
      phone: p.ph || null,
      terrace: !!p.os, takeaway: !!p.tk, veg: !!p.vg, step_free: !!p.wc,

      /* ---- and how much anybody has looked at it ----
         `checked` is the year a mapper last confirmed it, `edited` the
         year it was last touched at all, `tags` how many facts the record
         carries. None of them is an opinion, and together they are what
         separates a maintained listing from a name dropped on a map in
         2011. */
      checked: p.cd || null,
      edited: p.m || null,
      tags: p.t || 0
    }, p);
  }

  /* One place, listed by two sources, is still one place. Matched on name
     and position rather than id, because the three files round their
     coordinates from different originals and so disagree in the last
     decimal. 250 m is wide enough to catch a market that moved down the
     street and narrow enough not to merge two branches of a chain. */
/* One record can cover more than one named place: the market on the
     place d'Aligre is the covered Beauvau hall and the open-air market
     beside it, and the record describing both is titled for both. Matching
     the whole title only, it claimed neither name — so the same market
     stood on the page three times, once with a photograph of the hall and
     once of the street.

     A title therefore claims each name it joins with ` + `. Nothing
     looser: `&` is prose in "Kayak & Paddle on the Bassin de la Villette",
     and one name merely *containing* another is usually a real
     distinction — the Ménagerie is inside the Jardin des Plantes. */
  const namesOf = title =>
    [...new Set([flatten(title), ...String(title).split(' + ').map(flatten)])]
      .filter(Boolean);

  /* The same rule turned on a single list: the same name within 250
     metres is the same place, and the first one through the door wins.
     Separate from `dropDuplicates` because there is no winners list to
     compare against — the list is its own. */
  function selfDedupe(list) {
    const claimed = new Map();
    return list.filter(i => {
      const k = flatten(i.title);
      const near = claimed.get(k);
      if (near && near.some(c => c && i.coords && Loc.km(c, i.coords) < 0.25)) return false;
      if (!near) claimed.set(k, []);
      claimed.get(k).push(i.coords);
      return true;
    });
  }

  function dropDuplicates(pool, winners) {
    if (!winners.length) return pool;
    const claimed = new Map();
    winners.forEach(w => {
      namesOf(w.title).forEach(k => {
        if (!claimed.has(k)) claimed.set(k, []);
        claimed.get(k).push(w.coords);
      });
    });
    return pool.filter(p => {
      const near = claimed.get(flatten(p.title));
      if (!near) return true;
      return !near.some(c => c && p.coords && Loc.km(c, p.coords) < 0.25);
    });
  }

  /* ---------- handwritten notes ----------

     The last word, and the only data file a human edits. A note can
     attach to anything with an id — including a place that arrived from
     OpenStreetMap with nothing but a name — and writing a `why` for one
     is what promotes it to somewhere you have actually been.

     Applied after every other layer precisely so it cannot be argued
     with by a rebuild. */

  function applyNotes(notes, all, discovered) {
    if (!notes || !Object.keys(notes).length) return { all, discovered };

    const byId = new Map([...all, ...discovered].map(i => [i.id, i]));
    let hidden = 0;

    for (const [id, note] of Object.entries(notes)) {
      const item = byId.get(id);
      if (!item) { console.warn('note for a place that is not here:', id); continue; }
      if (note.hide) { item.hidden = true; hidden++; continue; }
      Object.assign(item, note);
      /* Writing a reason down is the whole definition of the top tier. */
      if (note.why) item.provenance = 'personal';
    }

    return hidden
      ? { all: all.filter(i => !i.hidden), discovered: discovered.filter(i => !i.hidden) }
      : { all, discovered };
  }

/* ---------- things that are not there any more ----------

     Wikipedia describes a café the same way whether it is serving coffee
     this morning or shut in 1902, and the sourced tier inherits the tone
     along with the coordinates: "The Alcazar d'Été was a café-concert
     which opened in 1860 … and closed in 1914" arrives with a position, a
     category of `cafe` and a good quality score.

     Only a plain statement of closure counts. "Was a" does not — half the
     museums in Paris are described in the past tense because the building
     had an earlier life, and the Maison de Balzac is very much open. */

  const CLOSED = /closed (?:in|down|its doors)\b|became defunct|(?:was|has been|now) demolished|no longer exists|until its closure in/i;

  const stillThere = p => !CLOSED.test(p.why || '');

  /* ---------- the two layers ----------

     Everything above, in the order the layers have to be built in.
     `D` is the loaded data files keyed by name; `todayISO` is what
     counts as expired. Out come the two lists Near.use() wants.

     The order is not arbitrary. Curated names are collected first so the
     OSM copy of a place somebody wrote up loses to the write-up. The
     sourced tier is assembled before de-duplication so it can win against
     the bare OSM record of the same shop. Notes are applied last, after
     every generated layer, so a rebuild cannot argue with them. */

  function build(D, todayISO) {
    /* The same shop often exists in both layers. Ours wins — it has a
       reason attached — so the OSM copy is dropped rather than competing
       with itself under the same name. */
    const curated = [].concat(D.events?.items || [], D.places?.items || [],
      D.nightlife?.items || [], D.sports?.items || [], D.food?.items || []);

    const curatedNames = new Set(curated.flatMap(i => namesOf(i.title)));

    let found = (D.discovered?.items || [])
      .filter(p => !curatedNames.has(flatten(p.n)))
      .map(fromCompact);

    /* The middle tier: what the city and the record say. Two files, one
       shape, because to everything downstream they are the same kind of
       thing — a real place with a factual line and a source behind it.

       The record goes first, and the order is the tie-break. Both files
       describe the Jardin Atlantique and the Musée Zadkine, and they do
       not describe them equally: the city's line is the same sentence it
       gives every entry — "City park or garden, run by the City of Paris.
       Hours and closures vary." — while Wikipedia's is about that
       particular garden. Where two records are the same place, the one
       that says something is the one to keep.

       Checked rather than assumed, across all 39 overlapping pairs: the
       city's copy is never the only one with a photograph, and never the
       only one carrying opening days. So this drops nothing but the
       repetition. */
    const sourced = []
      .concat((D.notable?.items || []).filter(stillThere).map(p => Object.assign(fromCompact(p), {
        provenance: 'sourced',
        source: p.src || 'Wikipedia',
        lastVerified: D.notable?.generated || null,
        touristy: !!p.landmark
      })))
      .concat((D.civic?.items || []).map(p => Object.assign(fromCompact(p), {
        provenance: 'sourced',
        source: 'Ville de Paris — opendata.paris.fr',
        lastVerified: D.civic?.generated || null
      })));

    /* Which of them says anything beyond its own category. Stamped here
       rather than inside `fromCompact`, because the test is what a
       sentence's frequency is across the whole tier and the first record
       cannot know what the thousandth one says. */
    stampTells(sourced);

    /* Editorial records are written in full rather than compacted — they
       are prose, and there are only a couple of hundred of them. */
    const written = (D.editorial?.items || []).map(i =>
      withPhoto(Object.assign({ provenance: 'editorial' }, i), i));

    /* What the city says is on. Already in the full shape — scripts/
       events.mjs writes it that way — so it only needs its tier stating.
       These sit in `all` rather than the discovered layer because they
       are dated things to do, not places, and the expiry filter below is
       the whole reason the section cannot go stale. */
    const cityEvents = (D['events-city']?.items || []).map(i =>
      withPhoto(Object.assign({ provenance: 'sourced' }, i), i));

    /* Where a place exists in more than one layer, the one that knows most
       about it wins and the others are dropped — otherwise Marché Monge
       appears three times, once per source, which reads as a bug because
       it is one.

       Two passes, not one, and the first of them was missing. The sourced
       tier was concatenated whole and only the OpenStreetMap layer was
       ever filtered, so a place the guide had written up could still
       arrive a second time from the city's open data or from Wikidata —
       and did. The Parc de Belleville was on the page three times, once
       per source. Marché Beauvau stood beside the record that describes
       it, twenty metres and one photograph apart.

       Nothing about the rule changes: the same name, within 250 metres,
       and the better-known record wins. It is simply applied to the layer
       that was skipping it. */
    /* …and against itself, which is where the two city files overlap: the
       same square arrives from the city's open data and from Wikidata,
       and five of them arrive twice from one file alone. `selfDedupe`
       keeps the earlier of any pair, which the ordering above has already
       made the more informative one. */
    const kept = selfDedupe(dropDuplicates(sourced, curated.concat(written)));
    const discovered = kept.concat(
      dropDuplicates(found, kept.concat(written).concat(curated)));

    const all = []
      .concat(written)
      .concat(D.events?.items || [])
      .concat(cityEvents)
      .concat(D.places?.items || [])
      .concat(D.nightlife?.items || [])
      .concat(D.sports?.items || [])
      .concat(D.food?.items || [])
      .concat(D.itineraries?.items || [])
      .concat(D.daytrips?.items || [])
      .filter(i => !(i.end && todayISO && i.end < todayISO));

    /* Everything in the curated files was written by somebody who went.
       Anything arriving from a generated tier states its own provenance. */
    all.forEach(i => { if (!i.provenance) i.provenance = 'personal'; });
    discovered.forEach(i => { if (!i.provenance) i.provenance = 'found'; });

    return applyNotes((D.notes && D.notes.items) || {}, all, discovered);
  }

  return { flatten, compactId, fromCompact, stillStanding, dropDuplicates, applyNotes, build };
})();
