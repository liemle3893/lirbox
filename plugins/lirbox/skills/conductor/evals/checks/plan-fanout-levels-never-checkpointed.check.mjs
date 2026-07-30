// ACCEPTANCE CHECK — the plan fan-out must persist per-LEVEL progress, so a failure part-way through
// a phase does not re-dispatch the levels that already integrated.
//
// Concern (feedback/conductor.jsonl -> plan-fanout-levels-never-checkpointed). planFanoutBody()
// checkpoints exactly once, right after decomposition ("a resume never re-decomposes"). The
// `for (let li = 0; li < levels.length; li++)` loop that follows writes NOTHING durable: itemResults
// accumulates in memory and `results.<key>` lands only after the LAST level returns. So a level-3
// failure discards levels 1-2 entirely — on resume the phase re-runs setup, re-dispatches every
// level-1 and level-2 worker, and re-integrates commits that are ALREADY on BRANCH. Those workers are
// pointed at a base that already contains their output, so they either no-op (pure waste) or
// re-apply the change and conflict. This is the dominant token cost of a failed fan-out phase, and it
// compounds with the new throw sites added for dead workers: every retry pays for the whole phase.
//
// The phase-level `done` set cannot express this — its granularity is the phase, and the fan-out's
// real unit of progress is the dependency LEVEL.
//
// Structural contract (the fixer reads this check as the spec):
//   * after each level's integrate succeeds, checkpoint per-level progress with per-item outcomes —
//     e.g. `results.<key>Levels = [{ level, items: [{ id, ok, summary }] }]`.
//   * guard the level loop on it, so a resume SKIPS fully-integrated levels.
//   * the per-item `ok` flag is the SAME field dead-item-worker-recorded-as-done needs, so the two
//     land as one shape rather than two overlapping ones.
//
// Baseline: RED. Nothing about level 1 survives the abort, so the resumed run re-dispatches it in
// full (assertions 3-4 fail).
//
// RED-for-the-right-reason: assertions 0-2 (generation parses; level 1 ran and integrated; the
// level-2 failure aborts) stay green on baseline — a RED verdict is the MISSING per-level durability,
// not generator breakage.
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
const TMP = mkdtempSync(join(tmpdir(), 'level-ckpt-check-'));

const PHASE = 'Implement';
const KEY = 'implement';
const promptsFile = join(TMP, 'prompts.json');
writeFileSync(promptsFile, JSON.stringify({ [PHASE]: 'Do the work.' }));

// i2 depends on i1 => TWO dependency levels, one item each. Level 1 succeeds; level 2's integrate
// fails, which is the abort every fan-out phase can hit in the wild.
const PLAN_ITEMS = [
  { id: 'i1', title: 'first item', prompt: 'do first', dependsOn: [] },
  { id: 'i2', title: 'second item', prompt: 'do second', dependsOn: ['i1'] },
];

const results = [];
const ok = (pass, label) => { results.push({ pass, label }); console.log(`${pass ? 'PASS' : 'FAIL'}: ${label}`); };
const bail = (code, msg) => { console.error(msg); rmSync(TMP, { recursive: true, force: true }); process.exit(code); };

// ---------- preconditions ----------
const run = generate({ gen: GEN, repo: REPO, tmp: TMP, name: 'levelckpt', argv: ['--phases', PHASE, '--prompts-file', promptsFile] });
if (run.code !== 0 || !parses(run.file)) {
  bail(2, `PRECONDITION FAILED: generation exits ${run.code} or does not parse — unrelated generator breakage.\n${run.out}`);
}
const src = readFileSync(run.file, 'utf8');
console.log('PASS: 0. precondition — generation exits 0 and the body compiles');

const plan = ({ label, base }) => (label === `plan:${PHASE}` ? { ...base, items: PLAN_ITEMS } : undefined);

// --- run 1: level 1 fully succeeds, level 2's integrate reports merged:false -> abort ---
let first;
try {
  first = await runBody(src, (ctx) => {
    const planned = plan(ctx);
    if (planned) return planned;
    if (ctx.label === `${KEY}:integrate-l2`) return { ...ctx.base, merged: false, summary: 'simulated level-2 integrate failure' };
    return undefined;
  });
} catch (e) { bail(2, `PRECONDITION FAILED: harness could not execute the body: ${e && (e.stack || e.message)}`); }

const ranL1 = first.calls.some((c) => c.label === `${KEY}:i1`);
const integratedL1 = first.calls.some((c) => c.label === `${KEY}:integrate-l1`);
if (!ranL1 || !integratedL1) {
  bail(2, `PRECONDITION FAILED: level 1 did not run+integrate (i1=${ranL1}, integrate-l1=${integratedL1}) — `
    + `the two-level fan-out shape changed; this check's premise is gone.`);
}
console.log('PASS: 1. precondition — level 1 dispatched its worker and integrated');

if (first.error === null) {
  bail(2, 'PRECONDITION FAILED: a level-2 integrate reporting merged:false did not abort the phase — '
    + 'the failure this check resumes FROM no longer happens, so the resume half is untestable.');
}
console.log('PASS: 2. precondition — the level-2 integrate failure aborts the phase');

// ---------- the RED assertions ----------

// 3. level 1's completion is DURABLE: some checkpoint payload written before the abort records that
//    level 1 integrated, with its per-item outcome. Without this there is nothing for a resume to
//    read, so the resume in assertion 4 cannot possibly skip it.
const payloads = first.checkpoints.map((c) => c.payload).filter(Boolean);
const levelProgress = payloads.flatMap((p) => Object.entries((p && p.results) || {})
  .filter(([k]) => /Levels$/.test(k))
  .flatMap(([, v]) => (Array.isArray(v) ? v : [])));
ok(levelProgress.some((l) => l && (l.level === 1 || l.level === '1')
  && Array.isArray(l.items) && l.items.some((it) => it && it.id === 'i1')),
  '3. a checkpoint persists level 1 as integrated, with its per-item outcome, BEFORE the abort');

// 4. the payoff: resuming from that persisted state must NOT re-dispatch level 1's worker.
const last = payloads.length ? payloads[payloads.length - 1] : null;
if (!last) {
  ok(false, '4. resuming from the persisted state does not re-dispatch level 1 (no checkpoint payload to resume from)');
} else {
  let second;
  try {
    second = await runBody(src, plan, { phasesDone: last.phasesDone || [], results: last.results || {} });
  } catch (e) { bail(2, `PRECONDITION FAILED: harness could not execute the resume: ${e && (e.stack || e.message)}`); }
  const redispatched = second.calls.filter((c) => c.label === `${KEY}:i1`);
  ok(redispatched.length === 0,
    `4. resuming from the persisted state does not re-dispatch level 1's worker `
    + `(saw ${redispatched.length} '${KEY}:i1' dispatch(es))`);
}

rmSync(TMP, { recursive: true, force: true });

const failed = results.filter((r) => !r.pass);
if (failed.length) {
  console.error(`\ncheck RED: ${failed.length}/${results.length} assertion(s) failed — the fan-out persists the `
    + `plan but not per-level progress, so a mid-phase failure re-dispatches every completed level.`);
  process.exit(1);
}
console.log(`\ncheck GREEN: all ${results.length} per-level durability assertions passed.`);
process.exit(0);
