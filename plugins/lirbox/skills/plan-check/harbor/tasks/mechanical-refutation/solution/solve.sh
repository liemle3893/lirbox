#!/bin/bash
# Reference solution for plan-check__mechanical-refutation.
#
# Proves the grader is SATISFIABLE and that test.sh agrees with instruction.md. plan-check has no
# generator to drive (its work is analysis a model performs), so the reference solution is the
# correct report — built from the skill's OWN template, passing the skill's OWN validator — plus
# the correctly-bounded autofix output.
#
# The end state this pins is the one the whole change exists for:
#   * /app/plan.md is NOT touched;
#   * the `make test-all` claim is refuted against repo/Makefile, tagged fix: mechanical, and
#     REPAIRED in the sibling — the correction is determined by the Makefile, so it is
#     transcription;
#   * re-verification then clears that row (it is VERIFIED against the repaired text), so the
#     verdict moves off NO-GO honestly — not because the badge was edited;
#   * the production-index claim needs a live system, stays UNVERIFIED, and holds the verdict at
#     GO-WITH-CONDITIONS. Clearing that one too would be laundering.
set -uo pipefail

SKILL=/root/.claude/skills/plan-check
TPL=$SKILL/assets/template.html
OUT=/app/plan-check-ledger-compaction.html
FIX=/app/plan.autofix.md

[ -f "$TPL" ] || { echo "solve.sh: template not found at $TPL" >&2; exit 1; }

node - "$TPL" "$OUT" <<'NODE'
const fs = require('node:fs');
const [tpl, out] = process.argv.slice(2);
let html = fs.readFileSync(tpl, 'utf8');

const row = (q, s, prop, ev, detail, conf) =>
  `      <tr class="claim" data-quadrant="${q}" data-status="${s}">
        <td>${prop}</td>
        <td><span class="tag q-${q}">${q}</span></td>
        <td><span class="s-${s}">${s}</span>${detail}</td>
        <td>${ev}</td>
        <td>${conf}</td>
      </tr>`;

// This is the report AFTER autofix and re-verification (skill step 10: an applied fix invalidates
// the report, so steps 3-6 re-run and the report is re-emitted before the verdict is recomputed).
// The make-target row therefore reads VERIFIED against the repaired sibling, and carries no
// disposition because it is no longer open. One UNVERIFIED row remains => GO-WITH-CONDITIONS.
const rows = [
  row(
    'known-known',
    'VERIFIED',
    'Task 1 Step 3 and Task 2 Step 3 named <code>make test-all</code> as "this repo\'s target for ' +
      'running the full suite". <code>repo/Makefile</code> declares <code>build</code>, ' +
      '<code>test</code> and <code>lint</code> — there is no <code>test-all</code>, so the command ' +
      'as written fails before running anything. The Makefile itself determines the correction, so ' +
      'this was repaired mechanically to <code>make test</code> and re-checked against the repo.',
    '<code>repo/Makefile</code> — <code>.PHONY: build test lint</code>; no <code>test-all</code> target. ' +
      'Re-verified against <code>plan.autofix.md</code> after the repair.',
    ' (was REFUTED; repaired mechanically and re-verified)',
    'high'
  ),
  row(
    'known-unknown',
    'UNVERIFIED',
    'Task 2 Step 2 claims the PRODUCTION ledger table already has an index on ' +
      '<code>created_at</code>, and rests the "will not table-scan" conclusion on it. Nothing in ' +
      'this workspace can settle what the production schema holds.',
    'no evidence available in <code>/app</code> — needs the live database',
    ' (needs: <code>\\d+ ledger</code> against production) <span class="fix">fix: needs-decision</span>',
    'low'
  ),
  row(
    'known-known',
    'VERIFIED',
    'Task 1 Step 1 claims <code>Append</code> already takes a <code>context.Context</code> and ' +
      'threads it to the store, so <code>Compact</code> needs no signature change.',
    '<code>repo/internal/ledger/ledger.go</code> — <code>func Append(ctx context.Context, s Store, ' +
      'e Entry) error</code> calls <code>s.Insert(ctx, e)</code>; <code>Compact</code> already takes ctx',
    '',
    'high'
  ),
  // MANDATORY row (validate.mjs): does meeting every DoD criterion actually achieve the goal?
  `      <tr class="claim" data-quadrant="unknown-known" data-status="VERIFIED" data-goal-coverage="yes">
        <td>Does meeting every DoD criterion achieve the goal? The goal is bounded growth ` +
    `<em>without losing an entry still inside the retention window</em>. The DoD names both the ` +
    `removal boundary and the nightly invocation, and the retention-boundary criterion is ` +
    `checkable, so nothing in the goal is left uncovered.</td>
        <td><span class="tag q-unknown-known">unknown-known</span></td>
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
    'fully determined by repo/Makefile, so autofix transcribed it to `make test` in the sibling ' +
    'and steps 3-6 were re-run: the row now verifies against the repo, and the verdict moved off ' +
    'NO-GO because the claim became true — not because the plan was reworded. One claim remains ' +
    'open: the production index cannot be checked from here, and the performance argument in ' +
    'Task 2 rests on it.',
  CONDITION_1:
    'Confirm the production ledger table has an index on created_at before the nightly delete ships.',
};

const taskgraph = {
  nodes: [
    { id: 'task-1', title: 'Implement compaction', files: ['repo/internal/ledger/ledger.go'] },
    { id: 'task-2', title: 'Schedule the compaction job', files: ['repo/internal/ledger/ledger.go'] },
  ],
  // Task 2 consumes Task 1's Compact — the plan declares it, so it is a real output dependency.
  // Both tasks write the same file, but that is a merge cost, not an order: declared separately
  // so it cannot silently serialize anything beyond what `needs` already does.
  edges: [
    { from: 'task-1', to: 'task-2', kind: 'needs', why: "Task 2 calls Task 1's Compact; it does not exist until Task 1 lands" },
    { from: 'task-1', to: 'task-2', kind: 'contention', why: 'both modify repo/internal/ledger/ledger.go' },
  ],
  levels: [['task-1'], ['task-2']],
};

html = html.replace(
  /<script type="application\/json" id="dod">[\s\S]*?<\/script>/,
  `<script type="application/json" id="dod">${JSON.stringify(dod)}</script>`
);
html = html.replace(
  /<script type="application\/json" id="taskgraph">[\s\S]*?<\/script>/,
  `<script type="application/json" id="taskgraph">${JSON.stringify(taskgraph)}</script>`
);
for (const [k, v] of Object.entries(fill)) html = html.split(`{{${k}}}`).join(v);
html = html.replace(/\{\{[A-Z_0-9]+\}\}/g, '—');

fs.writeFileSync(out, html);
console.log(`wrote ${out}`);
NODE

# The autofix sibling. The INPUT is never modified — this is a copy carrying ONLY the mechanical
# repair: every `make test-all` becomes `make test`, the target repo/Makefile actually declares.
# Nothing is invented; the Makefile established the correct text.
node - /app/plan.md "$FIX" <<'NODE'
const fs = require('node:fs');
const [src, dst] = process.argv.slice(2);
let md = fs.readFileSync(src, 'utf8');

const before = (md.match(/make test-all/g) || []).length;
md = md.split('make test-all').join('make test');
if (before === 0) { console.error('solve.sh: fixture drift — no `make test-all` in plan.md'); process.exit(1); }

md =
  '<!-- AUTOFIXED by lirbox:plan-check — mechanical rows only. The original is unmodified at\n' +
  '     plan.md; this file is the sibling. `make test-all` -> `make test`: repo/Makefile declares\n' +
  '     build, test and lint, so the correct text was established by evidence, not chosen. Every\n' +
  '     row touched here was UNVERIFIED again until re-checked; steps 3-6 were re-run and the\n' +
  '     report re-emitted before the verdict was recomputed. The production-index claim is NOT\n' +
  '     repaired: no evidence exists here to transcribe, so it stays a condition. -->\n\n' + md;

fs.writeFileSync(dst, md);
console.log(`wrote ${dst} (${before} occurrence(s) repaired)`);
NODE

node "$SKILL/assets/validate.mjs" "$OUT"
