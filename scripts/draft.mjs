#!/usr/bin/env node
/* ---------------------------------------------------------
   draft.mjs — start a handwritten note.

   data/notes.json is keyed by place id, and the ids for places found on
   the map are built from a name and a rounded coordinate. Nobody should
   ever have to work one out by hand — the first attempt at it in this
   repo got the rounding wrong, because JavaScript rounds a .5 up and
   Python rounds it to even. So the machine does it.

   Search for a place, pick it, and this writes a stub into notes.json
   with everything already known about it, leaving you the one field that
   cannot be generated.

   Usage:  node scripts/draft.mjs mosquee
           node scripts/draft.mjs "du pain et des idees"
           node scripts/draft.mjs strada --write
   --------------------------------------------------------- */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRecord, readDiscovered } from './shim.mjs';

const { Rec } = loadRecord();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const WRITE = process.argv.includes('--write');
const terms = process.argv.slice(2).filter(a => !a.startsWith('--')).join(' ').trim();

if (!terms) {
  console.error('\n  What are you looking for?\n\n    node scripts/draft.mjs mosquee\n');
  process.exit(1);
}

const read = async f => JSON.parse(await fs.readFile(path.join(DATA, f + '.json'), 'utf8'));
const flat = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/* Not a copy of the browser's id rule — the browser's id rule. Change
   it in js/record.js and every existing note id changes with it. */
const osmId = Rec.compactId;

const ARR_NAMES = {
  1:'Louvre', 2:'Bourse', 3:'Haut Marais', 4:'Marais', 5:'Latin Quarter', 6:'Saint-Germain',
  7:'Invalides', 8:'Champs-Élysées', 9:'SoPi', 10:'Canal Saint-Martin', 11:'Oberkampf',
  12:'Bercy', 13:'Butte-aux-Cailles', 14:'Montparnasse', 15:'Vaugirard', 16:'Passy',
  17:'Batignolles', 18:'Montmartre', 19:'Buttes-Chaumont', 20:'Belleville'
};

async function run() {
  const disc = await readDiscovered();
  const curatedFiles = ['places', 'nightlife', 'sports', 'food', 'events', 'itineraries', 'daytrips'];

  const hits = [];
  for (const f of curatedFiles) {
    const d = await read(f).catch(() => ({ items: [] }));
    for (const i of d.items || []) {
      if (flat(i.title).includes(flat(terms)))
        hits.push({ id: i.id, name: i.title, cat: i.type, arr: i.arr, from: f + '.json', curated: true });
    }
  }
  for (const p of disc.items || []) {
    if (flat(p.n).includes(flat(terms)))
      hits.push({ id: osmId(p), name: p.n, cat: p.c, arr: p.a, street: p.s, url: p.w,
                  cuisine: p.k, from: 'the map' });
  }

  if (!hits.length) {
    console.log(`\n  Nothing matching “${terms}”.`);
    console.log('  OpenStreetMap has real gaps — some newer independent shops simply are not in it.');
    console.log('  You can still write a note; it just needs a place to attach to.\n');
    return;
  }

  console.log(`\n  ${hits.length} match${hits.length === 1 ? '' : 'es'} for “${terms}”:\n`);
  hits.slice(0, 12).forEach((h, n) => {
    const where = [h.arr ? `${h.arr}e ${ARR_NAMES[h.arr] || ''}`.trim() : null, h.street].filter(Boolean).join(' · ');
    console.log(`  ${String(n + 1).padStart(2)}. ${h.name}`);
    console.log(`      ${[h.cat, where, h.curated ? 'already written up' : h.from].filter(Boolean).join('  ·  ')}`);
    console.log(`      ${h.id}\n`);
  });
  if (hits.length > 12) console.log(`  …and ${hits.length - 12} more. Try a narrower search.\n`);

  const pick = hits[0];
  const stub = {
    why: `TODO — what is it actually like, and what should they order? Delete this line if you have nothing to say yet.`,
    ...(pick.curated ? {} : { quality: 4, uniqueness: 3 })
  };

  console.log('  ── stub for the first match ' + '─'.repeat(38));
  console.log(`  "${pick.id}": ${JSON.stringify(stub, null, 2).split('\n').join('\n  ')}`);
  console.log('  ' + '─'.repeat(64) + '\n');

  if (!WRITE) {
    console.log('  Copy that into data/notes.json under "items", or re-run with --write.\n');
    return;
  }

  const notes = await read('notes');
  if (notes.items[pick.id]) {
    console.log(`  ${pick.name} already has a note. Left alone.\n`);
    return;
  }
  notes.items[pick.id] = stub;
  await fs.writeFile(path.join(DATA, 'notes.json'), JSON.stringify(notes, null, 2) + '\n', 'utf8');
  console.log(`  Added a stub for ${pick.name}. Open data/notes.json and write the why.\n`);
}

run().catch(e => { console.error('\n' + e.message + '\n'); process.exit(1); });
