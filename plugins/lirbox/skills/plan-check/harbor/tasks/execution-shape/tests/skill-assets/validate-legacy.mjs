#!/usr/bin/env node
// VERSION-NEUTRAL report contract for paired Harbor runs. Exit 0 = valid, 1 = invalid.
//
// A paired run grades a baseline arm (the skill at git HEAD) and an after arm (the working tree)
// with the SAME grader. Grading both against the current validate.mjs only re-measures "the
// baseline predates the change" — that is the `if`, not the model. So this holds only what every
// plan-check version since the goal-coverage change emits:
//   1. no leftover {{placeholder}};
//   2. exactly one data-verdict, in {GO, GO-WITH-CONDITIONS, NO-GO};
//   3. >=1 <tr class="claim">, each with a data-status in STATUSES;
//   4. exactly one #dod JSON block with a non-empty criteria array;
//   5. one id="goal" element and one data-goal-coverage row.
// Deliberately absent (they changed between versions): data-quadrant, the derived-verdict rule,
// the conditions count, #taskgraph, and per-row fix dispositions.
//
// Copied verbatim into each task that needs it; there is no shared source to drift from.
import { readFileSync } from 'node:fs';

const VERDICTS = new Set(['GO', 'GO-WITH-CONDITIONS', 'NO-GO']);
const STATUSES = new Set(['VERIFIED', 'REFUTED', 'UNVERIFIED', 'UNSTATED-ASSUMPTION', 'BLIND-SPOT-RISK']);

const path = process.argv[2];
if (!path) { console.error('usage: validate-legacy.mjs <report.html>'); process.exit(2); }
let html;
try { html = readFileSync(path, 'utf8'); } catch (e) { console.error(`cannot read ${path}: ${e.message}`); process.exit(2); }

const errors = [];
const attr = (tag, name) => (tag.match(new RegExp(`\\b${name}="([^"]*)"`)) || [])[1] ?? null;
const ph = html.match(/\{\{[^}]+\}\}/g);
if (ph) errors.push(`leftover placeholder(s): ${[...new Set(ph)].join(', ')}`);
const markup = html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<!--[\s\S]*?-->/g, '');

const verdicts = [...markup.matchAll(/data-verdict="([^"]*)"/g)].map((m) => m[1]);
if (verdicts.length !== 1) errors.push(`expected exactly one data-verdict, found ${verdicts.length}`);
else if (!VERDICTS.has(verdicts[0])) errors.push(`data-verdict="${verdicts[0]}" not a verdict`);

const rows = [...markup.matchAll(/<tr\b[^>]*\bclass="[^"]*\bclaim\b[^"]*"[^>]*>/g)].map((m) => m[0]);
if (!rows.length) errors.push('no <tr class="claim"> rows found');
for (const [i, tag] of rows.entries()) {
  const s = attr(tag, 'data-status');
  if (!s || !STATUSES.has(s)) errors.push(`claim row ${i + 1}: bad data-status=${JSON.stringify(s)}`);
}

const dod = [...html.matchAll(/<script type="application\/json" id="dod">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
if (dod.length !== 1) errors.push(`expected exactly one #dod block, found ${dod.length}`);
else {
  let d = null;
  try { d = JSON.parse(dod[0]); } catch (e) { errors.push(`#dod is not valid JSON: ${e.message}`); }
  if (d && !(Array.isArray(d.criteria) && d.criteria.length)) errors.push('#dod needs a non-empty criteria array');
}

if ((markup.match(/\bid="goal"/g) || []).length !== 1) errors.push('expected exactly one id="goal" element');
if (rows.filter((t) => attr(t, 'data-goal-coverage') !== null).length !== 1) errors.push('expected exactly one data-goal-coverage row');

if (errors.length) {
  console.error(`INVALID ${path}`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`VALID ${path} — verdict ${verdicts[0]}, ${rows.length} claim(s)`);
