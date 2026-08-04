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

const row = (quadrant, status, proposition, evidence, detail, confidence) =>
  `      <tr class="claim" data-quadrant="${quadrant}" data-status="${status}">
        <td>${proposition}</td>
        <td><span class="tag q-${quadrant}">${quadrant}</span></td>
        <td><span class="s-${status}">${status}</span>${detail}</td>
        <td>${evidence}</td>
        <td>${confidence}</td>
      </tr>`;

// Rows 1, 2 and 4 are UNSTATED-ASSUMPTION: none is "open" per the validator's OPEN set, so none
// becomes a condition. Row 3 is the BLIND-SPOT-RISK that does. refuted=0, open=1
// => derived verdict GO-WITH-CONDITIONS, and exactly one <li class="condition">.
const rows = [
  row(
    'unknown-known',
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
    'unknown-known',
    'UNSTATED-ASSUMPTION',
    'Task 4 declares "Consumes: nothing" while its own Step 3 says to run it after Task 2 has landed. ' +
      'The dependency block is what a runner dispatches from; the step prose is invisible to it, so ' +
      'Task 4 can be dispatched concurrently with Task 2. This one IS a real ordering edge.',
    'plan.md Task 4 Interfaces: "Consumes: nothing" vs Task 4 Step 3: "Run this after Task 2 has landed"',
    ' <span class="fix">fix: mechanical</span>',
    'high'
  ),
  row(
    'unknown-unknown',
    'BLIND-SPOT-RISK',
    'The "Implementation order" section flattens the task graph into a line (1 &rarr; 2 &rarr; 3 &rarr; 4), ' +
      'so a real edge is indistinguishable from an incidental one — and it hides that Task 2 and Task 3 ' +
      'are independent of each other and may run at the same time.',
    'plan.md header: "Implementation order (decided 2026-08-02): Task 1, then Task 2, then Task 3, then Task 4."',
    ' <span class="fix">fix: needs-decision</span>',
    'medium'
  ),
  row(
    'unknown-known',
    'UNSTATED-ASSUMPTION',
    'Task 3 declares "Consumes: nothing", but its Step 2 writes into <code>schedule_runs.error</code> — ' +
      'the column Task 1 creates. The edge Task 1 &rarr; Task 3 is real and undeclared.',
    'plan.md Task 3 Interfaces: "Consumes: nothing" vs Task 3 Step 2: "Write the error string into schedule_runs.error"; Task 1 Produces: "schedule_runs.error"',
    ' <span class="fix">fix: mechanical</span>',
    'high'
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

// The honest graph. Task 2 and Task 3 share worker.go with NO data dependency between them, so
// they sit in ONE level joined by a contention edge; the plan's own "Implementation order" denies
// that parallelism. Task 1 -> Task 3 and Task 2 -> Task 4 are real edges the plan never declares.
const taskgraph = {
  nodes: [
    { id: 't1', title: 'Migration — add the run-error column', files: ['server/migrations/0018_run_error.sql'] },
    { id: 't2', title: 'Bookkeeping survives cancellation', files: ['server/internal/schedules/worker.go', 'server/internal/schedules/worker_test.go'] },
    { id: 't3', title: 'The run records its own failure reason', files: ['server/internal/schedules/worker.go', 'server/internal/schedules/worker_test.go'] },
    { id: 't4', title: 'Expose the run error on the API', files: ['server/internal/api/runs.go', 'server/internal/api/runs_api_test.go'] },
  ],
  edges: [
    { from: 't1', to: 't2', kind: 'needs', why: 'Task 2 Interfaces declares it: "Consumes: Task 1\'s column"' },
    { from: 't1', to: 't3', kind: 'needs', why: 'UNDECLARED — Task 3 Step 2 writes into schedule_runs.error, the column Task 1 creates' },
    { from: 't2', to: 't4', kind: 'needs', why: 'UNDECLARED in the Interfaces block — stated only in Task 4 Step 3, "run this after Task 2 has landed"' },
    { from: 't2', to: 't3', kind: 'contention', why: 'both write worker.go and worker_test.go; no data dependency, so with per-task worktrees this is a merge at integration, not an order' },
  ],
  levels: [['t1'], ['t2', 't3'], ['t4']],
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
  CONDITION_1:
    'Declare the two missing edges (Task 1 &rarr; Task 3, Task 2 &rarr; Task 4) in the Interfaces ' +
    'blocks, and record the Task 2 / Task 3 overlap on <code>worker.go</code> as contention — they ' +
    'may still run concurrently in separate worktrees.',
};

html = html.replace(
  /<script type="application\/json" id="dod">[\s\S]*?<\/script>/,
  `<script type="application/json" id="dod">${JSON.stringify(dod)}</script>`
);
html = html.replace(
  /<script type="application\/json" id="taskgraph">[\s\S]*?<\/script>/,
  `<script type="application/json" id="taskgraph">${JSON.stringify(taskgraph)}</script>`
);

// The visible Execution-shape list, mirroring the block above. Replaced wholesale because the
// template ships one specimen <li> and this plan has three levels.
html = html.replace(
  /<li><span class="q">level \{\{LEVEL_N\}\}<\/span>[\s\S]*?<\/li>/,
  [
    '<li><span class="q">level 0</span><br><strong>t1</strong> — the migration. Nothing precedes it.</li>',
    '    <li><span class="q">level 1</span><br><strong>t2</strong>, <strong>t3</strong> — both need t1\'s column, and they are independent of each other, so they run in parallel. They collide on <code>worker.go</code>: a merge at integration, not an ordering constraint.</li>',
    '    <li><span class="q">level 2</span><br><strong>t4</strong> — needs t2, an edge the plan states only in step prose.</li>',
  ].join('\n')
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
