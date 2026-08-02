// ACCEPTANCE CHECK — a run that dies mid-phase must leave a CLASSIFIED failure record on disk, and
// must still surface the original error.
//
// Concern (feedback/conductor.jsonl -> failure-record). Every throw site outside DoDGate aborts the
// Workflow with its message going only to the transcript. `SKILL.md` step 5 then stamps
// `status: failed` and discards the reason, so a later resume reads `{status, phasesDone}` and
// re-runs the failed phase with byte-identical inputs — straight back into the same wall. DoDGate
// already does the right thing (scaffold-workflow.cjs: persists `status:'escalated'` + `unmet[]`
// through the checkpoint writer, THEN throws); this check requires that pattern generalized to
// every other throw site, with a classification attached so a resume can route on it.
//
// Structural contract (the fixer reads this check as the spec):
//   * the phase body is wrapped so any throw is caught, a postmortem worker is dispatched (label
//     starting `postmortem`), and the failure is persisted before the error propagates.
//   * the persisted payload carries `failure` with at least a `kind` and a `reason`.
//   * the persisted `status` is terminal (`escalated`/`failed`), never left at `running`.
//   * the ORIGINAL error still propagates — a postmortem that dies or throws must not replace the
//     failure it was sent to explain, or the diagnostic layer becomes the thing hiding the diagnosis.
//   * every `phase('...')` call stays at COLUMN 0. Harbor's phase_order_matches_meta() matches
//     `^phase\('…'\)` with re.M, so indenting the body inside the wrap empties its match and
//     silently zeroes a tier-3 dimension. No tier-1/tier-2 net would catch that.
//
// Baseline: RED. There is no wrap, so no postmortem is dispatched (2), no failure block is
// persisted (3), and no terminal status is written (4).
//
// RED-for-the-right-reason: assertions 0-1 (generation parses; the run actually aborted with the
// injected failure) and 5-6 (original error propagates; phases at column 0) stay GREEN on baseline,
// so a RED verdict is the missing RECORD, not generator breakage.
//
// Locked (evals/**): the whetstone fixer may NEVER edit this file.
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { generate, parses, runBody, checkpointPayload } from './body-harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..', '..', '..', '..');
const GEN = process.env.GEN_OVERRIDE || resolve(REPO, 'plugins/lirbox/skills/conductor/scripts/scaffold-workflow.cjs');
const TMP = mkdtempSync(join(tmpdir(), 'failure-record-check-'));

const PHASE = 'Implement';
const promptsFile = join(TMP, 'prompts.json');
writeFileSync(promptsFile, JSON.stringify({ [PHASE]: 'Do the work.' }));

const PLAN_ITEMS = [
  { id: 'i1', title: 'first item', prompt: 'do first', dependsOn: [] },
  { id: 'i2', title: 'second item', prompt: 'do second', dependsOn: [] },
];
// The injected failure: level-1 worktree setup reports not-ready. Chosen because it aborts BEFORE
// any item worker runs, so the failure is deterministic and independent of gate/profile wiring.
const BOOM = 'boom-setup-not-ready';

const results = [];
const ok = (pass, msg) => { results.push({ pass, msg }); console.log(`${pass ? 'PASS' : 'FAIL'} ${msg}`); };

const gen = generate({ gen: GEN, repo: REPO, tmp: TMP, name: 'failrec', argv: ['--phases', PHASE, '--prompts-file', promptsFile] });
ok(gen.code === 0 && parses(gen.file), '0. scaffold generates and parses as a workflow body');

const src = readFileSync(gen.file, 'utf8');

const run = await runBody(src, ({ label, base }) => {
  if (/^plan:/.test(label)) return { ...base, items: PLAN_ITEMS };
  if (/:setup-l1$/.test(label)) return { ...base, ready: false, created: [], summary: BOOM };
  return undefined;
});

ok(!!run.error && String(run.error.message || run.error).includes(BOOM),
  '1. the injected setup failure actually aborts the run');

// 2. a postmortem worker ran after the failure.
const postmortem = run.calls.filter((c) => /^postmortem/.test(c.label));
ok(postmortem.length >= 1, '2. a postmortem worker is dispatched when a phase throws');

// 3. the persisted payload carries a classified failure block.
// Read straight off the dispatched prompts rather than via the harness's checkpoint filter: the
// failure record is deliberately NOT labelled `checkpoint:` (a checkpoint is progress persisted
// before moving on; this is written during an abort), so scanning every call is both correct here
// and independent of that label convention.
const payloads = run.calls.map((c) => checkpointPayload(c.prompt)).filter(Boolean);
const withFailure = payloads.filter((p) => p && p.failure && typeof p.failure === 'object');
ok(withFailure.some((p) => p.failure.kind && p.failure.reason),
  '3. a persisted payload carries failure.kind and failure.reason');

// 4. the run is persisted as terminal, not left mid-flight at running.
ok(withFailure.some((p) => p.status === 'escalated' || p.status === 'failed'),
  '4. the failure payload persists a terminal status (escalated/failed), not running');

// 5. the ORIGINAL error propagates — the postmortem never replaces it.
ok(!!run.error && String(run.error.message || run.error).includes(BOOM)
   && !/postmortem/i.test(String(run.error.message || run.error)),
  '5. the original error propagates unchanged (the postmortem does not mask it)');

// 6. Harbor's column-0 phase regex still matches after any wrapping.
const colZero = [...src.matchAll(/^phase\('([^']+)'\)/gm)].map((m) => m[1]);
const anyPhase = [...src.matchAll(/phase\('([^']+)'\)/g)].map((m) => m[1]);
ok(colZero.length > 0 && colZero.length === anyPhase.length,
  `6. every phase() call stays at column 0 (Harbor phase_order_matches_meta) — found ${colZero.length}/${anyPhase.length}`);

rmSync(TMP, { recursive: true, force: true });

const failed = results.filter((r) => !r.pass);
if (failed.length) {
  console.error(`\ncheck RED: ${failed.length}/${results.length} assertion(s) failed — a mid-phase failure leaves no `
    + `classified record on disk, so a resume re-runs the same phase with the same inputs and hits the same wall.`);
  process.exit(1);
}
console.log(`\ncheck GREEN: all ${results.length} failure-record assertions passed.`);
process.exit(0);
