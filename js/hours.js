/* ---------------------------------------------------------
   hours.js — is it open?

   The one question a recommendation has to survive. Everything else the
   site knows about a place is worth nothing at eight on a Sunday evening
   if the place is shut, and until now it could not tell: discover.mjs
   filtered on `opening_hours` and then discarded the field, so not one
   of fourteen thousand records carried it.

   OpenStreetMap's opening-hours syntax is a small language, and most of
   it is never used. This reads the part Paris actually writes —

       Mo-Fr 08:00-19:30; Sa 09:00-13:00; Su off
       Tu-Su 12:00-14:30,19:00-22:30
       24/7
       Mo-Su 07:00-02:00

   — and refuses the rest. Refusing matters more than covering: a rule
   about the third Sunday in August, or sunset, or a public holiday
   exception, is better answered with "we do not know" than with a guess.
   So every entry point returns three states, not two, and the interface
   is expected to say which one it got.

   Rules are applied in order and later ones override earlier ones for
   the days they name, which is what the specification says and what
   `Mo-Su 09:00-18:00; We off` obviously means.
   --------------------------------------------------------- */

const Hours = (() => {

  const DAY = { su: 0, mo: 1, tu: 2, we: 3, th: 4, fr: 5, sa: 6 };
  const DAY_MIN = 1440;

  /* Anything in here means the rule depends on something we do not model
     — a season, a date, the sun, a holiday calendar. One appearance and
     the whole spec is unknown, because a partial reading of a
     conditional rule is worse than no reading at all. */
  const UNSUPPORTED = /\b(sunrise|sunset|dawn|dusk|easter|week\s|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b|\[|\d{4}\s|→|"/i;

  /* Public and school holiday rules are dropped rather than refused.
     "PH off" appears on a large share of French records, and refusing
     the whole spec over it would throw away the weekday hours it also
     states — which are the part being asked about. Holidays are handled
     properly elsewhere: scoring.js knows the French calendar and which
     kinds of place shut on it. */
  const HOLIDAY_RULE = /^(ph|sh)\b/i;

  const cache = new Map();

  /* ---------- parsing ---------- */

  function parseDays(sel) {
    const out = new Set();
    for (const part of sel.split(',')) {
      const range = part.trim().match(/^([a-z]{2})\s*-\s*([a-z]{2})$/i);
      if (range) {
        const a = DAY[range[1].toLowerCase()], b = DAY[range[2].toLowerCase()];
        if (a == null || b == null) return null;
        // Sa-Su and Fr-Mo both wrap; walk forwards from a until b.
        for (let d = a; ; d = (d + 1) % 7) { out.add(d); if (d === b) break; }
        continue;
      }
      const one = part.trim().match(/^([a-z]{2})$/i);
      if (!one) return null;
      const d = DAY[one[1].toLowerCase()];
      if (d == null) return null;
      out.add(d);
    }
    return out.size ? out : null;
  }

  function parseTimes(spec) {
    const ranges = [];
    for (const part of spec.split(',')) {
      const m = part.trim().match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
      if (!m) return null;
      const from = +m[1] * 60 + +m[2];
      let to = +m[3] * 60 + +m[4];
      if (to === 0) to = DAY_MIN;                 // 20:00-00:00 means until midnight
      ranges.push([from, to]);
    }
    return ranges.length ? ranges : null;
  }

  /* Returns an array of rules, or null if any part of the spec is
     outside the subset. Null is a real answer and callers must handle it. */
  function parse(spec) {
    if (typeof spec !== 'string') return null;
    const raw = spec.trim();
    if (!raw) return null;
    if (cache.has(raw)) return cache.get(raw);

    const remember = v => { cache.set(raw, v); return v; };

    if (/^24\/7$/i.test(raw)) {
      return remember([{ days: new Set([0, 1, 2, 3, 4, 5, 6]), ranges: [[0, DAY_MIN]] }]);
    }
    if (UNSUPPORTED.test(raw)) return remember(null);

    /* A comma where the syntax wants a semicolon: `Mo-Sa 10:00-20:00,
       Su 10:00-13:00`. Common enough in the wild to be worth reading.
       Only split where the comma follows a time and precedes a weekday —
       `Mo,We,Fr 09:00-17:00` is a legitimate day list and must survive. */
    const normalised = raw.replace(/(\d),\s*(?=(Mo|Tu|We|Th|Fr|Sa|Su)\b)/gi, '$1;');

    const rules = [];
    for (const chunk of normalised.split(';')) {
      const rule = chunk.trim();
      if (!rule) continue;
      if (HOLIDAY_RULE.test(rule)) continue;

      /* A bare `closed` or `off`, with no days and no times, is a place
         that has shut. Saying so is more useful than refusing to read
         it — a closed shop is exactly what the site must not suggest. */
      if (/^(off|closed)$/i.test(rule)) {
        rules.push({ days: parseDays('Mo-Su'), ranges: [], off: true, whole: true });
        continue;
      }

      /* A bare time range with no weekday means every day. */
      const bare = parseTimes(rule);
      if (bare) { rules.push({ days: parseDays('Mo-Su'), ranges: bare }); continue; }

      const m = rule.match(/^([A-Za-z,\s-]+?)\s+(.+)$/) || rule.match(/^([A-Za-z,\s-]+)$/);
      if (!m) return remember(null);

      const days = parseDays(m[1].trim());
      if (!days) return remember(null);

      const rest = (m[2] || '').trim();
      if (/^(off|closed)$/i.test(rest)) { rules.push({ days, ranges: [], off: true }); continue; }
      if (/^open$/i.test(rest)) { rules.push({ days, ranges: [[0, DAY_MIN]] }); continue; }

      const ranges = parseTimes(rest);
      if (!ranges) return remember(null);
      rules.push({ days, ranges });
    }
    /* A spec made only of exceptions says when a place is *shut* and
       nothing about when it is open. `Su off` means closed on Sunday —
       it does not mean closed all week, which is what treating every
       unmentioned day as having no hours amounts to. Twenty-two records
       were being read as permanently closed on the strength of it, and
       so dropped from every dated section.

       Unknown is the honest answer, and this module already has one.
       The exception is a bare `closed` with no day attached, which
       genuinely does mean shut — that carries `whole`. */
    if (!rules.length) return remember(null);
    if (!rules.some(r => r.ranges.length || r.whole)) return remember(null);
    return remember(rules);
  }

  /* ---------- asking ---------- */

  /* The ranges in force on one weekday, after later rules have overridden
     earlier ones. An `off` rule wins for its days and leaves nothing. */
  function rangesOn(rules, dow) {
    let ranges = null;
    for (const r of rules) {
      if (!r.days.has(dow)) continue;
      ranges = r.off ? [] : r.ranges;
    }
    return ranges || [];
  }

  /* true / false / null, where null means the spec is outside the subset
     or absent. Overnight ranges are handled by asking yesterday too:
     `Fr 20:00-02:00` is open at one in the morning on Saturday. */
  function isOpen(spec, when = new Date()) {
    const rules = parse(spec);
    if (!rules) return null;

    const dow = when.getDay();
    const mins = when.getHours() * 60 + when.getMinutes();

    for (const [from, to] of rangesOn(rules, dow)) {
      if (to > from ? (mins >= from && mins < to) : mins >= from) return true;
    }
    /* yesterday, still running past midnight */
    for (const [from, to] of rangesOn(rules, (dow + 6) % 7)) {
      if (to <= from && mins < to) return true;
    }
    return false;
  }

  /* Does it serve past this hour on the day in question? The question
     behind "somewhere for after the film". */
  function openAfter(spec, hour, dow) {
    const rules = parse(spec);
    if (!rules) return null;
    return rangesOn(rules, dow).some(([from, to]) => (to <= from) || to > hour * 60);
  }

  /* Which days of the week it is shut — the honest version of `days`,
     for records that carry hours rather than a hand-written list. */
  function closedDays(spec) {
    const rules = parse(spec);
    if (!rules) return null;
    const out = [];
    for (let d = 0; d < 7; d++) if (!rangesOn(rules, d).length) out.push(d);
    return out;
  }

  return { parse, isOpen, openAfter, closedDays };
})();
