#!/bin/bash
# Reference solution for plan-check__execution-shape.
#
# The oracle's job is to prove the grader is SATISFIABLE and that test.sh agrees with
# instruction.md — not to demonstrate intelligence. plan-check has no generator to drive (its
# work is analysis a model performs), so the reference solution is the correct report, built
# from the skill's OWN template and passing the skill's OWN validator. That keeps the oracle on
# the real artifact path: if the template or validate.mjs changes incompatibly, this breaks too.
#
# The two findings below are the ones planted in files/plan.md, both derivable from the plan's
# own text with no repository present.
set -uo pipefail

TPL=/root/.claude/skills/plan-check/assets/template.html
OUT=/app/plan-check-schedule-run-hang-fix.html

if [ ! -f "$TPL" ]; then
  echo "solve.sh: template not found at $TPL — the task image did not vendor the skill" >&2
  exit 1
fi

node - "$TPL" "$OUT" <<'NODE'
const fs = require('node:fs');
const [tpl, out] = process.argv.slice(2);
let html = fs.readFileSync(tpl, 'utf8');

const row = (quadrant, status, proposition, evidence, detail, confidence) =>
  `      <tr class="claim" data-quadrant="${quadrant}" data-status="${status}">
        <td>${proposition}</td>
        <td><span class="tag q-${quadrant}">${quadrant}</span></td>
        <td><span class="s-${status}">${status}</span>${detail}</td>
        <td>${evidence}</td>
        <td>${confidence}</td>
      </tr>`;

// Row 1 + 2 are UNSTATED-ASSUMPTION: neither is "open" per the validator's OPEN set, so neither
// becomes a condition. Row 3 is the BLIND-SPOT-RISK that does. refuted=0, open=1
// => derived verdict GO-WITH-CONDITIONS, and exactly one <li class="condition">.
const rows = [
  row(
    'unknown-known',
    'UNSTATED-ASSUMPTION',
    'Task 2 and Task 3 both declare <code>server/internal/schedules/worker.go</code> under Files:, ' +
      'and Task 3 declares "Consumes: nothing". The overlap is a serialization point the plan never ' +
      'states; both tasks edit the same file and Task 3 edits the same <code>Run</code> function.',
    'plan.md Task 2 Files: and Task 3 Files: — both list worker.go; Task 3 Interfaces: "Consumes: nothing"',
    ' <span class="fix">fix: needs-decision</span>',
    'high'
  ),
  row(
    'unknown-known',
    'UNSTATED-ASSUMPTION',
    'Task 4 declares "Consumes: nothing" while its own Step 3 says to run it after Task 2 has landed. ' +
      'The dependency block is what a runner dispatches from; the step prose is invisible to it, so ' +
      'Task 4 can be dispatched concurrently with Task 2.',
    'plan.md Task 4 Interfaces: "Consumes: nothing" vs Task 4 Step 3: "Run this after Task 2 has landed"',
    ' <span class="fix">fix: mechanical</span>',
    'high'
  ),
  row(
    'unknown-unknown',
    'BLIND-SPOT-RISK',
    'The "Implementation order" section flattens the task graph into a line, so a real edge ' +
      '(Task 2 &rarr; Task 4) is indistinguishable from an incidental one. Which edges are load-bearing ' +
      'is unrecoverable from the plan as written.',
    'plan.md header: "Implementation order (decided 2026-08-02): Task 1, then Task 2, then Task 3, then Task 4."',
    ' <span class="fix">fix: needs-decision</span>',
    'medium'
  ),
].join('\n');

// Swap the template's single specimen claim row for the real ledger.
html = html.replace(
  /^\s*<tr class="claim"[\s\S]*?<\/tr>\s*$/m,
  rows
);

const dod = {
  criteria: [
    {
      id: 'graph-declared',
      text: 'Every task that another task depends on declares that edge in its own Interfaces block, not in step prose.',
      tier: 'checkable',
      check: "! grep -qi 'run this after Task' plan.md",
    },
    {
      id: 'no-undeclared-file-collision',
      text: 'No source file appears under Files: in two tasks that do not declare the overlap.',
      tier: 'judged',
    },
  ],
};

const fill = {
  PLAN_TITLE: 'Schedule Run Hang Fix — Implementation Plan',
  PLAN_CLASS: 'code',
  DATE: '2026-08-03',
  VERDICT: 'GO-WITH-CONDITIONS',
  VERDICT_SUMMARY:
    'The plan\'s account of the code is sound; its account of ITSELF is not. Two structural ' +
    'declarations contradict the plan\'s own text, and both mislead a runner that dispatches from them.',
  CONDITION_1:
    'Decide and declare the Task 2 / Task 3 overlap on <code>worker.go</code>: merge them, or state ' +
    'that they are serial. Then move Task 4\'s Step 3 dependency into its Interfaces block.',
};

html = html.replace(
  /<script type="application\/json" id="dod">[\s\S]*?<\/script>/,
  `<script type="application/json" id="dod">${JSON.stringify(dod)}</script>`
);

for (const [k, v] of Object.entries(fill)) {
  html = html.split(`{{${k}}}`).join(v);
}
// Any placeholder the ledger rows carried is gone with the specimen row; sweep the rest so the
// validator's "no leftover {{token}}" rule holds without depending on the template's exact set.
html = html.replace(/\{\{[A-Z_0-9]+\}\}/g, '—');

fs.writeFileSync(out, html);
console.log(`wrote ${out}`);
NODE

node /root/.claude/skills/plan-check/assets/validate.mjs "$OUT"
