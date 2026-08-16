#!/usr/bin/env node
/* ---------------------------------------------------------
   geocode.mjs — give every curated record a real position.

   `minutesFromHome` was written by hand for one flat in the 10th. That
   is the thing standing between this site and working for anyone else:
   a stored distance is only true from one place. Coordinates are true
   from everywhere, so distance becomes something the browser computes
   against whatever location you have chosen.

   Two passes, cheapest first:

     1. MATCH   the discovery index already holds 14k Paris places with
                positions. A lot of the curated list is in there under
                the same name — free, instant, and exact.
     2. GEOCODE whatever is left goes to Nominatim at one request per
                second, which is their published limit.

   Anything still unplaced falls back to its arrondissement centroid, and
   is reported so it can be fixed by hand if the distance matters.

   Usage:  node scripts/geocode.mjs [--dry] [--force]
   --------------------------------------------------------- */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const DRY   = process.argv.includes('--dry');
const FORCE = process.argv.includes('--force');
const UA = 'paris-for-you/1.0 (personal site; https://github.com/EktaSengar/paris)';

const ARR = {
  1:[48.8626,2.3363],  2:[48.8683,2.3413],  3:[48.8637,2.3615],  4:[48.8546,2.3572],
  5:[48.8448,2.3501],  6:[48.8496,2.3329],  7:[48.8565,2.3120],  8:[48.8726,2.3120],
  9:[48.8768,2.3374],  10:[48.8760,2.3595], 11:[48.8578,2.3792], 12:[48.8351,2.4212],
  13:[48.8283,2.3626], 14:[48.8331,2.3264], 15:[48.8412,2.3000], 16:[48.8637,2.2769],
  17:[48.8872,2.3070], 18:[48.8925,2.3444], 19:[48.8871,2.3828], 20:[48.8635,2.3985]
};

const FILES = ['events.json','places.json','nightlife.json','sports.json',
               'food.json','itineraries.json','daytrips.json'];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const norm = s => (s || '').toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/* A street address looks like "12 rue de Something"; an area description
   looks like "Three bakeries within a 15-minute walk". Only the first is
   worth sending to a geocoder. */
const looksLikeAddress = s =>
  /\d|\b(rue|avenue|boulevard|quai|place|passage|impasse|square|parc|bd|av)\b/i.test(s || '');

async function nominatim(q) {
  const url = 'https://nominatim.openstreetmap.org/search'
    + `?q=${encodeURIComponent(q)}&format=json&limit=1&countrycodes=fr`;
  const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) return null;
  const [hit] = await res.json();
  if (!hit) return null;
  return [+(+hit.lat).toFixed(5), +(+hit.lon).toFixed(5)];
}

async function run() {
  let discovered = { items: [] };
  try { discovered = JSON.parse(await fs.readFile(path.join(DATA, 'discovered.json'), 'utf8')); }
  catch { console.log('  (no discovery index yet — matching skipped)'); }

  const byName = new Map();
  for (const p of discovered.items) {
    const k = norm(p.n);
    if (k && !byName.has(k)) byName.set(k, [p.lat, p.lon]);
  }

  const todo = [];
  const docs = {};
  for (const f of FILES) {
    docs[f] = JSON.parse(await fs.readFile(path.join(DATA, f), 'utf8'));
    for (const it of docs[f].items || []) {
      if (it.coords && !FORCE) continue;
      todo.push({ file: f, it });
    }
  }
  console.log(`\n  ${todo.length} records need a position\n`);

  let matched = 0, geocoded = 0, fellBack = 0;
  const unplaced = [];

  /* pass 1 — free */
  for (const { it } of todo) {
    const hit = byName.get(norm(it.title));
    if (hit) { it.coords = hit; it.coordsFrom = 'osm-match'; matched++; }
  }
  console.log(`  matched against the discovery index: ${matched}`);

  /* pass 2 — one request a second */
  const remaining = todo.filter(({ it }) => !it.coords);
  console.log(`  geocoding ${remaining.filter(({it}) => looksLikeAddress(it.area)).length} addresses…\n`);

  for (const { it } of remaining) {
    if (looksLikeAddress(it.area)) {
      const q = `${it.area}, Paris, France`;
      try {
        const hit = await nominatim(q);
        if (hit) { it.coords = hit; it.coordsFrom = 'nominatim'; geocoded++; }
      } catch {}
      await sleep(1100);                               // their published limit
    }
    if (!it.coords) {
      if (it.arr && ARR[it.arr]) { it.coords = ARR[it.arr]; it.coordsFrom = 'arr-centroid'; fellBack++; }
      else unplaced.push(it.id);
    }
  }

  if (!DRY) {
    for (const f of FILES) {
      await fs.writeFile(path.join(DATA, f), JSON.stringify(docs[f], null, 2) + '\n', 'utf8');
    }
  }

  console.log(`\n  geocoded exactly:        ${geocoded}`);
  console.log(`  fell back to centroid:   ${fellBack}`);
  console.log(`  no position at all:      ${unplaced.length}${unplaced.length ? '  ' + unplaced.join(', ') : ''}`);
  console.log(`\n  ${DRY ? 'dry run — nothing written' : 'written'}\n`);
}

console.log('\nPlacing the curated catalogue…');
run().catch(e => { console.error('\n' + e.message + '\n'); process.exit(1); });
