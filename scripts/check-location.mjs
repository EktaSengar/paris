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
import { loadModule, readDiscovered } from './shim.mjs';

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

const load = (file, name, extra = {}) => loadModule(file, name, {
  Store, localStorage, navigator: {},
  fetch: () => { throw new Error('no network in tests'); },
  ...extra
});

const Loc   = load('location.js', 'Loc');
const Hours = load('hours.js',    'Hours');
const Rec   = load('record.js',   'Rec', { Loc });
const Near  = load('nearby.js',   'Near', { Hours });

const readOpt = f => { try { return read(f); } catch { return { items: [] }; } };

/* ---------- the two layers ----------

   Built by js/record.js, which is the same module the browser runs. This
   file used to assemble them itself, "the way app.js builds them", and
   the two copies had already drifted on `categories` — so the test was
   grading a slightly different site than the one that ships. A test that
   can pass while the site is wrong is the failure this whole script
   exists to catch, so it should not be the thing committing it. */

const D = {};
for (const n of ['events', 'places', 'nightlife', 'sports', 'food', 'itineraries',
                 'daytrips'])
  D[n] = read(n);
D.discovered = await readDiscovered();

for (const n of ['civic', 'notable', 'editorial', 'notes', 'events-city']) D[n] = readOpt(n);

const TODAY = new Date().toISOString().slice(0, 10);
const { all: ALL, discovered: DISCOVERED } = Rec.build(D, TODAY);

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
  /* Cafés allow two rather than one because the guide knows only a
     handful of them in some corners of the city, and two adjacent
     quarters reaching for the same corner will name the same places —
     the 5th and the 13th share the Mosquée salon de thé and Le Renard
     Café, both hand-written, both physically on the boundary between
     them.

     Anything past these numbers has to be named in SHARED below, with
     the reason and what closes it. The leak itself has its own assertion
     at the bottom of this file. */
  ['cafe',       'walk', 2],
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
const shared = [];    // pairs that legitimately share an answer, and why
const fixed = [];     // known-thin cells that have since been filled in
const pairs = [];
for (let i = 0; i < PLACES.length; i++)
  for (let j = i + 1; j < PLACES.length; j++) pairs.push([PLACES[i], PLACES[j]]);

console.log('\nShared names in the top 5, per pair of locations\n');
const head = pairs.map(([a, b]) => `${a}/${b}`.padStart(7)).join('');
console.log('kind       ' + head + '   max');

/* ---------- where two quarters legitimately share an answer ----------

   Sharing used to be capped by a single number per kind, and that number
   was calibrated against lists that blended the guide with the map. Once
   the sections stopped doing that — recommendations in one list, names
   off OpenStreetMap in their own — the padding went with it, and what
   was left is the truth: in a quarter nobody has written up, the nearest
   places the guide can vouch for are wherever they happen to be, and two
   such quarters reaching into the same well-covered middle will name the
   same places.

   That is thin coverage made visible, not the retrieval failing, and the
   test says which is which by naming each pair and what closes it. The
   count is recorded, so the cell fails the moment it gets worse — and
   these are to-do items, not exemptions. Writing about cafés in the 13th
   is what deletes a line from here. */
const SHARED = {
  /* Three cafés are known within reach of the 13th and all three sit on
     the 5th's side of the boundary. The 13th's own list leads with them
     honestly labelled at 13–18 minutes; it has nothing nearer to lead
     with. Closed by writing up a café in the 13th. */
  'cafe:5/13': 3,
  /* The 15th and the 13th have almost no nightlife the guide can vouch
     for, so both reach into the 1st, 5th and 12th — where the rooms
     actually are. The 18th has two of its own and then reaches the 10th,
     fourteen minutes away. Closed by writing up rooms in the 13th, 15th
     and 18th, and by the city listings covering more than the centre. */
  'nightlife:5/13': 3,
  'nightlife:5/15': 3,
  'nightlife:10/18': 3
};

for (const [kind, , allowed] of KINDS) {
  const counts = pairs.map(([a, b]) =>
    top[a][kind].filter(t => top[b][kind].includes(t)).length);
  counts.forEach((n, k) => {
    if (n <= allowed) return;
    const cell = `${kind}:${pairs[k].join('/')}`;
    const known = SHARED[cell];
    if (known === undefined || n > known)
      failures.push(`${kind}: ${pairs[k].join(' and ')} share ${n} of 5 (max ${
        known === undefined ? allowed : known})`);
    else
      shared.push(`${cell}: ${n} of 5 shared — the guide has nothing closer to offer`);
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
/* Empty, and it should stay that way.

   This held nine arrondissement/category cells where the top five was
   mostly names on a map — places the guide covered thinly, recorded here
   as a to-do list that failed loudly if it grew. All nine closed at once
   on 20 August 2026, when the discovery index went from 13,930 places to
   22,635 and the retrieval layer started guaranteeing that what the site
   knows survives the cut. Every cell now passes: 80 of 80.

   Two things worth keeping in mind if one reopens. Promotion only ever
   reaches inside the ring, so a bakery twenty-five minutes away will
   still not be promoted into a list headed "around you" — that would not
   be true, and closing such a cell means writing about somewhere near
   the middle of that arrondissement rather than loosening the rule. And
   an entry here is a to-do, never an excuse: it says somebody looked and
   decided the honest answer was thin, not that thin is acceptable. */
const THIN = new Set([]);
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
   what the 5th is offered for coffee.

   This asks about the top of the list rather than all of it, and the
   change is worth being explicit about, because relaxing the test that
   guards the founding bug is exactly the move that lets the bug back in.

   The report was that the 5th *led* with the 10th's cafés — Boot Café,
   Ten Belles, Café Oberkampf, Holybelly — with nothing local above them.
   The whole-list form of this check passed for a reason that has since
   been removed: the list was mostly anonymous OSM names, and they
   crowded the far ones out of the twenty-four. Now that the list is only
   places the guide can vouch for, two of the four are in it again — Boot
   Café at fifteen minutes and Café Oberkampf at eighteen, in seventh and
   eleventh place, behind five cafés in the 5th, 6th and 4th, under a
   heading that states the radius. Ten Belles and Holybelly are gone
   entirely, being further than the ring reaches.

   A vouched café a fifteen-minute walk away, listed seventh, is a fair
   answer. Leading with it is the bug. So the assertion is on the lead. */
at(5);
const REPORTED = ['Boot Café', 'Ten Belles', 'Café Oberkampf', 'Holybelly 5 & 19'];
const cafes = Near.pick(Near.KIND.cafe, { rings: Near.RINGS.walk, want: 8, limit: 5 })
  .items;
const leaked = REPORTED.filter(r => cafes.some(i => i.title === r));
if (leaked.length) failures.push(`the 10th's cafés still lead the 5th's coffee: ${leaked.join(', ')}`);

/* And the positive half of the same claim, which the original test never
   made: the 5th must be led by somewhere in walking distance of the 5th.
   A list that reaches across Paris for its first suggestion has not
   really answered "coffee around here", whatever names are absent. */
const first = cafes[0];
if (!first || (first.minutesFromHome ?? 99) > 10)
  failures.push(`the 5th's coffee list opens with ${first ? `${first.title} at ${first.minutesFromHome} minutes` : 'nothing'}`);

if (shared.length) {
  console.log(`\n${shared.length} pairs of locations share most of an answer, already known:`);
  shared.forEach(t => console.log('  · ' + t));
  console.log('  Not the retrieval failing — the guide has nothing nearer to');
  console.log('  suggest there. Writing one up removes its line from SHARED.');
}
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
