#!/usr/bin/env node
/* ---------------------------------------------------------
   invaders.mjs — the mosaics, so the hunt is real.

   Invader has been cementing tile mosaics to Paris walls since 1998 and
   the city is the board of a game he invented: each piece has a code,
   you find it, you photograph it. It is the best possible excuse to walk
   down a street you would otherwise have no reason to walk down, which
   is the whole point of the Sport → Play section.

   The card would be worth having as prose alone. It is worth much more
   than that because the positions are open data: OpenStreetMap carries
   them as `artwork_type=mosaic` with `artist_name=Invader`, most of them
   with the artist's own reference code. So "three within a ten-minute
   walk" is a fact the site can check rather than a suggestion it makes.

   One honest limit, and the interface repeats it: this is what OSM
   knows, not what exists. Invader has put up something like 1,500 pieces
   in Paris; about 400 are mapped, and many of those are gone — painted
   over, fallen, or taken. A hunt that promised completeness would be
   lying. A hunt that says "here are four the map knows about near you"
   is telling the truth and is still a good afternoon.

   Usage:  node scripts/invaders.mjs [--dry]
   --------------------------------------------------------- */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const DRY  = process.argv.includes('--dry');

const BBOX = '48.812,2.246,48.908,2.422';
const MIRRORS = ['https://overpass-api.de/api/interpreter',
                 'https://overpass.kumi.systems/api/interpreter',
                 'https://overpass.private.coffee/api/interpreter'];

const ARR = {
  1:[48.8626,2.3363],  2:[48.8683,2.3413],  3:[48.8637,2.3615],  4:[48.8546,2.3572],
  5:[48.8448,2.3501],  6:[48.8496,2.3329],  7:[48.8565,2.3120],  8:[48.8726,2.3120],
  9:[48.8768,2.3374],  10:[48.8760,2.3595], 11:[48.8578,2.3792], 12:[48.8351,2.4212],
  13:[48.8283,2.3626], 14:[48.8331,2.3264], 15:[48.8412,2.3000], 16:[48.8637,2.2769],
  17:[48.8872,2.3070], 18:[48.8925,2.3444], 19:[48.8871,2.3828], 20:[48.8635,2.3985]
};
const near = (lat, lon) => {
  let best = null, bd = Infinity;
  for (const [n, [a, b]] of Object.entries(ARR)) {
    const d = (a - lat) ** 2 + (b - lon) ** 2;
    if (d < bd) { bd = d; best = Number(n); }
  }
  return best;
};

const clean = s => (s || '').replace(/\s+/g, ' ').trim();

async function overpass(query) {
  let lastErr;
  for (const host of MIRRORS) {
    try {
      const res = await fetch(host, {
        method: 'POST',
        headers: { 'content-type': 'text/plain',
                   'user-agent': 'paris-for-you/1.0 (https://github.com/EktaSengar/paris)' },
        body: query,
        signal: AbortSignal.timeout(180000)
      });
      if (!res.ok) { lastErr = new Error(`${host} → ${res.status}`); continue; }
      const json = await res.json();
      if (!json.elements || !json.elements.length) { lastErr = new Error(`${host} returned nothing`); continue; }
      return json;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('every Overpass mirror failed');
}

async function run() {
  console.log('\nFinding the Invaders…\n');

  /* Mosaics, plus anything explicitly attributed to him that is not
     tagged as a mosaic. The artist filter runs here rather than in the
     query because a regex over every artwork in Paris times Overpass
     out, while 470 mosaics come back in seconds. */
  const q = `[out:json][timeout:180];(` +
    `node["artwork_type"="mosaic"](${BBOX});` +
    `way["artwork_type"="mosaic"](${BBOX});` +
    `node["tourism"="artwork"]["artist_name"~"nvader"](${BBOX});` +
    `);out center tags;`;

  const data = await overpass(q);
  const isInvader = t => /invader/i.test(t.artist_name || '') || /invader/i.test(t.name || '');

  const seen = new Set();
  const items = [];
  for (const el of data.elements) {
    const t = el.tags || {};
    if (!isInvader(t)) continue;
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat == null || lon == null) continue;

    /* The artist's own code is the identity. Where a piece has none, its
       rounded position stands in — stable enough to remember that you
       found it, which is all the id has to do. */
    const code = clean(t.ref) ||
      `at-${Math.round(lat * 2000)}-${Math.round(lon * 2000)}`;
    if (seen.has(code)) continue;
    seen.add(code);

    items.push({
      c: code,
      lat: +lat.toFixed(5),
      lon: +lon.toFixed(5),
      a: near(lat, lon),
      ...(t['addr:street'] ? { s: clean(t['addr:street']).slice(0, 60) } : {}),
      ...(t.description ? { x: clean(t.description).slice(0, 120) } : {}),
      ...(t.level ? { l: clean(t.level).slice(0, 12) } : {}),
      ...(t['check_date'] || t['survey:date']
        ? { v: clean(t['check_date'] || t['survey:date']).slice(0, 4) } : {})
    });
  }

  items.sort((a, b) => a.c.localeCompare(b.c, 'en', { numeric: true }));

  const spread = {};
  items.forEach(p => { spread[p.a] = (spread[p.a] || 0) + 1; });

  console.log(`  ${items.length} mosaics, ${items.filter(i => !i.c.startsWith('at-')).length} with the artist's code`);
  console.log(`  ${items.filter(i => i.x).length} with a description`);
  console.log('  per arrondissement:', Object.entries(spread)
    .sort((a, b) => a[0] - b[0]).map(([a, n]) => `${a}:${n}`).join(' '));

  if (DRY) { console.log('\n  --dry, nothing written\n'); return; }

  const doc = {
    generated: new Date().toISOString().slice(0, 10),
    source: 'OpenStreetMap via Overpass · ODbL',
    note: 'Invader mosaics as OpenStreetMap has them. Not a complete list and never claims to be: the artist has put up roughly 1,500 pieces in Paris, a few hundred are mapped, and some of those are painted over or gone. The hunt is honest about that — it offers what the map knows within a walk, not a checklist of everything that exists.',
    items
  };
  await fs.writeFile(path.join(DATA, 'invaders.json'), JSON.stringify(doc) + '\n', 'utf8');
  const kb = Math.round((await fs.stat(path.join(DATA, 'invaders.json'))).size / 1024);
  console.log(`\n  wrote data/invaders.json — ${kb} KB\n`);
}

run().catch(e => { console.error('\n' + e.message + '\n'); process.exit(1); });
