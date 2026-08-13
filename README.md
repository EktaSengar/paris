# Paris for You

A personal Paris exploration guide for Ekta & Kartik, living in the 10th.

**Live at → https://ektasengar.github.io/paris/**

It answers one question every time you open it: *what is something interesting
we could do next?* Not an events listing — a ranked, weather-aware, date-aware
set of suggestions built around one home base in the 10th.

---

## How it works

Static site. No build step, no framework, no backend, no API keys, no accounts.
Three JavaScript files and some JSON.

```
index.html
css/style.css
js/
  state.js      what the site remembers about you (localStorage only)
  weather.js    Open-Meteo — no key, no account, coordinates rounded to the neighbourhood
  scoring.js    the ranking engine
  app.js        loading and rendering
data/
  events.json         time-sensitive; expires and is pruned automatically
  places.json         cafés, bakeries, markets, shops, museums, parks, classes
  itineraries.json    ready-made routes — the "start here, then walk there" layer
  daytrips.json       reachable from Gare du Nord / Gare de l'Est
  neighborhoods.json  all 20 arrondissement profiles
  quests.json         long-running exploration goals
scripts/
  refresh.mjs   prune + validate; run daily by CI
  serve.mjs     local preview server
```

### The ranking

Nothing is shown in file order. Every candidate is scored against:

- how far it is from the 10th (a good thing 15 minutes away beats a good
  thing an hour away)
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

## Privacy

No exact address is in this repository or sent anywhere. Distances are
estimated from the neighbourhood, and the weather request uses coordinates
rounded to two decimal places — roughly a kilometre. Ratings, saved places
and quest progress are stored in your browser's localStorage and are never
transmitted. There is no analytics, no tracking and no login.
