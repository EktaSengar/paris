# Roadmap

Where this site goes next, and why. Written 20 August 2026.

Two things are wanted: a database that actually covers Paris rather than the
10th, and a recommendation engine that only offers things worth offering,
nearest first.

Those pull in opposite directions, and the tension is the point of this
document. The principle the site was built on is *resist the pull toward more
rows; add judgement instead* — and the first half of this plan is unambiguously
more rows. The resolution, applied identically in every phase below:

> **Ingest without judgement. Gate with it.**
>
> Exhaustive underneath, opinionated on the surface. Thirty thousand records
> should make the bar higher, not the page longer. Any phase that puts more
> names in front of a reader has been implemented wrong.

---

## Where it stands today

| layer | records | refreshed | carries judgement |
|---|---|---|---|
| curated (`places`, `food`, `nightlife`, `sports`, …) | ~130 | by hand | yes — somebody went |
| `editorial` | 42 | by hand | yes — researched, never visited |
| `notable` (Wikidata + Wikipedia) | 793 | weekly | facts only |
| `civic` (opendata.paris.fr) | 1,117 | weekly | facts, plus market days and hours |
| `discovered` (OpenStreetMap) | 13,930 | weekly | nothing — names and positions |
| **`events`** | **31** | **pruned, never added** | yes |

The bones are right. The provenance ladder in `js/nearby.js` and the split
between retrieval and ranking are the two decisions worth keeping, and nothing
below replaces them. The problems are narrower than they look.

### The two decisions this plan locks in

**When the gate cannot fill a section, the radius widens and the heading says
so.** Not the bar. A quiet quarter gets *"the nearest four we know anything
about are twenty minutes away"* rather than four anonymous names two minutes
away. `Near.pick` already returns the radius it used; the sections need to
start printing it.

**The city's event feed is ingested whole and shipped gated.** All 2,908 live
records come in; roughly a hundred and fifty reach the page. Same shape as the
places pipeline, for the same reason.

---

## Why OpenStreetMap, and not Google

Asked, and worth writing down, because the obvious answer is wrong for a
specific reason.

**The index is not thin because OpenStreetMap is thin.** Measured against
Overpass on 20 August 2026, for Paris intra-muros:

| | in OpenStreetMap | shipped in `discovered.json` |
|---|---|---|
| restaurants | **10,127** | 5,192 |
| cafés | 2,732 | 1,219 |
| restaurants + cafés + bakeries + bars | 16,382 | ~9,300 |

The whole shipped index — eleven categories — is 13,930, while OSM holds
16,382 in the four food categories alone. Two filters cause that, and both are
ours. `discover.mjs` does not even *ask* Overpass for a restaurant unless it
carries a website or opening hours, so half of them are never fetched; a
second gate in JavaScript then drops 55% of the cafés that do come back. Both
were reasonable defences against shipping a phone book, and both gate in the
wrong place. Removing them is Phase 1, and it roughly doubles the index
without adding a source.

**Google Places is blocked by its licence, not by its quality.** It is
genuinely better at the thing this site lacks — ratings, review counts, price
level, live hours, which is exactly what a quality gate wants. The terms were
read rather than remembered, on 20 August 2026, and they are more specific than
"do not scrape":

- **Maps Platform Terms §3.2.3(a), No Scraping** enumerates the prohibited
  examples, and one of them is copying and saving business names and
  addresses. Another is pre-fetching, storing or re-hosting content outside
  the Services. That is a description of `discovered.json`.
- **§3.2.3(b), No Caching** bars caching at all except where the Service
  Specific Terms expressly allow it.
- For Places, those allowances are exactly two: **place IDs**, cacheable
  indefinitely (General Service Terms §3), and **latitude and longitude**, for
  up to 30 consecutive calendar days (Maps Service Specific Terms §14.3).
  Names, categories, addresses and opening hours are not on the list.

So the blocker is not attribution — it is that a committed file of 14,000
names is the specific thing the terms describe. It would also need a billed API
key, and this site has no backend to keep one in.

*Correcting an earlier draft of this section:* it is **not** true that Places
content must be shown on a Google Map. §14.1 permits use with no map at all,
which is what this site does. The live clause is §14.2, and it runs the other
way — Places content must not be used **alongside a non-Google map**. That is
satisfiable today and forecloses something real: putting these places on a
Leaflet or OSM map, which for a Paris guide is a likely thing to want.

Where Google is legitimately useful is as a **research aid for a human writing
an editorial or personal record** — reading reviews and then writing your own
sentence about a place. What lands in the repo is your sentence, not Google's
content. That is the top of the provenance ladder working as designed, and it
has no licence problem.

Which points at the deeper reason the choice matters less than it looks: the
discovered layer is *defined* as names and positions carrying no opinion.
Swapping its source upgrades the one tier that carries no judgement. What needs
upgrading is the gate — Phase 1's opening hours and evidence score, Phase 1.5's
liveness check, and Phase 4's contract.

---

## Phase 0 — two bugs, first  ·  *done, 20 August 2026*

Neither was large. Both were worth clearing before anything changed the shape
of a record.

`inArr()` in `js/nearby.js` put the `AUTHORITY` **object** into an arithmetic
expression, so every record whose `discovered` flag was false — which is to say
every editorial and hand-written one, the best 95 records the site has — scored
`NaN` and sorted wherever the input order happened to leave it. The
neighbourhood dossier was demoting the guide's own writing in all twenty
arrondissements, and nothing on screen said so. It now reads the same four-tier
ladder as the rest of the file.

`fromCompact` existed twice — `js/app.js` and `scripts/check-location.mjs` —
and the copies had already drifted apart on `categories`. That is the bad kind
of duplication: the test can pass while the site is wrong, which is precisely
the failure `check-location.mjs` was written to catch. The record shape, the
layer assembly and the note-application step now live in `js/record.js`, which
the browser loads as a script and the Node scripts load through
`scripts/shim.mjs`. The same move retired two further copies of the id rule, in
`editorial.mjs` and `draft.mjs` — ids `data/notes.json` is keyed by, where a
one-character drift would have orphaned every note silently.

---

## Phase 1 — stop discarding the most useful field we already fetch  ·  *done, 20 August 2026*

`scripts/discover.mjs` filters cafés and restaurants on `opening_hours` and
then does not store it. Not one of the 13,930 records carries opening hours.
That is why `openNow()` in `js/app.js` is a fiction for everything except civic
markets: the site cannot tell whether the bakery it just recommended is shut,
which is the single most obvious way a recommendation fails a reader standing
on the street.

- Carry `opening_hours`, `phone`, house number, `outdoor_seating`, `takeaway`,
  `diet:*`, `wheelchair` and `check_date`, plus the OSM element timestamp —
  which needs `out center tags meta` rather than `out center tags`.
- Add a parser for the subset of the OSM opening-hours syntax that covers
  Paris in practice, so *open now* and *open late* become real filters rather
  than assumptions.
- Widen the layer list: ice cream, salons de thé, wine bars, music venues,
  climbing and yoga and hammams, record and vintage shops, traiteurs.
- **Drop the ingest-time quality gate** — both halves of it, the one in the
  Overpass query and the one in JavaScript. Requiring a website-or-hours is
  gating in the wrong place: it starves the quiet arrondissements at the
  source, before any part of the site gets a chance to be clever about them.
  Ingest broadly; gate at ranking, in Phase 4.
- Add a computed `evidence` score built from things that can be counted: hours
  present, `check_date` recency, tag density, a Wikidata entry, heritage
  listing, craft, organic, founding year, chain penalty. Nothing invented,
  every point traceable to a tag.

  The invented `q: 3, u: 2` defaults survive, and it is worth being precise
  about why rather than claiming they were removed. They still feed the merit
  term every tier shares, so deleting them would have meant reworking scoring
  in the same change. What has gone is their role as the *only* thing
  separating one found record from another — every one of 22,635 scored
  identically on merit, and evidence is what discriminates now. Retiring them
  properly belongs with Phase 4, which rewrites that arithmetic anyway.

**What actually happened.** The index went from 13,930 places to **22,635**;
restaurants from 5,192 to 10,044, cafés from 1,219 to 2,854. 10,220 records
now carry opening hours, and `js/hours.js` can read 94% of them — measured by
`scripts/check-hours.mjs`, which fails CI below 80%, because a parser that
confidently mis-reads is worse than one that admits it cannot tell. What it
refuses is genuinely refusable: seasonal rules, `sunrise-sunset`, month
selectors. Every entry point returns three states, and "we do not know" is one
of them.

Two things were learned by measuring rather than assuming:

*The hours strings were not worth interning.* The first version put them in a
dictionary with records pointing in by index, on the assumption that a few
hundred distinct strings covered the city. Paris writes 6,972 distinct strings
across 10,220 places — an 8% saving on the field, about 1% of the file, in
exchange for a dictionary that a partial `--only` refresh has to carefully
re-map or it silently repoints half the city at the wrong hours. Removed.

*Doubling the index broke a guarantee nobody had written down.* Twice as many
bare names now sit within a few minutes of anywhere, so in the 5th, 12th and
19th they filled the whole café section and buried the places the guide
actually has something to say about. The ring had always guaranteed that known
places were *inside* the radius; nothing guaranteed they survived the cut to
five. `keepKnown()` in `js/nearby.js` now makes that explicit. It is the
original complaint this layer was built to answer, arriving by a new route,
and `check-location.mjs` caught it.

The file is now 3.3 MB, which moves Phase 3 from "eventually" to "next time
this grows".

## Phase 1.5 — is it still there?

OpenStreetMap cannot answer this, structurally. A café that closed in 2023 sits
on the map until a mapper happens to walk past and edit it, and nothing in the
record says how long it has been since anybody checked. Every other quality
signal is worthless if the shop has gone.

**INSEE's SIRENE** answers it. It is the French business register, published on
data.gouv.fr under Licence Ouverte v2 — no key, no scraping, redistributable.
Every establishment carries its activity code (`56.10A` restaurants, `10.71C`
artisan boulangerie-pâtisserie, `56.30Z` bars) and, the part that matters, its
**cessation date**.

- Pull the Paris extract, filter to the activity codes the site has sections
  for, and match against the index on name and address.
- A match with no cessation date becomes a positive liveness signal, dated —
  *still trading as of last month*, which is a stronger claim than anything
  else in the data.
- A confident match on a *closed* establishment demotes the record hard, or
  drops it. This is the only route the site has to noticing a place has gone.
- Matching will be imperfect — SIRENE records legal entities and OSM records
  shopfronts, and the names differ. Unmatched is not evidence of closure and
  must not be treated as any evidence at all.

Two smaller sources worth the same slot, both permissively licensed: **Overture
Maps** and **Foursquare's open Places** carry per-POI confidence scores and
would fill whatever OSM misses. And the high-signal French lists — the city's
*Meilleure baguette de Paris* winners, Michelin's Bib Gourmand — are a few
hundred names that belong straight in the `sourced` tier. Twenty names that
mean something beat two thousand that do not.

## Phase 2 — events, which is the actual hole

Thirty-one hand-written events, a window closing on 31 October 2026, and a
refresh script that deliberately prunes without adding. This section decays to
empty on its own; it is the one part of the site with a countdown on it.

The city publishes 2,908 live records at `opendata.paris.fr`, keyless, with
coordinates, price, indoor/outdoor, cover image and occurrence times.

- New `scripts/events.mjs`, writing `data/events-city.json` — kept separate
  from the hand-written `events.json` so the curated voice is not drowned by
  volume.
- Records land in the `sourced` tier carrying `url`, `source` and
  `lastVerified`. The existing rule stands: no date is written down unless it
  is actually known.
- Run **daily**. OpenStreetMap is weekly because the city's bakeries do not
  move; its concerts do.
- The hard part is the gate, not the fetch. The feed carries a great deal of
  municipal filler. Require the venue to resolve to a place already in the
  index, allowlist the `univers` categories the site has sections for, and cap
  per category per day.

## Phase 3 — serving a bigger index without a slower first paint

`discovered.json` is already 1.5 MB parsed on every load, and Phase 1 roughly
doubles it. Shard it per arrondissement, fetch the active one and its
neighbours, lazy-load the rest. This keeps the property that matters — location
is an input, so changing it changes what *exists* nearby — while the index
grows underneath it.

## Phase 4 — the recommendation contract  ·  *done, 20 August 2026*

Distance is currently a *scoring term*: `+14 × reach` in `js/scoring.js`, and a
multiplier inside `localScore`. That is a defensible design, and it is not the
one that was asked for. *Only quality results, sorted by distance* is
lexicographic rather than weighted:

1. **Gate** on evidence, open-now and chain. Something below the bar is not
   shown at any distance.
2. **Sort** strictly by minutes, ascending. Ties broken by evidence.
3. If the gate cannot fill the section, widen the ring — and print the radius
   that was actually used. Never quietly lower the bar.

This also finishes separating two rankers that overlapped. `Rank` keeps the
question it is good at — *is this good today*, with weather, urgency and
season, which is a question about events. `Near` is purely *what is around me
that clears the bar*. `beyond()` is unchanged: the labelled escape hatch, and
the one section where distance deliberately does not sort.

**Where the bar sits.** `evidence >= 0.35`, plus a chain cut-off — about the
top quarter of what OpenStreetMap knows, 6,340 of 21,880 found records. Chosen
from the measured distribution rather than picked: within ten minutes of the
10th it leaves 55 cafés, 36 bakeries and 215 restaurants, which is more than
any section needs, while a quiet quarter has to reach further. Anything above
the `found` tier is in regardless — somebody looked at it, which is a stronger
claim than any count of tags.

**Open now is a disqualification, not a demotion** — but only where the record
says so. `Hours.isOpen` returns null for a spec it cannot read, and null never
excludes: more than half the city states no hours, and a section that hid
everything it could not read would hide Paris. The gate is passed a Date by
the sections that are genuinely about this minute, which today means the
"Around you" cards, since those hand you directions to a named shop.

Two things learned in the doing:

*The known-guarantee and the distance sort had to be separated.* `keepKnown()`
decides membership; the distance sort decides order. It filters an
already-ordered list rather than resorting it, so a promoted record lands
wherever its own walk puts it and "nearest first" stays literally true of
whatever comes out.

*At `limit: 1` the guarantee decides everything.* The "Around you" cards ask
for one place per category, so a `wantKnown` of 1 means the guide's own record
wins over a gated bare name a minute closer. That is right — one card per
category is the site speaking rather than listing — but it was arriving as an
accident of a default, and it is now written down at the call site. It costs
something worth recording: the curated files carry no opening hours, so a known
record almost always answers "we cannot tell" to the open-now gate and sails
through it. The gate bites hardest on found records. That is the safe way
round, and it is an argument for carrying hours on the written-up places too.

## Phase 5 — guardrails

`scripts/check-location.mjs` already asserts that every arrondissement gets
results the site knows something about. Extend it to assert the **gated** set
is non-empty for every category in every arrondissement.

That one test is what turns "exhaustive" from an aspiration into something CI
can fail on.

---

## Order of work

Smallest risk first, and each step shippable on its own.

1. ~~**Phase 0** — the two bugs.~~ Done.
2. ~~**Phase 1** — hours, wider layers, computed evidence.~~ Done.
3. **Phase 1.5** — SIRENE liveness. Feeds the same `evidence` score, and the
   index it has to match against is the wider one Phase 1 produces.
4. ~~**Phase 4** — gate-then-distance.~~ Done.
5. **Phase 2** — events. Independent of all of the above, and now the oldest
   outstanding problem: the section still decays to empty on its own.
6. **Phase 3** — sharding. The index is 3.3 MB. Due.

Phases 1 and 4 are the pair that delivers what was asked for. Phase 2 is the
one that stops an existing section from quietly dying.
