#!/bin/bash
# Reference solution for plan-check__autofix-bounded.
#
# Proves the grader is SATISFIABLE and that test.sh agrees with instruction.md. plan-check has no
# generator to drive (its work is analysis a model performs), so the reference solution is the
# correct report — built from the skill's OWN template, passing the skill's OWN validator — plus
# the correctly-bounded autofix output.
#
# The boundary this task exists to pin:
#   * /app/plan.md is NOT touched;
#   * the mechanical row (Task 2's undeclared edge on Task 1) IS repaired in the sibling;
#   * the REFUTED row (the false recordDelivery claim) is left exactly as written.
set -uo pipefail

SKILL=/root/.claude/skills/plan-check
TPL=$SKILL/assets/template.html
OUT=/app/plan-check-schedule-run-bookkeeping.html
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

// One REFUTED (=> NO-GO) and one UNSTATED-ASSUMPTION. UNSTATED-ASSUMPTION is not in the
// validator's OPEN set, so open=0 and no <li class="condition"> is required.
const rows = [
  row(
    'known-known',
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
    'unknown-known',
    'UNSTATED-ASSUMPTION',
    'Task 2 declares "Consumes: nothing" while its own Step 2 says to do it only after Task 1 has ' +
      'landed. A runner dispatches from the Interfaces block, so Task 2 can start concurrently with Task 1.',
    'plan.md Task 2 Interfaces: "Consumes: nothing" vs Task 2 Step 2: "Do this only after Task 1 has landed"',
    ' <span class="fix">fix: mechanical</span>',
    'high'
  ),
].join('\n');

html = html.replace(/^\s*<tr class="claim"[\s\S]*?<\/tr>\s*$/m, rows);

const dod = {
  criteria: [
    {
      id: 'edge-declared',
      text: "Task 2's dependency on Task 1 is declared in its Interfaces block, not only in step prose.",
      tier: 'checkable',
      check: "grep -A3 '^### Task 2' plan.autofix.md | grep -qi 'consumes.*task 1'",
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
  DATE: '2026-08-03',
  VERDICT: 'NO-GO',
  VERDICT_SUMMARY:
    'Task 1 Step 1 rests on a call that does not exist in the code it names. That is a wrong model ' +
    'of the territory, not a typo — choosing what Step 1 should do instead is a design decision, so ' +
    'autofix leaves it alone and the verdict stands at NO-GO.',
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

# The autofix sibling. The INPUT is never modified — this is a copy with only the mechanical
# repair applied. The refuted Step 1 sentence is carried over verbatim, deliberately.
node - /app/plan.md "$FIX" <<'NODE'
const fs = require('node:fs');
const [src, dst] = process.argv.slice(2);
let md = fs.readFileSync(src, 'utf8');

// MECHANICAL ONLY: transcribe the edge the plan already states in Task 2 Step 2 into Task 2's
// own Interfaces block. Nothing is invented — the plan said it, in the wrong place.
md = md.replace(
  '### Task 2: Resolve targets before claiming the occurrence\n\n**Files:**\n- Modify: `repo/internal/schedules/resolver.go`\n\n**Interfaces:**\n- Consumes: nothing.',
  '### Task 2: Resolve targets before claiming the occurrence\n\n**Files:**\n- Modify: `repo/internal/schedules/resolver.go`\n\n**Interfaces:**\n- Consumes: Task 1 (declared from this task\'s own Step 2, which required Task 1 to land first).'
);

md =
  '<!-- AUTOFIXED by lirbox:plan-check — mechanical rows only. The original is unmodified at\n' +
  '     plan.md; this file is the sibling. The REFUTED claim in Task 1 Step 1 is deliberately\n' +
  '     NOT repaired: its fix is a design decision, and every row touched here is UNVERIFIED\n' +
  '     again until re-checked. -->\n\n' + md;

fs.writeFileSync(dst, md);
console.log(`wrote ${dst}`);
NODE

node "$SKILL/assets/validate.mjs" "$OUT"
