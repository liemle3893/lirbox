#!/usr/bin/env node
// Headless validator for a plan-check HTML report. Exit 0 = valid, 1 = invalid.
// Enforces the report contract so a report can't silently drift or fabricate a
// verdict that its own claim rows contradict. Regex-based (controlled template).
//
//   node validate.mjs <report.html>
//
// Contract:
//   1. No leftover {{placeholder}} tokens.
//   2. Exactly one element with data-verdict; value in VERDICTS.
//   3. >=1 <tr class="claim">; each carries data-quadrant in QUADRANTS and
//      data-status in STATUSES.
//   4. Verdict is DERIVED from the rows, not asserted:
//        any REFUTED            -> NO-GO
//        else any open item     -> GO-WITH-CONDITIONS   (open = UNVERIFIED | BLIND-SPOT-RISK)
//        else                   -> GO
//      data-verdict must equal the derived verdict.
//   5. Count of class="condition" items == count of open items (every open risk
//      is a condition-to-clear).

import { readFileSync } from 'node:fs';

const VERDICTS = new Set(['GO', 'GO-WITH-CONDITIONS', 'NO-GO']);
const QUADRANTS = new Set(['known-known', 'known-unknown', 'unknown-known', 'unknown-unknown']);
const STATUSES = new Set(['VERIFIED', 'REFUTED', 'UNVERIFIED', 'UNSTATED-ASSUMPTION', 'BLIND-SPOT-RISK']);
const OPEN = new Set(['UNVERIFIED', 'BLIND-SPOT-RISK']);

const path = process.argv[2];
if (!path) {
  console.error('usage: validate.mjs <report.html>');
  process.exit(2);
}

let html;
try {
  html = readFileSync(path, 'utf8');
} catch (e) {
  console.error(`cannot read ${path}: ${e.message}`);
  process.exit(2);
}

const errors = [];
const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? m[1] : null;
};

// 1. placeholders
const ph = html.match(/\{\{[^}]+\}\}/g);
if (ph) errors.push(`leftover placeholder(s): ${[...new Set(ph)].join(', ')}`);

// 2. verdict
const verdicts = [...html.matchAll(/data-verdict="([^"]*)"/g)].map((m) => m[1]);
if (verdicts.length !== 1) {
  errors.push(`expected exactly one data-verdict, found ${verdicts.length}`);
} else if (!VERDICTS.has(verdicts[0])) {
  errors.push(`data-verdict="${verdicts[0]}" not in {${[...VERDICTS].join(', ')}}`);
}

// 3. claim rows
const rows = [...html.matchAll(/<tr\b[^>]*\bclass="[^"]*\bclaim\b[^"]*"[^>]*>/g)].map((m) => m[0]);
if (rows.length === 0) errors.push('no <tr class="claim"> rows found');

let refuted = 0;
let open = 0;
for (const [i, tag] of rows.entries()) {
  const q = attr(tag, 'data-quadrant');
  const s = attr(tag, 'data-status');
  if (!q || !QUADRANTS.has(q)) errors.push(`claim row ${i + 1}: bad data-quadrant=${JSON.stringify(q)}`);
  if (!s || !STATUSES.has(s)) errors.push(`claim row ${i + 1}: bad data-status=${JSON.stringify(s)}`);
  if (s === 'REFUTED') refuted++;
  if (OPEN.has(s)) open++;
}

// 4. derived verdict
if (verdicts.length === 1 && rows.length > 0) {
  const derived = refuted > 0 ? 'NO-GO' : open > 0 ? 'GO-WITH-CONDITIONS' : 'GO';
  if (verdicts[0] !== derived) {
    errors.push(`data-verdict="${verdicts[0]}" contradicts the rows (derived: ${derived}; ${refuted} refuted, ${open} open)`);
  }
}

// 5. conditions == open
const conditions = (html.match(/class="[^"]*\bcondition\b[^"]*"/g) || []).length;
if (conditions !== open) {
  errors.push(`conditions-to-clear count (${conditions}) != open items (${open})`);
}

if (errors.length) {
  console.error(`INVALID ${path}`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`VALID ${path} — verdict ${verdicts[0]}, ${rows.length} claim(s), ${open} open, ${conditions} condition(s)`);
