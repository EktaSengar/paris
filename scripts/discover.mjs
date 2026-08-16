#!/usr/bin/env node
/* ---------------------------------------------------------
   discover.mjs — build a Paris-wide index of real places.

   The curated catalogue is opinionated but small, and it was written by
   someone living in the 10th. That is fine for the 10th and useless for
   the 15th. This builds the other half: every named bakery, café,
   market, park, museum, pool and bar in Paris, so that changing the home
   location changes what there *is* nearby, not merely how far away the
   old list happens to be.

   Two layers, deliberately different in kind:

     curated     ~90 places with a reason to care, photographs, pairings.
                 Ranked first. This is the voice.
     discovered  ~thousands of places with a name, a category and a
                 position. No opinion, and the interface never pretends
                 otherwise — they fill in the map, they do not review it.

   Queried at BUILD time, not in the browser: Overpass rate-limits and
   times out under load, and a static site should not depend on a third
   party being awake. The daily Action refreshes it.

   Usage:  node scripts/discover.mjs [--dry]
   --------------------------------------------------------- */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const DRY  = process.argv.includes('--dry');
const ONLY = (() => { const i = process.argv.indexOf('--only'); return i === -1 ? null : process.argv[i + 1].split(','); })();

const BBOX = '48.812,2.246,48.908,2.422';          // Paris intra-muros, generously
/* Full-planet mirrors only. overpass.osm.ch looks like a mirror and is a
   Switzerland-only extract — it answers 200 with zero elements, which the
   first version of this happily recorded as "Paris has no restaurants". */
const MIRRORS = ['https://overpass-api.de/api/interpreter',
                 'https://overpass.kumi.systems/api/interpreter',
                 'https://overpass.private.coffee/api/interpreter'];

/* Arrondissement centroids — used to label a point, and to sanity-check
   coverage. Nearest centroid, not point-in-polygon: good enough to say
   "5e" next to a name, and never used for distance. */
const ARR = {
  1:[48.8626,2.3363],  2:[48.8683,2.3413],  3:[48.8637,2.3615],  4:[48.8546,2.3572],
  5:[48.8448,2.3501],  6:[48.8496,2.3329],  7:[48.8565,2.3120],  8:[48.8726,2.3120],
  9:[48.8768,2.3374],  10:[48.8760,2.3595], 11:[48.8578,2.3792], 12:[48.8351,2.4212],
  13:[48.8283,2.3626], 14:[48.8331,2.3264], 15:[48.8412,2.3000], 16:[48.8637,2.2769],
  17:[48.8872,2.3070], 18:[48.8925,2.3444], 19:[48.8871,2.3828], 20:[48.8635,2.3985]
};

/* What to pull, and how strict to be.

   `quality` exists because OpenStreetMap contains every kebab counter in
   the city with equal enthusiasm. Requiring a website or opening hours is
   a weak but real signal that somebody maintains the place — and it keeps
   the shipped file from becoming a phone book. */
const LAYERS = [
  { cat:'bakery',     emoji:'🥐', label:'Bakery',      q:['node["shop"="bakery"]','node["shop"="pastry"]'], quality:false },
  { cat:'cafe',       emoji:'☕', label:'Coffee',      q:['node["amenity"="cafe"]'],                        quality:true  },
  { cat:'restaurant', emoji:'🍽️', label:'Restaurant',  q:['node["amenity"="restaurant"]["website"]','node["amenity"="restaurant"]["opening_hours"]'], quality:true  },
  { cat:'market',     emoji:'🧺', label:'Market',      q:['node["amenity"="marketplace"]','way["amenity"="marketplace"]'], quality:false },
  { cat:'deli',       emoji:'🧀', label:'Food shop',   q:['node["shop"="cheese"]','node["shop"="chocolate"]','node["shop"="wine"]','node["shop"="greengrocer"]'], quality:false },
  { cat:'park',       emoji:'🌳', label:'Park',        q:['way["leisure"="park"]','way["leisure"="garden"]'], quality:false, minName:true },
  { cat:'museum',     emoji:'🏛️', label:'Museum',      q:['node["tourism"="museum"]','way["tourism"="museum"]','node["tourism"="gallery"]'], quality:false },
  { cat:'sport',      emoji:'🏃', label:'Sport',       q:['way["leisure"="sports_centre"]','node["leisure"="sports_centre"]','way["leisure"="swimming_pool"]["access"!="private"]','node["leisure"="fitness_centre"]','node["leisure"="pitch"]["sport"="tennis"]'], quality:false },
  { cat:'nightlife',  emoji:'🍸', label:'Bar',         q:['node["amenity"="bar"]','node["amenity"="pub"]','node["amenity"="nightclub"]'], quality:true },
  { cat:'culture',    emoji:'🎭', label:'Culture',     q:['node["amenity"="theatre"]','node["amenity"="cinema"]','node["amenity"="arts_centre"]'], quality:false },
  { cat:'books',      emoji:'📚', label:'Bookshop',    q:['node["shop"="books"]'],                          quality:false }
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* Overpass throttles hard: 429 when you have used your slot, 504 when the
   instance is busy. Both are worth waiting out rather than failing — the
   first version of this script read a 429 as "no restaurants in Paris". */
async function overpass(query, attempt = 0) {
  let lastErr;
  for (const host of MIRRORS) {
    try {
      const res = await fetch(host, {
        method: 'POST',
        headers: { 'content-type': 'text/plain',
                   'user-agent': 'paris-for-you/1.0 (https://github.com/EktaSengar/paris)' },
        body: query,
        signal: AbortSignal.timeout(240000)
      });
      if (res.status === 429 || res.status === 504) {
        lastErr = new Error(`${host} → ${res.status}`);
        continue;                                       // try the next mirror first
      }
      if (!res.ok) { lastErr = new Error(`${host} → ${res.status}`); continue; }
      const text = await res.text();
      let json;
      try { json = JSON.parse(text); }
      catch { lastErr = new Error('non-JSON reply (throttled)'); continue; }
      // Treat an empty answer as suspect rather than authoritative.
      if (!json.elements || !json.elements.length) {
        lastErr = new Error(`${host} returned nothing`);
        continue;
      }
      return json;
    } catch (e) { lastErr = e; }
  }
  if (attempt < 4) {
    const wait = 30000 * (attempt + 1);
    process.stdout.write(`(throttled, waiting ${wait / 1000}s) `);
    await sleep(wait);
    return overpass(query, attempt + 1);
  }
  throw lastErr || new Error('every Overpass mirror failed');
}

const near = (lat, lon) => {
  let best = null, bd = Infinity;
  for (const [n, [a, b]] of Object.entries(ARR)) {
    const d = (a - lat) ** 2 + (b - lon) ** 2;
    if (d < bd) { bd = d; best = Number(n); }
  }
  return best;
};

/* Some names are shouty or duplicated across a chain; keep it tidy. */
const clean = s => s.replace(/\s+/g, ' ').trim().slice(0, 60);

async function run() {
  const out = [];
  const counts = {};

  for (const layer of LAYERS.filter(l => !ONLY || ONLY.includes(l.cat))) {
    const body = `[out:json][timeout:180];(${layer.q.map(q => `${q}(${BBOX});`).join('')});out center tags;`;
    process.stdout.write(`  ${layer.label.padEnd(11)} `);

    let data;
    try { data = await overpass(body); }
    catch (e) { console.log(`failed — ${e.message}`); continue; }

    let kept = 0;
    for (const el of data.elements) {
      const t = el.tags || {};
      if (!t.name) continue;
      if (layer.quality && !(t.website || t['contact:website'] || t.opening_hours)) continue;

      const lat = el.lat ?? el.center?.lat;
      const lon = el.lon ?? el.center?.lon;
      if (lat == null || lon == null) continue;

      out.push({
        n: clean(t.name),
        c: layer.cat,
        lat: +lat.toFixed(5),
        lon: +lon.toFixed(5),
        a: near(lat, lon),
        ...(t['addr:street'] ? { s: clean(t['addr:street']) } : {}),
        ...(t.website || t['contact:website'] ? { w: (t.website || t['contact:website']).slice(0, 120) } : {}),
        ...(t.cuisine ? { k: t.cuisine.split(';')[0].slice(0, 24) } : {})
      });
      kept++;
    }
    counts[layer.cat] = kept;
    console.log(`${String(kept).padStart(5)} kept  (of ${data.elements.length})`);
    await sleep(1500);                                  // be a good citizen
  }

  /* De-duplicate: OSM often has the same shop as a node and a way. */
  const seen = new Set();
  const items = out.filter(p => {
    const key = `${p.c}|${p.n.toLowerCase()}|${p.lat.toFixed(3)}|${p.lon.toFixed(3)}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });

  const spread = {};
  items.forEach(p => { spread[p.a] = (spread[p.a] || 0) + 1; });

  const doc = {
    generated: new Date().toISOString().slice(0, 10),
    source: 'OpenStreetMap via Overpass · ODbL',
    note: 'Names, categories and positions only — no opinions. The curated files carry the judgement; this carries the coverage, so that changing location changes what exists nearby rather than only how far away the old list is.',
    counts,
    items
  };

  console.log(`\n  ${items.length} places after de-duplication`);
  console.log('  per arrondissement:', Object.entries(spread)
    .sort((a, b) => a[0] - b[0]).map(([a, n]) => `${a}:${n}`).join(' '));

  if (DRY) { console.log('\n  --dry, nothing written\n'); return; }

  if (ONLY) {
    // keep everything we already have for the categories we did not re-run
    let prev = { items: [], counts: {} };
    try { prev = JSON.parse(await fs.readFile(path.join(DATA, 'discovered.json'), 'utf8')); } catch {}
    doc.items = prev.items.filter(p => !ONLY.includes(p.c)).concat(doc.items);
    doc.counts = { ...prev.counts, ...doc.counts };
    console.log(`  merged with existing → ${doc.items.length} total`);
  }
  await fs.writeFile(path.join(DATA, 'discovered.json'), JSON.stringify(doc) + '\n', 'utf8');
  const kb = Math.round((await fs.stat(path.join(DATA, 'discovered.json'))).size / 1024);
  console.log(`\n  wrote data/discovered.json — ${kb} KB\n`);
}

console.log('\nDiscovering Paris from OpenStreetMap…\n');
run().catch(e => { console.error('\n' + e.message + '\n'); process.exit(1); });
