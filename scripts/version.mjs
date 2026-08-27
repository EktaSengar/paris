#!/usr/bin/env node
/* ---------------------------------------------------------
   version.mjs — content-hash the CSS and JS links in index.html.

   Why this exists: GitHub Pages serves assets with `cache-control:
   max-age=600`. Deploy a change and, for the next ten minutes, a returning
   browser happily pairs the NEW index.html with the OLD cached style.css
   and app.js. The result is a page that is half one version and half
   another — tabs with no spacing, views that render "nothing here"
   because the cached script has never heard of them.

   Stamping each asset with a hash of its own contents means a changed file
   gets a new URL, so it can never be answered from a stale cache, while an
   unchanged file keeps its URL and stays cached.

   The data files have exactly the same problem and, until recently, a
   worse answer: the page asked for all thirty-seven of them with
   `cache: 'no-cache'`, spending a round trip per file, on every visit, to
   be told nothing had changed. So they are hashed too — not into their
   own href, since nothing in the HTML links to them, but into a
   `window.__DV` map the page reads when it builds each data URL. Same
   guarantee, same mechanism: a changed file is unreachable from any
   cache, and an unchanged one costs no network at all.

   Usage:  node scripts/version.mjs [--check]
           --check  exit non-zero if the stamps are out of date (for CI)
   --------------------------------------------------------- */

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML = path.join(ROOT, 'index.html');
const CHECK = process.argv.includes('--check');

const hash = buf => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 8);

/* Matches href/src for a local css or js file, with or without an existing ?v= */
const ASSET = /(href|src)="((?:css|js)\/[^"?]+\.(?:css|js))(\?v=[^"]*)?"/g;

/* The one line in index.html that carries the data hashes. Rewritten
   whole each run, so the map cannot drift from what is on disk. */
const DV_LINE = /^(\s*)window\.__DV = .*;$/m;

/* Every .json under data/, including the twenty shards, keyed the way the
   page asks for them: "civic", "places/index", "places/11". */
async function dataVersions() {
  const base = path.join(ROOT, 'data');
  const names = [];
  for (const e of await fs.readdir(base, { withFileTypes: true })) {
    if (e.isFile() && e.name.endsWith('.json')) names.push(e.name.slice(0, -5));
    else if (e.isDirectory()) {
      for (const f of await fs.readdir(path.join(base, e.name))) {
        if (f.endsWith('.json')) names.push(`${e.name}/${f.slice(0, -5)}`);
      }
    }
  }
  names.sort();
  const map = {};
  for (const n of names) map[n] = hash(await fs.readFile(path.join(base, `${n}.json`)));
  return map;
}

async function run() {
  const original = await fs.readFile(HTML, 'utf8');
  const missing = [];
  const stamped = [];

  const replacements = [];
  for (const m of original.matchAll(ASSET)) {
    const [full, attr, file] = m;
    const abs = path.join(ROOT, file);
    try {
      const h = hash(await fs.readFile(abs));
      replacements.push([full, `${attr}="${file}?v=${h}"`]);
      stamped.push(`${file} → ${h}`);
    } catch (e) {
      missing.push(file);
    }
  }

  let out = original;
  replacements.forEach(([from, to]) => { out = out.replace(from, to); });

  const dv = await dataVersions();
  if (!DV_LINE.test(out)) {
    console.error('index.html has no `window.__DV = ...;` line to stamp.');
    process.exit(1);
  }
  out = out.replace(DV_LINE, (_, indent) => `${indent}window.__DV = ${JSON.stringify(dv)};`);
  stamped.push(`data/*.json → ${Object.keys(dv).length} hashes`);

  if (missing.length) {
    console.error('Referenced but not found:');
    missing.forEach(f => console.error(`  ✗ ${f}`));
    process.exit(1);
  }

  if (out === original) {
    console.log(`Asset stamps already current (${stamped.length} files).`);
    return;
  }

  if (CHECK) {
    console.error('Asset stamps are out of date. Run: node scripts/version.mjs');
    stamped.forEach(s => console.error(`  · ${s}`));
    process.exit(1);
  }

  await fs.writeFile(HTML, out, 'utf8');
  console.log('Stamped:');
  stamped.forEach(s => console.log(`  ✓ ${s}`));
}

run().catch(e => { console.error(e); process.exit(1); });
