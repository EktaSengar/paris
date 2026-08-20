#!/usr/bin/env node
/* ---------------------------------------------------------
   shim.mjs — run a browser module in Node.

   The js/ files are plain scripts, not ES modules: each one wraps an
   IIFE and leaves a single const behind for the next script tag to use.
   That is deliberate — no build step, no bundler, nothing between the
   editor and the page.

   It does mean Node cannot `import` them, and the Node scripts need to,
   because the alternative is a second copy of the logic that drifts out
   of step with the first. So they are evaluated in a function whose
   parameters stand in for whichever globals the module expects, and the
   const is handed back.

   Nothing is mocked beyond what a module actually reaches for. If a
   script needs `Store` or `fetch`, it passes its own stub and decides
   what the stub does.
   --------------------------------------------------------- */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readShards } from './shard.mjs';

/* The discovery index ships as twenty files so the browser can paint
   before it has all of them. Nothing in Node has any reason to care, so
   this is the one place that reassembles it. */
export const readDiscovered = readShards;

const JS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'js');

export function loadModule(file, name, globals = {}) {
  const src = fs.readFileSync(path.join(JS, file), 'utf8');
  const keys = ['console', ...Object.keys(globals)];
  const vals = [console, ...Object.values(globals)];
  return new Function(...keys, `${src}\n; return ${name};`)(...vals);
}

/* The two the record layer needs, in the order they depend on each
   other. Every script that reads data/ and wants it in the shape the
   browser sees should start here. */
export function loadRecord() {
  const Loc = loadModule('location.js', 'Loc',
    { localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      navigator: {}, Store: {} });
  return { Loc, Rec: loadModule('record.js', 'Rec', { Loc }) };
}
