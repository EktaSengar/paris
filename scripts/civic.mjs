#!/usr/bin/env node
/* ---------------------------------------------------------
   civic.mjs — what the city itself publishes.

   OpenStreetMap gives coverage and no judgement. Wikipedia gives
   judgement but only about the famous. Between them sits the thing the
   Mairie de Paris publishes about its own facilities: a swimming pool
   that exists, its address, its official page, and — for markets — which
   days it is actually on and between which hours.

   That last part is why this script earns its place. "Marché Monge,
   3 min" is a name. "Marché Monge — Wednesday, Friday and Sunday,
   07:00–14:30" is a plan, and the site could not say it before.

   Nothing here is an opinion, and the records say so: they land in the
   `sourced` tier, which ranks below anything a person wrote and above a
   bare name on a map.

   Two datasets, both keyless:
     marches-decouverts   80 open-air markets, with days and hours
     lieux-municipaux     pools, courts, parks, libraries, museums

   Usage:  node scripts/civic.mjs [--dry]
   --------------------------------------------------------- */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const DRY  = process.argv.includes('--dry');
const API  = 'https://opendata.paris.fr/api/explore/v2.1/catalog/datasets';
const UA   = 'paris-for-you/1.0 (https://github.com/EktaSengar/paris)';

/* Which municipal categories are worth putting in front of somebody, and
   what the site calls them. Everything not listed here — crèches, town
   halls, cemeteries, vaccination centres — is real and none of our
   business. */
const CIVIC = {
  'Piscines':                            ['sport',  '🏊', 'Municipal pool'],
  'Bassins écoles':                      ['sport',  '🏊', 'Municipal teaching pool'],
  'Baignades estivales':                 ['sport',  '🏊', 'Summer open-air swimming'],
  'Centres sportifs':                    ['sport',  '🏃', 'Municipal sports centre'],
  'Gymnases':                            ['sport',  '🤸', 'Municipal gymnasium'],
  'Tennis':                              ['sport',  '🎾', 'Municipal tennis courts'],
  'Stades':                              ['sport',  '🏟️', 'Municipal stadium'],
  'Terrains de sports':                  ['sport',  '⚽', 'Municipal sports ground'],
  'Aires de fitness et street workout':  ['sport',  '💪', 'Open-air fitness area'],
  'Skate park et aires de glisse':       ['sport',  '🛹', 'Skate park'],
  'Patinoires':                          ['sport',  '⛸️', 'Ice rink'],
  'Parcs, jardins et bois':              ['park',   '🌳', 'City park or garden'],
  'Bibliothèques':                       ['books',  '📚', 'Municipal library'],
  'Musées municipaux':                   ['museum', '🏛️', 'City of Paris museum']
};

const ARR = {
  1:[48.8626,2.3363],  2:[48.8683,2.3413],  3:[48.8637,2.3615],  4:[48.8546,2.3572],
  5:[48.8448,2.3501],  6:[48.8496,2.3329],  7:[48.8565,2.3120],  8:[48.8726,2.3120],
  9:[48.8768,2.3374],  10:[48.8760,2.3595], 11:[48.8578,2.3792], 12:[48.8351,2.4212],
  13:[48.8283,2.3626], 14:[48.8331,2.3264], 15:[48.8412,2.3000], 16:[48.8637,2.2769],
  17:[48.8872,2.3070], 18:[48.8925,2.3444], 19:[48.8871,2.3828], 20:[48.8635,2.3985]
};

const nearestArr = (lat, lon) => {
  let best = null, bd = Infinity;
  for (const [n, [a, b]] of Object.entries(ARR)) {
    const d = (a - lat) ** 2 + (b - lon) ** 2;
    if (d < bd) { bd = d; best = Number(n); }
  }
  return best;
};

const clean = s => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 70);

/* Titles arrive shouting — "MARCHÉ SAINT-CHARLES". Lower-case them and
   put the capitals back, keeping the accents. */
function titleCase(s) {
  if (!/[A-ZÀ-Þ]{4,}/.test(s)) return clean(s);
  return clean(s).toLowerCase().replace(/(^|[\s'’\-])([\p{L}])/gu, (_, a, b) => a + b.toUpperCase());
}

async function page(dataset, params = {}) {
  const out = [];
  for (let offset = 0; ; offset += 100) {
    const q = new URLSearchParams({ limit: '100', offset: String(offset), ...params });
    const res = await fetch(`${API}/${dataset}/records?${q}`, {
      headers: { 'user-agent': UA }, signal: AbortSignal.timeout(60000)
    });
    if (!res.ok) throw new Error(`${dataset} → ${res.status}`);
    const body = await res.json();
    const rows = body.results || [];
    out.push(...rows);
    /* The API caps offset at 10000; none of these datasets come close. */
    if (rows.length < 100 || out.length >= (body.total_count ?? out.length)) break;
  }
  return out;
}

/* ---------- markets ---------- */

const DOW = { dimanche: 0, lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6 };
const DOW_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const KIND = {
  'Alimentaire': 'Food market',
  'Alimentaire bio': 'Organic food market',
  'Fleurs': 'Flower market',
  'Puces': 'Flea market',
  'Timbres': 'Stamp market',
  'Création artistique': 'Art market'
};

/* "Wednesday, Friday and Sunday" — the list a person would say out loud. */
function sayDays(days) {
  const names = days.slice().sort((a, b) => (a || 7) - (b || 7)).map(d => DOW_EN[d]);
  if (names.length <= 1) return names[0] || '';
  return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
}

async function markets() {
  const rows = await page('marches-decouverts');
  return rows.map(r => {
    const pt = r.geo_point_2d;
    if (!pt) return null;

    const days = Object.entries(DOW).filter(([fr]) => Number(r[fr]) === 1).map(([, n]) => n);
    const week = [r.h_deb_sem_1, r.h_fin_sem_1].filter(Boolean).join('–');
    const sat  = [r.h_deb_sam, r.h_fin_sam].filter(Boolean).join('–');
    const sun  = [r.h_deb_dim, r.h_fin_dim].filter(Boolean).join('–');

    /* One sentence, entirely factual, and more use than any adjective:
       which days, and between what hours. Weekends usually run half an
       hour later, so say so only when they differ and only when the
       market is actually open then — printing two bare time ranges side
       by side tells the reader nothing about which is which. */
    const kind = KIND[r.produit] || 'Market';
    const base = days.some(d => d >= 1 && d <= 5) ? week : (sat || sun);
    const extra = [];
    if (days.includes(6) && sat && sat !== base) extra.push(`Saturday to ${sat.split('–')[1]}`);
    if (days.includes(0) && sun && sun !== base) extra.push(`Sunday to ${sun.split('–')[1]}`);

    const why = [
      kind + '.',
      days.length ? sayDays(days) + (base ? `, ${base}` : '') : null
    ].filter(Boolean).join(' ')
      + (extra.length ? ` (${extra.join(', ')})` : '') + '.';

    return {
      n: titleCase(r.nom_long || r.nom_court),
      c: 'market',
      lat: +pt.lat.toFixed(5),
      lon: +pt.lon.toFixed(5),
      a: r.ardt || nearestArr(pt.lat, pt.lon),
      s: clean(r.localisation).slice(0, 60) || null,
      why,
      days,
      emoji: r.produit === 'Fleurs' ? '💐' : r.produit === 'Puces' ? '🪞' : '🧺',
      q: 4, u: r.produit === 'Alimentaire' ? 3 : 4
    };
  }).filter(Boolean);
}

/* ---------- municipal places ---------- */

async function municipal() {
  const rows = await page('lieux-municipaux');
  const out = [];
  for (const r of rows) {
    const mapped = CIVIC[r.categorie];
    if (!mapped || r.latitude == null || r.longitude == null || !r.name) continue;
    const [cat, emoji, label] = mapped;

    out.push({
      n: titleCase(r.name),
      c: cat,
      lat: +Number(r.latitude).toFixed(5),
      lon: +Number(r.longitude).toFixed(5),
      a: nearestArr(Number(r.latitude), Number(r.longitude)),
      s: clean(r.address_street) || null,
      w: r.url || null,
      why: `${label}, run by the City of Paris. Hours and closures are on the city's own page.`,
      emoji,
      /* A municipal facility is a real, maintained thing — but a gymnasium
         is not a discovery. Rated as useful rather than remarkable. */
      q: 4,
      u: cat === 'park' ? 3 : 2
    });
  }
  return out;
}

async function run() {
  console.log('\nAsking the city about itself…\n');

  const [mk, mu] = await Promise.all([markets(), municipal()]);
  console.log(`  markets            ${String(mk.length).padStart(5)}`);
  console.log(`  municipal places   ${String(mu.length).padStart(5)}`);

  const items = mk.concat(mu);

  /* The same pool is occasionally listed twice under two categories. */
  const seen = new Set();
  const deduped = items.filter(p => {
    const k = `${p.c}|${p.n.toLowerCase()}|${p.lat.toFixed(3)}|${p.lon.toFixed(3)}`;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });

  const byCat = {};
  const byArr = {};
  deduped.forEach(p => { byCat[p.c] = (byCat[p.c] || 0) + 1; byArr[p.a] = (byArr[p.a] || 0) + 1; });

  console.log(`\n  ${deduped.length} after de-duplication`);
  console.log('  by kind:', Object.entries(byCat).map(([k, n]) => `${k}:${n}`).join(' '));
  console.log('  per arrondissement:', Object.entries(byArr)
    .sort((a, b) => a[0] - b[0]).map(([a, n]) => `${a}:${n}`).join(' '));

  const thin = Object.keys(ARR).map(Number).filter(a => !byArr[a]);
  if (thin.length) console.log('  no civic records at all in:', thin.join(', '));

  if (DRY) { console.log('\n  --dry, nothing written\n'); return; }

  const doc = {
    generated: new Date().toISOString().slice(0, 10),
    source: 'Ville de Paris — opendata.paris.fr (Licence Ouverte / Open Licence)',
    note: 'Facilities the city publishes about itself: markets with their days and hours, pools, courts, parks, libraries. Factual, not opinion — these land in the "sourced" tier, below anything a person wrote and above a bare name on a map.',
    counts: byCat,
    items: deduped
  };
  await fs.writeFile(path.join(DATA, 'civic.json'), JSON.stringify(doc) + '\n', 'utf8');
  const kb = Math.round((await fs.stat(path.join(DATA, 'civic.json'))).size / 1024);
  console.log(`\n  wrote data/civic.json — ${kb} KB\n`);
}

run().catch(e => { console.error('\n' + e.message + '\n'); process.exit(1); });
