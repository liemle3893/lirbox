#!/bin/bash
# Reference solution for plan-check__execution-shape.
#
# The oracle's job is to prove the grader is SATISFIABLE and that test.sh agrees with
# instruction.md — not to demonstrate intelligence. plan-check has no generator to drive (its
# work is analysis a model performs), so the reference solution is the correct report, built
# from the skill's OWN template and passing the skill's OWN validator. That keeps the oracle on
# the real artifact path: if the template or validate.mjs changes incompatibly, this breaks too.
#
# The findings below are the ones planted in environment/plan.md, all derivable from the plan's
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

const row = (status, proposition, evidence, detail, confidence) =>
  `      <tr class="claim" data-status="${status}">
        <td>${proposition}</td>
        <td><span class="s-${status}">${status}</span>${detail}</td>
        <td>${evidence}</td>
        <td>${confidence}</td>
      </tr>`;

// All four rows are open (UNSTATED-ASSUMPTION and BLIND-SPOT-RISK both are), none is a REFUTED
// needing a decision => derived verdict GO-WITH-CONDITIONS, and four <li class="condition">.
const rows = [
  row(
    'UNSTATED-ASSUMPTION',
    'Task 2 and Task 3 both declare <code>server/internal/schedules/worker.go</code> under Files:, ' +
      'and neither states the overlap. It is <strong>contention, not an ordering constraint</strong>: ' +
      'the two have no data dependency on each other, so under a runner giving each task its own ' +
      'worktree they run in parallel and the shared file costs a merge at integration. Declaring ' +
      'them serial would make the plan slower than the work actually is.',
    'plan.md Task 2 Files: and Task 3 Files: — both list worker.go and worker_test.go; neither Interfaces block names the other',
    ' <span class="fix">fix: needs-decision</span>',
    'high'
  ),
  row(
    'UNSTATED-ASSUMPTION',
    'Task 4 declares "Consumes: nothing" while its own Step 3 says to run it after Task 2 has landed. ' +
      'The dependency block is what a runner dispatches from; the step prose is invisible to it, so ' +
      'Task 4 can be dispatched concurrently with Task 2. This one IS a real ordering edge.',
    'plan.md Task 4 Interfaces: "Consumes: nothing" vs Task 4 Step 3: "Run this after Task 2 has landed"',
    ' <span class="fix">fix: mechanical</span>',
    'high'
  ),
  row(
    'BLIND-SPOT-RISK',
    'The "Implementation order" section flattens the task graph into a line (1 &rarr; 2 &rarr; 3 &rarr; 4), ' +
      'so a real edge is indistinguishable from an incidental one — and it hides that Task 2 and Task 3 ' +
      'are independent of each other and may run at the same time.',
    'plan.md header: "Implementation order (decided 2026-08-02): Task 1, then Task 2, then Task 3, then Task 4."',
    ' <span class="fix">fix: needs-decision</span>',
    'medium'
  ),
  row(
    'UNSTATED-ASSUMPTION',
    'Task 3 declares "Consumes: nothing", but its Step 2 writes into <code>schedule_runs.error</code> — ' +
      'the column Task 1 creates. The edge Task 1 &rarr; Task 3 is real and undeclared.',
    'plan.md Task 3 Interfaces: "Consumes: nothing" vs Task 3 Step 2: "Write the error string into schedule_runs.error"; Task 1 Produces: "schedule_runs.error"',
    ' <span class="fix">fix: mechanical</span>',
    'high'
  ),
  // MANDATORY row (validate.mjs): does meeting every DoD criterion actually achieve the goal?
  `      <tr class="claim" data-status="VERIFIED" data-goal-coverage="yes">
        <td>Does meeting every DoD criterion achieve the goal? The goal is about runs stranded in <code>running</code>; the DoD here covers only the plan&rsquo;s own graph honesty, which is what this check adjudicates. No goal-level gap is found in the plan&rsquo;s stated ACs.</td>
        <td><span class="s-VERIFIED">VERIFIED</span></td>
        <td>plan.md Definition of done vs the stated goal</td>
        <td>high</td>
      </tr>`,
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
  DATE: '2026-08-04',
  PLAN_GOAL:
    "Stop schedule runs being stranded in status='running' forever when a run outlives the job " +
    "queue's timeout.",
  VERDICT: 'GO-WITH-CONDITIONS',
  VERDICT_SUMMARY:
    'The plan\'s account of the code is sound; its account of ITSELF is not. Three dependency ' +
    'declarations contradict the plan\'s own text, and the stated implementation order serializes ' +
    'two tasks that are independent.',
};

// One condition per open row.
const conditions = [
  'Decide how Task 2 and Task 3 share <code>worker.go</code>: in separate worktrees they may run ' +
    'concurrently and the overlap is a merge; in one working tree they must be serialized.',
  'Declare Task 2 &rarr; Task 4 in Task 4\'s Interfaces block.',
  'Replace the linear "Implementation order" with the declared edges, so Task 2 and Task 3 are ' +
    'visibly independent.',
  'Declare Task 1 &rarr; Task 3 in Task 3\'s Interfaces block.',
];
html = html.replace(
  /<li class="condition"><div class="cbody">\{\{CONDITION_1\}\}<\/div><\/li>/,
  conditions.map((c) => `<li class="condition"><div class="cbody">${c}</div></li>`).join('\n    ')
);

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
