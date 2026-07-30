// ACCEPTANCE CHECK — a work item whose worker DIED must be recorded as not-done and surfaced as a
// coverage note, and the run must terminate `partial` rather than `complete`.
//
// Concern (feedback/conductor.jsonl -> dead-item-worker-recorded-as-done). `parallel()` resolves a
// worker that died after retries to `null`. The level loop did
// `itemResults.push({ id, title, summary: (r && r.summary) || '' })`, so the null became an
// empty-string summary pushed as a FINISHED item: a phase where 3 of 5 workers died was
// indistinguishable, in state.json and to every downstream gate, from one where all 5 succeeded, and
// the run still terminated `complete`. The same swallowing applies to every other per-item
// degradation the fan-out can hit — a plan item dropped by planItems, a dangling dependsOn filtered
// out, a cycle collapsed into one level.
//
// RELATIONSHIP TO THE HARD-FAIL SHIPPED IN #52. That PR made the null case LOUD by throwing, which
// is strictly better than silence but is not this concern's fix, and it costs real tokens: the level
// loop persists no per-level progress (see plan-fanout-levels-never-checkpointed), so a throw inside
// it re-dispatches every level from 1 on resume. This check therefore requires the RICHER shape the
// backlog specifies — record, note, continue, report `partial` — which means the fixer is expected to
// REPLACE that throw, not add to it. Continuing is safe in a way it was not before #52: the
// plan-of-record verifier in DoDGate now adjudicates every planned item against the real diff, so an
// item that never ran is caught by a gate instead of shipping unnoticed.
//
// Structural contract (the fixer reads this check as the spec):
//   * a per-item `ok` flag — false for a null/failed worker — in the item record the phase persists.
//   * a run-level `coverage` array of degradation notes, each naming the affected item id, carried
//     through checkpoint() into the persisted payload.
//   * a `partial` terminal marker on the persisted state once any coverage note exists
//     (`status: 'partial'` or `partial: true`).
//   * the dead item must NOT abort the phase — it is reported, not fatal.
//
// Baseline: RED. Post-#52 the body throws, so there is no item record, no coverage, no partial
// marker. Pre-#52 it recorded `summary: ''` with no ok flag. Either way assertions 2-5 fail.
//
// RED-for-the-right-reason: assertions 0-1 (generation parses; the level actually dispatched the
// items) stay green on baseline, so a RED verdict is the MISSING reporting shape, not generator
// breakage.
//
// Locked (evals/**): the whetstone fixer may NEVER edit this file.
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { generate, parses, runBody } from './body-harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..', '..', '..', '..');   // checks -> evals -> conductor -> skills -> lirbox -> plugins -> repo
const GEN = process.env.GEN_OVERRIDE || resolve(REPO, 'plugins/lirbox/skills/conductor/scripts/scaffold-workflow.cjs');
const TMP = mkdtempSync(join(tmpdir(), 'dead-item-check-'));

const PHASE = 'Implement';
const promptsFile = join(TMP, 'prompts.json');
writeFileSync(promptsFile, JSON.stringify({ [PHASE]: 'Do the work.' }));

// Three independent items => ONE dependency level of three parallel workers. The middle one dies.
const PLAN_ITEMS = [
  { id: 'i1', title: 'first item', prompt: 'do first', dependsOn: [] },
  { id: 'i2', title: 'second item', prompt: 'do second', dependsOn: [] },
  { id: 'i3', title: 'third item', prompt: 'do third', dependsOn: [] },
];
const DEAD = 'i2';

const results = [];
const ok = (pass, label) => { results.push({ pass, label }); console.log(`${pass ? 'PASS' : 'FAIL'}: ${label}`); };
const bail = (code, msg) => { console.error(msg); rmSync(TMP, { recursive: true, force: true }); process.exit(code); };

// ---------- preconditions (failure here = harness rot -> exit 2, never a RED verdict) ----------
const run = generate({ gen: GEN, repo: REPO, tmp: TMP, name: 'deaditem', argv: ['--phases', PHASE, '--prompts-file', promptsFile] });
if (run.code !== 0 || !parses(run.file)) {
  bail(2, `PRECONDITION FAILED: generation exits ${run.code} or does not parse — unrelated generator breakage.\n${run.out}`);
}
console.log('PASS: 0. precondition — generation exits 0 and the body compiles');

// One worker dies; every other dispatch gets the permissive answer, so nothing else can explain the
// verdict. The planner is answered with the fixed 3-item plan.
const answer = ({ label, base }) => {
  if (label === `plan:${PHASE}`) return { ...base, items: PLAN_ITEMS };
  if (label === `implement:${DEAD}`) return 'DEAD';
  return undefined;
};

let exec;
try { exec = await runBody(readFileSync(run.file, 'utf8'), answer); }
catch (e) { bail(2, `PRECONDITION FAILED: harness could not execute the body: ${e && (e.stack || e.message)}`); }

const dispatched = exec.calls.filter((c) => PLAN_ITEMS.some((it) => c.label === `implement:${it.id}`));
if (dispatched.length !== PLAN_ITEMS.length) {
  bail(2, `PRECONDITION FAILED: expected ${PLAN_ITEMS.length} item workers dispatched, saw ${dispatched.length} `
    + `(${dispatched.map((c) => c.label).join(', ')}) — the fan-out shape changed; this check's premise is gone.`);
}
console.log(`PASS: 1. precondition — the level dispatched all ${PLAN_ITEMS.length} item workers (${DEAD} answered as dead)`);

// ---------- the RED assertions ----------

// 2. a dead worker is not fatal: the phase reports it and the run continues to later phases.
ok(exec.error === null,
  '2. a dead item worker does NOT abort the run — it is reported, not fatal');

// Everything below reads the PERSISTED payload, not in-memory state: the whole point of the concern
// is that state.json and every downstream gate could not tell a dead item from a finished one.
const payloads = exec.checkpoints.map((c) => c.payload);
const itemRecords = payloads.flatMap((p) => Object.values((p && p.results) || {})
  .flatMap((v) => (v && Array.isArray(v.items) ? v.items : [])));
const deadRecord = itemRecords.find((r) => r && r.id === DEAD);

// 3. the dead item carries an explicit ok:false in what gets persisted.
ok(!!deadRecord && deadRecord.ok === false,
  `3. the dead item '${DEAD}' is persisted with ok:false (not an empty summary passed off as done)`);

// 4. a run-level coverage note names the affected item.
const coverage = payloads.flatMap((p) => {
  const c = (p && p.coverage) || (p && p.results && p.results.coverage) || [];
  return Array.isArray(c) ? c : [];
});
ok(coverage.some((n) => JSON.stringify(n).includes(DEAD)),
  `4. a run-level coverage note names the degraded item '${DEAD}'`);

// 5. once a coverage note exists the run is marked partial, never a clean complete.
ok(payloads.some((p) => p && (p.status === 'partial' || p.partial === true)),
  '5. the persisted state carries a partial marker (status:"partial" or partial:true)');

rmSync(TMP, { recursive: true, force: true });

const failed = results.filter((r) => !r.pass);
if (failed.length) {
  console.error(`\ncheck RED: ${failed.length}/${results.length} assertion(s) failed — a dead item worker is `
    + `either swallowed as done or fatal to the run; no ok flag, no coverage note, no partial status.`);
  process.exit(1);
}
console.log(`\ncheck GREEN: all ${results.length} dead-item reporting assertions passed.`);
process.exit(0);
