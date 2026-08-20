#!/usr/bin/env node
/* ---------------------------------------------------------
   discover.mjs — build a Paris-wide index of real places.

   The curated catalogue is opinionated but small, and it was written by
   someone living in the 10th. That is fine for the 10th and useless for
   the 15th. This builds the other half: every named bakery, café,
   market, park, museum, pool and bar in Paris, so that changing the home
   location changes what there *is* nearby, not merely how far away the
   old list happens to be.

   Two layers, deliberately different in kind:

     curated     ~90 places with a reason to care, photographs, pairings.
                 Ranked first. This is the voice.
     discovered  ~thousands of places with a name, a category and a
                 position. No opinion, and the interface never pretends
                 otherwise — they fill in the map, they do not review it.

   What this file must NOT become: a second curated catalogue. It carries
   the weak signals OSM actually has (a website, a brand tag, a Wikidata
   id) and nothing invented. Deciding which of these to show is
   js/nearby.js's job, not this script's.

   Queried at BUILD time, not in the browser: Overpass rate-limits and
   times out under load, and a static site should not depend on a third
   party being awake. The daily Action refreshes it.

   Usage:  node scripts/discover.mjs [--dry]
   --------------------------------------------------------- */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const DRY  = process.argv.includes('--dry');
const ONLY = (() => { const i = process.argv.indexOf('--only'); return i === -1 ? null : process.argv[i + 1].split(','); })();

const BBOX = '48.812,2.246,48.908,2.422';          // Paris intra-muros, generously
/* Full-planet mirrors only. overpass.osm.ch looks like a mirror and is a
   Switzerland-only extract — it answers 200 with zero elements, which the
   first version of this happily recorded as "Paris has no restaurants". */
const MIRRORS = ['https://overpass-api.de/api/interpreter',
                 'https://overpass.kumi.systems/api/interpreter',
                 'https://overpass.private.coffee/api/interpreter'];

/* Arrondissement centroids — used to label a point, and to sanity-check
   coverage. Nearest centroid, not point-in-polygon: good enough to say
   "5e" next to a name, and never used for distance. */
const ARR = {
  1:[48.8626,2.3363],  2:[48.8683,2.3413],  3:[48.8637,2.3615],  4:[48.8546,2.3572],
  5:[48.8448,2.3501],  6:[48.8496,2.3329],  7:[48.8565,2.3120],  8:[48.8726,2.3120],
  9:[48.8768,2.3374],  10:[48.8760,2.3595], 11:[48.8578,2.3792], 12:[48.8351,2.4212],
  13:[48.8283,2.3626], 14:[48.8331,2.3264], 15:[48.8412,2.3000], 16:[48.8637,2.2769],
  17:[48.8872,2.3070], 18:[48.8925,2.3444], 19:[48.8871,2.3828], 20:[48.8635,2.3985]
};

/* What to pull.

   This used to carry a `quality` flag that required a website or opening
   hours before a place was allowed into the file, and the Overpass
   queries were pre-filtered the same way. Both are gone, and the reason
   is worth keeping: gating here was gating in the wrong place.

   Measured on 20 August 2026, the two filters between them discarded
   half of what OpenStreetMap has — 10,127 restaurants in the city
   against 5,192 shipped, 2,732 cafés against 1,219. They were meant to
   stop the file becoming a phone book, and instead they starved the
   quiet arrondissements at the source, before anything downstream got a
   chance to be clever about them.

   So this ingests every named place, and the deciding happens where it
   can see the whole picture: `evidence` below, and the gate in
   js/nearby.js. A name with nothing behind it still arrives — it just
   has to get past something to be shown. */
const LAYERS = [
  { cat:'bakery',     emoji:'🥐', label:'Bakery',      q:['node["shop"="bakery"]','node["shop"="pastry"]'] },
  { cat:'cafe',       emoji:'☕', label:'Coffee',      q:['node["amenity"="cafe"]','node["shop"="coffee"]','node["shop"="tea"]'] },
  { cat:'restaurant', emoji:'🍽️', label:'Restaurant',  q:['node["amenity"="restaurant"]'] },
  { cat:'market',     emoji:'🧺', label:'Market',      q:['node["amenity"="marketplace"]','way["amenity"="marketplace"]'] },
  { cat:'deli',       emoji:'🧀', label:'Food shop',   q:['node["shop"="cheese"]','node["shop"="chocolate"]','node["shop"="wine"]','node["shop"="greengrocer"]','node["shop"="deli"]','node["amenity"="ice_cream"]','node["shop"="confectionery"]'] },
  { cat:'park',       emoji:'🌳', label:'Park',        q:['way["leisure"="park"]','way["leisure"="garden"]'], minName:true },
  { cat:'museum',     emoji:'🏛️', label:'Museum',      q:['node["tourism"="museum"]','way["tourism"="museum"]','node["tourism"="gallery"]'] },
  { cat:'sport',      emoji:'🏃', label:'Sport',       q:['way["leisure"="sports_centre"]','node["leisure"="sports_centre"]','way["leisure"="swimming_pool"]["access"!="private"]','node["leisure"="fitness_centre"]','node["leisure"="pitch"]["sport"="tennis"]','node["sport"="climbing"]','node["leisure"="sauna"]','node["amenity"="public_bath"]'] },
  { cat:'nightlife',  emoji:'🍸', label:'Bar',         q:['node["amenity"="bar"]','node["amenity"="pub"]','node["amenity"="nightclub"]','node["amenity"="music_venue"]'] },
  { cat:'culture',    emoji:'🎭', label:'Culture',     q:['node["amenity"="theatre"]','node["amenity"="cinema"]','node["amenity"="arts_centre"]','way["amenity"="theatre"]'] },
  { cat:'books',      emoji:'📚', label:'Bookshop',    q:['node["shop"="books"]','node["shop"="music"]','node["shop"="second_hand"]','node["shop"="antiques"]'] }
];

const sleep = ms => new Promise(r => setTimeout(r, ms));


/* Overpass throttles hard: 429 when you have used your slot, 504 when the
   instance is busy. Both are worth waiting out rather than failing — the
   first version of this script read a 429 as "no restaurants in Paris". */
async function overpass(query, attempt = 0) {
  let lastErr;
  for (const host of MIRRORS) {
    try {
      const res = await fetch(host, {
        method: 'POST',
        headers: { 'content-type': 'text/plain',
                   'user-agent': 'paris-for-you/1.0 (https://github.com/EktaSengar/paris)' },
        body: query,
        signal: AbortSignal.timeout(240000)
      });
      if (res.status === 429 || res.status === 504) {
        lastErr = new Error(`${host} → ${res.status}`);
        continue;                                       // try the next mirror first
      }
      if (!res.ok) { lastErr = new Error(`${host} → ${res.status}`); continue; }
      const text = await res.text();
      let json;
      try { json = JSON.parse(text); }
      catch { lastErr = new Error('non-JSON reply (throttled)'); continue; }
      // Treat an empty answer as suspect rather than authoritative.
      if (!json.elements || !json.elements.length) {
        lastErr = new Error(`${host} returned nothing`);
        continue;
      }
      return json;
    } catch (e) { lastErr = e; }
  }
  if (attempt < 4) {
    const wait = 30000 * (attempt + 1);
    process.stdout.write(`(throttled, waiting ${wait / 1000}s) `);
    await sleep(wait);
    return overpass(query, attempt + 1);
  }
  throw lastErr || new Error('every Overpass mirror failed');
}

const near = (lat, lon) => {
  let best = null, bd = Infinity;
  for (const [n, [a, b]] of Object.entries(ARR)) {
    const d = (a - lat) ** 2 + (b - lon) ** 2;
    if (d < bd) { bd = d; best = Number(n); }
  }
  return best;
};

/* Some names are shouty or duplicated across a chain; keep it tidy. */
const clean = s => s.replace(/\s+/g, ' ').trim().slice(0, 60);

async function run() {
  const out = [];
  const counts = {};

  for (const layer of LAYERS.filter(l => !ONLY || ONLY.includes(l.cat))) {
    /* `meta` for the element timestamp — how long since anybody touched
       this record is the closest thing OSM has to a freshness signal. */
    const body = `[out:json][timeout:240];(${layer.q.map(q => `${q}(${BBOX});`).join('')});out center tags meta;`;
    process.stdout.write(`  ${layer.label.padEnd(11)} `);

    let data;
    try { data = await overpass(body); }
    catch (e) { console.log(`failed — ${e.message}`); continue; }

    let kept = 0;
    for (const el of data.elements) {
      const t = el.tags || {};
      if (!t.name) continue;

      const lat = el.lat ?? el.center?.lat;
      const lon = el.lon ?? el.center?.lon;
      if (lat == null || lon == null) continue;

      const hours = (t.opening_hours || '').trim();
      const year = v => { const m = /^(\d{4})/.exec(String(v || '')); return m ? Number(m[1]) : null; };

      out.push({
        n: clean(t.name),
        c: layer.cat,
        lat: +lat.toFixed(5),
        lon: +lon.toFixed(5),
        a: near(lat, lon),
        ...(t['addr:street'] ? { s: clean(t['addr:street']) } : {}),
        ...(t.website || t['contact:website'] ? { w: (t.website || t['contact:website']).slice(0, 120) } : {}),
        ...(t.cuisine ? { k: t.cuisine.split(';')[0].slice(0, 24) } : {}),
        /* Two weak signals the ranking can use, both cheap to carry.
           `b` says OSM knows this is a branch of something — the retrieval
           layer already infers chains from repeated names, and this is the
           same fact stated outright. `d` says the place has a Wikidata
           entry, which for a bakery or a theatre means somebody thought it
           worth recording beyond its existence. */
        ...(t.brand || t['brand:wikidata'] ? { b: 1 } : {}),
        ...(t.wikidata || t.wikipedia ? { d: 1 } : {}),
        /* Distinctions OSM occasionally records and the ranking can use.
           Sparse — about two percent of places carry any of them — but
           where they exist they are the difference between a shop and a
           shop worth crossing the road for. */
        ...(t.heritage || t['ref:mhs'] || t.historic ? { h: 1 } : {}),
        ...(t.craft ? { r: 1 } : {}),
        ...(t.organic === 'yes' || t.organic === 'only' ? { o: 1 } : {}),
        ...(/^\d{4}/.test(t.start_date || '') ? { y: Number(String(t.start_date).slice(0, 4)) } : {}),
        ...(t.description && t.description.length <= 160 ? { x: clean(t.description).slice(0, 160) } : {}),

        /* ---- the practical half ----

           Opening hours are the field this script used to filter on and
           then threw away, which is why the site could never say whether
           anywhere was open.

           Stored as written. The first version of this interned the
           strings into a dictionary and had records point at it by index,
           on the assumption that a few hundred distinct strings covered
           the city. Measured: 6,972 distinct strings across 10,220
           places, an 8% saving on the field and about 1% of the file —
           against a dictionary that a partial `--only` refresh has to
           carefully re-map or it silently repoints half of Paris at the
           wrong hours. Not a trade worth making. */
        ...(hours ? { oh: hours.slice(0, 120) } : {}),
        ...(t['addr:housenumber'] ? { hn: clean(t['addr:housenumber']).slice(0, 10) } : {}),
        ...(t.phone || t['contact:phone'] ? { ph: (t.phone || t['contact:phone']).slice(0, 24) } : {}),
        ...(t.outdoor_seating === 'yes' ? { os: 1 } : {}),
        ...(t.takeaway === 'yes' || t.takeaway === 'only' ? { tk: 1 } : {}),
        ...(t['diet:vegetarian'] === 'yes' || t['diet:vegan'] === 'yes' ? { vg: 1 } : {}),
        ...(t.wheelchair === 'yes' ? { wc: 1 } : {}),

        /* ---- the freshness half ----

           `cd` is the year a mapper last said "I checked this"; `m` the
           year the record was last edited at all. Neither proves the shop
           is still there — nothing in OSM can — but a café nobody has
           touched since 2016 is a different proposition from one edited
           last month, and until now the file said nothing either way.
           Years rather than dates: it is a staleness signal, and a
           full timestamp on 25,000 records is a lot of bytes to spend on
           precision nobody reads. */
        ...(year(t.check_date || t['survey:date']) ? { cd: year(t.check_date || t['survey:date']) } : {}),
        ...(year(el.timestamp) ? { m: year(el.timestamp) } : {}),

        /* How much anybody has bothered to record. A place with twenty
           tags has been looked after; a place with three is a name and a
           position. Cheaper and more honest than inventing a rating. */
        t: Object.keys(t).length
      });
      kept++;
    }
    counts[layer.cat] = kept;
    console.log(`${String(kept).padStart(5)} kept  (of ${data.elements.length})`);
    await sleep(1500);                                  // be a good citizen
  }

  /* De-duplicate: OSM often has the same shop as a node and a way. */
  const seen = new Set();
  const items = out.filter(p => {
    const key = `${p.c}|${p.n.toLowerCase()}|${p.lat.toFixed(3)}|${p.lon.toFixed(3)}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });

  const spread = {};
  items.forEach(p => { spread[p.a] = (spread[p.a] || 0) + 1; });

  const doc = {
    generated: new Date().toISOString().slice(0, 10),
    source: 'OpenStreetMap via Overpass · ODbL',
    note: 'Names, categories, positions and the practical facts OSM records — opening hours, contact, access, and when anybody last checked. No opinions: the curated files carry the judgement, this carries the coverage, so that changing location changes what exists nearby rather than only how far away the old list is.',
    counts,
    items
  };

  console.log(`\n  ${items.length} places after de-duplication`);
  const withHours = items.filter(p => p.oh != null).length;
  console.log(`  ${withHours} with opening hours (${Math.round(withHours / items.length * 100)}%)`);
  console.log('  per arrondissement:', Object.entries(spread)
    .sort((a, b) => a[0] - b[0]).map(([a, n]) => `${a}:${n}`).join(' '));

  if (DRY) { console.log('\n  --dry, nothing written\n'); return; }

  if (ONLY) {
    // keep everything we already have for the categories we did not re-run
    let prev = { items: [], counts: {}, hours: [] };
    try { prev = JSON.parse(await fs.readFile(path.join(DATA, 'discovered.json'), 'utf8')); } catch {}
    doc.items = prev.items.filter(p => !ONLY.includes(p.c)).concat(doc.items);
    doc.counts = { ...prev.counts, ...doc.counts };
    console.log(`  merged with existing → ${doc.items.length} total`);
  }
  await fs.writeFile(path.join(DATA, 'discovered.json'), JSON.stringify(doc) + '\n', 'utf8');
  const kb = Math.round((await fs.stat(path.join(DATA, 'discovered.json'))).size / 1024);
  console.log(`\n  wrote data/discovered.json — ${kb} KB\n`);
}

console.log('\nDiscovering Paris from OpenStreetMap…\n');
run().catch(e => { console.error('\n' + e.message + '\n'); process.exit(1); });
