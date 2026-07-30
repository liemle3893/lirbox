// ACCEPTANCE CHECK — the DoD gate must verify the run's PLAN-OF-RECORD alongside the frozen
// criteria, and a dead work item must never be recorded as a completed one.
//
// Concern. A DoD is frozen at scaffold time, BEFORE anything has read the repo, so it cannot name
// a work item that the phase planner invents at runtime. Two drift paths follow, and the baseline
// generator had a hole on both:
//   (a) SILENT SKIP — a worker defers/descopes its item. Every frozen criterion can still verify
//       MET, so DoDGate goes green on an implementation that is missing planned work. The frozen
//       criteria are a coarse PROXY for intent; the planner's own item list is the plan of record.
//   (b) DEAD WORKER — `parallel()` yields null for an agent that died after retries, and the
//       baseline pushed that null straight into itemResults as `summary: ''`. No throw, no log:
//       the item vanished from the record and the run walked on to a gate that could pass without
//       it. This half is DETERMINISTIC — it needs a guard in the conductor, never a judge.
//
// The fix verifies both views IN PARALLEL inside DoDGate (one round, no added wall-clock) and
// UNIONS their unmet rows, so the existing replan / fix / stall-detection / escalate machinery
// routes on criteria and plan items alike. Structural markers the emitted conductor must carry —
// the whetstone fixer reads this check as the contract, so these names are the interface:
//   • `PLAN_KEYS`  — the work-phase result keys whose planners commit to items.
//   • `goalItems`  — the plan-of-record, read from the PERSISTED plans (never re-decomposed).
//   • one `parallel([...])` dispatching BOTH `dodgate:verify-*` and `dodgate:goals-*`.
//   • `allUnmet()` — the union; `dodUnmet()` alone must not drive replan / stall / escalate.
//   • `goalsAnswered` — a dead plan verifier must not read as "nothing unmet".
//   • `deadItems` — the null-result guard, hard-failing BEFORE itemResults is written.
//
// Baseline (origin/main @ d5e5b25 — DoDGate verifies criteria only, null items recorded silently):
// assertions 1-7 FAIL → exit 1 (RED). Verified 2026-07-30 by running this file against that
// generator. After the fix: all hold → exit 0.
//
// RED-for-the-right-reason: the generator still runs and emits a parseable conductor on baseline
// (assertion 8 stays green there) — the failures are MISSING structure, not a crash.
//
// Locked (evals/**): the whetstone fixer may NEVER edit this file.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(HERE, '..', '..');                       // .../skills/conductor
const REPO = resolve(SKILL_DIR, '..', '..', '..', '..');           // repo root
// GEN_OVERRIDE lets this check be pointed at a baseline copy of the generator to prove it goes RED.
const GEN = process.env.GEN_OVERRIDE || resolve(REPO, 'plugins/lirbox/skills/conductor/scripts/scaffold-workflow.cjs');

const TMP = mkdtempSync(join(tmpdir(), 'dodgate-plan-check-'));

// --- fixtures the check writes itself (never under evals/fixtures) ---
const promptsFile = join(TMP, 'prompts.json');
writeFileSync(promptsFile, JSON.stringify({ Analyze: 'Survey the code.', Implement: 'Do the work.' }));

const dodFile = join(TMP, 'dod.json');           // mixed checkable + judged
writeFileSync(dodFile, JSON.stringify({ criteria: [
  { id: 'ac1', text: 'unit tests green', tier: 'checkable', check: 'yarn test' },
  { id: 'ac2', text: 'error message is clear', tier: 'judged' },
] }));

// Generate to a file and read it back. Returns the emitted source, or '' if generation failed.
function emit(label, extraArgs) {
  const outFile = join(TMP, label + '.js');
  try {
    execFileSync('node', [GEN, '--name', label, '--out', outFile, '--force', '--prompts-file', promptsFile, ...extraArgs],
      { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch { return ''; }
  try { return readFileSync(outFile, 'utf8'); } catch { return ''; }
}

// Compile as the async function BODY the Workflow runtime wraps the script in. NOT `node --check`,
// which is vacuous here: it stops validating after the first ESM statement and every emitted script
// opens with `export const meta`, so a syntax error in the executing body passes cleanly.
function parsesAsWorkflowBody(src) {
  const f = join(TMP, 'probe.cjs');
  writeFileSync(f, 'const s=require("fs").readFileSync(process.argv[1],"utf8").replace(/^export const meta/m,"const meta");'
    + 'const AF=Object.getPrototypeOf(async function(){}).constructor;'
    + 'new AF("args","log","phase","agent","parallel","pipeline","budget","workflow",s);');
  const target = join(TMP, 'probe-target.js');
  writeFileSync(target, src);
  try { execFileSync('node', [f, target], { stdio: 'ignore' }); return true; } catch { return false; }
}

const results = [];
function ok(pass, label) {
  results.push({ pass, label });
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${label}`);
}

// --- main generation: delivery tier, two plan-fanout work phases, DoD gate present ---
const src = emit('dod-plan', ['--phases', 'Analyze,Implement', '--profile', 'delivery', '--dod-file', dodFile]);
const gateBody = src.slice(src.indexOf("if (done.has('DoDGate'))"));

// 1. the work-phase keys whose planners commit to items are baked in
ok(/const PLAN_KEYS\s*=\s*\[/.test(src) && /"analyze"/.test(src) && /"implement"/.test(src),
  '1. `PLAN_KEYS` names every plan-fanout work phase key');

// 2. the plan-of-record is READ from the persisted plans, never re-decomposed at gate time
ok(/goalItems/.test(gateBody) && /PLAN_KEYS[\s\S]{0,80}Plan\b/.test(gateBody),
  '2. `goalItems` derived from the PERSISTED per-phase plans (no re-decomposition in the gate)');

// 3. BOTH verifiers dispatch inside ONE parallel() — slice from its opening to the line that closes
//    the thunk array, so two sequential awaits could not satisfy this.
const parStart = gateBody.indexOf('await parallel([');
const afterPar = parStart === -1 ? '' : gateBody.slice(parStart);
const parEnd = afterPar.search(/^\s*\]\)\s*$/m);
const parBlock = parStart === -1 || parEnd === -1 ? '' : afterPar.slice(0, parEnd);
ok(/dodgate:verify-/.test(parBlock) && /dodgate:goals-/.test(parBlock),
  '3. the criteria verifier and the plan verifier run in ONE parallel() (no added wall-clock)');

// 4. the gate's unmet set is the UNION of both views
ok(/allUnmet\s*=\s*\(\)\s*=>\s*\[\s*\.\.\.dodUnmet\(\)\s*,\s*\.\.\.goalUnmet\(\)\s*\]/.test(gateBody),
  '4. `allUnmet()` unions the criteria verdicts with the plan-item verdicts');

// 5. replan / stall / escalate all route on the union, never on dodUnmet() alone
ok(!/const unmet = dodUnmet\(\)/.test(gateBody)
  && !/unmet: dodUnmet\(\)/.test(gateBody)
  && !/unmetKey = dodUnmet\(\)/.test(gateBody),
  '5. replan / stall-detection / escalate consume allUnmet(), not dodUnmet() alone');

// 6. a dead plan verifier must not read as "nothing unmet"
ok(/goalsAnswered/.test(gateBody) && /goalsAnswered\s*&&/.test(gateBody),
  '6. `goalsAnswered` blocks a pass when the plan verifier returned no verdicts');

// 7. dead-worker guard: a null result must never be recorded as a COMPLETED item.
//
// RE-STATED 2026-07-30, and deliberately narrowed. This assertion originally read "a null
// (dead-worker) item result hard-fails the phase", matching the crude guard that shipped with this
// check: `deadItems` + an unconditional `throw`. The fan-out reporting cluster then replaced that
// with the shape the backlog had specified all along — a dead item is recorded ok:false and noted in
// `results.coverage`, and only a level where NOTHING landed still throws. The old wording kept
// passing on a substring match (`deadItems` near some `throw`) while no longer describing what runs,
// which is a check that has stopped measuring its own claim.
//
// So this now asserts the invariant that actually survives the redesign and is the reason the
// concern existed: every item record carries an explicit `ok` flag that STARTS false, so a worker
// that never returned cannot be indistinguishable from one that finished. The full behavioural
// contract — coverage note, partial status, non-fatal — belongs to its own frozen check,
// dead-item-worker-recorded-as-done.check.mjs; this one only guards the flag's existence and
// default, so the two do not drift into asserting the same thing twice.
const itemRecord = src.match(/return \{ id: it\.id, title: it\.title, ok: [^}]*\}/);
ok(/\bok: false\b/.test(src) && itemRecord !== null && /\bok:/.test(itemRecord[0]),
  '7. every fan-out item record carries an `ok` flag defaulting to false (a dead worker is never a done item)');

// 8. RIGHT-REASON guard: the generator still runs and emits a parseable conductor (the failures
//    above are MISSING structure, not a generator crash / unparseable output).
ok(src !== '' && parsesAsWorkflowBody(src),
  '8. generator still runs and emits a conductor that compiles as a workflow body');

// 9. --no-plan-fanout has no runtime planner, so there IS no plan-of-record: the second verifier
//    and its whole prompt must not be emitted at all (dead prompt text is tokens paid per run).
const serial = emit('dod-plan-serial', ['--phases', 'Work', '--profile', 'delivery', '--dod-file', dodFile, '--no-plan-fanout']);
ok(serial !== '' && !/dodgate:goals/.test(serial) && !/PLAN_KEYS/.test(serial),
  '9. --no-plan-fanout emits no plan verifier and no PLAN_KEYS');

rmSync(TMP, { recursive: true, force: true });

const failed = results.filter((r) => !r.pass);
if (failed.length) {
  console.error(`\ncheck RED: ${failed.length}/${results.length} assertion(s) failed — DoDGate verifies the frozen criteria only; a skipped or dead work item passes the gate unseen.`);
  process.exit(1);
}
console.log(`\ncheck GREEN: all ${results.length} plan-of-record assertions passed.`);
process.exit(0);
