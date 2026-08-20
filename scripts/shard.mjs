#!/usr/bin/env node
/* ---------------------------------------------------------
   shard.mjs — split the discovery index by arrondissement.

   22,635 places is 3.3 MB of JSON, and every visitor fetched all of it
   before the page could say anything — including the nineteen
   arrondissements they were not standing in.

   Worth being accurate about the cost, because the raw number overstates
   it: Pages serves this gzipped, so the wire cost is 778 KB rather than
   3.3 MB. Still the largest thing the site asks for by a wide margin,
   still ahead of the first paint, and still mostly irrelevant to the
   question being asked.

   So the index is written as twenty files and the browser fetches the
   ones it needs first — about 150 KB compressed — paints, and then pulls
   the rest in the background. What it must never do is *stay* partial:
   a section quietly returning fewer results because a file has not
   arrived is the same class of bug as location not reaching retrieval,
   and it would not look like a bug. See the note in js/app.js.

   Only the `found` layer is split. The tiers that carry judgement are
   small and every one of them is needed city-wide — `beyond()` answers
   "worth the trip" from them and would be wrong with a partial file.

   Usage:  node scripts/shard.mjs [--dry]
   --------------------------------------------------------- */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const OUT  = path.join(DATA, 'places');
const DRY  = process.argv.includes('--dry');

/* Places with no arrondissement — a handful, on the edge of the bbox —
   go here rather than being dropped. Loaded with the first batch. */
const ORPHANS = 'x';

export async function shard(doc) {
  const by = new Map();
  for (const p of doc.items) {
    const key = p.a ? String(p.a) : ORPHANS;
    if (!by.has(key)) by.set(key, []);
    by.get(key).push(p);
  }

  const shards = {};
  for (const [key, items] of by) shards[key] = { n: items.length };

  const manifest = {
    generated: doc.generated,
    source: doc.source,
    note: doc.note,
    counts: doc.counts,
    shards
  };

  if (DRY) return { manifest, by };

  await fs.mkdir(OUT, { recursive: true });
  /* Clear first: an arrondissement that empties out between runs must
     not leave last week's file behind for the browser to find. */
  for (const f of await fs.readdir(OUT).catch(() => [])) {
    if (f.endsWith('.json')) await fs.unlink(path.join(OUT, f));
  }

  for (const [key, items] of by) {
    await fs.writeFile(path.join(OUT, `${key}.json`),
      JSON.stringify({ a: key, items }) + '\n', 'utf8');
  }
  await fs.writeFile(path.join(OUT, 'index.json'),
    JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  return { manifest, by };
}

/* Read every shard back as one document — for the Node scripts, which
   have no reason to care that the browser fetches it in pieces. */
export async function readShards() {
  const manifest = JSON.parse(await fs.readFile(path.join(OUT, 'index.json'), 'utf8'));
  const items = [];
  for (const key of Object.keys(manifest.shards)) {
    const doc = JSON.parse(await fs.readFile(path.join(OUT, `${key}.json`), 'utf8'));
    items.push(...doc.items);
  }
  return { ...manifest, items };
}

/* Run directly: split whatever data/discovered.json holds, then retire it. */
if (import.meta.url === `file://${process.argv[1]}`) {
  const src = path.join(DATA, 'discovered.json');
  const doc = JSON.parse(await fs.readFile(src, 'utf8'));
  const { by } = await shard(doc);

  const rows = [...by.entries()].sort((a, b) =>
    (a[0] === ORPHANS ? 99 : +a[0]) - (b[0] === ORPHANS ? 99 : +b[0]));
  console.log(`\nSplit ${doc.items.length} places into ${rows.length} shards\n`);
  for (const [key, items] of rows) {
    const kb = DRY ? 0 : Math.round((await fs.stat(path.join(OUT, `${key}.json`))).size / 1024);
    console.log(`  ${String(key).padStart(3)}  ${String(items.length).padStart(5)} places  ${String(kb).padStart(4)} KB`);
  }
  if (!DRY) {
    await fs.unlink(src).catch(() => {});
    console.log(`\n  wrote data/places/ and retired data/discovered.json\n`);
  } else {
    console.log('\n  --dry, nothing written\n');
  }
}
