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
     the chain count, matching a note to a place — compares them flat. */
  const flatten = s => (s || '').toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').trim();

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

  /* ---------- the compact shape ----------

     Three files arrive in it — the OpenStreetMap index, the city's own
     facilities, and the places that are a matter of record. Compact
     because there are fourteen thousand of them and every byte ships to
     the browser; one shape because to everything downstream they are the
     same kind of thing. */

  function fromCompact(p) {
    return {
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
      goodFor: [], labels: [],

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
    };
  }

  /* One place, listed by two sources, is still one place. Matched on name
     and position rather than id, because the three files round their
     coordinates from different originals and so disagree in the last
     decimal. 250 m is wide enough to catch a market that moved down the
     street and narrow enough not to merge two branches of a chain. */
  function dropDuplicates(pool, winners) {
    if (!winners.length) return pool;
    const claimed = new Map();
    winners.forEach(w => {
      const k = flatten(w.title);
      if (!claimed.has(k)) claimed.set(k, []);
      claimed.get(k).push(w.coords);
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
    const curatedNames = new Set(
      [].concat(D.events?.items || [], D.places?.items || [], D.nightlife?.items || [],
                D.sports?.items || [], D.food?.items || [])
        .map(i => flatten(i.title)));

    let found = (D.discovered?.items || [])
      .filter(p => !curatedNames.has(flatten(p.n)))
      .map(fromCompact);

    /* The middle tier: what the city and the record say. Two files, one
       shape, because to everything downstream they are the same kind of
       thing — a real place with a factual line and a source behind it. */
    const sourced = []
      .concat((D.civic?.items || []).map(p => Object.assign(fromCompact(p), {
        provenance: 'sourced',
        source: 'Ville de Paris — opendata.paris.fr',
        lastVerified: D.civic?.generated || null
      })))
      .concat((D.notable?.items || []).map(p => Object.assign(fromCompact(p), {
        provenance: 'sourced',
        source: p.src || 'Wikipedia',
        lastVerified: D.notable?.generated || null,
        touristy: !!p.landmark
      })));

    /* Editorial records are written in full rather than compacted — they
       are prose, and there are only a couple of hundred of them. */
    const written = (D.editorial?.items || []).map(i =>
      Object.assign({ provenance: 'editorial' }, i));

    /* What the city says is on. Already in the full shape — scripts/
       events.mjs writes it that way — so it only needs its tier stating.
       These sit in `all` rather than the discovered layer because they
       are dated things to do, not places, and the expiry filter below is
       the whole reason the section cannot go stale. */
    const cityEvents = (D['events-city']?.items || []).map(i =>
      Object.assign({ provenance: 'sourced' }, i));

    /* Where a place exists in more than one layer, the one that knows most
       about it wins and the others are dropped — otherwise Marché Monge
       appears three times, once per source, which reads as a bug because
       it is one. */
    const discovered = sourced.concat(dropDuplicates(found, sourced.concat(written)));

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

  return { flatten, compactId, fromCompact, dropDuplicates, applyNotes, build };
})();
