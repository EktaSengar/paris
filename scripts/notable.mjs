#!/usr/bin/env node
/* ---------------------------------------------------------
   notable.mjs — the places that are a matter of record.

   Between "somebody went and wrote it up" and "a name on a map" sits a
   third kind of place: one with a verifiable distinction. An article, a
   heritage listing, a date of founding. Not an opinion, but far more
   than a position.

   Three keyless sources, in order:

     Wikidata SPARQL   which Paris places have an entry at all
     Wikipedia REST    a factual sentence about each one
     Pageviews API     how famous — which is not the same as how good

   That last one is the important one, and it is why this script is more
   careful than it looks. A pure notability signal recommends Le Procope
   and La Tour d'Argent: places that are genuinely notable and genuinely
   not where you want to be sent for coffee. Monthly pageviews separate
   the landmark from the local place that happens to have an article, and
   landmarks get flagged so the everyday sections push them down while
   Culture and "Worth the trip" can still use them.

   Nothing here writes an opinion. Every record carries its source and
   the date it was checked, and lands in the `sourced` tier.

   Usage:  node scripts/notable.mjs [--dry] [--limit N]
   --------------------------------------------------------- */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const DRY  = process.argv.includes('--dry');
const LIMIT = (() => { const i = process.argv.indexOf('--limit'); return i === -1 ? 0 : Number(process.argv[i + 1]); })();
const UA = 'paris-for-you/1.0 (https://github.com/EktaSengar/paris)';

/* Wikidata classes worth having, mapped onto the site's own categories.
   Kept deliberately short: this is the layer that risks turning a
   neighbourhood guide into a sightseeing list, so it takes the kinds of
   place the site already has sections for and nothing else. */
const CLASSES = [
  ['wd:Q30022',   'cafe'],        // café
  ['wd:Q11707',   'restaurant'],  // restaurant
  ['wd:Q2360219', 'restaurant'],  // bistro
  ['wd:Q7075',    'books'],       // library
  ['wd:Q1367454', 'books'],       // bookshop
  ['wd:Q33506',   'museum'],      // museum
  ['wd:Q207694',  'museum'],      // art museum
  ['wd:Q22687',   'nightlife'],   // bar
  ['wd:Q41253',   'culture'],     // movie theatre
  ['wd:Q24354',   'culture'],     // theatre
  ['wd:Q22698',   'park'],        // park
  ['wd:Q483110',  'sport'],       // stadium
  ['wd:Q2143825', 'bakery'],      // pastry shop
  ['wd:Q274393',  'bakery']       // bakery
];

/* P576 is the date a thing stopped existing. Without this filter the
   query cheerfully returns a hippodrome demolished in 1900, and the site
   recommends an empty plot of land. */
const SPARQL = `
SELECT ?item ?itemLabel ?desc ?cls ?coord ?article ?heritage ?inception WHERE {
  ?item wdt:P131* wd:Q90 .
  ?item wdt:P625 ?coord .
  ?item wdt:P31/wdt:P279* ?cls .
  VALUES ?cls { ${[...new Set(CLASSES.map(c => c[0]))].join(' ')} }
  FILTER NOT EXISTS { ?item wdt:P576 ?dissolved }
  FILTER NOT EXISTS { ?item wdt:P582 ?ended }
  OPTIONAL { ?item wdt:P1435 ?heritage }
  OPTIONAL { ?item wdt:P571 ?inception }
  OPTIONAL { ?item schema:description ?desc FILTER(LANG(?desc) = "en") }
  OPTIONAL {
    ?article schema:about ?item ;
             schema:isPartOf <https://en.wikipedia.org/> .
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,fr". }
}`;

const CAT_OF = Object.fromEntries(CLASSES.map(([q, c]) => [q.replace('wd:', ''), c]));

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

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(url, opts = {}, attempt = 0) {
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': UA, ...(opts.headers || {}) },
      signal: AbortSignal.timeout(opts.timeout || 60000)
    });
    if (res.status === 429 || res.status >= 500) throw new Error(String(res.status));
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(String(res.status));
    return await res.json();
  } catch (e) {
    if (attempt < 3) { await sleep(2000 * (attempt + 1)); return get(url, opts, attempt + 1); }
    throw e;
  }
}

/* ---------- 1. who exists ---------- */

async function fromWikidata() {
  process.stdout.write('  Wikidata… ');
  const url = 'https://query.wikidata.org/sparql?query=' + encodeURIComponent(SPARQL);
  const body = await get(url, { headers: { Accept: 'application/sparql-results+json' }, timeout: 120000 });

  const byId = new Map();
  for (const b of body.results.bindings) {
    const qid = b.item.value.split('/').pop();
    const label = b.itemLabel?.value || '';
    if (!label || /^Q\d+$/.test(label)) continue;             // unlabelled
    const m = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(b.coord?.value || '');
    if (!m) continue;
    const lon = +m[1], lat = +m[2];
    const cat = CAT_OF[b.cls.value.split('/').pop()];
    if (!cat) continue;

    const prev = byId.get(qid);
    byId.set(qid, {
      qid, name: label, lat, lon, cat: prev?.cat || cat,
      desc: b.desc?.value || prev?.desc || null,
      article: b.article?.value ? decodeURIComponent(b.article.value.split('/wiki/').pop()) : (prev?.article || null),
      heritage: !!(b.heritage?.value) || prev?.heritage || false,
      inception: b.inception?.value?.slice(0, 4) || prev?.inception || null
    });
  }
  console.log(`${byId.size} places`);
  return [...byId.values()];
}

/* ---------- 2. what is true about them ---------- */

async function summaries(list) {
  process.stdout.write('  Wikipedia summaries… ');
  let done = 0;
  for (const p of list) {
    if (!p.article) continue;
    const d = await get(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(p.article)}`);
    if (d && d.extract) {
      /* The first sentence or two — enough to say what the place is and
         why anybody wrote it down, and no more. */
      const sentences = d.extract.replace(/\s+/g, ' ').match(/[^.!?]+[.!?]+/g) || [d.extract];
      p.extract = sentences.slice(0, 2).join(' ').trim().slice(0, 300);
      p.thumb = d.thumbnail?.source || null;
    }
    if (++done % 40 === 0) process.stdout.write('.');
    await sleep(60);
  }
  console.log(` ${list.filter(p => p.extract).length} with text`);
}

/* ---------- 3. famous, or good? ---------- */

/* Above this many views a month, a place is a landmark rather than a
   local secret. Tuned against known cases: Le Procope ~2.4k, Berthillon
   ~0.4k. The point is not precision — it is keeping coach parties out of
   the coffee section. */
const LANDMARK_VIEWS = 1500;

async function fame(list) {
  process.stdout.write('  pageviews… ');
  const to = new Date(), from = new Date(to.getTime() - 180 * 86400000);
  const fmt = d => d.toISOString().slice(0, 10).replace(/-/g, '') + '00';
  let done = 0;
  for (const p of list) {
    if (!p.article) continue;
    const url = 'https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia'
      + `/all-access/user/${encodeURIComponent(p.article)}/monthly/${fmt(from)}/${fmt(to)}`;
    const d = await get(url).catch(() => null);
    const items = d?.items || [];
    if (items.length) p.views = Math.round(items.reduce((a, x) => a + x.views, 0) / items.length);
    if (++done % 40 === 0) process.stdout.write('.');
    await sleep(60);
  }
  const flagged = list.filter(p => (p.views || 0) >= LANDMARK_VIEWS).length;
  console.log(` ${flagged} flagged as landmarks`);
}

/* ---------- assemble ---------- */

/* Wikidata labels a lot of listed buildings by what the heritage
   register recorded, which is an address or a trade rather than a name.
   "34 avenue de Choisy, Paris" and "boulangerie-pâtisserie-confiserie"
   are both perfectly good database keys and useless things to send
   somebody to for breakfast.

   Rejecting these is not tidying. A recommendation whose name is a
   street address tells the reader nothing and makes the whole list look
   automated, which is exactly what it must not look like. */

const STREET = 'rue|avenue|boulevard|bd|place|quai|impasse|passage|cour|allée|allee|villa|square';

/* A name that is only a trade — with or without hyphens or ampersands. */
const GENERIC = new Set([
  'boulangerie', 'patisserie', 'boulangerie patisserie', 'boulangerie patisserie confiserie',
  'cafe', 'restaurant', 'bar', 'brasserie', 'bistrot', 'bistro', 'librairie', 'hotel',
  'confiserie', 'chocolaterie', 'salon de the', 'cinema', 'theatre', 'musee',
  'boucherie', 'epicerie', 'commerce', 'magasin', 'immeuble', 'maison'
]);

function unusableName(raw) {
  const n = (raw || '').trim();
  if (!n || n.length < 3) return true;
  if (/^\d/.test(n)) return true;                                  // "34 avenue de Choisy"
  if (/,\s*Paris\b/i.test(n)) return true;                         // "…, Paris"
  if (new RegExp(`^(${STREET})\\s`, 'i').test(n)) return true;       // "rue de …"
  if (new RegExp(`,\\s*\\d+\\s*(${STREET})\\b`, 'i').test(n)) return true; // "Boulangerie, 16 rue …"
  const flat = n.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[-–—&]/g, ' ').replace(/\s+/g, ' ').trim();
  return GENERIC.has(flat);
}

function toRecord(p) {
  if (unusableName(p.name)) return null;
  const bits = [];
  if (p.extract) bits.push(p.extract);
  else {
    /* No article — say the little we do know rather than nothing, and
       nothing rather than something invented. */
    if (p.desc) bits.push(p.desc[0].toUpperCase() + p.desc.slice(1) + '.');
    if (p.heritage) bits.push('A listed building.');
    if (p.inception) bits.push(`Established ${p.inception}.`);
    if (!bits.length) return null;
  }
  if (p.heritage && p.extract && !/listed|monument historique|heritage/i.test(p.extract))
    bits.push('A listed building.');

  const why = bits.join(' ').slice(0, 340);

  /* "Cafe in Paris, France." is a true sentence that tells the reader
     nothing, and a card carrying it is a database row wearing a
     recommendation's clothes. If the only thing we can say about a place
     is its own category, it has no distinction — so it is not in this
     tier. It stays in the map layer, where a bare name is honest. */
  if (/^(a |an )?[\w\s'’-]{0,34}\s+in\s+paris(,\s*france)?\.?$/i.test(why.trim())) return null;

  return {
    n: p.name.slice(0, 70),
    c: p.cat,
    lat: +p.lat.toFixed(5),
    lon: +p.lon.toFixed(5),
    a: nearestArr(p.lat, p.lon),
    why,
    w: p.article ? `https://en.wikipedia.org/wiki/${encodeURIComponent(p.article)}` : null,
    src: p.article ? 'Wikipedia' : 'Wikidata',
    ...(p.views ? { v: p.views } : {}),
    ...((p.views || 0) >= LANDMARK_VIEWS ? { landmark: 1 } : {}),
    /* Being written about is not the same as being good, so the ceiling
       here is deliberately below what a curated record can reach. */
    q: 4,
    u: p.heritage || (p.inception && +p.inception < 1900) ? 5 : 4
  };
}

async function run() {
  console.log('\nFinding the places that are a matter of record…\n');

  let list = await fromWikidata();
  if (LIMIT) list = list.slice(0, LIMIT);

  await summaries(list);
  await fame(list);

  const items = list.map(toRecord).filter(Boolean);

  const byCat = {}, byArr = {};
  items.forEach(p => { byCat[p.c] = (byCat[p.c] || 0) + 1; byArr[p.a] = (byArr[p.a] || 0) + 1; });

  console.log(`\n  ${items.length} records with something to say`);
  console.log('  by kind:', Object.entries(byCat).map(([k, n]) => `${k}:${n}`).join(' '));
  console.log('  per arrondissement:', Object.entries(byArr)
    .sort((a, b) => a[0] - b[0]).map(([a, n]) => `${a}:${n}`).join(' '));
  console.log('  landmarks (demoted in everyday sections):', items.filter(i => i.landmark).length);

  if (DRY) {
    console.log('\n  --dry, nothing written. A sample:\n');
    items.slice(0, 6).forEach(i => console.log(`   • ${i.n} (${i.a}e, ${i.c})${i.landmark ? ' [landmark]' : ''}\n     ${i.why.slice(0, 150)}\n`));
    return;
  }

  const doc = {
    generated: new Date().toISOString().slice(0, 10),
    source: 'Wikidata + Wikipedia (CC BY-SA) · pageviews via the Wikimedia REST API',
    note: 'Places with a verifiable distinction. Facts, never opinion — these land in the "sourced" tier. `landmark` marks somewhere famous enough that it is a sight rather than a recommendation, and the ranking pushes those down in everyday sections.',
    counts: byCat,
    items
  };
  await fs.writeFile(path.join(DATA, 'notable.json'), JSON.stringify(doc) + '\n', 'utf8');
  const kb = Math.round((await fs.stat(path.join(DATA, 'notable.json'))).size / 1024);
  console.log(`\n  wrote data/notable.json — ${kb} KB\n`);
}

run().catch(e => { console.error('\n' + e.message + '\n'); process.exit(1); });
