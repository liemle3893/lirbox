#!/bin/bash
# Reference solution for plan-check__mechanical-refutation.
#
# Proves the grader is SATISFIABLE and that test.sh agrees with instruction.md. plan-check has no
# generator to drive (its work is analysis a model performs), so the reference solution is the
# correct report — built from the skill's OWN template, passing the skill's OWN validator — plus
# the correctly-bounded autofix, applied in place.
#
# The end state this pins:
#   * the `make test-all` claim is refuted against repo/Makefile and tagged fix: mechanical — a
#     condition, not a NO-GO, because the Makefile determines the correction;
#   * autofix REPAIRS it in /app/plan.md (no sibling copy), and the row is re-adjudicated VERIFIED
#     against the Makefile;
#   * the production-index claim needs a live system, stays UNVERIFIED, and holds the verdict at
#     GO-WITH-CONDITIONS. Clearing that one too would be laundering.
set -uo pipefail

SKILL=/root/.claude/skills/plan-check
TPL=$SKILL/assets/template.html
OUT=/app/plan-check-ledger-compaction.html
PLAN=/app/plan.md

[ -f "$TPL" ] || { echo "solve.sh: template not found at $TPL" >&2; exit 1; }

node - "$TPL" "$OUT" <<'NODE'
const fs = require('node:fs');
const [tpl, out] = process.argv.slice(2);
let html = fs.readFileSync(tpl, 'utf8');

const row = (s, prop, ev, detail, conf) =>
  `      <tr class="claim" data-status="${s}">
        <td>${prop}</td>
        <td><span class="s-${s}">${s}</span>${detail}</td>
        <td>${ev}</td>
        <td>${conf}</td>
      </tr>`;

// This is the report AFTER autofix (skill step 10: each fixed row is re-adjudicated against the
// evidence that settled it, then validate.mjs re-runs). The make-target row reads VERIFIED against
// the Makefile and carries no disposition. One UNVERIFIED row remains => GO-WITH-CONDITIONS.
const rows = [
  row(
    'VERIFIED',
    'Task 1 Step 3 and Task 2 Step 3 named <code>make test-all</code> as "this repo\'s target for ' +
      'running the full suite". <code>repo/Makefile</code> declares <code>build</code>, ' +
      '<code>test</code> and <code>lint</code> — there is no <code>test-all</code>, so the command ' +
      'as written fails before running anything. The Makefile itself determines the correction, so ' +
      'this was repaired mechanically to <code>make test</code> and re-checked against the repo.',
    '<code>repo/Makefile</code> — <code>.PHONY: build test lint</code>; no <code>test-all</code> target. ' +
      'Re-checked against <code>plan.md</code> after the in-place repair.',
    ' (was REFUTED, fix: mechanical; repaired in place)',
    'high'
  ),
  row(
    'UNVERIFIED',
    'Task 2 Step 2 claims the PRODUCTION ledger table already has an index on ' +
      '<code>created_at</code>, and rests the "will not table-scan" conclusion on it. Nothing in ' +
      'this workspace can settle what the production schema holds.',
    'no evidence available in <code>/app</code> — needs the live database',
    ' (needs: <code>\\d+ ledger</code> against production) <span class="fix">fix: needs-decision</span>',
    'low'
  ),
  row(
    'VERIFIED',
    'Task 1 Step 1 claims <code>Append</code> already takes a <code>context.Context</code> and ' +
      'threads it to the store, so <code>Compact</code> needs no signature change.',
    '<code>repo/internal/ledger/ledger.go</code> — <code>func Append(ctx context.Context, s Store, ' +
      'e Entry) error</code> calls <code>s.Insert(ctx, e)</code>; <code>Compact</code> already takes ctx',
    '',
    'high'
  ),
  // MANDATORY row (validate.mjs): does meeting every DoD criterion actually achieve the goal?
  `      <tr class="claim" data-status="VERIFIED" data-goal-coverage="yes">
        <td>Does meeting every DoD criterion achieve the goal? The goal is bounded growth ` +
    `<em>without losing an entry still inside the retention window</em>. The DoD names both the ` +
    `removal boundary and the nightly invocation, and the retention-boundary criterion is ` +
    `checkable, so nothing in the goal is left uncovered.</td>
        <td><span class="s-VERIFIED">VERIFIED</span></td>
        <td>DoD criteria <code>retention-boundary</code> + <code>nightly-window</code> vs the stated goal</td>
        <td>high</td>
      </tr>`,
].join('\n');

html = html.replace(/^\s*<tr class="claim"[\s\S]*?<\/tr>\s*$/m, rows);

const dod = {
  criteria: [
    {
      id: 'retention-boundary',
      text: 'Entries older than the retention window are removed; entries inside it are not.',
      tier: 'checkable',
      check: 'cd repo && make test',
    },
    {
      id: 'nightly-window',
      text: 'The nightly job invokes Compact with a 90-day window.',
      tier: 'judged',
    },
    {
      id: 'index-present',
      text: 'The production ledger table has an index on created_at before the delete ships.',
      tier: 'judged',
    },
  ],
};

const fill = {
  PLAN_TITLE: 'Ledger Compaction — Implementation Plan',
  PLAN_GOAL:
    'Stop the ledger table growing without bound by compacting entries older than the retention ' +
    'window, without losing an entry that is still inside it.',
  PLAN_CLASS: 'code',
  DATE: '2026-09-21',
  VERDICT: 'GO-WITH-CONDITIONS',
  VERDICT_SUMMARY:
    'The plan named a make target that does not exist. That is a refutation whose correction is ' +
    'fully determined by repo/Makefile — a condition, not a blocker — and autofix transcribed it ' +
    'to `make test` in plan.md, where it now verifies against the repo. One claim remains ' +
    'open: the production index cannot be checked from here, and the performance argument in ' +
    'Task 2 rests on it.',
  CONDITION_1:
    'Confirm the production ledger table has an index on created_at before the nightly delete ships.',
};

html = html.replace(
  /<script type="application\/json" id="dod">[\s\S]*?<\/script>/,
  `<script type="application/json" id="dod">${JSON.stringify(dod)}</script>`
);
for (const [k, v] of Object.entries(fill)) html = html.split(`{{${k}}}`).join(v);
html = html.replace(/\{\{[A-Z_0-9]+\}\}/g, '—');

fs.writeFileSync(out, html);
console.log(`wrote ${out}`);
NODE

# Autofix, in place: every `make test-all` becomes `make test`, the target repo/Makefile actually
# declares. Nothing is invented; the Makefile established the correct text.
node - "$PLAN" <<'NODE'
const fs = require('node:fs');
const [src] = process.argv.slice(2);
const dst = src;
let md = fs.readFileSync(src, 'utf8');

const before = (md.match(/make test-all/g) || []).length;
md = md.split('make test-all').join('make test');
if (before === 0) { console.error('solve.sh: fixture drift — no `make test-all` in plan.md'); process.exit(1); }

fs.writeFileSync(dst, md);
console.log(`wrote ${dst} (${before} occurrence(s) repaired)`);
NODE

node "$SKILL/assets/validate.mjs" "$OUT"
