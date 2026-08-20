#!/usr/bin/env node
/* ---------------------------------------------------------
   editorial.mjs — resolve researched recommendations against real places.

   data/editorial.json is written by hand, and hand-written data rots in
   two specific ways: coordinates get mistyped, and places get recommended
   that do not exist. So the file carries neither. Each record says only
   which place it is talking about —

       "match": { "name": "Ten Belles", "arr": 10, "type": "cafe" }

   — and this fills in the id, the coordinates and the official link from
   the discovery index. A record that matches nothing is reported and
   dropped rather than shipped, which makes inventing a café impossible
   by construction.

   Run it after editing editorial.json. It rewrites the file in place,
   keeping every hand-written field exactly as written.

   Usage:  node scripts/editorial.mjs [--check]
           --check   report and exit non-zero, change nothing (for CI)
   --------------------------------------------------------- */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRecord } from './shim.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const CHECK = process.argv.includes('--check');

const read = async f => JSON.parse(await fs.readFile(path.join(DATA, f + '.json'), 'utf8'));
const flat = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/* Not a copy of the browser's id rule — the browser's id rule. Every
   note in data/notes.json is keyed by it, so a second implementation
   drifting by one character silently orphans them all. */
const { Rec } = loadRecord();
const compactId = Rec.compactId;

/* Exact name first, then a contains match, then the same words in any
   order — enough slack for "Boulangerie Utopie" vs "Utopie", not enough
   to match a different shop. */
function findPlace(pool, m) {
  const want = flat(m.name);
  const inArr = pool.filter(p => (m.arr == null || p.a === m.arr) &&
                                 (m.type == null || p.c === m.type));
  const exact = inArr.find(p => flat(p.n) === want);
  if (exact) return exact;
  const partial = inArr.filter(p => flat(p.n).includes(want) || want.includes(flat(p.n)));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) {
    /* Prefer the one whose name is closest in length to what was asked for. */
    return partial.sort((a, b) =>
      Math.abs(flat(a.n).length - want.length) - Math.abs(flat(b.n).length - want.length))[0];
  }
  const words = want.split(' ').filter(w => w.length > 2);
  const loose = inArr.filter(p => words.length && words.every(w => flat(p.n).includes(w)));
  return loose.length === 1 ? loose[0] : null;
}

async function run() {
  const doc = await read('editorial');
  const disc = await read('discovered');
  const pool = disc.items || [];

  const missed = [];
  let resolved = 0;

  const items = doc.items.map(rec => {
    if (!rec.match) { missed.push(`${rec.title || rec.id || '?'} — no "match" block`); return rec; }
    const hit = findPlace(pool, rec.match);
    if (!hit) { missed.push(`${rec.match.name} (${rec.match.arr}e ${rec.match.type || ''})`); return null; }
    resolved++;

    /* Hand-written fields win; the machine only fills in what it knows. */
    const { match, ...written } = rec;
    return {
      id: compactId(hit),
      title: hit.n,
      type: hit.c,
      arr: hit.a,
      coords: [hit.lat, hit.lon],
      area: hit.s || null,
      url: hit.w || null,
      cuisine: hit.k || null,
      categories: [['cafe','bakery','restaurant','market','deli'].includes(hit.c) ? 'food' : hit.c],
      match,
      ...written
    };
  }).filter(Boolean);

  const byArr = {}, byType = {};
  items.forEach(i => { byArr[i.arr] = (byArr[i.arr] || 0) + 1; byType[i.type] = (byType[i.type] || 0) + 1; });

  console.log(`\n  ${resolved} of ${doc.items.length} resolved against the discovery index`);
  if (Object.keys(byType).length) console.log('  by kind:', Object.entries(byType).map(([k, n]) => `${k}:${n}`).join(' '));
  if (Object.keys(byArr).length) console.log('  per arrondissement:', Object.entries(byArr)
    .sort((a, b) => a[0] - b[0]).map(([a, n]) => `${a}:${n}`).join(' '));

  if (missed.length) {
    console.log(`\n  ${missed.length} could not be matched and were dropped:`);
    missed.forEach(m => console.log('    ✗ ' + m));
    console.log('\n  Either the name is wrong, or OpenStreetMap has never heard of the place.');
    console.log('  The second happens more than you would think — newer independent shops');
    console.log('  are the weak spot. A handwritten note in notes.json is the way in.\n');
  } else {
    console.log('  every record matched a real place\n');
  }

  if (CHECK) { process.exit(missed.length ? 1 : 0); }

  doc.generated = new Date().toISOString().slice(0, 10);
  doc.items = items;
  await fs.writeFile(path.join(DATA, 'editorial.json'), JSON.stringify(doc, null, 1) + '\n', 'utf8');
  console.log('  wrote data/editorial.json\n');
}

run().catch(e => { console.error('\n' + e.message + '\n'); process.exit(1); });
