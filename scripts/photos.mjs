#!/usr/bin/env node
/* ---------------------------------------------------------
   photos.mjs — photographs for the layers nobody hand-mapped.

   scripts/images.mjs resolves the ~160 hand-written cards, one article
   named per record in a table somebody maintains. That works because the
   curated files are small and change when a person changes them.

   The generated tiers are neither. notable.json is 793 records rebuilt
   from Wikidata every Monday; events-city.json is 345 rebuilt from the
   city's open data every morning. A hand-maintained table cannot follow
   that, and until now the consequence was simply that none of them had a
   photograph — which stopped being a detail the moment the sections
   became recommendations rather than lists of names. A recommendation
   with an empty grey square where the picture goes reads as a database
   row, whatever the words next to it say.

   So this resolves them from the same records they were built from:

     notable      the place's own photograph, from its Wikipedia article
                  or its Wikidata entry — a picture *of the subject*
     events-city  the venue the event is at, which is a picture of the
                  room rather than of the concert
     editorial    the street the shop stands on, because no free photo of
                  a particular café exists

   The honesty rule from images.mjs carries over unchanged: `imageKind`
   records whether the frame contains the thing itself or its
   surroundings, and only `subject` photographs are allowed to lead a
   section.

   Usage:  node scripts/photos.mjs [--force] [--dry]
   --------------------------------------------------------- */

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { pageImages } from './images.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const CACHE = path.join(ROOT, 'scripts', 'photo-cache.json');
const FORCE = process.argv.includes('--force');
const DRY   = process.argv.includes('--dry');
const UA = 'paris-for-you/1.0 (personal site; https://github.com/EktaSengar/paris)';

/* ---------- where a Commons file lives ----------

   Commons puts every file under two directory segments taken from the MD5
   of its name: `Foo bar.jpg` hashes to 8c…, so it is served from
   `/commons/8/8c/Foo_bar.jpg`. That is arithmetic, not a lookup, which
   means a filename is all we need to store — no second API call to find
   out where the file lives, and nothing to go stale. */

const commonsPath = file => {
  const name = file.replace(/ /g, '_');
  const h = crypto.createHash('md5').update(name, 'utf8').digest('hex');
  return `${h[0]}/${h.slice(0, 2)}/${name}`;
};

/* The reverse, for the URLs the Wikipedia API hands back whole. */
const fileFromUrl = u => {
  const m = (u || '').match(/\/commons\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/]+)/);
  return m ? decodeURIComponent(m[1]) : null;
};

/* ---------- what is not a photograph ----------

   The page image of the Centre Pompidou is its logo. Wikidata's P18 for a
   Métro station is often a route diagram, and for a park, a plan. All of
   them are perfectly good pictures and none of them tells a reader what a
   place is like, which is the entire job here.

   SVG is the strong signal — nothing drawn as vectors is a photograph —
   and it arrives disguised, because Commons renders SVG thumbnails as
   `.svg.png`. The name test catches the raster logos and scans that the
   format test cannot. */

const NOT_A_PHOTO = [
  /\.svg(\.\w+)?$/i,                                  // vectors, however rendered
  /\b(logo|logotype|wordmark)\b/i,
  /\b(blason|armoiries|coat[ _-]?of[ _-]?arms|escudo)\b/i,
  /\b(carte|map|plan|plattegrond|schema|diagram|localisation|location[ _-]?map)\b/i
];

const isPhoto = file => !!file && !NOT_A_PHOTO.some(re => re.test(file));

/* ---------- Wikidata's own picture ----------

   One query for every item inside the Paris bounding box that has a P18
   image — about 33,000 of them, and it answers in a second. The join back
   onto notable.json is on the coordinate, at the five decimal places the
   file already stores, and it is exact rather than nearest-neighbour:
   those coordinates *came from* these items, so a match is the same
   record rather than something that happens to be nearby.

   That distinction is the whole reason this is not done by proximity. The
   nearest photographed thing to a municipal tennis court is not a picture
   of the tennis court, and attaching it would be inventing a claim. */

const BOX_QUERY = `SELECT ?coord ?img WHERE {
  SERVICE wikibase:box {
    ?item wdt:P625 ?coord .
    bd:serviceParam wikibase:cornerWest "Point(2.20 48.80)"^^geo:wktLiteral .
    bd:serviceParam wikibase:cornerEast "Point(2.48 48.92)"^^geo:wktLiteral .
  }
  ?item wdt:P18 ?img .
}`;

async function wikidataImages() {
  process.stdout.write('  Wikidata P18 across Paris… ');
  const res = await fetch(
    'https://query.wikidata.org/sparql?query=' + encodeURIComponent(BOX_QUERY),
    { headers: { 'user-agent': UA, Accept: 'application/sparql-results+json' },
      signal: AbortSignal.timeout(180000) });
  if (!res.ok) throw new Error(`Wikidata ${res.status}`);

  const rows = (await res.json()).results.bindings;
  const byPos = new Map();
  for (const b of rows) {
    const m = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(b.coord.value);
    if (!m) continue;
    const key = `${(+m[2]).toFixed(5)},${(+m[1]).toFixed(5)}`;
    const file = decodeURIComponent(b.img.value.split('Special:FilePath/').pop());
    /* First one wins: an item with several images is not a tie worth
       breaking, and the order the endpoint returns is stable enough. */
    if (!byPos.has(key)) byPos.set(key, file);
  }
  console.log(`${byPos.size} positions`);
  return byPos;
}

/* ---------- the cache ----------

   notable.json is rebuilt weekly and events-city.json daily, so without
   this every rebuild would re-ask Wikimedia about eleven hundred records
   to be told what it was told last week. The cache is keyed on what was
   looked up rather than on the record, so it survives a rebuild that
   renumbers everything, and it stores misses as well as hits — "there is
   no free photograph of the rue de Babylone" is worth remembering too.

   It lives beside perf-baseline.json rather than in data/, because
   nothing in the browser reads it. */

async function readCache() {
  try { return JSON.parse(await fs.readFile(CACHE, 'utf8')); }
  catch { return { note: 'Resolved by scripts/photos.mjs. "" means: looked, found nothing.', found: {} }; }
}

const readJson = async f => JSON.parse(await fs.readFile(path.join(DATA, f), 'utf8'));

/* Each of these files has a writer of its own — notable.mjs, events.mjs,
   editorial.mjs — and they do not agree on indentation. Match whichever
   one owns the file, so stamping a photograph does not reformat three
   hundred kilobytes and bury the change in the diff. */
const INDENT = { 'notable.json': undefined, 'civic.json': undefined,
                 'events-city.json': 2, 'editorial.json': 1 };

async function writeJson(f, doc) {
  if (DRY) return;
  await fs.writeFile(path.join(DATA, f), JSON.stringify(doc, null, INDENT[f]) + '\n', 'utf8');
}

/* ---------- 1. the sourced tier ----------

   Two sources for the same question, and the order matters. A Wikipedia
   article's page image is chosen by the people writing the article, and
   is almost always the establishing photograph. Wikidata's P18 is a
   property somebody filled in, and for the Champ de Mars it is a painting
   of the Fête de la Fédération in 1790. Both are correct; only one of
   them tells you what the place looks like now.

   So: the article's picture where there is an article, P18 where there is
   not — which is also, conveniently, most of the records the article
   route cannot reach at all. */

async function sourcedTier(cache, wd) {
  const doc = await readJson('notable.json');
  const items = doc.items;

  const key = i => `wd:${i.lat.toFixed(5)},${i.lon.toFixed(5)}`;
  const todo = items.filter(i => FORCE || cache.found[key(i)] === undefined);
  console.log(`\nnotable.json — ${items.length} records, ${items.length - todo.length} already resolved`);

  /* a. the article's own picture, batched twenty titles to a request */
  const byTitle = new Map();
  for (const i of todo) {
    if (!i.w) continue;
    const t = decodeURIComponent(i.w.split('/wiki/').pop());
    if (!byTitle.has(t)) byTitle.set(t, []);
    byTitle.get(t).push(i);
  }
  if (byTitle.size) {
    console.log(`  en.wikipedia page images for ${byTitle.size} articles…`);
    for (const [title, url] of await pageImages([...byTitle.keys()], 'en')) {
      const file = fileFromUrl(url);
      if (!isPhoto(file)) continue;
      for (const i of byTitle.get(title) || []) cache.found[key(i)] = commonsPath(file);
    }
  }

  /* b. Wikidata's picture for everything the articles did not answer */
  let fromWd = 0;
  for (const i of todo) {
    const k = key(i);
    if (cache.found[k]) continue;
    const file = wd.get(`${i.lat.toFixed(5)},${i.lon.toFixed(5)}`);
    if (isPhoto(file)) { cache.found[k] = commonsPath(file); fromWd++; }
    else cache.found[k] = '';                    // looked, nothing usable
  }
  console.log(`  Wikidata filled ${fromWd} the articles could not`);

  /* c. stamp. `i` is the Commons path fragment rather than a URL: the
     filename appears twice in a thumbnail URL and the prefix is the same
     for every record, so storing the fragment is a quarter of the bytes
     for the same picture. js/record.js builds the URL back. */
  let has = 0;
  for (const item of items) {
    const p = cache.found[key(item)];
    if (p) { item.i = p; has++; } else delete item.i;
  }
  await writeJson('notable.json', doc);
  console.log(`  → ${has} of ${items.length} carry a photograph (${Math.round(100 * has / items.length)}%)`);
  return has;
}

/* ---------- 2. the city's own facilities ----------

   civic.json is 1,117 parks, pools, gymnasiums, markets and municipal
   libraries from opendata.paris.fr. Their coordinates are the city's own,
   not Wikidata's, so the exact-position join above cannot reach them and
   a nearest-neighbour one would be guessing. What is left is the name,
   looked up as an article title — and because the API normalises and
   follows redirects, a hit means an article actually called that, not
   something that merely sounds similar.

   The hit rate splits hard by what kind of thing it is, and the split is
   worth knowing before anybody wonders why half the section has pictures:
   about two in five squares and gardens have an article, a third of the
   museums, a sixth of the libraries, one municipal pool or gym in twenty,
   and no food market at all. Paris writes about its parks and not about
   its tennis courts.

   These are `subject` photographs — the article is about the place, so
   the picture is of the place. */

async function namedTier(cache) {
  const doc = await readJson('civic.json');
  const items = doc.items;

  const wanted = new Map();
  for (const item of items) {
    const q = (item.n || '').trim();
    if (!q) continue;
    if (!wanted.has(q)) wanted.set(q, []);
    wanted.get(q).push(item);
  }

  const fresh = [...wanted.keys()].filter(q => FORCE || cache.found[`n:${q}`] === undefined);
  console.log(`\ncivic.json — ${items.length} records, ${wanted.size} names, ${fresh.length} not looked up yet`);

  if (fresh.length) {
    console.log('  fr.wikipedia…');
    for (const [q, url] of await pageImages(fresh, 'fr')) {
      const f = fileFromUrl(url);
      if (isPhoto(f)) cache.found[`n:${q}`] = commonsPath(f);
    }
    const left = fresh.filter(q => !cache.found[`n:${q}`]);
    if (left.length) {
      console.log(`  en.wikipedia for ${left.length} remaining…`);
      for (const [q, url] of await pageImages(left, 'en')) {
        const f = fileFromUrl(url);
        if (isPhoto(f)) cache.found[`n:${q}`] = commonsPath(f);
      }
    }
    fresh.forEach(q => { if (cache.found[`n:${q}`] === undefined) cache.found[`n:${q}`] = ''; });
  }

  let has = 0;
  for (const [q, group] of wanted) {
    const frag = cache.found[`n:${q}`];
    for (const item of group) {
      if (frag) { item.i = frag; has++; } else delete item.i;
    }
  }
  await writeJson('civic.json', doc);
  console.log(`  → ${has} of ${items.length} carry a photograph (${Math.round(100 * has / items.length)}%)`);
  return has;
}

/* ---------- 3. photographs of somewhere, not something ----------

   An event is a concert on a Tuesday and a hand-written record is a
   particular café; neither has a free photograph of its own, and both sit
   somewhere that does. `area` already names it — a venue for the city's
   events, a street for the editorial records — so the lookup is the field
   the record already carries.

   These are stamped `context`, which is not a formality: `hasRealPhoto`
   in js/app.js only lets `subject` photographs lead a section, so a
   picture of the rue de Babylone can illustrate Coutume without ever
   being presented as a picture of Coutume. */

async function contextTier(cache, file) {
  const doc = await readJson(file);
  const items = doc.items || [];

  const wanted = new Map();                        // query -> [items]
  for (const item of items) {
    if (item.image && !FORCE) continue;
    const q = (item.area || '').trim();
    if (!q || q.length > 60) continue;             // an address is not an article
    if (!wanted.has(q)) wanted.set(q, []);
    wanted.get(q).push(item);
  }

  const fresh = [...wanted.keys()].filter(q => FORCE || cache.found[`q:${q}`] === undefined);
  console.log(`\n${file} — ${wanted.size} places named, ${fresh.length} not looked up yet`);

  if (fresh.length) {
    /* French Wikipedia first: it is far better on Paris streets, and an
       article about the rue Oberkampf only exists there. */
    console.log(`  fr.wikipedia…`);
    for (const [q, url] of await pageImages(fresh, 'fr')) {
      const f = fileFromUrl(url);
      if (isPhoto(f)) cache.found[`q:${q}`] = commonsPath(f);
    }
    const left = fresh.filter(q => !cache.found[`q:${q}`]);
    if (left.length) {
      console.log(`  en.wikipedia for ${left.length} remaining…`);
      for (const [q, url] of await pageImages(left, 'en')) {
        const f = fileFromUrl(url);
        if (isPhoto(f)) cache.found[`q:${q}`] = commonsPath(f);
      }
    }
    fresh.forEach(q => { if (cache.found[`q:${q}`] === undefined) cache.found[`q:${q}`] = ''; });
  }

  /* Same compact fragment as the sourced tier, and for the same reason —
     `events-city.json` is one of the files the first paint waits for, and
     a full thumbnail URL spends two hundred and seventy bytes per record
     to say what sixty can. `ik: 'c'` marks the frame as the surroundings
     rather than the thing; js/record.js expands both, and reads the
     subject off `area`, which is the field the lookup was made from. */
  let has = 0;
  for (const [q, group] of wanted) {
    const p = cache.found[`q:${q}`];
    if (!p) continue;
    for (const item of group) { item.i = p; item.ik = 'c'; has++; }
  }
  await writeJson(file, doc);
  console.log(`  → ${has} of ${items.length} carry a photograph (${Math.round(100 * has / (items.length || 1))}%)`);
  return has;
}

async function run() {
  console.log('\nFinding photographs for the generated tiers…\n');
  const cache = await readCache();
  const before = Object.keys(cache.found).length;

  const wd = await wikidataImages();

  await sourcedTier(cache, wd);
  await namedTier(cache);
  await contextTier(cache, 'events-city.json');
  await contextTier(cache, 'editorial.json');

  if (!DRY) {
    await fs.writeFile(CACHE, JSON.stringify(cache, null, 1) + '\n', 'utf8');
  }
  const n = Object.keys(cache.found).length;
  console.log(`\nCache: ${n} lookups remembered (${n - before} new). Run scripts/version.mjs next.\n`);
}

run().catch(e => { console.error(e); process.exit(1); });
