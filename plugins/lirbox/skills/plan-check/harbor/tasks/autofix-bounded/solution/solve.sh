#!/bin/bash
# Reference solution for plan-check__autofix-bounded.
#
# Proves the grader is SATISFIABLE and that test.sh agrees with instruction.md. plan-check has no
# generator to drive (its work is analysis a model performs), so the reference solution is the
# correct report — built from the skill's OWN template, passing the skill's OWN validator — plus
# the correctly-bounded autofix, applied in place.
#
# The boundary this task exists to pin (headless: nobody can state a decision):
#   * the mechanical row (Task 2's undeclared edge on Task 1) IS repaired in /app/plan.md;
#   * the REFUTED row (the false recordDelivery claim) needs a decision, so it is left as written;
#   * no sibling copy of the plan is written.
# The report is the post-autofix one: the repaired row is re-adjudicated VERIFIED against Task 2's
# own Step 2, and the needs-decision refutation keeps the verdict at NO-GO.
set -uo pipefail

SKILL=/root/.claude/skills/plan-check
TPL=$SKILL/assets/template.html
OUT=/app/plan-check-schedule-run-bookkeeping.html
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

// One REFUTED needing a decision (=> NO-GO) and the repaired edge, now VERIFIED. open=0, so no
// <li class="condition"> is required.
const rows = [
  row(
    'REFUTED',
    'Task 1 Step 1 claims <code>Run</code> already calls <code>w.recordDelivery(ctx, tg, status)</code> ' +
      'for every target immediately after the finalize UPDATE. It does not: <code>Run</code> contains ' +
      'no <code>recordDelivery</code> call at all, and the finalize UPDATE is its last statement. ' +
      'The step\'s premise — that a ledger write already sits there to wrap — is false, so the ' +
      'approach it prescribes has nothing to attach to.',
    '<code>repo/internal/schedules/worker.go</code> — no recordDelivery symbol; UPDATE is the final statement of Run',
    ' <span class="fix">fix: needs-decision</span> — to clear: name the real ledger write site, or add one, then re-derive Step 1.',
    'high'
  ),
  row(
    'VERIFIED',
    'Task 2 declared "Consumes: nothing" while its own Step 2 says to do it only after Task 1 has ' +
      'landed. Autofix (mechanical) copied the edge into Task 2\'s Interfaces block in place.',
    'plan.md Task 2 Step 2: "Do this only after Task 1 has landed"; Interfaces now: "Consumes: Task 1"',
    '',
    'high'
  ),
  // MANDATORY row (validate.mjs): does meeting every DoD criterion actually achieve the goal?
  `      <tr class="claim" data-status="VERIFIED" data-goal-coverage="yes">
        <td>Does meeting every DoD criterion achieve the goal? Yes: the goal is runs no longer stranded in <code>running</code> on cancellation, and <code>step1-premise</code> forces Step 1 onto a write site that exists before the detached context is introduced.</td>
        <td><span class="s-VERIFIED">VERIFIED</span></td>
        <td>DoD criteria <code>edge-declared</code> + <code>step1-premise</code> vs the stated goal</td>
        <td>high</td>
      </tr>`,
].join('\n');

html = html.replace(/^\s*<tr class="claim"[\s\S]*?<\/tr>\s*$/m, rows);

const dod = {
  criteria: [
    {
      id: 'edge-declared',
      text: "Task 2's dependency on Task 1 is declared in its Interfaces block, not only in step prose.",
      tier: 'checkable',
      check: "grep -A8 '^### Task 2' plan.md | grep -qi 'consumes.*task 1'",
    },
    {
      id: 'step1-premise',
      text: 'Task 1 Step 1 names a ledger write site that exists in repo/internal/schedules/worker.go.',
      tier: 'judged',
    },
  ],
};

const fill = {
  PLAN_TITLE: 'Schedule Run Bookkeeping — Implementation Plan',
  PLAN_CLASS: 'code',
  PLAN_GOAL: "Stop schedule runs being stranded in status='running' when the job context is cancelled mid-fan-out.",
  DATE: '2026-08-03',
  VERDICT: 'NO-GO',
  VERDICT_SUMMARY:
    'Task 1 Step 1 rests on a call that does not exist in the code it names. That is a wrong model ' +
    'of the territory, not a typo — choosing what Step 1 should do instead is a design decision ' +
    'nobody has made yet, so autofix leaves it alone and the verdict stays NO-GO until one is.',
  CONDITION_1: '—',
};

html = html.replace(
  /<script type="application\/json" id="dod">[\s\S]*?<\/script>/,
  `<script type="application/json" id="dod">${JSON.stringify(dod)}</script>`
);
for (const [k, v] of Object.entries(fill)) html = html.split(`{{${k}}}`).join(v);
html = html.replace(/\{\{[A-Z_0-9]+\}\}/g, '—');

// open=0 => the validator requires ZERO <li class="condition">. Drop the template's specimen.
html = html.replace(/<li class="condition">[\s\S]*?<\/li>\s*/g, '');

fs.writeFileSync(out, html);
console.log(`wrote ${out}`);
NODE

# Autofix, in place. Only the mechanical repair; the refuted Step 1 sentence stays verbatim.
node - "$PLAN" <<'NODE'
const fs = require('node:fs');
const [src] = process.argv.slice(2);
const dst = src;
let md = fs.readFileSync(src, 'utf8');

// MECHANICAL ONLY: transcribe the edge the plan already states in Task 2 Step 2 into Task 2's
// own Interfaces block. Nothing is invented — the plan said it, in the wrong place.
md = md.replace(
  '### Task 2: Resolve targets before claiming the occurrence\n\n**Files:**\n- Modify: `repo/internal/schedules/resolver.go`\n\n**Interfaces:**\n- Consumes: nothing.',
  '### Task 2: Resolve targets before claiming the occurrence\n\n**Files:**\n- Modify: `repo/internal/schedules/resolver.go`\n\n**Interfaces:**\n- Consumes: Task 1 (declared from this task\'s own Step 2, which required Task 1 to land first).'
);

fs.writeFileSync(dst, md);
console.log(`wrote ${dst}`);
NODE

node "$SKILL/assets/validate.mjs" "$OUT"
