---
name: paris-performance
description: >-
  Measure and protect the loading performance of the Paris discovery site
  (ektasengar.github.io/paris). Use this whenever work touches how the page
  loads or how much it ships — index.html, css/style.css, anything in js/,
  the shape or size of anything in data/, scripts/version.mjs, or sw.js —
  and whenever the user asks about speed, Lighthouse, Core Web Vitals, LCP,
  CLS, INP, bundle size, page weight, caching, or "why is this slow". Also
  use it for the regular scheduled performance report. Load it BEFORE
  changing the boot sequence, adding a data file to the critical path,
  changing an image slot, or adding a render pass — several fast-looking
  changes in this codebase are known to be slow, and the reasons are
  recorded here rather than being obvious from the code.
---

# Paris — performance

This site was optimised in August 2026: Lighthouse 30 → 56, LCP 10.1 s →
4.5 s, CLS 0.759 → 0.009, INP 2,264 ms → 472 ms, page weight 2,245 KB →
755 KB, with byte-identical output across all nine views.

Much of that win lives in arrangements that look arbitrary if you meet them
cold — script tags in an odd place, a `:empty` selector, a `<picture>` where
an `<img>` would do. This skill exists so those do not get tidied away by
someone being helpful, and so the numbers keep getting checked.

Two jobs: **measure** (below) and **don't regress** (the invariants).

## Measuring

```bash
export CHROME_PATH="/Applications/Google Chrome 2.app/Contents/MacOS/Google Chrome"
node scripts/check-perf.mjs --runs 5 --inp
```

Chrome on this machine is installed as `Google Chrome 2.app`, which
`chrome-launcher` cannot find on its own — without `CHROME_PATH` the run
fails with `ChromeNotInstalledError`. INP additionally needs
`npm install --no-save puppeteer-core`; without it that row is skipped
rather than the run failing.

The harness serves the site the way GitHub Pages does — gzip,
`max-age=600`, ETags — because `scripts/serve.mjs` sends `no-store` and
measuring against it tells you about the server rather than the site. It
takes the median of N runs in a fresh Chrome each time, compares against
`scripts/perf-baseline.json`, and reports. **It never fails the build**:
Lighthouse scores have real variance and a check that cries wolf is one
people learn to ignore.

Useful flags: `--real` (real device throttling instead of Lighthouse's
simulation), `--markdown FILE` (a report, used by CI), `--json`,
`--save --note "..."` (adopt the current numbers as the new baseline).

### Reading the result honestly

The byte counts and request count are exact — trust a change in those
immediately. The score and the timings are noisy, so the harness only calls
out drift past a per-metric tolerance. Two traps worth knowing:

**Simulated vs real throttling disagree, and it matters here.** Lighthouse's
default simulation models "when is everything downloaded", which for a
JS-driven page that paints before its background fetches finish reports a
much worse LCP than a real browser sees. During the optimisation, simulated
LCP barely moved while real-throttled LCP went 15.8 s → 5.9 s. If a change
should help the critical path and the simulated number is flat, re-run with
`--real` before concluding it did nothing.

**`Data (JSON)`, `Total page` and `Images` measure the trace window, not
the payload.** They sum bytes for as long as Lighthouse traces, and this
page fills in the background for several seconds after the paint. So the
figure is "how much of the fill landed inside the trace", which stretches
when the machine is busy. Observed three times on 27 August 2026: 330 KB
on a quiet run against 1,092 KB on a loaded one, reproducible — and
1,092 KB is almost exactly the 1,081 KB that *every* data file gzipped
comes to. The metric saturates at "everything"; nothing had grown.

They move together with TBT for the same reason, which is what makes the
pair convincing and wrong. To settle it, measure the payload directly —
that is deterministic and load-independent:

```bash
for f in home events events-city places nightlife sports food itineraries \
         daytrips neighborhoods quests editorial invaders notes; do
  gzip -c "data/$f.json" | wc -c
done | paste -sd+ - | bc      # the critical path: FIRST + CORE
```

**Check the load average before trusting any timing — the harness now
prints it.** Every run reports `Machine load a b c across N cores`, and
flags `← busy` above a third of the cores with a note saying which rows
survive it. On 27 August 2026 the same commit gave TBT 1,715 ms on a
quiet laptop and 8,212 ms with Spotlight indexing and a browser open.
When the busy flag is up, only **JS bundle** and **Requests** are worth
reading; come back when it is down.

**LCP can improve while the number gets worse, and vice versa.** The LCP
*element* changes. Before the optimisation, LCP was the hero text at
4,760 ms and the photograph never arrived inside the window at all; after,
text is at 3,300 ms and the photograph — a much larger element, so now the
LCP candidate — is painted at 4,376 ms. The metric moved a little; the
experience moved a lot. When LCP shifts oddly, check *which element* it is
before drawing a conclusion.

### Reporting to the user

Give the before → after table the harness prints, then say what changed and
why in prose. Flag anything in the "worse" list against
`references/invariants.md` — most regressions here are a known invariant
being broken, and naming which one is far more useful than the number.

## Not regressing

Read `references/invariants.md` before changing the boot sequence, the data
loading, the image slots, or the render path. It is short, and each entry
says what the arrangement is, what happens without it, and how the failure
shows up — so you can tell whether a proposed change is the good kind of
tidying or the kind that costs two seconds.

The headline ones, so they are in mind even if the file is not read:

- **The scripts sit after `</header>`, not at the end of `<body>`.** Moving
  them back costs 0.75 of CLS.
- **`civic.json` and `notable.json` are deliberately not on the critical
  path**, and the fill after the paint is ordered hero photograph → those
  two → the sixteen far shards. That ordering is load-bearing.
- **Data URLs carry a `?v=` hash from `window.__DV`.** Anything fetching
  from `data/` must go through `dataUrl()`, or it reintroduces a
  revalidation round trip per file per visit.
- **Image slots cap by effective pixel ratio, not by layout.** An honest
  `sizes` on a phone asks for a 696 KB rendition nobody can see.
- **`render()` builds the markup either way but only writes what changed.**
  Rewriting `#view` wholesale destroys the hero `<img>` and pushes LCP to
  the last repaint.

## Verifying a change kept the site correct

Speed work here is only acceptable if the page still says the same things.
The optimisation was held to byte-identical output across all nine views,
and that is a low bar to re-clear:

```bash
node scripts/version.mjs --check    # asset + data hashes current
node scripts/refresh.mjs --check    # data still valid
node scripts/check-location.mjs     # moving still changes the answers
```

`scripts/version.mjs` must be re-run after touching anything in `css/`,
`js/` or `data/` — the data hashes live in `index.html` now, so a stale
stamp means the browser is asked for a URL that no longer matches the file.

For anything that changes rendering, compare the views before and after
rather than trusting that it looks fine: render each of the nine views in a
headless browser and diff the text length, card count, row count and image
count. A performance change that alters what is on the page is a bug, not a
trade-off, unless the user has agreed to the trade.

## When the numbers drift on their own

The data grows without anyone touching the code — `events-city.json` and
the twenty shards are regenerated by CI daily and weekly. So a scheduled
report can go red with no commit behind it. That is the report doing its
job. The usual causes, in order of likelihood: the discovery index grew, a
new file joined the critical path, or an image slot started resolving to a
larger rendition because a photograph was replaced.
