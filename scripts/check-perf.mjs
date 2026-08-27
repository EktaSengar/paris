#!/usr/bin/env node
/* ---------------------------------------------------------
   check-perf.mjs — how long does this page make somebody wait,
   and has that got worse since last time.

   The other check-* scripts ask whether the site is *right*. This one
   asks whether it is *quick*, which is a question that goes wrong
   quietly: nobody writes a commit that says "make the first paint two
   seconds slower". It happens a hundred kilobytes at a time, as the
   discovery index grows and another file joins the critical path, and
   the only way to notice is to keep measuring.

   Measured against a local server that behaves like GitHub Pages —
   gzip, `max-age=600`, ETags — because measuring against a server that
   does none of those things tells you about the server.

   Reports; never fails. A Lighthouse score has real run-to-run variance
   and a check that cries wolf is a check people learn to ignore. The
   numbers are here to be read, and the byte counts (which are exact) are
   where a regression usually shows up first anyway.

   Usage:
     node scripts/check-perf.mjs                  measure and compare
     node scripts/check-perf.mjs --runs 5         more runs, tighter median
     node scripts/check-perf.mjs --real           real throttling, not simulated
     node scripts/check-perf.mjs --inp            also drive the tabs and time them
     node scripts/check-perf.mjs --save           adopt these numbers as the baseline
     node scripts/check-perf.mjs --json           machine-readable, for CI
     node scripts/check-perf.mjs --markdown FILE  write a report (CI job summary)

   Needs Chrome. Set CHROME_PATH if it is somewhere unusual — on this
   machine it is "/Applications/Google Chrome 2.app/Contents/MacOS/Google
   Chrome", which chrome-launcher cannot find on its own.
   --------------------------------------------------------- */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = path.join(ROOT, 'scripts', 'perf-baseline.json');
const LIGHTHOUSE = 'lighthouse@12';

const argv = process.argv.slice(2);
const flag = n => argv.includes(`--${n}`);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1]; };

const RUNS = Number(opt('runs', 3));
const REAL = flag('real');
const WANT_INP = flag('inp');
const SAVE = flag('save');
const AS_JSON = flag('json');
const MARKDOWN = opt('markdown', null);
const PORT = Number(opt('port', 4399));

/* ---------- a server that behaves like the one this ships to ----------

   Pages gzips text, serves `cache-control: max-age=600`, and answers a
   matching ETag with a 304. scripts/serve.mjs deliberately does none of
   that — it sends `no-store` so a local preview never shows you a stale
   file — which makes it the wrong thing to measure against. */

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp',
  '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2'
};
const COMPRESSIBLE = /^(text\/|application\/json|application\/javascript|text\/javascript|image\/svg)/;

function serve() {
  const gzipped = new Map();
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(ROOT, url === '/' ? 'index.html' : url);
    if (!file.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }

    let buf;
    try { buf = fs.readFileSync(file); }
    catch { res.writeHead(404, { 'content-type': 'text/plain' }).end('not found'); return; }

    const type = TYPES[path.extname(file)] || 'application/octet-stream';
    const etag = '"' + crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16) + '"';
    const headers = { 'content-type': type, 'cache-control': 'max-age=600', etag };

    if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers).end(); return; }

    if (/gzip/.test(req.headers['accept-encoding'] || '') && COMPRESSIBLE.test(type)) {
      let out = gzipped.get(file + etag);
      if (!out) { out = zlib.gzipSync(buf, { level: 6 }); gzipped.set(file + etag, out); }
      headers['content-encoding'] = 'gzip';
      headers.vary = 'Accept-Encoding';
      res.writeHead(200, headers).end(out);
    } else {
      res.writeHead(200, headers).end(buf);
    }
  });
  return new Promise(ok => server.listen(PORT, () => ok(server)));
}

/* ---------- one Lighthouse run ----------

   Through npx rather than a dependency, because this repo has none and a
   perf check is not a good enough reason to give it one. The download is
   cached by npm after the first run.

   A fresh Chrome profile per run, which npx gives us for free by
   launching a new browser each time. That matters more than it sounds:
   sharing one profile across runs let the service worker registered by
   run 1 serve run 2 from cache, and the median came out a good deal
   prettier than the truth. */

function lighthouse(url) {
  return new Promise((ok, fail) => {
    const out = path.join(os.tmpdir(), `lh-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    const args = [
      '-y', LIGHTHOUSE, url,
      '--output=json', `--output-path=${out}`,
      '--only-categories=performance',
      '--chrome-flags=--headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage',
      '--quiet'
    ];
    if (REAL) args.push('--throttling-method=devtools');

    const child = spawn('npx', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', d => { err += d; });
    child.on('error', fail);
    child.on('close', code => {
      if (!fs.existsSync(out)) {
        return fail(new Error(`lighthouse exited ${code}\n${err.split('\n').slice(-12).join('\n')}`));
      }
      const lhr = JSON.parse(fs.readFileSync(out, 'utf8'));
      fs.unlinkSync(out);
      ok(read(lhr));
    });
  });
}

function read(lhr) {
  const a = lhr.audits;
  const items = a['network-requests'].details.items;
  const bytes = {};
  let total = 0;
  for (const it of items) {
    const kind = it.resourceType || 'Other';
    bytes[kind] = (bytes[kind] || 0) + (it.transferSize || 0);
    total += it.transferSize || 0;
  }
  return {
    performance: Math.round(lhr.categories.performance.score * 100),
    fcp: a['first-contentful-paint'].numericValue,
    lcp: a['largest-contentful-paint'].numericValue,
    cls: a['cumulative-layout-shift'].numericValue,
    tbt: a['total-blocking-time'].numericValue,
    speedIndex: a['speed-index'].numericValue,
    requests: items.length,
    totalBytes: total,
    jsBytes: bytes.Script || 0,
    cssBytes: bytes.Stylesheet || 0,
    dataBytes: (bytes.Fetch || 0) + (bytes.XHR || 0),
    imageBytes: bytes.Image || 0
  };
}

/* ---------- interaction latency ----------

   Lighthouse has no lab INP, so this drives the tabs and reads the real
   `event` timings. It needs puppeteer-core, which this repo does not
   depend on, so it is opt-in and skipped cleanly when absent rather than
   turning a report into a crash. Install it with:

       npm install --no-save puppeteer-core

   The worst interaction is what gets reported, not the average. Every
   tab being quick except Sport is not "mostly fine" — it is Sport being
   broken, and an average hides exactly that. */

const TAPS = ['nights', 'weekend', 'eat', 'sport', 'explore', 'away', 'today'];

async function measureInp(url) {
  let puppeteer;
  try { puppeteer = (await import('puppeteer-core')).default; }
  catch { return null; }

  const exe = process.env.CHROME_PATH;
  if (!exe) return null;

  const browser = await puppeteer.launch({
    executablePath: exe, headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 412, height: 823, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const cdp = await page.target().createCDPSession();
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

    await page.evaluateOnNewDocument(() => {
      window.__events = [];
      new PerformanceObserver(list => {
        for (const e of list.getEntries()) if (e.interactionId) window.__events.push(e.duration);
      }).observe({ type: 'event', durationThreshold: 16, buffered: true });
    });

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 120000 });
    await new Promise(r => setTimeout(r, 3000));

    const perTab = {};
    for (const view of TAPS) {
      const before = await page.evaluate(() => window.__events.length);

      /* A real dispatched click, not element.click() from a script. Only
         genuine input gets an `interactionId`, which is what the event
         timing above keys on — a scripted click reports nothing at all
         and the whole measurement quietly comes back as zero. The tab bar
         scrolls sideways on a phone, so the tab is brought into view
         first and clicked at its actual coordinates. */
      const box = await page.evaluate(v => {
        const el = document.querySelector(`.tab[data-view="${v}"]`);
        if (!el) return null;
        el.scrollIntoView({ block: 'center', inline: 'center' });
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }, view);
      if (!box) { perTab[view] = null; continue; }

      await page.mouse.click(box.x, box.y);
      await new Promise(r => setTimeout(r, 1200));
      const seen = await page.evaluate(n => window.__events.slice(n), before);
      perTab[view] = seen.length ? Math.round(Math.max(...seen)) : 0;
    }
    const all = await page.evaluate(() => window.__events);
    return { worst: all.length ? Math.round(Math.max(...all)) : 0, perTab };
  } finally {
    await browser.close();
  }
}

/* ---------- reporting ---------- */

const median = xs => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const kb = n => `${(n / 1024).toFixed(0)} KB`;
const ms = n => `${Math.round(n).toLocaleString('en-GB')} ms`;

/* Which way is better, and how much drift is worth mentioning.

   Two thresholds per metric, and a change has to clear *both* before it
   is called a regression: a relative one, and an absolute floor. The
   floor is what stops the noisy metrics crying wolf — CLS going from
   0.001 to 0.002 is a 100% increase and means nothing whatsoever, and a
   Lighthouse score swings a few points between identical runs. Ratios
   alone would flag both.

   These are not opinions about what counts as fast. They are about what
   this harness can actually distinguish from noise, which is why the
   byte counts — exact, and where a real regression usually shows up
   first — get much tighter ones than the timings. */
const METRICS = [
  //  key           label           better  format              rel%   floor
  ['performance', 'Performance',   'up',   v => String(v),        5,      5],
  ['lcp',         'LCP',           'down', ms,                   12,    400],
  ['fcp',         'FCP',           'down', ms,                   12,    250],
  ['cls',         'CLS',           'down', v => v.toFixed(3),    50,   0.02],
  ['tbt',         'TBT',           'down', ms,                   20,    300],
  ['speedIndex',  'Speed Index',   'down', ms,                   15,    400],
  ['inp',         'INP (worst)',   'down', ms,                   25,    100],
  ['jsBytes',     'JS bundle',     'down', kb,                    2,   4096],
  ['totalBytes',  'Total page',    'down', kb,                    2,  20480],
  ['dataBytes',   'Data (JSON)',   'down', kb,                    2,  10240],
  ['imageBytes',  'Images',        'down', kb,                    5,  20480],
  ['requests',    'Requests',      'down', v => String(v),        5,      3]
];

function compare(now, base) {
  return METRICS.map(([key, label, better, fmt, relative, floor]) => {
    const a = base?.[key], b = now[key];
    if (b == null) return null;
    const row = { key, label, now: fmt(b), raw: b };
    if (a == null) { row.verdict = 'new'; return row; }

    row.before = fmt(a);
    const absolute = b - a;
    const pct = a === 0 ? (b === 0 ? 0 : 100) : (absolute / Math.abs(a)) * 100;
    row.deltaPct = pct;

    const moved = Math.abs(pct) >= relative && Math.abs(absolute) >= floor;
    row.verdict = !moved ? 'same'
      : (better === 'down' ? absolute < 0 : absolute > 0) ? 'better' : 'worse';
    return row;
  }).filter(Boolean);
}

/* The arrow follows the number, not the verdict — a Performance score
   going down is worse, and printing "↑ WORSE -3%" next to it is the kind
   of small incoherence that makes a reader stop trusting the whole
   table. */
function drift(r) {
  if (r.verdict === 'new') return 'new';
  if (r.verdict === 'same') return '·';
  const arrow = r.deltaPct > 0 ? '↑' : '↓';
  const sign = r.deltaPct > 0 ? '+' : '';
  return `${arrow} ${r.verdict === 'better' ? 'better' : 'WORSE'} ${sign}${r.deltaPct.toFixed(0)}%`;
}

function table(rows) {
  const w = [Math.max(...rows.map(r => r.label.length)), 12, 12];
  const line = (a, b, c, d) =>
    `  ${a.padEnd(w[0])}  ${String(b).padStart(w[1])}  ${String(c).padStart(w[2])}  ${d}`;
  const out = [line('', 'baseline', 'now', '')];
  for (const r of rows) out.push(line(r.label, r.before ?? '—', r.now, drift(r)));
  return out.join('\n');
}

function markdown(rows, meta) {
  const head = [
    `# Performance — ${meta.when}`, '',
    `Median of ${meta.runs} run${meta.runs === 1 ? '' : 's'}, ${meta.throttling} throttling, `
      + `mobile emulation, against a GitHub-Pages-like server (gzip, \`max-age=600\`, ETag).`,
    meta.baselineWhen ? `Baseline recorded ${meta.baselineWhen}.` : 'No baseline yet.', '',
    '| | Baseline | Now | |', '|---|---|---|---|'
  ];
  for (const r of rows) {
    const d = r.verdict === 'worse' || r.verdict === 'better' ? `**${drift(r)}**` : drift(r);
    head.push(`| ${r.label} | ${r.before ?? '—'} | ${r.now} | ${d} |`);
  }
  const worse = rows.filter(r => r.verdict === 'worse');
  head.push('', worse.length
    ? `## Worth a look\n\n${worse.map(r => `- **${r.label}** moved from ${r.before} to ${r.now}.`).join('\n')}`
      + `\n\nSee \`.claude/skills/paris-performance/references/invariants.md\` — most regressions here`
      + ` are a known invariant being broken, and naming which one is more useful than the number.`
    : '## Nothing has regressed.');
  return head.join('\n') + '\n';
}

/* ---------- run ---------- */

async function main() {
  const url = `http://localhost:${PORT}/`;
  const server = await serve();

  try {
    const runs = [];
    for (let i = 0; i < RUNS; i++) {
      process.stderr.write(`  lighthouse ${i + 1}/${RUNS}…`);
      const r = await lighthouse(url);
      runs.push(r);
      process.stderr.write(` performance ${r.performance}, LCP ${Math.round(r.lcp)} ms\n`);
    }

    const now = {};
    for (const key of Object.keys(runs[0])) now[key] = median(runs.map(r => r[key]));

    if (WANT_INP) {
      process.stderr.write('  interaction latency…');
      const inp = await measureInp(url);
      if (inp) { now.inp = inp.worst; now.inpPerTab = inp.perTab; process.stderr.write(` worst ${inp.worst} ms\n`); }
      else process.stderr.write(' skipped (needs puppeteer-core and CHROME_PATH)\n');
    }

    const base = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : null;
    const rows = compare(now, base?.metrics);
    const meta = {
      when: new Date().toISOString().slice(0, 10),
      runs: RUNS,
      throttling: REAL ? 'real device' : 'simulated',
      baselineWhen: base?.recorded ?? null,
      /* What else the machine was doing. Everything below the byte counts
         is a timing, and a timing here is only as good as the CPU it had.
         Measured on 27 August 2026: TBT read 1,715 ms on a quiet laptop
         and 8,212 ms on the same commit with Spotlight indexing and a
         browser open — and `Data (JSON)` went 330 KB to 1,092 KB with it,
         not because anything grew but because a slower page keeps the
         trace open long enough for the whole background fill to land
         inside it. Both look exactly like a regression. Printing the load
         is four lines and saves the hour it otherwise costs. */
      load: os.loadavg().map(n => n.toFixed(1)).join(' '),
      cores: os.cpus().length
    };

    if (AS_JSON) {
      console.log(JSON.stringify({ meta, metrics: now, comparison: rows }, null, 2));
    } else {
      console.log(`\nPerformance — median of ${RUNS}, ${meta.throttling} throttling`);
      if (base) console.log(`Baseline recorded ${base.recorded}${base.note ? ` — ${base.note}` : ''}`);
      /* A third of the cores, not most of them. The load here is rarely
         CPU-bound arithmetic — it is Spotlight, a browser and a display
         server competing for memory bandwidth, and that hurts a Lighthouse
         run long before the cores are full. Every run on 27 August 2026
         sat between 4 and 32 on a twelve-core laptop and every one of them
         produced junk timings; an idle machine sits below 1. */
      const busy = os.loadavg()[0] > os.cpus().length / 3;
      console.log(`Machine load ${meta.load} across ${meta.cores} cores`
        + (busy ? '  ← busy' : ''));
      if (busy) console.log(
        '  Timings below are unreliable at this load. So are Data (JSON), Total page and\n'
        + '  Images: they count what landed inside the trace, and a slow run keeps it open\n'
        + '  long enough for the whole background fill to arrive. JS bundle and Requests are exact.');
      console.log();
      console.log(table(rows));
      const worse = rows.filter(r => r.verdict === 'worse');
      console.log(worse.length
        ? `\n${worse.length} metric${worse.length === 1 ? '' : 's'} worse than baseline: `
          + worse.map(r => r.label).join(', ')
        : '\nNothing has regressed.');
    }

    if (MARKDOWN) fs.writeFileSync(MARKDOWN, markdown(rows, meta));

    if (SAVE) {
      const note = opt('note', base?.note ?? '');
      fs.writeFileSync(BASELINE, JSON.stringify({
        recorded: meta.when,
        runs: RUNS,
        throttling: meta.throttling,
        note,
        metrics: now
      }, null, 2) + '\n');
      console.error(`\nBaseline updated: ${path.relative(ROOT, BASELINE)}`);
    }
  } finally {
    server.close();
  }
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
