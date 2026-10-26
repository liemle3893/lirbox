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
//   3. >=1 <tr class="claim">; each carries data-status in STATUSES.
//   4. Every non-VERIFIED row carries a fix disposition: `fix: mechanical` | `fix: needs-decision`.
//   5. Verdict is DERIVED from the rows, not asserted:
//        any REFUTED + needs-decision -> NO-GO
//        else any open item           -> GO-WITH-CONDITIONS
//        else                         -> GO
//      open = UNVERIFIED | UNSTATED-ASSUMPTION | BLIND-SPOT-RISK | REFUTED + mechanical.
//      data-verdict must equal the derived verdict.
//   6. Count of class="condition" items == count of open items (every open row
//      is a condition-to-clear).
//   7. Exactly one <script type="application/json" id="dod"> block whose JSON is
//      { criteria: [{ id, text, tier: 'checkable'|'judged', check? }] }.
//   8. The plan's goal (id="goal") + exactly one data-goal-coverage claim row.

import { readFileSync } from 'node:fs';

const VERDICTS = new Set(['GO', 'GO-WITH-CONDITIONS', 'NO-GO']);
const STATUSES = new Set(['VERIFIED', 'REFUTED', 'UNVERIFIED', 'UNSTATED-ASSUMPTION', 'BLIND-SPOT-RISK']);
const FIX = /\bfix:\s*(mechanical|needs-decision)\b/i;

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

// 1. placeholders (whole file — a leftover token anywhere is a broken render)
const ph = html.match(/\{\{[^}]+\}\}/g);
if (ph) errors.push(`leftover placeholder(s): ${[...new Set(ph)].join(', ')}`);

// Element-level checks (2-5) run on markup only: strip <style> blocks (their
// `.verdict[data-verdict="..."]` attribute selectors are CSS, not verdict
// elements) and HTML comments (template guidance mentions the attributes).
const markup = html
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
  .replace(/<!--[\s\S]*?-->/g, '');

// 2. verdict
const verdicts = [...markup.matchAll(/data-verdict="([^"]*)"/g)].map((m) => m[1]);
if (verdicts.length !== 1) {
  errors.push(`expected exactly one data-verdict, found ${verdicts.length}`);
} else if (!VERDICTS.has(verdicts[0])) {
  errors.push(`data-verdict="${verdicts[0]}" not in {${[...VERDICTS].join(', ')}}`);
}

// 3. claim rows — full bodies, because the fix disposition lives in the Status cell. Rows do not
// nest, so the non-greedy capture is safe.
const fullRows = [...markup.matchAll(/<tr\b[^>]*\bclass="[^"]*\bclaim\b[^"]*"[^>]*>[\s\S]*?<\/tr>/g)].map((m) => m[0]);
const rows = fullRows.map((r) => r.match(/^<tr\b[^>]*>/)[0]);
if (rows.length === 0) errors.push('no <tr class="claim"> rows found');

// 4. Every non-VERIFIED row carries a fix disposition.
//
// This rule exists because the convention did NOT survive without it: measured over 20 paired
// Harbor trials, `fix:` appeared in only 4 of 10 reports per arm while every other element of this
// contract landed at ~100%. Step 9 loops the model until validate.mjs exits 0, and a rule living
// only in SKILL.md prose never enters that loop. Per ROW, not per file: one tagged row must not
// excuse an untagged one.
let blocking = 0;
let open = 0;
const untagged = [];
for (const [i, body] of fullRows.entries()) {
  const s = attr(rows[i], 'data-status');
  if (!s || !STATUSES.has(s)) {
    errors.push(`claim row ${i + 1}: bad data-status=${JSON.stringify(s)}`);
    continue;
  }
  if (s === 'VERIFIED') continue;
  const fix = (body.match(FIX) || [])[1];
  if (!fix) { untagged.push(i + 1); continue; }
  // A REFUTED row blocks only when its repair needs a decision. One the evidence fully corrects
  // (a renamed symbol, a Makefile target that does not exist) is a condition like any open row.
  if (s === 'REFUTED' && fix.toLowerCase() === 'needs-decision') blocking++;
  else open++;
}
if (untagged.length) {
  errors.push(
    `${untagged.length} row(s) carry no fix disposition (row ${untagged.join(', ')}) — every ` +
      `non-VERIFIED row needs "fix: mechanical" (the repair is determined by the finding) or ` +
      `"fix: needs-decision"; without it a reader cannot tell what can be applied`
  );
}

// 5. derived verdict
if (verdicts.length === 1 && rows.length > 0 && !untagged.length) {
  const derived = blocking > 0 ? 'NO-GO' : open > 0 ? 'GO-WITH-CONDITIONS' : 'GO';
  if (verdicts[0] !== derived) {
    errors.push(
      `data-verdict="${verdicts[0]}" contradicts the rows (derived: ${derived}; ` +
        `${blocking} refuted needing a decision, ${open} open)`
    );
  }
}

// 6. conditions == open
const conditions = (markup.match(/class="[^"]*\bcondition\b[^"]*"/g) || []).length;
if (conditions !== open) {
  errors.push(`conditions-to-clear count (${conditions}) != open items (${open})`);
}

// 8. the plan's GOAL, and one adjudicated row tying the DoD back to it.
//
// Both halves or neither. A goal printed in the header is decoration: the failure this catches is
// a plan whose DoD is fully checkable and does not achieve the objective, and only the
// adjudication sees that. Kept in validate.mjs rather than left to prose because an optional
// field is one that gets skipped.
// \1 backreferences the tag name so the capture runs to the element's OWN closing tag. A plain
// non-greedy `<\/[a-zA-Z]+>` stops at the first nested close (`</strong>` in the template's
// "<strong>Goal:</strong> …"), which reads as an empty goal on a perfectly good report.
const goalEl = [...markup.matchAll(/<([a-zA-Z]+)[^>]*\bid="goal"[^>]*>([\s\S]*?)<\/\1>/g)].map((m) => m[2]);
if (goalEl.length !== 1) {
  errors.push(`expected exactly one element with id="goal" (the plan's goal), found ${goalEl.length}`);
} else if (!goalEl[0].replace(/<[^>]+>/g, '').replace(/Goal:/i, '').trim()) {
  errors.push('id="goal" is empty — state what the plan is trying to achieve, or say the plan states none');
}

const goalRows = rows.filter((tag) => attr(tag, 'data-goal-coverage') !== null);
if (goalRows.length !== 1) {
  errors.push(
    `expected exactly one claim row with data-goal-coverage (does meeting every DoD criterion ` +
      `achieve the goal?), found ${goalRows.length}`
  );
}

// 7. machine-readable DoD block
let dodCount = 0;
const dodBlocks = [...html.matchAll(/<script type="application\/json" id="dod">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
if (dodBlocks.length !== 1) {
  errors.push(`expected exactly one <script type="application/json" id="dod"> block, found ${dodBlocks.length}`);
} else {
  let dod = null;
  try { dod = JSON.parse(dodBlocks[0]); } catch (e) { errors.push(`#dod block is not valid JSON: ${e.message}`); }
  const list = dod && Array.isArray(dod.criteria) ? dod.criteria : null;
  if (dod && (!list || !list.length)) errors.push('#dod block needs a non-empty criteria array');
  if (list) {
    dodCount = list.length;
    for (const [i, c] of list.entries()) {
      if (!c.id || !c.text || (c.tier !== 'checkable' && c.tier !== 'judged')) {
        errors.push(`#dod criterion ${i + 1}: needs id, text, and tier=checkable|judged`);
      }
      if (c.tier === 'checkable' && (typeof c.check !== 'string' || !c.check.trim())) {
        errors.push(`#dod criterion ${i + 1} ('${c.id || '?'}'): checkable needs a non-empty check command`);
      }
    }
  }
}

if (errors.length) {
  console.error(`INVALID ${path}`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(
  `VALID ${path} — verdict ${verdicts[0]}, ${rows.length} claim(s), ${open} open, ${conditions} condition(s), ` +
    `${dodCount} DoD criteria`
);
