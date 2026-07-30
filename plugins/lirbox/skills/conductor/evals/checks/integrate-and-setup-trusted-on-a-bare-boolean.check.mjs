// ACCEPTANCE CHECK — the two control-flow decisions gating the plan fan-out must verify the SET a
// worker acted on, not just believe a boolean it asserted about itself.
//
// Concern (feedback/conductor.jsonl -> integrate-and-setup-trusted-on-a-bare-boolean).
// `levelSetup.ready` decides whether a whole dependency level may dispatch; `levelIntegrate.merged`
// decides whether that level's per-item branches are accepted into the run branch. PLAN_SETUP_SCHEMA
// and PLAN_INTEGRATE_SCHEMA require only `ready: boolean` / `merged: boolean`. The conductor
// dispatched a KNOWN set — it built `itemBranches` and `itemWorktrees` from `level` itself — but never
// asks for that set back and never compares. An integrate worker that merged 2 of 3 branches and
// returned merged:true advances the run: the third item's commits never reach BRANCH, and every
// downstream gate then verifies an incomplete diff while reporting on the full plan.
//
// Note the asymmetry the concern calls out: the plan INPUT is already validated properly in pure JS
// (planItems dedups ids, drops dangling dependsOn, sanitizes slugs; planLevels is cycle-safe and
// loud). It is only the worker OUTPUT that is taken on trust. The fix is a set BIJECTION checked in
// pure JS at zero extra agent cost — exact equality against the dispatched set, and a mismatch fails
// naming the missing/extra entries rather than proceeding.
//
// Structural contract (the fixer reads this check as the spec):
//   * PLAN_SETUP_SCHEMA requires `created: string[]` — the worktrees actually created.
//   * PLAN_INTEGRATE_SCHEMA requires `merged_branches: string[]` — the branches actually merged.
//   * exact set equality against the dispatched set before advancing; on mismatch, fail naming what
//     is missing (or extra) instead of continuing to the next level or gate.
//
// Baseline: RED. Both schemas carry only a boolean, so a stub's `true` advances the run even when the
// accompanying list is short (assertions 3-6 fail).
//
// RED-for-the-right-reason: assertions 0-2 (generation parses; the level dispatched three items; the
// dispatched branch set is recoverable from the setup prompt) stay green on baseline — a RED verdict
// is the MISSING bijection, not generator breakage.
//
// Locked (evals/**): the whetstone fixer may NEVER edit this file.
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { generate, parses, runBody } from './body-harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..', '..', '..', '..');
const GEN = process.env.GEN_OVERRIDE || resolve(REPO, 'plugins/lirbox/skills/conductor/scripts/scaffold-workflow.cjs');
const TMP = mkdtempSync(join(tmpdir(), 'bijection-check-'));

const PHASE = 'Implement';
const KEY = 'implement';
const promptsFile = join(TMP, 'prompts.json');
writeFileSync(promptsFile, JSON.stringify({ [PHASE]: 'Do the work.' }));

// Three independent items => ONE level dispatching three worktrees/branches, so "2 of 3" is
// expressible. A single-item level short-circuits to the serial path and cannot show the bug.
const PLAN_ITEMS = [
  { id: 'i1', title: 'first item', prompt: 'do first', dependsOn: [] },
  { id: 'i2', title: 'second item', prompt: 'do second', dependsOn: [] },
  { id: 'i3', title: 'third item', prompt: 'do third', dependsOn: [] },
];

const results = [];
const ok = (pass, label) => { results.push({ pass, label }); console.log(`${pass ? 'PASS' : 'FAIL'}: ${label}`); };
const bail = (code, msg) => { console.error(msg); rmSync(TMP, { recursive: true, force: true }); process.exit(code); };

// ---------- preconditions ----------
const run = generate({ gen: GEN, repo: REPO, tmp: TMP, name: 'bijection', argv: ['--phases', PHASE, '--prompts-file', promptsFile] });
if (run.code !== 0 || !parses(run.file)) {
  bail(2, `PRECONDITION FAILED: generation exits ${run.code} or does not parse — unrelated generator breakage.\n${run.out}`);
}
const src = readFileSync(run.file, 'utf8');
console.log('PASS: 0. precondition — generation exits 0 and the body compiles');

const plan = ({ label, base }) => (label === `plan:${PHASE}` ? { ...base, items: PLAN_ITEMS } : undefined);

// The setup worker's prompt carries `setup_item "<worktree>" "<branch>"` per item — that IS the
// dispatched set, recovered from the conductor's own output rather than guessed from slug rules.
const dispatchedFrom = (calls) => {
  const setup = calls.find((c) => c.label === `${KEY}:setup-l1`);
  if (!setup) return { worktrees: [], branches: [] };
  const worktrees = [];
  const branches = [];
  for (const m of setup.prompt.matchAll(/setup_item\s+"([^"]+)"\s+"([^"]+)"/g)) {
    worktrees.push(m[1]); branches.push(m[2]);
  }
  return { worktrees, branches };
};

// A dry run to recover the dispatched set and confirm the fan-out shape.
let dry;
try { dry = await runBody(src, plan); }
catch (e) { bail(2, `PRECONDITION FAILED: harness could not execute the body: ${e && (e.stack || e.message)}`); }

const workers = dry.calls.filter((c) => PLAN_ITEMS.some((it) => c.label === `${KEY}:${it.id}`));
if (workers.length !== 3) {
  bail(2, `PRECONDITION FAILED: expected 3 item workers in one level, saw ${workers.length} — the fan-out shape changed.`);
}
console.log('PASS: 1. precondition — the level dispatched all three item workers');

const { worktrees, branches } = dispatchedFrom(dry.calls);
if (branches.length !== 3 || worktrees.length !== 3) {
  bail(2, `PRECONDITION FAILED: could not recover the dispatched set from the setup prompt `
    + `(worktrees=${worktrees.length}, branches=${branches.length}) — the setup prompt shape changed.`);
}
console.log(`PASS: 2. precondition — dispatched set recovered from the setup prompt (${branches.join(', ')})`);

const missingBranch = branches[2];
const missingWorktree = worktrees[2];

// ---------- the RED assertions ----------

// 3+4. an integrate worker that merged only 2 of the 3 dispatched branches must stop the run, and say
//      which branch is missing — a run that continues here ships an incomplete diff to every gate.
let integ;
try {
  integ = await runBody(src, (ctx) => {
    const planned = plan(ctx);
    if (planned) return planned;
    if (ctx.label === `${KEY}:integrate-l1`) {
      return { ...ctx.base, merged: true, merged_branches: branches.slice(0, 2), summary: 'merged 2 of 3' };
    }
    return undefined;
  });
} catch (e) { bail(2, `PRECONDITION FAILED: harness could not execute the integrate scenario: ${e && (e.stack || e.message)}`); }

ok(integ.error !== null,
  '3. an integrate reporting merged:true while listing only 2 of 3 dispatched branches STOPS the run');
ok(integ.error !== null && String(integ.error.message || integ.error).includes(missingBranch),
  `4. that failure names the branch that never merged ('${missingBranch}')`);

// 5+6. the same for setup: `ready: true` with a short `created` list must not license the level to
//      dispatch workers into worktrees that do not exist.
let setupRun;
try {
  setupRun = await runBody(src, (ctx) => {
    const planned = plan(ctx);
    if (planned) return planned;
    if (ctx.label === `${KEY}:setup-l1`) {
      return { ...ctx.base, ready: true, created: worktrees.slice(0, 2), summary: 'created 2 of 3' };
    }
    return undefined;
  });
} catch (e) { bail(2, `PRECONDITION FAILED: harness could not execute the setup scenario: ${e && (e.stack || e.message)}`); }

ok(setupRun.error !== null,
  '5. a setup reporting ready:true while listing only 2 of 3 dispatched worktrees STOPS the level');
ok(setupRun.error !== null && String(setupRun.error.message || setupRun.error).includes(missingWorktree),
  `6. that failure names the worktree that was never created ('${missingWorktree}')`);

// 7. the schemas must actually REQUIRE the sets — without that a real worker would never return them
//    and the bijection above could only ever be vacuous.
const requires = (schemaName, field) => {
  const at = src.indexOf(schemaName);
  if (at !== -1) return new RegExp(`"required"\\s*:\\s*\\[[^\\]]*"${field}"`).test(src.slice(at, at + 1200));
  // The generator may inline the schema at the call site rather than naming a constant; fall back to
  // the dispatch whose label identifies it.
  const call = src.indexOf(`${KEY}:setup-l`) !== -1 || src.indexOf(`${KEY}:integrate-l`) !== -1;
  return call && new RegExp(`"required"\\s*:\\s*\\[[^\\]]*"${field}"`).test(src);
};
ok(requires('PLAN_SETUP_SCHEMA', 'created') && requires('PLAN_INTEGRATE_SCHEMA', 'merged_branches'),
  '7. the setup/integrate schemas REQUIRE `created` / `merged_branches` (so a worker must return them)');

rmSync(TMP, { recursive: true, force: true });

const failed = results.filter((r) => !r.pass);
if (failed.length) {
  console.error(`\ncheck RED: ${failed.length}/${results.length} assertion(s) failed — setup/integrate routing `
    + `trusts a self-asserted boolean over a set the conductor already knows; a partial merge advances the run.`);
  process.exit(1);
}
console.log(`\ncheck GREEN: all ${results.length} set-bijection assertions passed.`);
process.exit(0);
