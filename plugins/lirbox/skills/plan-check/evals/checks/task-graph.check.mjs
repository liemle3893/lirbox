// ACCEPTANCE-CHECK (BEHAVIOUR concern) — FAILS on the unmodified baseline (fail-before / pass-after).
//
// Concern: `execution-shape` taught plan-check to FIND a dishonest task graph, but the finding
// landed as prose in a claim row. Nothing downstream can read prose, and — worse — the guidance
// was wrong about the one runner this repo actually ships. blind-spot.md called a file claimed by
// two tasks "an undeclared serialization point", while lirbox:conductor's own planner prompt says
// the opposite in as many words: "Touching the SAME file is NOT a dependency: every item runs in
// its OWN worktree on its OWN branch". Acting on the old advice makes a plan MORE serial than the
// work is, which is the exact opposite of what reading the graph is for.
//
// The invariant this guards has two halves, and only the pair is worth anything:
//
//   A. The report carries a machine-readable `#taskgraph` whose `levels` are DERIVED, not
//      asserted — validate.mjs recomputes them by layering the `needs` edges and rejects a
//      mismatch. That is what stops a report inventing serialization (levels [[a]],[[b]] with no
//      edge between them) or claiming parallelism its own edges forbid.
//   B. `needs` and `contention` are DIFFERENT constraints. A `contention` edge (two tasks, one
//      file) must NOT push its tasks into separate levels: under per-item worktrees it costs a
//      merge at integration, not an order. A validator that serializes on contention would hand
//      conductor a slower plan than the truth.
//
// Asserted by EXECUTING validate.mjs against synthetic reports, not by grepping it. The previous
// three checks in this skill each shipped a FALSE-GREEN first (a token that survived in a
// neighbouring bullet, an error string, a comment); running the thing cannot be fooled that way.
//
// RED on baseline: no `#taskgraph` block exists anywhere — template, validator or SKILL.md — so
// every report is silent on what may run concurrently.
//
// Locked (evals/**): the fixer may never edit this file.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = process.cwd();
const P = 'plugins/lirbox/skills/plan-check';
const SKILL_MD = process.env.PLAN_CHECK_SKILL_MD || join(ROOT, P, 'SKILL.md');
const BLIND_SPOT = process.env.PLAN_CHECK_BLIND_SPOT_MD || join(ROOT, P, 'references/blind-spot.md');
const TEMPLATE = process.env.PLAN_CHECK_TEMPLATE || join(ROOT, P, 'assets/template.html');
const VALIDATE = process.env.PLAN_CHECK_VALIDATE || join(ROOT, P, 'assets/validate.mjs');

const read = (p) => {
  try {
    return readFileSync(p, 'utf8');
  } catch (e) {
    console.error(`FAIL check: cannot read ${p}: ${e.message}`);
    process.exit(1);
  }
};

const skill = read(SKILL_MD);
const blind = read(BLIND_SPOT);
const template = read(TEMPLATE);

const TMP = mkdtempSync(join(tmpdir(), 'plan-check-taskgraph-'));

// A minimal report that satisfies every OTHER rule, so the only thing under test is #taskgraph.
const report = (graph) => `<!DOCTYPE html><html><head><style>.verdict[data-verdict="GO"]{color:#000}</style></head><body>
<p id="goal"><strong>Goal:</strong> ship the thing without breaking checkout</p>
<div class="verdict" data-verdict="GO"><span class="badge">GO</span></div>
<table><tbody>
<tr class="claim" data-goal-coverage="true" data-quadrant="known-known" data-status="VERIFIED"><td>DoD reaches the goal</td></tr>
<tr class="claim" data-quadrant="known-known" data-status="VERIFIED"><td>a claim</td></tr>
</tbody></table>
<script type="application/json" id="dod">{"criteria":[{"id":"c1","text":"suite green","tier":"checkable","check":"true"}]}</script>
${graph === null ? '' : `<script type="application/json" id="taskgraph">${JSON.stringify(graph)}</script>`}
</body></html>`;

// exit code of validate.mjs on a report carrying `graph` (0 = accepted, 1 = rejected).
let n = 0;
const verdictOn = (graph) => {
  const f = join(TMP, `r${++n}.html`);
  writeFileSync(f, report(graph));
  try {
    execFileSync('node', [VALIDATE, f], { stdio: 'pipe' });
    return 0;
  } catch (e) {
    return typeof e.status === 'number' ? e.status : 1;
  }
};

const why = 'stated reason';
const N = (id, files) => (files ? { id, files } : { id });

// --- the graphs under test -------------------------------------------------------------------
// Two tasks, no edges, declared as running together. The honest baseline case.
const PARALLEL = { nodes: [N('a'), N('b')], edges: [], levels: [['a', 'b']] };
// Same two tasks, no edge justifying it, declared serial. Invented serialization.
const INVENTED_SERIAL = { nodes: [N('a'), N('b')], edges: [], levels: [['a'], ['b']] };
// A real ordering edge, but the levels claim they run together anyway.
const OVERCLAIMED_PARALLEL = {
  nodes: [N('a'), N('b')],
  edges: [{ from: 'a', to: 'b', kind: 'needs', why }],
  levels: [['a', 'b']],
};
// One file, two owners, no edge saying so — the collision the plan is silent about.
const UNCLASSIFIED_COLLISION = {
  nodes: [N('a', ['svc/write.go']), N('b', ['svc/write.go'])],
  edges: [],
  levels: [['a', 'b']],
};
// The same collision, classified as contention — MUST still run concurrently (per-item worktrees).
const CONTENTION_PARALLEL = {
  nodes: [N('a', ['svc/write.go']), N('b', ['svc/write.go'])],
  edges: [{ from: 'a', to: 'b', kind: 'contention', why }],
  levels: [['a', 'b']],
};

const assertions = [
  {
    id: 'template-has-taskgraph-block',
    where: 'assets/template.html',
    ok: /<script[^>]*\bid="taskgraph"/.test(template),
    want: 'the report template must carry a machine-readable <script id="taskgraph"> block',
  },
  {
    id: 'skill-declares-both-edge-kinds',
    where: 'SKILL.md',
    // Both kinds named, AND levels stated as derived rather than authored. Either alone is
    // decoration: naming the kinds without deriving levels lets the report assert any shape.
    // "deriv" must sit next to "levels" — a bare /deriv/ over the whole file is satisfied by
    // step 8's unrelated "If the plan stated none, derive them", which is a FALSE-GREEN.
    ok: /\bneeds\b/.test(skill) && /\bcontention\b/.test(skill) && /levels[^.]{0,160}deriv/i.test(skill),
    want:
      'step 8 must name both edge kinds (needs / contention) and state that `levels` is DERIVED ' +
      'from the needs edges, not asserted by the report',
  },
  {
    id: 'blindspot-collision-is-classified-not-serialized',
    where: 'references/blind-spot.md',
    // The bullet must reach the worktree distinction. Baseline said "an undeclared serialization
    // point" flatly, which contradicts conductor's own planner prompt.
    ok: blind
      .split(/\n(?=\s*[-*]\s)/)
      .some((b) => /(more than one|two|multiple)\s+tasks?\b/i.test(b) && /worktree/i.test(b) && /contention/i.test(b)),
    want:
      'the file-collision bullet must classify: under per-item worktrees a shared file is ' +
      '`contention` (a merge cost), not an ordering constraint',
  },
  {
    id: 'validator-requires-the-block',
    where: 'assets/validate.mjs',
    ok: verdictOn(null) === 1,
    want: 'a report with no #taskgraph block must be REJECTED',
  },
  {
    id: 'validator-accepts-an-honest-graph',
    where: 'assets/validate.mjs',
    // Guards against a validator that rejects everything — which would make every other
    // assertion here pass for the wrong reason.
    ok: verdictOn(PARALLEL) === 0,
    want: 'two tasks with no edges, declared as one level, must be ACCEPTED',
  },
  {
    id: 'validator-rejects-invented-serialization',
    where: 'assets/validate.mjs',
    ok: verdictOn(INVENTED_SERIAL) === 1,
    want:
      'levels claiming a serial order that no `needs` edge justifies must be REJECTED — this is ' +
      'the dimension that stops a plan reading as less parallel than it is',
  },
  {
    id: 'validator-rejects-overclaimed-parallelism',
    where: 'assets/validate.mjs',
    ok: verdictOn(OVERCLAIMED_PARALLEL) === 1,
    want: 'levels claiming concurrency that a `needs` edge forbids must be REJECTED',
  },
  {
    id: 'validator-rejects-unclassified-collision',
    where: 'assets/validate.mjs',
    ok: verdictOn(UNCLASSIFIED_COLLISION) === 1,
    want: 'a file claimed by two tasks with no edge between them must be REJECTED',
  },
  {
    id: 'contention-does-not-serialize',
    where: 'assets/validate.mjs',
    // The half that protects PARALLELISM. A validator treating contention as an order would
    // pass every other assertion above and still hand a runner a needlessly serial plan.
    ok: verdictOn(CONTENTION_PARALLEL) === 0,
    want:
      'two tasks joined by a `contention` edge must still be ACCEPTED in ONE level — under ' +
      'per-item worktrees a shared file is a merge cost, not an ordering constraint',
  },
];

const failed = assertions.filter((a) => !a.ok);
if (!failed.length) {
  console.log(
    "PASS check: plan-check emits an enforced task graph whose levels are derived from its edges " +
      `(${assertions.length}/${assertions.length} assertions).`
  );
  process.exit(0);
}
console.error('FAIL check: plan-check does not enforce a derived, two-kind task graph.');
for (const a of failed) console.error(`  - [${a.id}] ${a.where}: ${a.want}`);
process.exit(1);
