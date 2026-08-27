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
  hours.js      reads the OpenStreetMap opening-hours syntax — and says so
                when it cannot, rather than guessing
  record.js     what a record is, and how the data files stack into two
                layers — shared with the tests so they cannot disagree
  invaders.js   the mosaic hunt: what is near you, routed missions, progress
  nearby.js     retrieval and the provenance ladder: what exists nearby, and
                how much anybody knows about it
  state.js      what the site remembers about you (localStorage only)
  weather.js    Open-Meteo — no key, no account, coordinates rounded to the neighbourhood
  scoring.js    the ranking engine — is this good today
  app.js        loading and rendering
data/
  events.json         time-sensitive; expires and is pruned automatically
  events-city.json    what the city says is on — collected daily, gated hard
  places.json         cafés, bakeries, markets, shops, museums, parks, classes
  nightlife.json      jazz rooms, live venues, clubs and bars
  sports.json         play vs watch — activities, venues, running routes
  food.json           food missions: a brief, three candidates, what to order
  itineraries.json    ready-made routes — the "start here, then walk there" layer
  daytrips.json       reachable from Gare du Nord / Gare de l'Est
  neighborhoods.json  all 20 arrondissement profiles
  quests.json         long-running exploration goals
  invaders.json       ~390 Invader mosaics, for the hunt in Sport → Play
  home.json           the default location, on first visit only
  places/             the discovery index, ~23k Paris places from OpenStreetMap
                      — coverage, not opinion. Twenty files, one per
                      arrondissement, so a first paint does not wait for
                      the nineteen you are not standing in
  civic.json          markets with their days and hours, pools, parks, libraries
  notable.json        places with a verifiable distinction, from Wikidata
  editorial.json      researched recommendations — opinionated, never visited
  notes.json          handwritten, hand-edited, and it beats everything above
scripts/
  discover.mjs  build the Paris-wide index from OpenStreetMap
  shard.mjs     split that index by arrondissement, and read it back whole
  invaders.mjs  where the Space Invader mosaics are, so the hunt is real
  events.mjs    what is on, from the city's own feed — and the gate that
                decides which fraction of it earns a place
  civic.mjs     what the Mairie de Paris publishes about its own facilities
  notable.mjs   Wikidata + Wikipedia + pageviews — distinction, and fame
  editorial.mjs resolve hand-written records against real places
  draft.mjs     start a handwritten note, id and all
  check-location.mjs  does moving change the answers, and are they any good
  check-hours.mjs     how much of the city's opening hours can we actually read
  check-perf.mjs      how long does the page make somebody wait, and has that got worse
  shim.mjs      run a js/ module in Node, so scripts share the browser's rules
  geocode.mjs   give every curated record real coordinates
  relocate.mjs  (legacy) rewrite stored distances for a new home
  refresh.mjs   prune + validate; run daily by CI
  images.mjs    resolve one openly-licensed photo per hand-written card
  photos.mjs    the same, for the tiers that are generated weekly
  version.mjs   content-hash the CSS/JS/data URLs so caches cannot go stale
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
stays cached. **Run it after touching anything in `css/`, `js/` or `data/`** —
CI runs it too, as a backstop:

```bash
node scripts/version.mjs           # restamp
node scripts/version.mjs --check   # fail if stamps are stale
```

The data files have the same problem and now the same answer. They are not
linked from the HTML, so instead of an href the script writes a
`window.__DV` map of `name → hash` into `index.html`, and `js/app.js` builds
every data URL through it. This replaced `cache: 'no-cache'` on thirty-seven
fetches — a round trip per file, on every visit, to be told nothing had
changed.

Freshness now comes from the deploy rather than from asking: a changed file is
at a URL no cache has ever seen, and an unchanged one costs no network at all.

**`sw.js`** is where the caching rule actually changes, because `max-age=600`
is not negotiable on Pages and a service worker is the only place to override
it. It is deliberately small, and its safety rests on the hashing above:

* hashed URLs (all CSS, JS and data) — served from cache without asking,
  which is arithmetic rather than a judgement call
* `index.html` — the one file with no hash, so always network-first, with the
  cached copy as an offline fallback. It carries the hashes of everything
  else, so a deploy is picked up in full on the first load after it
* the forecast and the address lookup — never cached
* photographs — cached by URL, which already encodes the rendition width

Nothing in it can make a finished event look like it is on: expiry is applied
when the records are built, against today's date, not when they are fetched.

A second visit currently costs **zero network requests**.

### Keeping it quick

`scripts/check-perf.mjs` measures the page against a local server that
behaves like GitHub Pages — gzip, `max-age=600`, ETags — and compares the
result with `scripts/perf-baseline.json`.

```bash
export CHROME_PATH="/Applications/Google Chrome 2.app/Contents/MacOS/Google Chrome"
node scripts/check-perf.mjs --runs 5 --inp     # measure and compare
node scripts/check-perf.mjs --real             # real throttling, not simulated
node scripts/check-perf.mjs --save --note "…"  # adopt these numbers as the baseline
```

It **reports and never fails**. Lighthouse scores have real run-to-run
variance, and a red check that is sometimes just noise is a check people
learn to scroll past. Drift has to clear both a relative and an absolute
threshold before it is called a regression, which is what keeps CLS going
from 0.001 to 0.002 — a 100% increase, and meaningless — off the report.

The interaction-latency row needs `npm install --no-save puppeteer-core`;
without it that row is skipped rather than the run failing. Everything else
runs through `npx`, so the repo stays dependency-free.

`.github/workflows/perf.yml` runs it weekly and puts the table in the job
summary. Weekly rather than per-push because what it guards against is
drift: the discovery index and the events file are regenerated on their own
schedule, so the page can get heavier with nobody having touched the code.

Why any given number is what it is —  and which arrangements in this
codebase exist to keep it that way — is in
`.claude/skills/paris-performance/references/invariants.md`. Read it before
changing the boot sequence, adding a file to the critical path, touching an
image slot, or adding a render pass. Several fast-looking changes here are
known to be slow, and the file says which and by how much.

### What the first paint waits for

`js/app.js` splits the data files three ways, and the split is load-bearing:

* `FIRST` — `home` and `places/index`, two small files that decide *where the
  reader is*, and therefore which shards are the near ones. Nothing else can
  be ordered until this is known
* `CORE` — what the first render actually draws from
* `LATER` — `civic` and `notable`, which feed only the discovered layer, the
  layer that is already briefly incomplete by design

`index.html` starts `FIRST` and `CORE` from a script in the head, before the
nine JS files have even been downloaded; `app.js` picks up the in-flight
requests through `window.__PRELOAD` rather than asking twice.

After the paint the fill runs nearest-consequence-first — the hero photograph,
then `LATER` (which changes what the sections about *around you* say), then
the sixteen far shards (which do not). The rule that makes any of this safe is
unchanged: the page may be **briefly** partial and must never **stay** partial,
and `whenComplete()` is still awaited by anything that changes the question.

### Photographs

Every card carries a picture from Wikimedia Commons, resolved at build time by
`scripts/images.mjs` and baked into the JSON as a plain URL — so the browser
makes no API call and nothing can rate-limit the page.

Commons renders a fixed set of thumbnail widths, and its 1280px rendering of a
single card photograph is 696 KB. On a phone at 2.6 device pixels an honest
`sizes` asks for exactly that, which is how the first screen came to cost
1.1 MB of photographs nobody could see the difference in.

So `img()` in `js/app.js` caps each slot at the point where more pixels stop
being visible — 250px for the list thumbnails, 500px for cards, 960px only for
a picture that runs the width of a desktop page. `sizes` stays honest about how
wide the slot is; the srcset simply stops offering renditions past the cap. The
two wide slots use `<picture>` with a `media` query, because `srcset` cannot
tell a 1000px desktop hero from a 390px phone one and would hand both the big
file.

Small businesses rarely have a freely licensed photograph of their own. Rather
than fake it, those cards borrow a picture of the street or quarter they stand
on, and `imageSubject` records what is genuinely in the frame so the card can
say so in its credit line. Each card names the photographer and the licence.

**Two scripts, because there are two kinds of record.** `images.mjs` resolves
the ~160 hand-written cards from a table that names an article per record — it
works because a person maintains those files and can maintain the table with
them. The generated tiers cannot be handled that way: `notable.json` is 793
records rebuilt from Wikidata every Monday and `events-city.json` is 345
rebuilt from the city's open data every morning. `scripts/photos.mjs` resolves
those from the records themselves:

| Layer | How the picture is found | Of what | Coverage |
|---|---|---|---|
| `notable.json` | its own Wikipedia article, else the Wikidata `P18` image | the subject | 86% |
| `civic.json` | the record's name, as an article title | the subject | 20% |
| `events-city.json` | the venue in `area` | the room, not the concert | 32% |
| `editorial.json` | the street in `area` | the street | 52% |

Nothing is matched by proximity. The Wikidata join is on the exact coordinate —
those coordinates *came from* those items, so a match is the same record rather
than something that happens to be nearby — and the name lookups go through the
article title, which the API normalises and follows redirects for. The nearest
photographed thing to a municipal tennis court is not a picture of the tennis
court, and attaching it would be inventing a claim.

Two filters earn their place. Wikipedia's page image for the Centre Pompidou is
its logo, and Wikidata's `P18` for a park is often a plan — so anything drawn
as vectors is rejected (Commons serves SVG thumbnails as `.svg.png`, so the
format test alone is not enough), along with filenames that announce themselves
as logos, coats of arms or maps. And a record that carries a photograph carries
the Commons **path fragment**, not a URL: a thumbnail URL names the file twice
behind a fifty-character prefix that is identical for every record on the site,
and `events-city.json` is a file the first paint waits for. `js/record.js`
rebuilds the URL — the directory is the MD5 of the filename, so it is
arithmetic rather than a lookup.

`scripts/photo-cache.json` remembers every lookup, misses included, which is
what makes this cheap enough to run on a schedule: a weekly rebuild returning
the same 1,100 places asks Wikimedia about none of them.

The 22,635 places in the discovery index get no photograph and should not. No
free picture of them exists, and the section they appear in says plainly that
nobody has vouched for them — borrowing a street scene would be the one claim
that page is built to avoid making.

**Markets have no photograph either, and the tile says so by being a drawing.**
Four sources were tried and measured before giving up on it: Wikipedia page
images matched none of a forty-name sample; Wikidata has no item for a
municipal market, so the `P18` join reaches nothing; Commons categories covered
five markets of twenty-four, and one of those five is a photograph of
counterfeit perfume. The fourth is the tempting one — **the city photographs its
own venues and publishes the URLs, 95% of them** — and it is the one to stay away
from:

- The dataset is ODbL, which licenses the *database*. The photographs inside it
  are separate works, and the credits name individual photographers — "Sophie
  Robichon / Ville de Paris", "DSol". 41% carry no credit at all, so they could
  not be attributed even if the licence allowed it.
- They are 229–508 KB JPEGs with no thumbnail API. Every other picture here can
  be rewritten to a capped width because Commons renders fixed sizes; a
  `cdn.paris.fr` URL cannot, so a 64-pixel list thumbnail would cost a third of
  a megabyte.

So the market tile is striped canvas drawn in CSS — a market awning, which is
what the thing actually looks like, at no bytes and no request. It is plainly
not a photograph, which is the point, and it is the same decision as the
typographic tile: draw something honest rather than borrow something false.

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
node scripts/photos.mjs           # the generated tiers, from the records themselves
node scripts/photos.mjs --dry     # what it would resolve, writing nothing
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

### Sport: active city exploration

Play is not only pitches and pools. Anything in `sports.json` carrying the
`citygame` category appears in its own strip at the top of Play, on the
principle that getting out of the flat and moving around Paris *is* the sport —
so a mosaic hunt, a scavenger route or a long walk across four arrondissements
belongs there more honestly than a gym does. Scavenger hunts, orienteering,
cycling and running challenges slot in as one JSON object each.

The first of them, the Invader hunt, has real positions behind it
(`data/invaders.json`, from OpenStreetMap) and so gets an interactive panel:
what is within a walk, three missions routed nearest-neighbour from where you
are standing, and a count of what you have found — kept in this browser, on the
same shelf as the quests. Missions end by handing you back to the rest of the
guide: coffee, a bakery, a park, lunch, picked near the last stop.

Two things it deliberately does not do. It never shows a percentage, because
the denominator is what OpenStreetMap knows — a few hundred of the ~1,500
pieces Invader has put up — and a progress bar would quietly lie about how far
along you are. And a mission that cannot be filled is not offered, rather than
being offered short.

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

Where this is going next, and the reasoning behind it: **[ROADMAP.md](ROADMAP.md)**.

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

`scripts/refresh.mjs` still prunes without inventing. Collection lives in
`scripts/events.mjs`, which reads the city's own feed at `opendata.paris.fr`
— keyless, around 2,200 live listings — and writes the fraction that clears
its gate to `events-city.json`. It runs daily in CI, before the prune, so what
it writes is validated by the same run that writes it.

The rule that keeps this useful rather than noisy is unchanged: never write an
event without `url`, `source` and `lastVerified`. The one that keeps it honest
is newer — a collected record is `sourced`, so its `why` carries the city's own
summary and never a claim about whether the two of you would enjoy it. That
claim is what `events.json` is for, and no script can make it.

---

## Location is an input, not an assumption

The site used to be *about* the 10th. Now it starts there and goes wherever
you point it — a different arrondissement, an address, a hotel, or the
browser's own idea of where you are.

**Four tiers, by how much anybody actually knows.**

"Curated or not" turned out to be too blunt a question. The gap between
somebody having stood in a shop and a name existing on a map is real — but so
are the two states in between, and collapsing them is what left the 5th ranked
by walking time.

| Tier | What it means | Where it comes from | Count |
|---|---|---|---|
| **personal** | You went and wrote it up | `places.json` and friends, plus `notes.json` | ~200 |
| **editorial** | Researched and argued for, **nobody visited** | `editorial.json`, written by hand | ~42 |
| **sourced** | A verifiable distinction — an article, a listing, an official record | `notable.json`, `civic.json`, generated weekly | ~2,300 |
| **found** | A name and a position, and no claim beyond that | `discovered.json`, from OpenStreetMap | ~14,000 |

The tier drives the ranking, the mark on the card (★ ◆ ◇ ·), the weight of the
rule under it, and the wording. Nothing is ever presented as more than it is:
an editorial card says *researched, not visited*, and a found one says nobody
has vouched for it.

**Personal always wins.** `data/notes.json` is the only data file meant to be
edited by hand and the only one no script rewrites. A note can attach to
anything with an id — including a place that arrived from OpenStreetMap with
nothing but a name — and writing a reason down is what promotes it. Ids encode
a rounded coordinate, so `node scripts/draft.mjs <search>` generates them; the
first one worked out by hand in this repo was wrong, because JavaScript rounds
a .5 up and Python rounds it to even.

Places present in more than one layer are de-duplicated by name and position,
so the one that knows most about a place wins and the others drop out.

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
- **The ring widens until it finds something worth recommending**, not merely
  until it is full. Eight anonymous bakeries two minutes away used to bury the
  two the guide actually knew about thirteen minutes away, which is how you end
  up handing somebody a list of names.
- **The recommendations and the map come back as two lists, never one.** A
  place somebody visited, researched, or can point to a listing for is a
  recommendation. A name and a position off OpenStreetMap is *coverage* — it
  answers "is there a bakery near me at all", which is a real question and the
  reason the discovery layer exists, but it is not an answer to "where should
  we get coffee". Blended and sorted by distance they are indistinguishable to
  a reader, and since the city has twenty-two thousand names against a few
  hundred write-ups, the names take every row: *Coffee around Saint-Germain*
  once meant twenty-two places nobody had been to. So the sections print the
  guide first and the map underneath its own heading, and where a quarter has
  nothing written about it the names become the answer and say so.
- **A record that says it closed is not a place.** Wikipedia describes a café
  the same way whether it is serving coffee this morning or shut in 1902, and
  the sourced tier inherits the tone along with the coordinates. Only a plain
  statement of closure counts — *"was a"* does not, because half the museums in
  Paris had an earlier life and the Maison de Balzac is very much open.
- **Fame is not quality.** A notability signal on its own recommends Le Procope
  and La Tour d'Argent: genuinely notable, and genuinely not where you send
  someone for coffee. Monthly Wikipedia pageviews separate a landmark from a
  local place that happens to have an article, and landmarks are pushed down in
  the everyday sections while staying eligible for Culture and *Worth the trip*.
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
node scripts/civic.mjs                       # markets, pools, parks, libraries
node scripts/notable.mjs                     # Wikidata + Wikipedia + pageviews
node scripts/editorial.mjs                   # resolve hand-written records
node scripts/draft.mjs mouffetard            # start a handwritten note
node scripts/check-location.mjs --verbose    # does location change the answers?
```

`editorial.json` carries no coordinates. Each record names the place it is
talking about and `editorial.mjs` resolves it against the discovery index, so a
recommendation for somewhere that does not exist is dropped rather than
shipped — inventing a café is impossible by construction.

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
| …of which the guide knows something about | 0 | 3 |

The second row was the retrieval fix. The third is the tiers, and it is the one
that decides whether the answer is a recommendation or a phone book.

`check-location.mjs` enforces both: every arrondissement must return materially
different lists *and* at least two of its top five must be more than a name on
a map. Seven of eighty arrondissement/category pairs still fail that, listed in
`THIN` in the script — a to-do list that fails loudly the moment it gets
longer. Adding a line to it should feel like an admission; removing one is the
actual work.

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
