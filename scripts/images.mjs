#!/usr/bin/env node
/* ---------------------------------------------------------
   images.mjs — resolve one openly-licensed photo per card.

   Source is Wikimedia Commons, via the Wikipedia page-image API. No key,
   no account, free licences, and every picture keeps its attribution.

   Resolution happens HERE, at build time, not in the browser: the site
   ships plain static URLs so there is no runtime API call, nothing to rate
   limit, and no broken image on a slow connection.

   Honesty rule: many small businesses have no free photograph of their own.
   Rather than pretend, those cards borrow a picture of the street or
   neighbourhood they sit on, and `imageSubject` records what is actually
   in the frame so the card can say so underneath.

   Usage:  node scripts/images.mjs [--force]
   --------------------------------------------------------- */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const FORCE = process.argv.includes('--force');

/* What to look up for each card. Where a place has no article of its own,
   the value is the street or quarter it stands on — and that is what the
   credit will name. */
const QUERIES = {
  // events
  'villette-open-air-cinema-2026': 'Parc de la Villette',
  'paris-plages-2026': 'Bassin de la Villette',
  'olympic-cauldron-2026': 'Jardin des Tuileries',
  'paris-jazz-festival-2026': 'Parc floral de Paris',
  'classique-au-vert-2026': 'Parc floral de Paris',
  'nuits-des-etoiles-parks-2026': 'Observatoire de Paris',
  'marcounet-guinguette-2026': 'Pont Marie',
  'fete-des-tuileries-2026': 'Jardin des Tuileries',
  'javelle-guinguette-2026': 'Parc de Bercy',
  'grand-palais-leandro-erlich-2026': 'Grand Palais',
  'grand-palais-hilma-af-klint-2026': 'Hilma af Klint',
  'beyond-the-streets-villette-2026': 'Grande halle de la Villette',
  'jeu-de-paume-photo-2026': 'Galerie nationale du Jeu de Paume',
  'musee-maillol-versace-2026': 'Musée Maillol',
  'quai-branly-esprit-du-temps-2026': 'Musée du quai Branly - Jacques-Chirac',
  'palais-tokyo-nocturnes-2026': 'Palais de Tokyo',
  'theatre-verdure-shakespeare-2026': 'Pré Catelan',
  'rock-en-seine-2026': 'Domaine national de Saint-Cloud',
  'journees-du-patrimoine-2026': 'Palais de l\'Élysée',
  'esports-world-cup-paris-2026': 'Paris Expo Porte de Versailles',

  // places
  'du-pain-et-des-idees': 'Rue Yves-Toudic',
  'ten-belles': 'Canal Saint-Martin',
  'holybelly': 'Rue Lucien-Sampaix',
  'boulangerie-utopie': 'Rue Jean-Pierre-Timbaud',
  'mamiche': '10e arrondissement de Paris',
  'cafe-oberkampf': 'Rue Oberkampf',
  'belleville-brulerie': 'Belleville (Paris)',
  'boot-cafe': 'Rue du Pont-aux-Choux',
  'marche-aligre': "Marché d'Aligre",
  'marche-enfants-rouges': 'Marché des Enfants-Rouges',
  'marche-saint-quentin': 'Marché Saint-Quentin',
  'puces-vanves': 'Vanves',
  'puces-saint-ouen': 'Marché aux puces de Saint-Ouen',
  'la-tresorerie': '10e arrondissement de Paris',
  'empreintes': 'Rue Charlot',
  'e-dehillerin': 'Rue Coquillière',
  'artazart': 'Quai de Valmy',
  'ofr-bookshop': 'Rue Dupetit-Thouars',
  'green-factory': 'Rue Notre-Dame-de-Nazareth',
  'sennelier': 'Quai Voltaire',
  'musee-chasse-nature': 'Musée de la chasse et de la nature',
  'pavillon-arsenal': "Pavillon de l'Arsenal",
  'musee-carnavalet': 'Musée Carnavalet',
  'petit-palais': 'Petit Palais',
  'musee-vie-romantique': 'Rue Chaptal',
  '59-rivoli': '59 Rivoli',
  'buttes-chaumont': 'Parc des Buttes-Chaumont',
  'parc-belleville': 'Parc de Belleville',
  'coulee-verte': 'Coulée verte René-Dumont',
  'petite-ceinture': 'Ligne de Petite Ceinture',
  'passages-couverts': 'Galerie Vivienne',
  'passage-brady': 'Passage Brady',
  'mouzaia': "Quartier d'Amérique",
  'butte-aux-cailles': 'Butte-aux-Cailles',
  'pere-lachaise': 'Cimetière du Père-Lachaise',
  'jardin-villemin': 'Jardin Villemin',
  'la-cuisine-paris': "Quai de l'Hôtel-de-Ville",
  'studio-des-parfums': 'Orgue à parfums',
  'o-chateau-wine': 'Cave à vin',
  'ceramics-workshop-paris': 'Tour de potier',

  // itineraries
  'canal-saturday-morning': 'Canal Saint-Martin',
  'rainy-day-passages': 'Galerie Vivienne',
  'sunday-aligre-coulee-verte': 'Coulée verte René-Dumont',
  'sunset-belleville': 'Parc de Belleville',
  'explore-the-13th': 'Butte-aux-Cailles',
  'villette-full-day': 'Parc de la Villette',
  'buttes-mouzaia': "Quartier d'Amérique",
  'marais-design-crawl': 'Le Marais',
  'vanves-flea-sunday': 'Vanves',

  // nightlife
  'new-morning': '10e arrondissement de Paris',
  'point-ephemere': 'Point Éphémère',
  'duc-des-lombards': 'Rue des Lombards',
  'caveau-huchette': 'Caveau de la Huchette',
  'cafe-universel': 'Rue Saint-Jacques (Paris)',
  'supersonic': 'Place de la Bastille',
  'la-maroquinerie': 'La Maroquinerie',
  'la-bellevilloise': 'La Bellevilloise',
  'philharmonie-paris': 'Parc de la Villette',
  'la-java': 'Rue du Faubourg-du-Temple',
  'rex-club': 'Boulevard Poissonnière',
  'la-machine-moulin-rouge': 'Moulin Rouge',
  'le-verre-vole': 'Rue de Lancry',
  'le-syndicat': 'Rue du Faubourg-Saint-Denis',
  'combat': 'Rue de Belleville',
  'little-red-door': 'Rue Charlot',
  'candelaria': 'Rue de Saintonge',
  'la-buvette': 'Rue Saint-Maur',
  'moonshiner': 'Rue Sedaine',
  'le-petit-bain': 'Quai de la Gare',

  // night events and routes
  'jazz-a-la-villette-2026': 'Grande halle de la Villette',
  'techno-parade-2026': 'Techno Parade',
  'lauryn-hill-bercy-2026': 'Accor Arena',
  'ayo-cigale-2026': 'La Cigale',
  'yemi-alade-cigale-2026': 'La Cigale',
  'night-faubourg-saint-denis': 'Rue du Faubourg-Saint-Denis',
  'night-jazz-lombards': 'Rue des Lombards',

  // sport
  'paris-fc-jean-bouin': 'Stade Jean-Bouin (Paris)',
  'psg-parc-des-princes': 'Parc des Princes',
  'red-star-stade-bauer': 'Stade Bauer',
  'stade-de-france': 'Stade de France',
  'adidas-arena-basketball': 'Adidas Arena',
  'accor-arena-bercy': 'Accor Arena',
  'roland-garros': 'Stade Roland-Garros',
  'hippodrome-vincennes': 'Hippodrome de Vincennes',
  'olympic-aquatics-centre': 'Stade de France',
  'seine-swimming': 'Seine',
  'piscine-pontoise': 'Piscine Pontoise',
  'arkose-climbing': 'Escalade de bloc',
  'paris-tennis-courts': 'Court de tennis',
  'run-canal-ourcq': 'Canal de l\'Ourcq',
  'run-buttes-chaumont': 'Parc des Buttes-Chaumont',
  'run-bois-de-vincennes': 'Bois de Vincennes',
  'run-coulee-verte': 'Coulée verte René-Dumont',
  'european-aquatics-2026': 'Pont de Bir-Hakeim',
  'prix-arc-triomphe-2026': 'Hippodrome de Longchamp',
  '20km-de-paris-2026': 'Tour Eiffel',
  'rolex-paris-masters-2026': 'La Défense',

  // day trips
  'chantilly': 'Château de Chantilly',
  'reims-champagne': 'Cathédrale Notre-Dame de Reims',
  'vaux-le-vicomte': 'Château de Vaux-le-Vicomte',
  'provins': 'Provins',
  'auvers-sur-oise': 'Auvers-sur-Oise',
  'fontainebleau': 'Château de Fontainebleau',
  'giverny': 'Giverny',
  'versailles': 'Château de Versailles',
  'sceaux': 'Parc de Sceaux',
  'senlis': 'Senlis (Oise)',
  'meaux': 'Cathédrale Saint-Étienne de Meaux',
  'saint-germain-en-laye': 'Château de Saint-Germain-en-Laye',
  'chartres': 'Cathédrale Notre-Dame de Chartres'
};

/* Photo provenance.

   Some cards show a photograph of the thing itself; others borrow one of the
   street or quarter, because no free photo of that café exists. The interface
   needs to know which: it leads with a picture only when the picture is
   actually informative. A beige street shot at card size tells you nothing
   about a bakery, so those views use type instead.

   Anything not listed here is assumed to be a photo of the subject itself. */
const CONTEXT_ONLY = new Set([
  'du-pain-et-des-idees', 'ten-belles', 'holybelly', 'boulangerie-utopie', 'mamiche',
  'cafe-oberkampf', 'belleville-brulerie', 'boot-cafe', 'la-tresorerie', 'empreintes',
  'e-dehillerin', 'artazart', 'ofr-bookshop', 'green-factory', 'sennelier',
  'musee-vie-romantique', 'la-cuisine-paris', 'studio-des-parfums', 'o-chateau-wine',
  'ceramics-workshop-paris', 'puces-vanves', 'vanves-flea-sunday',
  'nuits-des-etoiles-parks-2026', 'marcounet-guinguette-2026', 'journees-du-patrimoine-2026',
  'canal-saturday-morning', 'rainy-day-passages', 'sunday-aligre-coulee-verte',
  'sunset-belleville', 'explore-the-13th', 'villette-full-day', 'buttes-mouzaia',
  'marais-design-crawl', 'esports-world-cup-paris-2026', 'grand-palais-hilma-af-klint-2026',
  'new-morning', 'duc-des-lombards', 'cafe-universel', 'supersonic', 'la-java',
  'rex-club', 'la-machine-moulin-rouge', 'le-verre-vole', 'le-syndicat', 'combat',
  'little-red-door', 'candelaria', 'la-buvette', 'moonshiner',
  'lauryn-hill-bercy-2026', 'ayo-cigale-2026', 'yemi-alade-cigale-2026',
  'night-faubourg-saint-denis', 'night-jazz-lombards',
  'philharmonie-paris', 'le-petit-bain',
  'seine-swimming', 'arkose-climbing', 'paris-tennis-courts', 'run-canal-ourcq',
  'run-buttes-chaumont', 'run-bois-de-vincennes', 'run-coulee-verte',
  '20km-de-paris-2026', 'rolex-paris-masters-2026',
  'olympic-aquatics-centre', 'prix-arc-triomphe-2026'
]);

const FILES = ['events.json', 'places.json', 'nightlife.json', 'sports.json', 'itineraries.json', 'daytrips.json'];
const WIKIS = ['fr', 'en'];
const BATCH = 20;          // the API takes up to 50 titles; 20 keeps URLs sane
const clean = u => u ? u.split('?')[0] : u;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const strip = s => s ? String(s).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() : '';

/* Wikimedia asks for an identifying User-Agent and a modest request rate.
   We batch heavily, pause between calls, and back off on 429. */
const UA = 'paris-for-you/1.0 (personal site; https://github.com/EktaSengar/paris)';

async function api(url, attempt = 0) {
  const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(30000) });

  if (res.status === 429 || res.status === 403) {
    if (attempt >= 4) throw new Error(`rate limited after ${attempt} retries`);
    const wait = 5000 * Math.pow(2, attempt);
    console.log(`    …rate limited, waiting ${wait / 1000}s`);
    await sleep(wait);
    return api(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`${res.status} ${url}`);

  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    // The rate limiter answers in plain text, not JSON — surface it rather than
    // silently reporting "no image found".
    throw new Error(`non-JSON reply: ${text.slice(0, 120)}`);
  }
}

/* Look up many articles at once. Returns Map<requestedTitle, imageUrl>. */
async function pageImages(titles, lang) {
  const found = new Map();

  for (let i = 0; i < titles.length; i += BATCH) {
    const chunk = titles.slice(i, i + BATCH);
    const url = `https://${lang}.wikipedia.org/w/api.php?action=query&prop=pageimages`
      + `&piprop=thumbnail&pithumbsize=1200&redirects=1&format=json&formatversion=2`
      + `&titles=${encodeURIComponent(chunk.join('|'))}`;

    const d = await api(url);
    const q = d.query || {};

    // Follow normalisation and redirects back to what we asked for.
    const chain = new Map();
    (q.normalized || []).forEach(n => chain.set(n.to, n.from));
    (q.redirects || []).forEach(r => chain.set(r.to, chain.get(r.from) ?? r.from));

    (q.pages || []).forEach(p => {
      if (!p.thumbnail?.source) return;
      const src = clean(p.thumbnail.source);

      // Only take Commons-hosted files. Images under /wikipedia/<lang>/ are
      // local uploads, which for institutions are usually non-free logos
      // used under fair use — not ours to republish, and a logo is a poor
      // photograph anyway.
      if (!src.includes('/wikipedia/commons/')) return;

      const original = chain.get(p.title) ?? p.title;
      found.set(original, src);
    });

    await sleep(1500);
  }
  return found;
}

/* Artist and licence for a batch of Commons files. Returns Map<file, credit>. */
async function credits(files) {
  const out = new Map();

  for (let i = 0; i < files.length; i += BATCH) {
    const chunk = files.slice(i, i + BATCH).map(f => 'File:' + f);
    const url = `https://commons.wikimedia.org/w/api.php?action=query&prop=imageinfo`
      + `&iiprop=extmetadata&format=json&formatversion=2`
      + `&titles=${encodeURIComponent(chunk.join('|'))}`;

    try {
      const d = await api(url);
      (d.query?.pages || []).forEach(p => {
        const md = p.imageinfo?.[0]?.extmetadata || {};
        out.set(p.title.replace(/^File:/, ''), {
          artist: strip(md.Artist?.value).slice(0, 70) || 'Wikimedia Commons',
          licence: strip(md.LicenseShortName?.value) || 'Wikimedia Commons'
        });
      });
    } catch (e) {
      console.log(`    (credit lookup failed for a batch: ${e.message})`);
    }
    await sleep(1500);
  }
  return out;
}

const fileFromUrl = u => {
  const m = u.match(/\/commons\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/]+)/);
  return m ? decodeURIComponent(m[1]) : null;
};

/* Commons only renders a fixed set of thumbnail widths — anything else is a
   400. Probed against upload.wikimedia.org, these are the ones that work.
   Keep in sync with THUMB_WIDTHS in js/app.js, which builds the srcset. */
export const THUMB_WIDTHS = [120, 250, 500, 960, 1280, 1920];

/* Rewrite any Commons URL into a thumbnail of the given width. It is the
   difference between a 300 KB download and a 45 KB one for a card that is
   340 px wide. Originals served straight from /commons/x/xy/ get a /thumb/
   path built for them. */
function thumbUrl(url, width) {
  if (!THUMB_WIDTHS.includes(width)) throw new Error(`width ${width} is not one Commons will render`);
  const thumb = url.match(/^(https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/thumb\/[0-9a-f]\/[0-9a-f]{2}\/[^/]+\/)\d+px-(.+)$/);
  if (thumb) return `${thumb[1]}${width}px-${thumb[2]}`;

  const orig = url.match(/^(https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/)([0-9a-f]\/[0-9a-f]{2}\/)([^/]+)$/);
  if (orig) {
    const name = orig[3];
    // Commons serves SVG and some formats as PNG thumbs; keep it to raster here.
    if (/\.(jpe?g|png|gif)$/i.test(name)) return `${orig[1]}thumb/${orig[2]}${name}/${width}px-${name}`;
  }
  return null;
}

/* HEAD with retries — a burst of these gets throttled, and a throttled
   response must not be mistaken for a missing image. */
async function reachable(url, attempt = 0) {
  const res = await fetch(url, { method: 'HEAD', headers: { 'user-agent': UA },
    signal: AbortSignal.timeout(25000) }).catch(() => null);

  if (res && res.ok) return true;
  if (res && res.status === 400) return false;         // genuinely not a valid size
  if (attempt >= 3) return false;
  await sleep(3000 * (attempt + 1));
  return reachable(url, attempt + 1);
}

/* Normalise every stored image to a 500px thumbnail. The rewrite is
   deterministic, so we do it first and verify afterwards, reverting only
   what genuinely fails. */
async function resizePass() {
  const WIDTH = 500;
  const touched = [];
  let kept = 0;

  for (const file of FILES) {
    const full = path.join(DATA, file);
    const doc = JSON.parse(await fs.readFile(full, 'utf8'));

    for (const item of doc.items) {
      if (!item.image) continue;
      const candidate = thumbUrl(item.image, WIDTH);
      if (!candidate || candidate === item.image) { kept++; continue; }
      touched.push({ item, was: item.image, now: candidate });
      item.image = candidate;
    }
    docsToWrite.set(full, doc);
  }

  console.log(`Rewriting ${touched.length} to ${WIDTH}px, ${kept} already fine. Verifying…`);

  let reverted = 0;
  for (const t of touched) {
    if (!(await reachable(t.now))) { t.item.image = t.was; reverted++; console.log(`  ! reverted ${t.item.id}`); }
    await sleep(400);
  }

  for (const [full, doc] of docsToWrite) {
    await fs.writeFile(full, JSON.stringify(doc, null, 2) + '\n', 'utf8');
  }

  console.log(`\nResize: ${touched.length - reverted} now ${WIDTH}px, ${reverted} reverted, ${kept} unchanged.`);
}

const docsToWrite = new Map();

async function run() {
  /* 1 — gather every article we need to look up. */
  const docs = {};
  const wanted = new Map();                 // requested title -> [items]
  let skipped = 0;
  const missing = [];

  for (const file of FILES) {
    const full = path.join(DATA, file);
    docs[file] = { full, doc: JSON.parse(await fs.readFile(full, 'utf8')) };

    for (const item of docs[file].doc.items) {
      if (item.image && !FORCE) { skipped++; continue; }
      const query = QUERIES[item.id];
      if (!query) { missing.push(`${item.id} — no article mapped`); continue; }
      if (!wanted.has(query)) wanted.set(query, []);
      wanted.get(query).push(item);
    }
  }

  const titles = [...wanted.keys()];
  console.log(`Looking up ${titles.length} articles for ${[...wanted.values()].flat().length} cards.\n`);

  /* 2 — French Wikipedia first (much better on Paris), English for the rest. */
  const hits = new Map();
  if (titles.length) {
    console.log('  fr.wikipedia…');
    for (const [t, u] of await pageImages(titles, 'fr')) hits.set(t, u);

    const stillMissing = titles.filter(t => !hits.has(t));
    if (stillMissing.length) {
      console.log(`  en.wikipedia for ${stillMissing.length} remaining…`);
      for (const [t, u] of await pageImages(stillMissing, 'en')) hits.set(t, u);
    }
  }

  /* 3 — attribution, batched. */
  const files = [...new Set([...hits.values()].map(fileFromUrl).filter(Boolean))];
  console.log(`  attribution for ${files.length} files…`);
  const cr = await credits(files);

  /* 4 — write it back. */
  let resolved = 0;
  for (const [query, items] of wanted) {
    const url = hits.get(query);
    if (!url) { items.forEach(i => missing.push(`${i.id} — no free photo of "${query}"`)); continue; }
    const c = cr.get(fileFromUrl(url));
    items.forEach(item => {
      item.image = url;
      item.imageSubject = query;                 // what is genuinely in the frame
      item.imageKind = CONTEXT_ONLY.has(item.id) ? 'context' : 'subject';
      item.imageCredit = c ? `${c.artist} · ${c.licence}` : 'Wikimedia Commons';
      resolved++;
    });
  }

  for (const { full, doc } of Object.values(docs)) {
    await fs.writeFile(full, JSON.stringify(doc, null, 2) + '\n', 'utf8');
  }

  console.log(`\nImages: ${resolved} resolved, ${skipped} already had one.`);
  if (missing.length) {
    console.log(`\n${missing.length} without a photo — these get a typographic tile instead:`);
    missing.forEach(m => console.log(`  · ${m}`));
  }
}

const main = process.argv.includes('--resize') ? resizePass : run;
main().catch(e => { console.error(e); process.exit(1); });
