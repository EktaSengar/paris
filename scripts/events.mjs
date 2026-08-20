#!/usr/bin/env node
/* ---------------------------------------------------------
   events.mjs — what is actually on, from the city itself.

   The one part of this site with a countdown on it. `events.json` is
   hand-written, thirty-odd records deep, and `refresh.mjs` prunes
   without ever adding — so left alone the section empties itself and the
   page quietly becomes a guide to buildings.

   The Mairie publishes its own events feed, keyless, at
   opendata.paris.fr: around 2,200 live at any time, with coordinates,
   dates, price, an official link and a cover image. This takes all of
   them and ships the fraction that earns it.

   The rule this file exists to hold: **ingest without judgement, gate
   with it.** More rows is not the goal and never was. What reaches the
   page is what survives the gate below, and everything it drops is
   dropped for a reason written down next to the code that drops it.

   These are `sourced` records — facts with a source, no opinion. They
   rank below anything a person wrote and above a name on a map, and the
   hand-written events keep the top of every section they appear in.

   Usage:  node scripts/events.mjs [--dry] [--days N]
   --------------------------------------------------------- */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const DRY  = process.argv.includes('--dry');
const DAYS = (() => { const i = process.argv.indexOf('--days'); return i === -1 ? 60 : Number(process.argv[i + 1]); })();

const API = 'https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/que-faire-a-paris-/records';
const UA  = 'paris-for-you/1.0 (https://github.com/EktaSengar/paris)';

const TODAY = new Date().toISOString().slice(0, 10);
const UNTIL = new Date(Date.now() + DAYS * 86400000).toISOString().slice(0, 10);

/* ---------- the gate ----------

   Three questions, in order: is it for us, is it a reason to go, and is
   it one thing rather than a venue's whole programme. */

/* Not that these are bad — they are somebody's good evening, and none of
   them is what two adults are looking for on a Saturday. The feed is a
   municipal notice board as well as a listings magazine, and this is the
   notice board half. */
const NOT_FOR_US = new Set(['Enfants', 'Solidarité', 'Santé', 'Sciences', 'Innovation']);

/* A tag that is a reason to go, as opposed to one that merely files the
   record somewhere. `Loisirs`, `Atelier`, `Conférence` and `Nature`
   describe half the feed between them and single out nothing, so they
   are not enough on their own — they ride along on records that also
   carry one of these. */
const A_REASON_TO_GO = new Set(['Concert', 'Expo', 'Festival', 'Théâtre', 'Danse',
  'Art contemporain', 'Photo', 'Peinture', 'Cirque', 'Spectacle musical', 'Ecrans',
  'Nuit', 'Humour', 'Street-art', 'Brocante', 'Gourmand', 'Salon', 'BD',
  'Balade urbaine', 'LGBT']);

/* One per venue and one per programme. A jazz club with sixty dated
   nights is a venue, not sixty events — `nightlife.json` already links
   to its calendar rather than pretending to know what is on in three
   weeks, and that split is why nothing here goes stale. Without this cap
   four rooms and two municipal series produce a quarter of the feed. */
const PER_VENUE = 1;
const PER_PROGRAMME = 1;

const EMOJI = [['Concert', '🎵'], ['Spectacle musical', '🎵'], ['Expo', '🖼️'],
  ['Art contemporain', '🖼️'], ['Peinture', '🖼️'], ['Photo', '📷'], ['Théâtre', '🎭'],
  ['Danse', '💃'], ['Cirque', '🎪'], ['Ecrans', '🎬'], ['Festival', '🎉'],
  ['Brocante', '🪑'], ['Gourmand', '🍽️'], ['Balade urbaine', '🚶'], ['Humour', '😄'],
  ['Street-art', '🎨'], ['Nuit', '🌙'], ['LGBT', '🏳️‍🌈'], ['BD', '📚'], ['Salon', '🎫']];

const CATEGORY = [['Concert', 'music'], ['Spectacle musical', 'music'], ['Expo', 'art'],
  ['Art contemporain', 'art'], ['Peinture', 'art'], ['Photo', 'art'], ['Théâtre', 'theatre'],
  ['Danse', 'dance'], ['Cirque', 'theatre'], ['Ecrans', 'film'], ['Festival', 'festival'],
  ['Brocante', 'market'], ['Gourmand', 'food'], ['Balade urbaine', 'walk'],
  ['Humour', 'comedy'], ['Street-art', 'art'], ['Nuit', 'nightlife'], ['BD', 'books'],
  ['Salon', 'market'], ['LGBT', 'community']];

/* The cheapest way in, where the feed says so in figures. Prices arrive
   as prose — "De 0 à 16 euros", "Catégorie 1 40€, Catégorie 2 30€" — and
   the lowest number in it is the one a reader deciding whether to go
   actually cares about. No figure, no number: see toRecord(). */
function cheapest(detail) {
  const text = String(detail || '');
  const num = s => Number(String(s).replace(',', '.'));
  const ok  = n => Number.isFinite(n) && n >= 0 && n < 1000;

  /* "De 0 à 16 euros" — the low end carries no symbol of its own, so a
     rule that only reads €-suffixed figures answers 16 to a question
     whose honest answer is 0. Ranges are read first for that reason. */
  const range = [...text.matchAll(/\bde\s+(\d+(?:[.,]\d{1,2})?)\s*(?:€|euros?)?\s+à\s+(\d+(?:[.,]\d{1,2})?)\s*(?:€|euros?)/gi)]
    .map(m => num(m[1])).filter(ok);
  if (range.length) return Math.min(...range);

  /* Otherwise only figures that carry the symbol. Reading every number
     in the string would price "Catégorie 1 40€, Catégorie 2 30€" at one
     euro. */
  const tagged = [...text.matchAll(/(\d+(?:[.,]\d{1,2})?)\s*(?:€|euros?\b)/gi)]
    .map(m => num(m[1])).filter(ok);
  return tagged.length ? Math.min(...tagged) : null;
}

/* The tags miss some of it. A youth theatre workshop is filed under
   `Théâtre` and never under `Enfants`, and it reached the page. The feed
   states its own audience in a structured way — "Public adultes.",
   "Public jeunes et adultes.", "Public enfants. A partir de 7 ans." — so
   the honest test is whether adults are in the intended audience at all,
   not whether children are mentioned.

   Deliberately not a keyword filter on titles: that route drops an
   exhibition about Marilyn Monroe and a documentary called "l'enfant de
   Sinjar" to catch two workshops. Six records fall to this rule and all
   six are genuinely for children. */
const forChildrenOnly = e => {
  const a = (e.audience || '').toLowerCase();
  return /\b(enfants?|jeunes?|tout-petits)\b/.test(a) && !a.includes('adulte');
};

const tagsOf = e => (e.qfap_tags || '').split(';').map(s => s.trim()).filter(Boolean);
const strip  = s => (s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const arrOf  = e => {
  const z = (e.address_zipcode || '').replace(/\s/g, '');
  return /^75\d{3}$/.test(z) ? Number(z.slice(3)) || null : null;
};

/* ---------- fetching ---------- */

async function fetchAll() {
  const where = `date_end>=date'${TODAY}' and date_start<=date'${UNTIL}'`;
  const out = [];
  for (let offset = 0; offset < 10000; offset += 100) {
    const url = `${API}?where=${encodeURIComponent(where)}&limit=100&offset=${offset}`;
    const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error(`opendata.paris.fr → ${res.status}`);
    const json = await res.json();
    if (!json.results || !json.results.length) break;
    out.push(...json.results);
    process.stdout.write('.');
  }
  return out;
}

/* ---------- mapping ----------

   Nothing invented. `why` carries the city's own summary, the way the
   notable layer carries Wikipedia's — a factual line with a source
   attached, never a claim about whether the two of them would enjoy it.
   That claim is what `events.json` is for and this file cannot make it. */

function toRecord(e) {
  const tags = tagsOf(e);
  const pick = table => (table.find(([t]) => tags.includes(t)) || [])[1];
  const free = e.price_type === 'gratuit';

  return {
    id: 'qfap-' + String(e.event_id || e.id).replace(/[^a-zA-Z0-9]/g, '').slice(0, 40),
    title: strip(e.title).slice(0, 120),
    emoji: pick(EMOJI) || '🎫',
    type: 'event',
    categories: [...new Set(tags.map(t => (CATEGORY.find(([x]) => x === t) || [])[1]).filter(Boolean))],
    arr: arrOf(e),
    area: strip(e.address_name).slice(0, 80) || null,
    coords: [e.lat_lon.lat, e.lat_lon.lon],
    start: (e.date_start || '').slice(0, 10),
    end: (e.date_end || '').slice(0, 10),
    times: strip(e.date_description).slice(0, 140) || null,
    /* A number only where the city states one. `price` drives ranking and
       `priceNote` is what the reader sees, so the note keeps the city's
       own wording — "De 0 à 16 euros" — while the number takes the
       cheapest way in. Where the price is prose with no figure in it,
       there is no number, and scoring treats that as unknown rather than
       as free. */
    ...(free ? { price: 0, priceNote: 'Free' }
             : { ...(cheapest(e.price_detail) != null ? { price: cheapest(e.price_detail) } : {}),
                 priceNote: strip(e.price_detail).slice(0, 60) || 'Paid' }),
    why: strip(e.lead_text || e.description).slice(0, 320),
    url: e.url,
    source: 'Que Faire à Paris — opendata.paris.fr',
    lastVerified: TODAY,
    indoor: e.event_indoor === 1 || e.event_indoor === true ? true
          : e.event_indoor === 0 || e.event_indoor === false ? false : undefined,
    ...(free ? { labels: ['free'] } : {}),
    /* Deliberately flat. Every record here gets the same pair, because
       the feed says nothing about whether one listing is better than
       another and guessing would be the opinion this layer must not
       have. What separates them at ranking time is real: what it costs,
       how soon it ends, whether it is indoors when it rains, and how far
       away it is. */
    quality: 3,
    uniqueness: 3
  };
}

/* ---------- run ---------- */

async function run() {
  process.stdout.write(`\nQue Faire à Paris — ${TODAY} to ${UNTIL}\n  fetching `);
  const raw = await fetchAll();
  console.log(`\n  ${raw.length} live in the window\n`);

  const steps = [];
  const step = (label, list) => { steps.push([label, list.length]); return list; };

  let kept = step('has coordinates and an official link',
    raw.filter(e => e.lat_lon?.lat && e.url));
  kept = step('inside Paris', kept.filter(e => arrOf(e)));
  kept = step('filed under something', kept.filter(e => tagsOf(e).length));
  kept = step('not the municipal notice board',
    kept.filter(e => !tagsOf(e).some(t => NOT_FOR_US.has(t))));
  kept = step('adults are part of the intended audience',
    kept.filter(e => !forChildrenOnly(e)));
  kept = step('a reason to go, not just a category',
    kept.filter(e => tagsOf(e).some(t => A_REASON_TO_GO.has(t))));

  const venues = new Map(), programmes = new Map();
  kept = step(`at most ${PER_VENUE} per venue and ${PER_PROGRAMME} per programme`, kept.filter(e => {
    const v = e.address_name || e.title;
    const p = (e.programs || '').split('(')[0].trim();
    if ((venues.get(v) || 0) >= PER_VENUE) return false;
    if (p && (programmes.get(p) || 0) >= PER_PROGRAMME) return false;
    venues.set(v, (venues.get(v) || 0) + 1);
    if (p) programmes.set(p, (programmes.get(p) || 0) + 1);
    return true;
  }));

  const items = kept.map(toRecord).filter(r => r.start && r.end && r.title);

  steps.forEach(([label, n]) => console.log(`  ${String(n).padStart(5)}  ${label}`));

  const spread = {};
  items.forEach(r => { spread[r.arr] = (spread[r.arr] || 0) + 1; });
  const free = items.filter(r => r.price === 0).length;
  console.log(`\n  ${items.length} kept · ${free} free · ${Object.keys(spread).length}/20 arrondissements`);
  console.log('  per arrondissement:', Object.entries(spread)
    .sort((a, b) => a[0] - b[0]).map(([a, n]) => `${a}:${n}`).join(' '));

  if (DRY) {
    console.log('\n  sample:');
    items.slice(0, 5).forEach(r =>
      console.log(`   • ${r.emoji} ${r.title.slice(0, 62)}\n     ${r.area} · ${r.start}→${r.end} · ${r.priceNote}`));
    console.log('\n  --dry, nothing written\n');
    return;
  }

  const doc = {
    generated: TODAY,
    window: { from: TODAY, to: UNTIL },
    source: 'Que Faire à Paris · Ville de Paris · opendata.paris.fr (Licence Ouverte)',
    note: 'What is on, from the city itself. Facts with a source and no opinion — these are `sourced` records and rank below anything hand-written. The gate that decides what reaches this file lives in scripts/events.mjs and is the point of it: the feed carries around 2,200 live listings and this is the fraction that earns a place. Pruned daily by scripts/refresh.mjs.',
    items
  };
  await fs.writeFile(path.join(DATA, 'events-city.json'), JSON.stringify(doc, null, 2) + '\n', 'utf8');
  const kb = Math.round((await fs.stat(path.join(DATA, 'events-city.json'))).size / 1024);
  console.log(`\n  wrote data/events-city.json — ${kb} KB\n`);
}

run().catch(e => { console.error('\n' + e.message + '\n'); process.exit(1); });
