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

const readOpt = f => { try { return read(f); } catch { return { items: [] }; } };

/* ---------- the two layers, built the way app.js builds them ---------- */

const D = {};
for (const n of ['events','places','nightlife','sports','food','itineraries','daytrips','discovered'])
  D[n] = read(n);

const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const curatedNames = new Set([].concat(
  D.events.items, D.places.items, D.nightlife.items, D.sports.items, D.food.items
).map(i => norm(i.title)));

/* Mirrors fromCompact() in js/app.js. The three generated files share
   one shape, so one mapper reads all of them. */
const fromCompact = p => ({
  id: 'osm-' + norm(p.n).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32)
      + '-' + Math.round(p.lat * 2000) + '-' + Math.round(p.lon * 2000),
  title: p.n, type: p.c, arr: p.a, coords: [p.lat, p.lon], area: p.s || null,
  url: p.w || null, cuisine: p.k || null, discovered: true, why: p.why || p.x || '',
  branded: !!p.b, noted: !!p.d, heritage: !!p.h,
  quality: p.q ?? 3, uniqueness: p.u ?? 2, categories: [p.c], goodFor: [], labels: []
});

const civic    = readOpt('civic');
const notable  = readOpt('notable');
const editorial = readOpt('editorial');
const notes    = readOpt('notes');

const SOURCED = []
  .concat((civic.items || []).map(p => ({ ...fromCompact(p), provenance: 'sourced' })))
  .concat((notable.items || []).map(p => ({ ...fromCompact(p), provenance: 'sourced',
                                            touristy: !!p.landmark })));
const WRITTEN = (editorial.items || []).map(i => ({ provenance: 'editorial', ...i }));

const km = (a, b) => Loc.km(a, b);
const claimed = new Map();
SOURCED.concat(WRITTEN).forEach(w => {
  const k = norm(w.title);
  if (!claimed.has(k)) claimed.set(k, []);
  claimed.get(k).push(w.coords);
});

const FOUND = D.discovered.items
  .filter(p => !curatedNames.has(norm(p.n)))
  .map(fromCompact)
  .filter(p => {
    const near = claimed.get(norm(p.title));
    return !near || !near.some(c => c && p.coords && km(c, p.coords) < 0.25);
  });

const DISCOVERED = SOURCED.concat(FOUND);

const ALL = [].concat(WRITTEN, D.events.items, D.places.items, D.nightlife.items,
                      D.sports.items, D.food.items, D.itineraries.items, D.daytrips.items);

ALL.forEach(i => { if (!i.provenance) i.provenance = 'personal'; });
DISCOVERED.forEach(i => { if (!i.provenance) i.provenance = 'found'; });

/* Handwritten notes win, exactly as they do in the browser. */
const byId = new Map([...ALL, ...DISCOVERED].map(i => [i.id, i]));
for (const [id, note] of Object.entries(notes.items || {})) {
  const it = byId.get(id);
  if (!it) { console.warn(`  ! note for a place that is not here: ${id}`); continue; }
  Object.assign(it, note);
  if (note.why) it.provenance = 'personal';
}

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

   The third column is how many names two locations may share before it
   stops being a coincidence.

   These are not all zero, and the reasons differ. Markets are the
   sparsest category in the city — a couple of hundred against five
   thousand restaurants — so neighbouring quarters legitimately share the
   two or three destination markets. A museum in the 3rd is genuinely
   fifteen minutes from both the 10th and the 5th.

   The everyday ones went from zero to one when the ring learned to widen
   until it reaches somewhere the guide actually knows about. That is the
   intended behaviour and it has an unavoidable consequence: where only
   one good café is known between two adjacent quarters, both will now
   suggest it. Sharing one entry is the retrieval working. Sharing five
   was the bug this all started with. */
const KINDS = [
  ['cafe',       'walk', 1],
  ['bakery',     'walk', 1],
  ['restaurant', 'walk', 1],
  ['market',     'walk', 2],
  ['books',      'near', 1],
  ['park',       'near', 1],
  ['museum',     'near', 2],
  ['nightlife',  'walk', 2]
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
const thin = [];      // known-thin cells, tracked rather than ignored
const fixed = [];     // known-thin cells that have since been filled in
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

/* ---------- are they any good? ----------

   The difference test above only proves the lists moved. It passed
   perfectly while the 5th was being handed the nearest café in walking
   order, which is not a recommendation — so this second test asks
   whether the site knows anything about what it is suggesting.

   Two above `found` in the top five is a low bar on purpose. It is the
   difference between a guide and a phone book, not a standard of
   excellence, and it should hold in every arrondissement rather than
   only the one the catalogue was written in. */

const NEED_KNOWN = 2;

/* Where the guide is still thin, and why.

   These are not excused failures — they are a to-do list that fails
   loudly the moment it gets longer. Wikidata knows about thirty cafés in
   all of Paris, the city publishes nothing about coffee at all, and the
   editorial pass has not reached these yet. Writing a note in notes.json
   or an entry in editorial.json is what removes a line from here.

   Adding a line to this list should feel like an admission. Removing one
   is the actual work. */
const THIN = new Set([
  '12e restaurant',
  '13e cafe',
  '14e cafe',
  '16e bakery',
  '16e cafe',
  '16e restaurant',
  '17e restaurant',
  '19e bakery',
  '20e restaurant'
]);

/* A note on the two bakeries. The 16th and the 19th are large, and this
   test samples a single point in each — so an editorial record can be a
   real bakery in the right arrondissement and still sit outside the ring
   drawn from its centre. The ring widens looking for somewhere known,
   but it will not promote a bakery twenty-five minutes away into a list
   headed "around you", because that would not be true. Closing these
   means writing about somewhere near the middle of those two, not
   loosening the rule. */
const EVERYDAY = [['cafe', 'walk'], ['bakery', 'walk'], ['restaurant', 'walk'], ['market', 'walk']];
const ALL_ARRS = Array.from({ length: 20 }, (_, i) => i + 1);

console.log('\nHow much is known about the top 5, per arrondissement');
console.log('(★ visited · ◆ researched · ◇ on record · · on the map)\n');
console.log('arr    ' + EVERYDAY.map(([k]) => k.slice(0, 6).padStart(7)).join('') + '     worst');

const MARK = { personal: '★', editorial: '◆', sourced: '◇', found: '·' };
const beyondByArr = {};

for (const arr of ALL_ARRS) {
  at(arr);
  const cells = [];
  let worst = 9;
  for (const [kind, ringSet] of EVERYDAY) {
    const top = Near.pick(Near.KIND[kind], { rings: Near.RINGS[ringSet], want: 6, limit: 5 }).items;
    const known = top.filter(i => Near.tierOf(i) !== 'found').length;
    worst = Math.min(worst, known);
    cells.push(top.map(i => MARK[Near.tierOf(i)]).join('').padStart(7));
    const cell = `${arr}e ${kind}`;
    if (known < NEED_KNOWN) {
      if (THIN.has(cell)) thin.push(`${cell}: ${known} of 5 known`);
      else failures.push(`${cell}: only ${known} of the top 5 is more than a name on a map (need ${NEED_KNOWN})`);
    } else if (THIN.has(cell)) {
      fixed.push(cell);
    }
  }
  beyondByArr[arr] = Near.beyond(Near.KIND.cafe, 10).map(i => ({ title: i.title, arr: i.arr }));
  console.log(String(arr).padStart(3) + 'e   ' + cells.join('') + '   ' + String(worst).padStart(5));
}

/* "Worth the trip" is allowed to repeat itself between locations — the
   best café in Paris is the same café wherever you set out from, and
   demanding otherwise would be demanding a lie. What it must not do is
   what it used to: return three places from one arrondissement, which is
   how "the 10th again" survived the first fix. */
for (const arr of ALL_ARRS) {
  const spread = beyondByArr[arr];
  if (spread.length >= 2 && new Set(spread.map(x => x.arr)).size < 2)
    failures.push(`${arr}e worth-the-trip: all ${spread.length} suggestions are in the same arrondissement`);
}

/* The specific regression: the names from the original report must not be
   what the 5th is offered for coffee. */
at(5);
const REPORTED = ['Boot Café', 'Ten Belles', 'Café Oberkampf', 'Holybelly 5 & 19'];
const cafes = Near.pick(Near.KIND.cafe, { rings: Near.RINGS.walk, want: 8, limit: 24 })
  .items.map(i => i.title);
const leaked = REPORTED.filter(r => cafes.includes(r));
if (leaked.length) failures.push(`the 10th's cafés are still offered in the 5th: ${leaked.join(', ')}`);

if (thin.length) {
  console.log(`\n${thin.length} places the guide is still thin, already known:`);
  thin.forEach(t => console.log('  · ' + t));
  console.log('  Fix one by adding to data/editorial.json or data/notes.json,');
  console.log('  then delete its line from THIN in this file.');
}
if (fixed.length) {
  console.log(`\n${fixed.length} of the known-thin places now pass — remove them from THIN:`);
  fixed.forEach(t => console.log('  ✓ ' + t));
}

console.log('');
if (failures.length) {
  console.log('FAIL — location is not reaching retrieval:');
  failures.forEach(f => console.log('  ✗ ' + f));
  console.log('');
  process.exit(1);
}
console.log(`OK — ${pairs.length * KINDS.length} location pairs checked, all materially different.`);
console.log(`     ${80 - thin.length} of 80 arrondissement/category pairs know something about what they suggest.\n`);
