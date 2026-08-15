#!/usr/bin/env node
/* ---------------------------------------------------------
   refresh.mjs — the data hygiene step.

   Run daily by .github/workflows/refresh.yml. It does three jobs:

     1. PRUNE    drop events whose `end` date has passed, so the site
                 never shows something that already happened.
     2. VALIDATE check every record has the fields the front end needs
                 and fail loudly if not, so a bad edit cannot ship.
     3. STAMP    record when the data was last processed.

   It deliberately does NOT invent or scrape new events. Adding events is
   a research job — see `collect()` at the bottom for where an automated
   or agent-driven collector plugs in.

   Usage:  node scripts/refresh.mjs [--check] [--links]
           --check   validate only, change nothing (used in CI on PRs)
           --links   additionally HEAD every source URL and warn on failures
   --------------------------------------------------------- */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const TODAY = new Date().toISOString().slice(0, 10);

const args = new Set(process.argv.slice(2));
const CHECK_ONLY = args.has('--check');
const CHECK_LINKS = args.has('--links');

const problems = [];
const notes = [];

/* Which files hold what, and how strictly to treat them. */
const FILES = {
  'events.json':        { timeSensitive: true,  required: ['id', 'title', 'why', 'url', 'lastVerified', 'source'] },
  'places.json':        { timeSensitive: false, required: ['id', 'title', 'why', 'url'] },
  'nightlife.json':     { timeSensitive: false, required: ['id', 'title', 'why', 'url'] },
  'itineraries.json':   { timeSensitive: false, required: ['id', 'title', 'why', 'stops'] },
  'daytrips.json':      { timeSensitive: false, required: ['id', 'title', 'why', 'url', 'transit'] },
  'neighborhoods.json': { timeSensitive: false, required: ['arr', 'name', 'famousFor'] },
  'quests.json':        { timeSensitive: false, required: ['id', 'title', 'targets'] }
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;

async function readJSON(file) {
  const raw = await fs.readFile(path.join(DATA, file), 'utf8');
  try {
    return JSON.parse(raw);
  } catch (e) {
    problems.push(`${file}: not valid JSON — ${e.message}`);
    return null;
  }
}

function validateItem(file, item, required, i) {
  const where = `${file}[${i}] ${item.id || item.title || item.arr || '?'}`;

  required.forEach(f => {
    if (item[f] === undefined || item[f] === null || item[f] === '') {
      problems.push(`${where}: missing required field "${f}"`);
    }
  });

  ['start', 'end', 'lastVerified'].forEach(f => {
    if (item[f] && !ISO.test(item[f])) problems.push(`${where}: "${f}" must be YYYY-MM-DD, got "${item[f]}"`);
  });

  if (item.start && item.end && item.start > item.end) {
    problems.push(`${where}: start (${item.start}) is after end (${item.end})`);
  }

  if (item.price !== undefined && (typeof item.price !== 'number' || item.price < 0)) {
    problems.push(`${where}: price must be a non-negative number`);
  }

  if (item.minutesFromHome !== undefined &&
      (typeof item.minutesFromHome !== 'number' || item.minutesFromHome < 0)) {
    problems.push(`${where}: minutesFromHome must be a non-negative number`);
  }

  if (item.days && (!Array.isArray(item.days) || item.days.some(d => d < 0 || d > 6))) {
    problems.push(`${where}: days must be an array of 0-6 (0 = Sunday)`);
  }

  if (item.url && !/^https?:\/\//.test(item.url)) {
    problems.push(`${where}: url must be absolute`);
  }

  // Soft warning: an event verified long ago is probably stale.
  if (item.lastVerified) {
    const age = (new Date(TODAY) - new Date(item.lastVerified)) / 86400000;
    if (age > 45) notes.push(`${where}: last verified ${Math.round(age)} days ago — worth re-checking`);
  }
}

async function checkLinks(items) {
  const urls = [...new Set(items.map(i => i.url).filter(Boolean))];
  await Promise.all(urls.map(async url => {
    try {
      const res = await fetch(url, { method: 'HEAD', redirect: 'follow',
        signal: AbortSignal.timeout(12000) });
      if (res.status >= 400) notes.push(`link ${res.status}: ${url}`);
    } catch (e) {
      notes.push(`link unreachable: ${url} (${e.name})`);
    }
  }));
}

async function run() {
  let pruned = 0, total = 0;
  const allItems = [];

  for (const [file, cfg] of Object.entries(FILES)) {
    const doc = await readJSON(file);
    if (!doc) continue;

    const items = doc.items || [];
    const ids = new Set();

    items.forEach((item, i) => {
      validateItem(file, item, cfg.required, i);
      if (item.id) {
        if (ids.has(item.id)) problems.push(`${file}: duplicate id "${item.id}"`);
        ids.add(item.id);
      }
    });

    let kept = items;
    if (cfg.timeSensitive) {
      kept = items.filter(item => {
        const expired = item.end && item.end < TODAY;
        if (expired) {
          pruned++;
          notes.push(`pruned expired: ${item.title} (ended ${item.end})`);
        }
        return !expired;
      });
    }

    total += kept.length;
    allItems.push(...kept);

    if (!CHECK_ONLY && (kept.length !== items.length || cfg.timeSensitive)) {
      doc.items = kept;
      doc.generated = TODAY;
      await fs.writeFile(path.join(DATA, file), JSON.stringify(doc, null, 2) + '\n', 'utf8');
    }
  }

  if (CHECK_LINKS) await checkLinks(allItems);

  /* ---- report ---- */
  console.log(`\nParis data refresh — ${TODAY}`);
  console.log(`  ${total} live records across ${Object.keys(FILES).length} files`);
  console.log(`  ${pruned} expired ${pruned === 1 ? 'entry' : 'entries'} removed`);

  if (notes.length) {
    console.log('\nNotes:');
    notes.forEach(n => console.log(`  · ${n}`));
  }

  if (problems.length) {
    console.error('\nProblems:');
    problems.forEach(p => console.error(`  ✗ ${p}`));
    console.error(`\n${problems.length} problem(s) — not shipping this.`);
    process.exit(1);
  }

  console.log('\nAll good.\n');
}

/* ---------------------------------------------------------
   EXTENSION POINT — automated collection

   To make the site self-updating, add a collector here that appends new
   records to data/events.json before the prune/validate pass above.

   The rule that keeps this useful rather than noisy: never write an event
   without `url`, `source` and `lastVerified`. Aggregators are a discovery
   channel, not a source of truth — resolve to the venue's official page
   before committing a record.

   Practical options, cheapest first:
     · Paris.fr publishes an open data feed of events ("que faire à paris")
       at opendata.paris.fr — no key, and it is the city's own data.
     · Individual venue sites and their RSS/iCal feeds.
     · A scheduled Claude Code run doing the research and opening a PR,
       which keeps a human in the loop on quality.
   --------------------------------------------------------- */
// async function collect() { /* ... */ }

run().catch(e => { console.error(e); process.exit(1); });
