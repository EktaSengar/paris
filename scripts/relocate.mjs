#!/usr/bin/env node
/* ---------------------------------------------------------
   relocate.mjs — move the guide to a different home base.

   The whole site is built around one flat: "six minutes from your door",
   "twenty minutes up line 5". Two different things encode that, and only
   one of them can be automated.

     1. NUMBERS — `minutesFromHome` on every record. Computable, and this
        script recomputes all of them from the new coordinates.

     2. PROSE — sentences like "nine minutes from your flat" written into
        `why`, `transit` and `pairings`. Not computable. This script finds
        every one of them and prints the list, so a human rewrites the
        forty-odd that actually matter instead of re-reading two hundred.

   Usage:
     node scripts/relocate.mjs --where "Rue Oberkampf, Paris"    # move
     node scripts/relocate.mjs --where "..." --dry               # preview
     node scripts/relocate.mjs --audit                           # just list the prose

   Geocoding uses OpenStreetMap's Nominatim: no key, no account. It asks
   for an identifying User-Agent and one request per second, which is
   easy here because we make exactly one.
   --------------------------------------------------------- */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const UA = 'paris-for-you/1.0 (personal site; https://github.com/EktaSengar/paris)';

const args = process.argv.slice(2);
const flag = n => { const i = args.indexOf(n); return i === -1 ? null : args[i + 1]; };
const has  = n => args.includes(n);
const WHERE = flag('--where');
const DRY   = has('--dry');
const AUDIT = has('--audit');

/* Rough centroids of the twenty arrondissements. Good enough to estimate a
   journey; not a routing engine, and the script says so. */
const ARR = {
  1:[48.8626,2.3363],  2:[48.8683,2.3413],  3:[48.8637,2.3615],  4:[48.8546,2.3572],
  5:[48.8448,2.3501],  6:[48.8496,2.3329],  7:[48.8565,2.3120],  8:[48.8726,2.3120],
  9:[48.8768,2.3374],  10:[48.8760,2.3595], 11:[48.8578,2.3792], 12:[48.8351,2.4212],
  13:[48.8283,2.3626], 14:[48.8331,2.3264], 15:[48.8412,2.3000], 16:[48.8637,2.2769],
  17:[48.8872,2.3070], 18:[48.8925,2.3444], 19:[48.8871,2.3828], 20:[48.8635,2.3985]
};

const FILES = ['events.json','places.json','nightlife.json','sports.json',
               'food.json','itineraries.json','daytrips.json','neighborhoods.json'];

/* Anything that hard-codes the current home in words. */
const PROSE = /\b(from (your|the) (door|flat|street)|from home|minutes? from you|your own|your local|your street|walk from home|Gare du Nord|Gare de l'Est|Canal Saint-Martin|the 10th|10e|line 5 (?:goes )?(?:straight|direct))/i;

const km = (a, b) => {
  const R = 6371, toRad = d => d * Math.PI / 180;
  const dLat = toRad(b[0] - a[0]), dLon = toRad(b[1] - a[1]);
  const x = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};

/* Door-to-door estimate. Short hops are walked; longer ones assume a Metro
   with the access and waiting time that actually dominates a Paris journey. */
function minutes(from, to) {
  const d = km(from, to);
  const walk = d / 4.8 * 60;
  const transit = 4 + (d / 16) * 60 + 3;      // to the platform, ride, out again
  return Math.max(3, Math.round(Math.min(walk, transit)));
}

async function geocode(q) {
  const url = 'https://nominatim.openstreetmap.org/search'
    + `?q=${encodeURIComponent(q)}&format=json&limit=1&addressdetails=1`;
  const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`geocoder returned ${res.status}`);
  const [hit] = await res.json();
  if (!hit) throw new Error(`could not find "${q}"`);
  const arr = Number((hit.address?.postcode || '').slice(-2)) || null;
  return {
    label: (hit.display_name || q).split(',').slice(0, 2).join(',').trim(),
    lat: +(+hit.lat).toFixed(4),
    lon: +(+hit.lon).toFixed(4),
    arr: arr && arr >= 1 && arr <= 20 ? arr : null,
    city: hit.address?.city || hit.address?.town || 'Paris'
  };
}

async function load(file) {
  return JSON.parse(await fs.readFile(path.join(DATA, file), 'utf8'));
}

async function run() {
  const home = await load('home.json');
  const origin = [home.lat, home.lon];

  /* --- audit: which sentences name the current home? --- */
  const prose = [];
  for (const file of FILES) {
    const doc = await load(file);
    for (const item of (doc.items || [])) {
      const fields = ['why', 'transit', 'area', 'brief', 'note'];
      for (const f of fields) {
        if (typeof item[f] === 'string' && PROSE.test(item[f])) {
          prose.push(`${file} · ${item.id || item.arr} · ${f}`);
        }
      }
      for (const p of (item.pairings || [])) {
        if (PROSE.test(p.text || '')) prose.push(`${file} · ${item.id} · pairing "${p.text.slice(0, 40)}…"`);
      }
    }
  }

  if (AUDIT) {
    console.log(`\nProse naming the current home (${home.label}) — ${prose.length} places:\n`);
    prose.forEach(p => console.log('  · ' + p));
    console.log('\nThese need a human. Everything else is computed.\n');
    return;
  }

  if (!WHERE) {
    console.log('\nNothing to do. Pass --where "Somewhere, Paris" to move, or --audit to list the prose.\n');
    return;
  }

  /* --- move --- */
  console.log(`\nGeocoding "${WHERE}"…`);
  const to = await geocode(WHERE);
  const dest = [to.lat, to.lon];
  console.log(`  → ${to.label} (${to.lat}, ${to.lon})${to.arr ? ` · ${to.arr}e` : ''}`);
  console.log(`  moved ${km(origin, dest).toFixed(1)} km from ${home.label}\n`);

  let changed = 0, skipped = 0;
  const deltas = [];

  for (const file of FILES.filter(f => f !== 'neighborhoods.json')) {
    const doc = await load(file);
    for (const item of (doc.items || [])) {
      if (!item.arr || !ARR[item.arr]) { skipped++; continue; }   // outside Paris — needs a human
      const was = item.minutesFromHome;
      const now = minutes(dest, ARR[item.arr]);
      if (was !== now) { deltas.push([item.id, was, now]); changed++; }
      if (!DRY) item.minutesFromHome = now;
    }
    if (!DRY) await fs.writeFile(path.join(DATA, file), JSON.stringify(doc, null, 2) + '\n', 'utf8');
  }

  /* neighbourhood profiles carry their own distance */
  const hoods = await load('neighborhoods.json');
  for (const h of hoods.items || []) {
    if (!ARR[h.arr]) continue;
    h.minutesFromHome = h.arr === to.arr ? 0 : minutes(dest, ARR[h.arr]);
    h.isHome = h.arr === to.arr;
  }
  if (!DRY) {
    hoods.home = { arr: to.arr, label: to.label };
    await fs.writeFile(path.join(DATA, 'neighborhoods.json'), JSON.stringify(hoods, null, 2) + '\n', 'utf8');
    await fs.writeFile(path.join(DATA, 'home.json'), JSON.stringify({
      ...home, label: to.label, city: to.city, arr: to.arr, lat: to.lat, lon: to.lon,
      blurb: to.arr ? `${to.arr}ᵉ · ${to.label}` : to.label
    }, null, 2) + '\n', 'utf8');
  }

  console.log(`${DRY ? 'Would update' : 'Updated'} ${changed} travel times.`);
  console.log(`${skipped} records have no arrondissement (day trips, the suburbs) — left alone.\n`);

  console.log('Biggest changes:');
  deltas.sort((a, b) => Math.abs(b[2] - b[1]) - Math.abs(a[2] - a[1])).slice(0, 8)
    .forEach(([id, was, now]) => console.log(`  ${String(was).padStart(3)} → ${String(now).padStart(3)} min   ${id}`));

  console.log(`\nStill written in words, and not computable — ${prose.length} places:`);
  prose.slice(0, 12).forEach(p => console.log('  · ' + p));
  if (prose.length > 12) console.log(`  … and ${prose.length - 12} more (run --audit for the full list)`);
  console.log('\nThe numbers are estimates from arrondissement centroids, not routing.');
  console.log('Rewrite the prose above and the guide belongs to whoever lives there now.\n');
}

run().catch(e => { console.error('\n' + e.message + '\n'); process.exit(1); });
