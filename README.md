# Paris for You

A personal Paris exploration guide for Ekta & Kartik.

**Live at → https://ektasengar.github.io/paris/**

It answers one question every time you open it: *what is something interesting
we could do next?* Not an events listing — a ranked, weather-aware, date-aware
set of suggestions built around wherever you happen to be standing.

---

## How it works

Static site. No build step, no framework, no backend, no API keys, no accounts.
A handful of JavaScript files and some JSON.

```
index.html
css/style.css
js/
  location.js   where you are exploring from — position, not stored distances
  nearby.js     retrieval: which places exist within reach of that position
  state.js      what the site remembers about you (localStorage only)
  weather.js    Open-Meteo — no key, no account, coordinates rounded to the neighbourhood
  scoring.js    the ranking engine — is this good today
  app.js        loading and rendering
data/
  events.json         time-sensitive; expires and is pruned automatically
  places.json         cafés, bakeries, markets, shops, museums, parks, classes
  nightlife.json      jazz rooms, live venues, clubs and bars
  sports.json         play vs watch — activities, venues, running routes
  food.json           food missions: a brief, three candidates, what to order
  itineraries.json    ready-made routes — the "start here, then walk there" layer
  daytrips.json       reachable from Gare du Nord / Gare de l'Est
  neighborhoods.json  all 20 arrondissement profiles
  quests.json         long-running exploration goals
  home.json           the default location, on first visit only
  discovered.json     ~14k Paris places from OpenStreetMap — coverage, not opinion
scripts/
  discover.mjs  build the Paris-wide index from OpenStreetMap
  geocode.mjs   give every curated record real coordinates
  relocate.mjs  (legacy) rewrite stored distances for a new home
  refresh.mjs   prune + validate; run daily by CI
  images.mjs    resolve one openly-licensed photo per card
  version.mjs   content-hash the CSS/JS URLs so caches cannot go stale
  serve.mjs     local preview server
```

### Caching

GitHub Pages serves assets with `cache-control: max-age=600`. Without
cache-busting, deploying a change means that for the next ten minutes a
returning browser can pair the **new** `index.html` with the **old** cached
`style.css` and `app.js` — which looks like a half-broken page: tabs with no
spacing, views that say "nothing here" because the cached script has never
heard of them.

`scripts/version.mjs` stamps every local CSS/JS link with a hash of that
file's contents, so a changed file always gets a new URL and an unchanged one
stays cached. **Run it after touching anything in `css/` or `js/`** — CI runs
it too, as a backstop:

```bash
node scripts/version.mjs           # restamp
node scripts/version.mjs --check   # fail if stamps are stale
```

### Photographs

Every card carries a picture from Wikimedia Commons, resolved at build time by
`scripts/images.mjs` and baked into the JSON as a plain URL — so the browser
makes no API call and nothing can rate-limit the page.

Small businesses rarely have a freely licensed photograph of their own. Rather
than fake it, those cards borrow a picture of the street or quarter they stand
on, and `imageSubject` records what is genuinely in the frame so the card can
say so in its credit line. Each card names the photographer and the licence.

Two things worth knowing before touching this:

- Only Commons-hosted files are accepted. Anything under `/wikipedia/<lang>/`
  is a local upload, which for museums and festivals is usually a non-free
  logo used under fair use — not ours to republish, and a poor picture anyway.
- Commons renders **only a fixed set of thumbnail widths** — 120, 250, 500,
  960, 1280, 1920. Any other width is a 400. Cards store the 500px variant and
  the browser picks from a `srcset` at render time.

```bash
node scripts/images.mjs           # fill in anything missing
node scripts/images.mjs --force   # re-resolve everything
node scripts/images.mjs --resize  # normalise widths, verifying each
```

### The layouts

One card template repeated eighty times gives no rhythm and no signal about
what you are looking at, and it forces a photograph onto things that have no
good photograph. So format follows content:

| Content | Shape | Why |
|---|---|---|
| Events, exhibitions | image cards | time-bound and genuinely photogenic |
| Food, shops, hidden gems | **text list** | no real photos; read by scanning names and distances |
| Walks and routes | **numbered timeline** | the sequence *is* the content |
| Day trips | **wide editorial** | few, aspirational, real photographs |
| Weekend | **agenda** | it is a plan, not a list |
| Neighbourhood | **dossier** | it is an article |

`imageKind` on each record says whether the photograph is of the subject
itself or only of its street. Only `subject` photos are allowed to take the
hero slot, which is why a café never leads a page with a picture of a road.

A few things have no freely licensed photograph at all. Those get a tinted
placeholder tile at the same aspect ratio, so the grid stays aligned and the
card is visibly a tile rather than a picture — the alternative, inventing a
stock photo, would be worse than admitting there isn't one.

Navigation is seven destinations — Today, Nights, Weekend, Eat, Sport, Explore,
Away. On a phone the bar scrolls, with a fade on the right edge so that reads
as "more this way" rather than as clipped text.
Free, For two and Hidden are *filters*, not places, and live in the filter row.
Quests and Your list are utilities, kept small.

### Sport: play vs watch

Two different questions, so two different interfaces. **Play** leads with a
Sport of the Week (deterministic by ISO week, skips anything already rated),
then "add sport to the week" — four time-budgeted slots rather than a training
plan — then activities filtered by what you actually want out of it (try
something new / casual / group / compete / learn), then running routes.

**Watch** is a dated calendar with a `spectator` field on each fixture,
because a fixture you cannot see is just a date. That field answers "where
should we stand?" — take the Montmartre climb rather than the Champs-Élysées
barriers, go to a gymnastics qualification rather than the final.

### Food missions and subsections

Eat opens with five prominent subsections — Missions, Coffee, Bakeries,
Restaurants, Markets — using the same mode-switch component as Sport's
Play/Watch. The categories are the navigation, not a footer: previously the
only way to find a café was to scroll past every mission to the bottom.

Missions is the default because a mission is more useful than a list.
`food.json` holds them: a brief, a way to judge the result, three candidates
with what to order at each, and where to go afterwards.

Each category subsection follows the Sport of the Week shape — one editorial
pick with a photograph, then the rest as thumbnailed rows, then the quest that
belongs to that category.

### Quests

A checklist is not an achievement, so quests carry a progress ring, a
completion state, and — for the arrondissements — a map. Paris spirals
outward from the 1st like a snail shell, so the twenty dots are laid out on
their real relative positions (spread 30% from the centre, or the 1st through
4th sit on top of each other) with the Seine drawn through. Tapping a dot
marks it, and because progress for that quest is derived from `Store.arrs()`
rather than a separate list, the map, the ring and the Explore tab can never
disagree.

Play and Watch each have their own quest, surfaced inside the Sport section
rather than buried in the Quests tab.

### Pairings

Every card can carry `pairings` — the "what could we do before and after
this?" layer. A recommendation on its own is a listing; a recommendation with
a coffee after it is a plan, which is most of the difference this site is
trying to make.

### Nightlife

Dated concerts live in `events.json`, so they expire on their own. Venues live
in `nightlife.json` and never expire — a jazz club's programme changes nightly,
so the card links to its own calendar rather than pretending to know what is on
in three weeks. That split is why nothing here can go stale: **a date is only
ever written down when it is actually known.**

### The ranking

Nothing is shown in file order. Every candidate is scored against:

- how far it is from where you currently are (a good thing 15 minutes away
  beats a good thing an hour away) — on the same decay curve the retrieval
  layer uses, so "close" means one thing across the whole site
- price, with free and cheap weighted up
- how soon it disappears — things ending within a week get pushed forward
- **today's actual weather**, per day: rain promotes covered passages,
  museums and workshops and demotes anything outdoors; a heatwave promotes
  indoor and evening plans
- **French public holidays** — on Assumption or 1 May the site will not send
  you to a bakery, because the bakery is shut
- season, for things that only make sense in spring or autumn
- intrinsic quality and how unlikely you are to find it yourself
- whether you have already been
- **what you have told it you like** — rate things and the labels you
  favour gradually get weighted up

### Freshness

Every event carries `source`, `url` and `lastVerified`. `scripts/refresh.mjs`
runs each morning via GitHub Actions and deletes anything whose `end` date has
passed, so an expired event cannot survive on the page. It also validates every
record and fails the build rather than shipping a broken one.

The evergreen half of the data — bakeries, parks, walks, day trips — does not
expire, which is why the site is still useful on a quiet week.

---

## Working on it

```bash
node scripts/serve.mjs      # http://localhost:4321
```

```bash
node scripts/refresh.mjs --check    # validate, change nothing
node scripts/refresh.mjs            # prune expired entries + validate
node scripts/refresh.mjs --links    # also check every source URL resolves
```

### Adding something

Add an object to the right file in `data/`. The fields that matter:

| field | meaning |
|---|---|
| `id` | unique, kebab-case |
| `title`, `emoji`, `why` | `why` is the important one — say why *they* would care, not what it is |
| `arr`, `area`, `minutesFromHome` | distance is estimated from the Canal Saint-Martin area |
| `price`, `priceNote` | `price` is a number for ranking; `priceNote` is what gets displayed |
| `start`, `end` | `YYYY-MM-DD`. Anything with a past `end` is deleted automatically |
| `days` | `[0-6]`, 0 = Sunday. Omit if it is open every day |
| `indoor`, `weatherSensitive`, `rainyDayPick` | drives the weather-aware ranking |
| `labels` | drives the badges — see `LABEL_TEXT` in `js/scoring.js` |
| `quality`, `uniqueness` | 1–5, the intrinsic half of the score |
| `url`, `source`, `lastVerified` | required on events |

Then run `node scripts/refresh.mjs --check` before committing.

### Automating collection

`scripts/refresh.mjs` deliberately prunes but does not invent. The extension
point is documented at the bottom of that file. The rule worth keeping: never
write an event without `url`, `source` and `lastVerified`, and resolve
aggregator listings back to the venue's own page before trusting a date.
Paris.fr publishes an open events feed at `opendata.paris.fr`, which is the
city's own data and needs no key.

---

## Location is an input, not an assumption

The site used to be *about* the 10th. Now it starts there and goes wherever
you point it — a different arrondissement, an address, a hotel, or the
browser's own idea of where you are.

**Two layers, deliberately different in kind.**

| | | |
|---|---|---|
| **Curated** | ~180 records | A reason to care, photographs, pairings. The voice. |
| **Discovered** | ~14,000 places | Name, category, position, from OpenStreetMap. No opinion, and the interface never pretends otherwise — cards say *found nearby* and are drawn with a dashed border. |

Curated wins wherever it exists. Discovered fills the gaps, which is what
makes a neighbourhood the catalogue has never visited still have a bakery in
it. Places present in both are de-duplicated by name so the OSM copy never
shadows the one somebody wrote about.

**Distance is computed, not stored.** Every record carries coordinates and
the browser works out the travel time from wherever you currently are. That
one change is what lets the same catalogue serve any location: a stored
distance is only true from one flat.

**Retrieval, not re-sorting.** This is the part that took two goes to get
right, so it is worth stating as an order of operations:

```
where you are  →  how far is worth reaching  →  which places exist in
that reach  →  which of those are any good  →  the section
```

The first version did the second half only: it took the whole catalogue,
recomputed every distance, and re-sorted. That cannot work, and the reason is
almost too simple to see — **re-sorting a list cannot change what is in the
list.** Point the site at the 5th and it still recommended the 10th's cafés,
correctly labelled with their new travel times. Distance was an input to the
ranking when it needed to be an input to the *retrieval*.

`js/nearby.js` is that missing step. Every section that means "near me" asks
it for candidates rather than filtering the catalogue itself, so there is one
definition of what counts as near and one place to change it.

- **The radius is chosen by what is out there**, not by a constant. A ring
  widens (10 → 18 → 30 minutes for everyday things, 25 → 40 → 60 for a night
  out) until it holds enough to be worth printing. A dense quarter answers
  close in; a quiet one has to reach further, and the heading says which
  radius the answer came from.
- **Both layers compete inside the ring.** Merit is the same scale the main
  ranking uses; being written about is worth a fixed premium on top. That
  premium is multiplied by the same distance decay as everything else, which
  is the whole trick: *being written about makes a place worth more, it does
  not make it closer.*
- **Chains are demoted from the data itself.** OSM records the fortieth branch
  of a coffee chain as enthusiastically as the one good café on the street. A
  name that appears all over the city is a chain — derivable from the shipped
  file, so there is no hand-maintained list to rot.
- **Nothing is lost to the radius.** What falls outside it and is genuinely
  excellent moves to *Worth the trip*, which is where the 10th's classics go
  when you are standing in the 15th.

**Around You vs worth going further.** Proximity decides the first; quality
decides the second. Events get three tiers, because an exceptional thing an
hour away still belongs on the page while an ordinary one does not.

**Privacy.** Type a street address and the site says *5ᵉ · Latin Quarter*.
The precise coordinates stay in this browser for the arithmetic, the weather
lookup is rounded to ~1 km, and the exact address is never rendered.

**Debug.** Append `?debug=1` for the current location, coordinates, detected
arrondissement, how many candidates fall inside each radius, and — the part
worth having — the names the retrieval layer actually returns per category
with the radius it settled on. Two locations that produce the same three names
have not really moved, whatever the distances say.

```bash
node scripts/discover.mjs                    # rebuild the Paris-wide index
node scripts/discover.mjs --only restaurant  # one category
node scripts/geocode.mjs                     # place the curated records
```

Two things worth knowing before touching the discovery script: `overpass.osm.ch`
looks like a mirror and is a **Switzerland-only** extract that answers 200 with
zero elements, and Overpass returns **429** under load — the first version of
this read both as "Paris has no restaurants". Empty answers are now retried
rather than believed.

## Moving house (legacy)

The whole guide is measured from one flat — "six minutes from your door",
"twenty minutes up line 5". Two different things encode that, and only one of
them can be automated:

- **Numbers.** `minutesFromHome` on every record. Computed, and `relocate.mjs`
  recomputes all of them from the new coordinates.
- **Prose.** Sentences like *"nine minutes from your flat"* written into `why`,
  `transit` and `pairings`. Not computable — but the script finds every one and
  prints the list, so a human rewrites the sixty that matter rather than
  re-reading two hundred records.

```bash
node scripts/relocate.mjs --audit                        # list the prose only
node scripts/relocate.mjs --where "Rue Oberkampf, Paris" --dry   # preview
node scripts/relocate.mjs --where "Rue Oberkampf, Paris"         # do it
```

Geocoding is OpenStreetMap's Nominatim — no key, no account, one request.
Travel times are estimated from arrondissement centroids with a walk-or-Metro
model, so they are honest approximations rather than routing: anything outside
Paris proper (day trips, Saint-Denis) has no arrondissement and is deliberately
left alone, because its journey depends on which station you are now nearest —
exactly the thing that changes when you move.

`data/home.json` drives the footer, the weather lookup, the home dot on the
arrondissement map, and the "somewhere you have not been" bonus in the ranking
— nothing hard-codes the 10th any more.

**What relocation cannot do.** Recomputing distances re-ranks the catalogue; it
does not re-curate it. This script predates `nearby.js` and only ever solved
the arithmetic — it is kept for permanently moving house, where the stored
numbers and the prose both genuinely need rewriting. Temporarily exploring from
somewhere else does not go through it at all: the retrieval layer handles that
in the browser, without touching the data files.

The curated dataset is still 10th-heavy, and always will be, because it is a
record of where two people have actually been. What changed is that this no
longer determines what the site recommends:

| | before | after |
|---|---|---|
| Curated cafés within 15 min of the rue Mouffetard | 1 | 1 |
| Cafés the Eat tab offers there | 5, all of them in the 10th/11th/3rd | 24, in the 5th |

The second row is the fix. The first row is why the discovered layer exists.

So a real relocation is three jobs, in order of how much of it is a machine's:

1. `relocate.mjs` — distances and the home arrondissement. Automated.
2. `--audit` — the sixty-one sentences naming the old home. Human, but listed.
3. Re-curation — finding the bakeries, bars and runs of the new
   neighbourhood. Research, and still the reason the guide is worth anything —
   but no longer the difference between the site working and not working.

## Privacy

No exact address is in this repository or sent anywhere. Distances are
estimated from the neighbourhood, and the weather request uses coordinates
rounded to two decimal places — roughly a kilometre. Ratings, saved places,
quest progress and your theme choice are stored in your browser's localStorage
and are never transmitted. There is no analytics, no tracking and no login.

## Appearance

Light by default, deliberately — it reads like paper and suits the thing better
than a dark interface. The site does **not** follow the operating system's dark
mode; the moon button in the header switches to a warm dark theme and the choice
is remembered. An inline script in `<head>` applies a saved dark preference
before first paint so it never flashes light on the way in.
