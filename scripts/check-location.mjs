#!/usr/bin/env node
/* ---------------------------------------------------------
   check-location.mjs — does changing location change the answers?

   This exists because the site once passed every eyeball test while
   being completely broken. Point it at the 5th and the Eat tab showed
   Boot Café, Ten Belles, Café Oberkampf and Holybelly — the 10th's
   cafés — each with a correctly recalculated travel time next to it.
   Distance was flowing through the ranking; it was not reaching the
   retrieval, and nothing on screen said so.

   So the test is not "did the numbers change". It is: for a set of
   locations across the city, does the top of each section share names?
   Two locations that return the same five places have not moved,
   whatever the minutes say.

   Runs the real js/ modules against the real data/ files — no mocks, no
   second copy of the logic to drift out of step.

   Usage:  node scripts/check-location.mjs [--verbose]
   --------------------------------------------------------- */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERBOSE = process.argv.includes('--verbose');
const read = f => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f + '.json'), 'utf8'));

/* ---------- enough of a browser to load the modules ---------- */

const Store = {
  rating: () => null, isDone: () => false, tasteWeights: () => ({}),
  arrs: () => [], hasArr: () => false, seenRecently: () => false,
  questDone: () => [], seedQuest: () => {}, setRating: () => null,
  wants: () => [], doneIds: () => [], toggleQuest: () => [], toggleArr: () => false,
  markSeen: () => {}
};
const localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

function load(file, name, extra = {}) {
  const src = fs.readFileSync(path.join(ROOT, 'js', file), 'utf8');
  const keys = ['Store', 'localStorage', 'navigator', 'fetch', 'console', ...Object.keys(extra)];
  const vals = [Store, localStorage, {}, () => { throw new Error('no network in tests'); },
                console, ...Object.values(extra)];
  return new Function(...keys, `${src}\n; return ${name};`)(...vals);
}

const Loc  = load('location.js', 'Loc');
const Near = load('nearby.js',   'Near');

/* ---------- the two layers, built the way app.js builds them ---------- */

const D = {};
for (const n of ['events','places','nightlife','sports','food','itineraries','daytrips','discovered'])
  D[n] = read(n);

const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const curatedNames = new Set([].concat(
  D.events.items, D.places.items, D.nightlife.items, D.sports.items, D.food.items
).map(i => norm(i.title)));

const DISCOVERED = D.discovered.items
  .filter(p => !curatedNames.has(norm(p.n)))
  .map(p => ({
    id: 'osm-' + norm(p.n).replace(/[^a-z0-9]+/g, '-') + '-' + Math.round(p.lat * 2000),
    title: p.n, type: p.c, arr: p.a, coords: [p.lat, p.lon], area: p.s || null,
    url: p.w || null, cuisine: p.k || null, discovered: true,
    branded: !!p.b, noted: !!p.d, quality: 3, uniqueness: 2, categories: [p.c],
    goodFor: [], labels: []
  }));

const ALL = [].concat(D.events.items, D.places.items, D.nightlife.items,
                      D.sports.items, D.food.items, D.itineraries.items, D.daytrips.items);

Loc.boot(Loc.fromArr(1));
Near.use(ALL, DISCOVERED);

function at(arr) {
  Loc.explore(Loc.fromArr(arr));
  [...ALL, ...DISCOVERED].forEach(i => {
    const m = Loc.minutesTo(i);
    if (m != null) i.minutesFromHome = m;
  });
}

/* ---------- what to check ----------

   How much overlap is honest depends on the kind of thing. You walk to a
   bakery, so two neighbourhoods sharing even one of their best five is
   worth a second look. A museum in the 3rd genuinely is fifteen minutes
   from both the 10th and the 5th, and a test that called that a failure
   would be testing for a lie. */

const KINDS = [
  ['cafe',       'walk', 0],
  ['bakery',     'walk', 0],
  ['restaurant', 'walk', 0],
  /* Markets are the sparsest category in the city — a couple of hundred
     against five thousand restaurants — so the ring widens and neighbouring
     quarters legitimately share the two or three destination markets. */
  ['market',     'walk', 2],
  ['books',      'near', 1],
  ['park',       'near', 1],
  ['museum',     'near', 2],
  ['nightlife',  'walk', 1]
];

/* Spread across the city: the old home, the quarter in the bug report,
   somewhere genuinely far from both, and two edges. */
const PLACES = [10, 5, 15, 18, 13];

const top = {};
for (const arr of PLACES) {
  at(arr);
  top[arr] = {};
  for (const [kind, ringSet] of KINDS) {
    top[arr][kind] = Near
      .pick(Near.KIND[kind], { rings: Near.RINGS[ringSet], want: 6, limit: 5 })
      .items.map(i => i.title);
  }
}

let failures = [];
const pairs = [];
for (let i = 0; i < PLACES.length; i++)
  for (let j = i + 1; j < PLACES.length; j++) pairs.push([PLACES[i], PLACES[j]]);

console.log('\nShared names in the top 5, per pair of locations\n');
const head = pairs.map(([a, b]) => `${a}/${b}`.padStart(7)).join('');
console.log('kind       ' + head + '   max');

for (const [kind, , allowed] of KINDS) {
  const counts = pairs.map(([a, b]) =>
    top[a][kind].filter(t => top[b][kind].includes(t)).length);
  counts.forEach((n, k) => {
    if (n > allowed) failures.push(`${kind}: ${pairs[k].join(' and ')} share ${n} of 5 (max ${allowed})`);
  });
  console.log(kind.padEnd(11) + counts.map(n => String(n).padStart(7)).join('') +
              String(allowed).padStart(6));
}

if (VERBOSE) {
  for (const arr of PLACES) {
    console.log(`\n${arr}e`);
    for (const [kind] of KINDS) console.log(`  ${kind.padEnd(11)} ${top[arr][kind].join(', ')}`);
  }
}

/* The specific regression: the names from the original report must not be
   what the 5th is offered for coffee. */
at(5);
const REPORTED = ['Boot Café', 'Ten Belles', 'Café Oberkampf', 'Holybelly 5 & 19'];
const cafes = Near.pick(Near.KIND.cafe, { rings: Near.RINGS.walk, want: 8, limit: 24 })
  .items.map(i => i.title);
const leaked = REPORTED.filter(r => cafes.includes(r));
if (leaked.length) failures.push(`the 10th's cafés are still offered in the 5th: ${leaked.join(', ')}`);

console.log('');
if (failures.length) {
  console.log('FAIL — location is not reaching retrieval:');
  failures.forEach(f => console.log('  ✗ ' + f));
  console.log('');
  process.exit(1);
}
console.log(`OK — ${pairs.length * KINDS.length} location pairs checked, all materially different.\n`);
