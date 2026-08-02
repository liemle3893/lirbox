// ACCEPTANCE-CHECK (DOC concern) — FAILS on the unmodified baseline (fail-before / pass-after).
//
// Concern: plan-check verifies whether a plan is CORRECT but never whether its declared task
// graph is HONEST. An agentic runner (conductor, subagent-driven-development) reads the
// dependency declarations literally and dispatches from them, so a plan that under-declares its
// edges does not merely run slowly — it runs concurrently what must not be, and the damage
// surfaces as a merge conflict or a test that passed against a half-built base.
//
// Two real instances, both in plans this repo's own skill had already reviewed:
//   * a task whose Interfaces block says "Consumes: nothing" while step 6 of its own body says
//     "run it after Task 1 has landed" — the block is what a runner reads; prose is invisible.
//   * one function (`Run` in worker.go) claimed by five of eight tasks, declared nowhere.
//
// The invariant this guards: the plan's DECLARED dependency graph must be tested against the
// file-level truth the plan itself states, so an undeclared edge and a file claimed by two tasks
// each become a finding rather than a discovery at execution time.
//
// Asserted on two artifacts (each with an env hatch so prove-checks.mjs can mutate it):
//   A. SKILL.md step 2 — decomposition must invert the plan's own `Files:` lists and test the
//      declared edges against them.
//   B. references/blind-spot.md — the Code/repo checklist must carry the collision test
//      (a file owned by more than one task is an undeclared serialization point) AND the
//      undeclared-edge test (a dependency stated in prose but absent from the dependency block).
//
// RED on baseline: SKILL.md step 2 names "ordering & hidden dependencies" but never says to test
// them against actual file sets, and blind-spot.md's "Ordering hazards" bullet is about step
// sequencing, not task-graph honesty. We do NOT edit either doc here.
//
// Locked (evals/**): the fixer may never edit this file.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const SKILL_MD =
  process.env.PLAN_CHECK_SKILL_MD || join(ROOT, 'plugins/lirbox/skills/plan-check/SKILL.md');
const BLIND_SPOT =
  process.env.PLAN_CHECK_BLIND_SPOT_MD ||
  join(ROOT, 'plugins/lirbox/skills/plan-check/references/blind-spot.md');

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

// Whole-file token tests are too coarse here: "prose" and "depend" both recur across neighbouring
// bullets, so deleting the undeclared-edge bullet left them satisfied by its neighbours (a
// FALSE-GREEN caught by prove-checks.mjs). Assert per-bullet instead — the concepts must co-occur
// in ONE item, which is what makes them a single stated test rather than two unrelated mentions.
const bullets = blind.split(/\n(?=\s*[-*]\s)/);
const someBullet = (...res) => bullets.some((b) => res.every((re) => re.test(b)));

// A file owned by more than one task is THE collision predicate — phrased as a count, not as a
// keyword, so a reword survives but a deletion does not.
const MULTI_TASK = /(more than one|two or more|multiple|two)\s+tasks?\b/i;

const assertions = [
  {
    id: 'skill-inverts-files-to-tasks',
    where: 'SKILL.md',
    // Decomposition must reach for the plan's own Files: lists, and must reason about a file
    // having more than one owning task.
    ok: /\bFiles:/.test(skill) && MULTI_TASK.test(skill),
    want:
      "step 2 must invert the plan's own `Files:` lists into a file -> tasks table and treat a " +
      'file claimed by two tasks as a proposition',
  },
  {
    id: 'blindspot-file-collision',
    where: 'references/blind-spot.md',
    ok: someBullet(MULTI_TASK, /serial|collision|conflict/i),
    want:
      'the Code/repo checklist must flag a file touched by more than one task as an undeclared ' +
      'serialization point',
  },
  {
    id: 'blindspot-undeclared-edge',
    where: 'references/blind-spot.md',
    // The failure mode is an edge that exists in prose but not in the machine-read DECLARATION.
    // Requiring the declaration half is what separates this from the neighbouring
    // "ordering prose hides a graph" bullet, which mentions prose and dependence but not the block.
    ok: someBullet(/prose|narrative/i, /\bblocks?\b|declar/i),
    want:
      'the Code/repo checklist must flag a dependency stated only in step prose while the ' +
      "task's own dependency block declares none",
  },
];

const failed = assertions.filter((a) => !a.ok);
if (!failed.length) {
  console.log(
    'PASS check: plan-check tests the declared task graph against file-level truth ' +
      `(${assertions.length}/${assertions.length} assertions).`
  );
  process.exit(0);
}
console.error('FAIL check: plan-check does not test the declared task graph against file-level truth.');
for (const a of failed) console.error(`  - [${a.id}] ${a.where}: ${a.want}`);
process.exit(1);
