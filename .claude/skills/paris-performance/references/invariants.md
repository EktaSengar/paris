# Performance invariants

Arrangements in this codebase that exist for a measured reason and look
arbitrary without it. Each entry: what it is, what happens if it goes, and
how the failure shows up in the numbers.

The measurements quoted are from the August 2026 pass, mobile emulation,
Slow 4G + 4× CPU. They are here so a future change can be argued with
evidence rather than taste.

## Contents

1. [The scripts are above `<main>`, not at the end of `<body>`](#1)
2. [Three header lines are written before the first paint](#2)
3. [`:empty` reservations, not permanent ones](#3)
4. [Location resolves from two files before anything else is asked for](#4)
5. [`civic.json` and `notable.json` are not on the critical path](#5)
6. [The fill after the paint is ordered, and the order is load-bearing](#6)
7. [The forecast races a deadline instead of being awaited](#7)
8. [Data URLs carry a content hash](#8)
9. [Image slots cap by effective pixel ratio](#9)
10. [`render()` writes only what changed](#10)
11. [`Near.pick` gates only what the rings can reach](#11)
12. [Derived per-record values are memoised on the record](#12)
13. [The service worker's safety rests on the hashing](#13)
14. [Photographs are stored as a Commons path fragment, not a URL](#14)
15. [Every fill path redraws through `repaint()`](#15)
16. [Things deliberately not done](#16)

---

<a id="1"></a>
## 1. The scripts are above `<main>`, not at the end of `<body>`

`index.html` puts the nine `<script src>` tags immediately after
`</header>`. This looks like a mistake. It is not.

The dateline, epigraph and lede are written by JavaScript and need no data.
At the end of `<body>` they were still written *after the first paint* —
the stylesheet is what unblocks painting and it arrives before nine script
files do — so the browser drew a header three lines short and then grew it,
shoving the whole page down by 58 px.

Placed here, the parser stops with the header parsed and nothing below it
parsed yet, `app.js` fills those lines as it evaluates, and the header is
its full height before anything is drawn.

**Cost of moving them back:** CLS 0.009 → 0.759. Nothing else changes —
these scripts were always parser-blocking, so this changes the order, not
the total.

**How it shows up:** a single large layout-shift entry very early
(~250–650 ms), moving `#main` down by about 58 px.

<a id="2"></a>
## 2. Three header lines are written before the first paint

`renderStatics()` in `js/app.js` is called twice: once at the bottom of the
IIFE (which is what runs early, per §1) and once inside `init()`. The early
call cannot see `#lede`, which lives in `<main>` and has not been parsed
yet, so each line is guarded individually.

Do not "simplify" this to a single call in `init()`. `init()` runs on
`DOMContentLoaded`, which is after the paint.

<a id="3"></a>
## 3. `:empty` reservations, not permanent ones

`css/style.css` reserves space for the lines that genuinely cannot be
written early — but only while they are empty:

```css
.date:empty     { min-height: 1lh; }
.epigraph:empty { min-height: 2lh; }
.lede:empty     { min-height: 1lh; }
#view:empty     { min-height: 78vh; }
```

Two reasons for `:empty` rather than a plain `min-height`. It cannot add
height to the finished page, which is the usual failure of holding space
open. And a permanent `min-height` in viewport units keeps having opinions
after it is needed — `#view { min-height: 78vh }` re-evaluated during the
synthetic full-height resize that a page audit does to photograph the whole
page, where 78vh of a 5,000 px viewport is not a placeholder but a shove.

The reservations were measured, not guessed, at 360–1280 px: the dateline
is one line at every width; the lede is one line on the opening view from
412 px up; the epigraph is two lines on nine days in fourteen. The
`min-height: 3em` line before each `lh` line is the fallback for browsers
without `lh` units — keep both.

<a id="4"></a>
## 4. Location resolves from two files before anything else is asked for

`js/app.js` splits the data files into `FIRST` (`home`, `places/index`),
`CORE` and `LATER`. `FIRST` is awaited alone, before everything.

The reason: the shard order depends on where the reader is standing, so
until location is known nothing can say which shards are the near ones.
Previously every core file was fetched, *then* the index was read, *then*
the shards started — three round trips deep for no reason but the order the
code was written in.

**Cost of collapsing it back into one `Promise.all`:** shards start ~900 ms
later; LCP moves with them.

**How it shows up:** in a network waterfall, `data/places/*.json` starting
only after the last core file finishes rather than alongside it.

<a id="5"></a>
## 5. `civic.json` and `notable.json` are not on the critical path

They are 105 KB gzipped and they feed **only** the discovered layer — the
layer that is already, by design, briefly incomplete and repainted when it
fills. Holding the first paint for them bought nothing the repaint a second
later does not also buy.

They are in `LATER`, fetched by `whenNear()`, and deliberately **not** in
the head preload list in `index.html` — preloading them would take
bandwidth from the files the first paint is actually waiting for.

**Cost of moving them to `CORE`:** first paint ~578 ms later.

The rule that makes this safe is unchanged and must stay: the page may be
**briefly** partial and must never **stay** partial. `whenComplete()` is
still awaited by anything that changes what is being asked.

<a id="6"></a>
## 6. The fill after the paint is ordered, and the order is load-bearing

After the first paint, in this order:

1. `heroPainted()` — the photograph at the top of the page
2. `whenNear()` — `civic` + `notable`, which change what the sections about
   *around you* say
3. `whenComplete()` — the sixteen far shards, which do not

Each step exists because of a measured failure:

- **Hero first**, because the photograph cannot be requested until the data
  is ranked and the card drawn, so it starts *after* the fill has claimed
  the connection and then queues behind 780 KB of JSON. It arrived at 6.2 s
  for want of 118 KB it could have had at 3.9 s. There is a 2.5 s deadline
  so a slow or broken image can never hold up the fill.
- **`whenNear()` before the shards**, because as one batch the city-record
  files landed at ~8.7 s and the page reflowed under somebody who had
  started reading. Split, the settle happens at ~4.1 s.
- Background fetches pass `priority: 'low'`. It helps and is not sufficient
  on its own — by the time the image is requested the fill already holds
  the connections — which is why the ordering above exists as well.

<a id="7"></a>
## 7. The forecast races a deadline instead of being awaited

`Weather.load()` starts inside `load()` as soon as coordinates exist, and
`init()` does `await Promise.race([WXP, after(WX_GRACE)])` with
`WX_GRACE = 200`.

Both simpler options are worse. Awaiting it outright — what the code used
to do — makes a slow morning at `api.open-meteo.com` into a slow morning
for this site, with nothing on screen at all. Not awaiting it at all trades
that for a visible reshuffle a second later, because `weatherMode` feeds
the ranking: painting with and without the forecast are two different
pages, and the reader watches one become the other.

Started early, it is almost always back before the data it would have
waited behind, so the question rarely arises. The deadline is for when it
does.

<a id="8"></a>
## 8. Data URLs carry a content hash

`scripts/version.mjs` writes a `window.__DV` map of `name → hash` into
`index.html`, and `dataUrl()` in `js/app.js` builds every data URL through
it. This replaced `cache: 'no-cache'` on 37 fetches — one round trip per
file, on every visit, to be told nothing had changed.

**Anything that fetches from `data/` must go through `dataUrl()`.** A bare
`fetch('data/x.json')` reintroduces the revalidation cost for that file and
is invisible in a local test where latency is zero.

**Run `node scripts/version.mjs` after touching `css/`, `js/` or `data/`.**
The data hashes live in `index.html` now, so a stale stamp means asking for
a URL that no longer matches the file. `--check` fails if stamps are stale;
CI runs it as a backstop.

<a id="9"></a>
## 9. Image slots cap by effective pixel ratio

Commons renders a fixed set of widths, and its 1280 px rendering of one
card photograph is 696 KB. On a phone at 2.6 device pixels an honest
`sizes` asks for exactly that — which is how the first screen came to cost
1.1 MB of photographs nobody could see the difference in.

`img()` takes a named slot from `SLOT`, and the cap is the point where more
pixels stop being visible: 250 px for list thumbnails, 500 px for cards,
960 px only for a picture that runs the width of a desktop page.

The `hero` and `lead` slots emit `<picture>` with a `media` query. This is
not decoration: `srcset` cannot tell a 1000 px desktop hero from a 390 px
phone one, and offering the 960 px rendition for the desktop case hands it
to the phone too. `picture { display: contents; }` in the stylesheet keeps
the wrapper out of the box tree so every existing rule still applies to the
`<img>`.

The hero also carries `loading="eager" fetchpriority="high"` — lazy-loading
the largest element above the fold means the browser will not even start
the request until layout has run.

**Cost of removing the caps:** images 343 KB → 1,104 KB.

<a id="10"></a>
## 10. `render()` writes only what changed

`render()` builds the markup either way — that is the part that has to be
correct — and then `patch()` replaces only the top-level children whose
markup differs. A view change (`drawn.view !== VIEW`) still replaces
everything.

Two separate costs come from writing regardless:

- Re-parsing ~100 KB of markup on every repaint, and shifting the layout
  under somebody who may have started reading, to arrive at the page that
  was already there.
- A destroyed and recreated `<img>` is a **new element**: it re-requests
  the file, decodes it again, and paints for the first time all over again
   — so the largest thing on the page reports its arrival at the moment of
  the last repaint rather than when it actually appeared. This alone was
  LCP 4,320 ms vs 5,660 ms.

**If you edit `#view` outside `render()`, call `invalidate()`.** Two places
do: `surprise()` and the Invader panel repaint. Without it the memo thinks
the DOM matches what it last drew, and clicking Today after a Surprise
leaves the surprise card on screen.

<a id="11"></a>
## 11. `Near.pick` gates only what the rings can reach

`pick()` pre-filters by `minutesFromHome <= rings.at(-1)` before running the
expensive gate, with a fallback to the full scan if nothing in range
survives.

The fallback is not optional and must be preserved exactly. `ring()` returns
items outside the widest ring in one case — when the widest ring caught
nothing at all and returning something far away beats an empty section —
and the fallback is what keeps that branch reachable.

Without the pre-filter the gate ran hours, chain counts and evidence over
all 24,000 records to produce a list drawn from the few hundred within an
hour of the reader. That was most of a two-second tap on Sport.

<a id="12"></a>
## 12. Derived per-record values are memoised on the record

- `js/record.js` — `flatten()` is memoised. Building the two layers
  flattens the same ~20,000 names three times, and `normalize('NFD')` is
  the single most expensive thing that file does. `Rec.build` was 516 ms.
- `js/nearby.js` — `nameKey` is stamped as `i._nk` during `use()`;
  `chainPenalty` caches to `i._chain`; `evidence` caches to `i._ev`.

All are pure functions of fields that do not change after the record is
built, so caching cannot change an answer. `_chain` is explicitly cleared
in `use()` because the outlet counts it derives from have just been
recomputed.

**`localScore` is deliberately not cached** — it multiplies by distance,
and distance changes whenever the reader moves. If you add a cache there,
it must be invalidated in `applyLocation()`.

<a id="13"></a>
## 13. The service worker's safety rests on the hashing

`sw.js` exists because `max-age=600` is not negotiable on Pages and a
service worker is the only place the caching rule can be changed. Its
correctness is not a judgement call, it is arithmetic:

- hashed URLs (CSS, JS, data) — cache-first, because a changed file is a
  URL no cache has ever seen
- `index.html` — the one file with no hash, so always network-first with
  the cached copy as an offline fallback. It carries the hashes of
  everything else, so a deploy is picked up in full on the first load
  after it
- the forecast and the address lookup — never cached
- photographs — cached by URL, which already encodes the rendition width,
  through `photo()` rather than `immutable()`. They need their own path
  because they are cross-origin: an `<img>` issues a `no-cors` request and
  gets back an opaque response — `type: 'opaque'`, `status: 0`, and
  **`ok: false`**.

  That last one was a live bug until 28 August 2026. The guard read
  `res.ok && (res.status === 200 || res.type === 'opaque')`, and the
  `&& res.ok` made the opaque branch unreachable, so no photograph was
  ever written to the cache. It went unnoticed because Commons sends long
  cache headers and the browser's own HTTP cache covered repeat visits.

  The fix is **not** "also accept opaque". An opaque 404 is
  indistinguishable from an opaque 200, so caching them trades a silent
  miss for a broken picture pinned on somebody's device until eviction.
  Instead the status is made readable: `upload.wikimedia.org` sends
  `access-control-allow-origin: *`, so `photo()` re-requests with
  `mode: 'cors'` and `credentials: 'omit'` (a credentialed request is
  refused by a wildcard ACAO) and caches only `status === 200`. If CORS is
  ever refused it falls back to the element's own request, so the picture
  still appears and simply is not cached.

  **Verified:** a photograph now lands in `paris-photos-v2` on first
  visit and is served from it on the second; a deliberately bogus URL
  fails and leaves the cache count unchanged. `PHOTOS` was bumped to v2
  because v1 could only hold opaque entries from the old code, and those
  cannot be checked for validity — the activate handler deletes any cache
  not in the keep set.

- the forecast and the address lookup — never cached
- photographs — *intended* to be cached by URL, which already encodes the
  rendition width. **This does not currently work**, and the bug is one
  character of logic: `immutable()` in `sw.js` guards with

  ```js
  if (res.ok && (res.status === 200 || res.type === 'opaque'))
  ```

  A cross-origin image fetched by `<img>` is a `no-cors` request, so its
  response is opaque: `type: 'opaque'`, `status: 0`, and **`ok: false`**.
  The `&& res.ok` therefore makes the `|| opaque` branch unreachable, and
  no photograph is ever written to `paris-photos-v1`. Verified in the
  browser on 27 August 2026.

  The impact is mild — Commons sends long cache headers, so the browser's
  own HTTP cache still serves repeat visits — which is why nobody noticed.
  The clean fix is not to cache opaque responses (an opaque 404 is
  indistinguishable from an opaque 200, so that trades one bug for a worse
  one) but to make the status readable: `upload.wikimedia.org` sends
  `access-control-allow-origin: *`, so re-requesting with `mode: 'cors'`
  gives a real status, and the guard becomes `res.status === 200` with no
  opaque case at all. Not applied: it changes caching behaviour for anyone
  with the site already installed, which is the user's call.

Nothing here can make a finished event look like it is on: expiry is applied
when the records are built, against today's date, not when they are fetched.

**If you ever serve an unhashed data URL cache-first, this stops being
true.** That is the one change that would make the service worker unsafe.

A second visit costs zero network requests.

<a id="14"></a>
## 14. Photographs are stored as a Commons path fragment, not a URL

Records resolved by `scripts/photos.mjs` carry `i`, a fragment like
`2/29/MG-Paris-Champ_de_Mars.jpg`, and `js/record.js` builds the thumbnail
URL from it in `withPhoto()`.

A finished Commons URL names the file **twice** behind a fifty-character
prefix that is byte-identical for every record on the site — about 270
bytes where the fragment costs 60. `events-city.json` is in `CORE`, so
those bytes are on the critical path.

**Measured, adding photographs to the four generated tiers:** critical-path
JSON +4 KB gzipped (`events-city` +3.4, `editorial` +0.6). `notable.json`
+14 KB and `civic.json` are in `LATER` and cost the first paint nothing.
Storing full URLs instead would have put roughly +30 KB raw on
`events-city` alone.

The directory segments are the first three hex characters of the MD5 of the
filename, so this is arithmetic and not a lookup — nothing to fetch, nothing
to go stale. `scripts/photos.mjs` computes it going in, `js/record.js`
reverses it coming out; if one changes, so must the other.

Leaving the width out of the stored value is the second half of it: `img()`
rewrites the width per slot (§9), so what is stored only has to be a width
Commons will render.

<a id="15"></a>
## 15. Every fill path redraws through `repaint()`

Records that arrive after the first paint carry no distances —
`minutesFromHome` is stamped by `applyLocation()`, not carried in the
file. So any path that fills data in behind the page must stamp, rebuild
the context, and only then render. That is what `repaint()` is.

Three paths fill data in: the post-paint chain (`whenNear`, then
`whenComplete`), and switching a tab. The tab one called `render()` on its
own and nothing noticed for months, because no section filtered the
late-arriving tier by distance. The first one that did — *Somewhere new
this weekend*, which asks for sourced records within 30 minutes — found
all 1,847 of them sitting at the `?? 99` fallback and rendered nothing at
all.

**How it shows up:** not as a slow page. As a section that is silently
empty, or a distance that reads as "—", only when the data arrived on a
path that skipped the stamp. It will look like a data bug and it is a
render-order bug.

<a id="16"></a>
## 16. Things deliberately not done

Recorded so they are not re-proposed as easy wins:

- **Bundling the nine JS files.** Measured: 4.5 KB gzipped, because they
  already gzip well individually. Not worth a build step that can drift
  from its sources.
- **Columnar encoding for the shards.** Measured: 14% smaller. Not worth
  changing the format across `shard.mjs`, `record.js` and the validators.
- **Trimming `events-city.json`, `civic.json` or `notable.json`.** Their
  weight is real prose — `why` is 23% of `events-city.json` at 178
  characters average. Cutting it changes what the page says.
- **The city's own photographs for civic records.** `lieux-municipaux`
  carries a `photo_url` on 95% of its 3,696 venues and it looks like the
  answer to every empty market tile. It is not: 229–508 KB each with no
  thumbnail API, so §9's cap cannot apply to them — one list thumbnail
  would outweigh the entire current image budget for the first screen.
  The licence is the harder blocker (see the README), but the weight
  alone would rule it out.
- **Photographs for the 22,635 discovered records.** No free picture of
  them exists, and the section they appear in says nobody has vouched for
  them. This is an honesty limit rather than a budget one, but it is also
  the single largest page-weight decision on the site, so it is recorded
  here too.
- **Reducing `FIRST_BATCH` below 4 shards.** Saves ~70 KB and directly
  weakens the location-aware sections on the first paint, which is the
  thing the site is for.
- **Minification, or stripping comments at deploy.** Asked and answered
  on 27 August 2026, so it does not need reopening without new
  information.

  Comments are **47% of the shipped JS** — 36 KB gzipped of 76 KB — and
  they are parser-blocking, since the scripts sit above `<main>` (§1).
  That is a real cost and the number looks alarming. Three things settle
  it against acting:

  1. **The house ratio was already 39%.** This is a deliberate style, and
     this file exists precisely because those comments are load-bearing:
     every entry here was once a comment somebody nearly deleted.
  2. **Stripping is not cheap here.** Pages serves the repo directly —
     `index.html` points at `js/*.js` in place. Stripping means either CI
     committing stripped files over the source, which destroys the
     comments, or moving to artifact-based deploys, which is a build
     pipeline and a way for served code to drift from its source. The repo
     states its position on that twice, here and in `scripts/shim.mjs`.
  3. **The overshoot was authorial, not structural.** One session took
     comments from 39% to 49% by over-explaining; editing that prose back
     recovered most of it with no mechanism at all. That is the lever to
     reach for first, and it costs nothing.

  Moving the rationale into this file instead was the other candidate and
  is worse for the common case: someone editing `nearby.js` sees the
  comment, and will not go looking for a skill file they may not know
  exists. What belongs here is the compiled summary, not the only copy.
