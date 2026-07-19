// ACCEPTANCE CHECK (RED on baseline) — scaffold-workflow.cjs must wrap the DoD gate in a
// bounded plan-execute-verify OUTER loop, not a single pass that throws.
//
// Concern (feedback/conductor.jsonl → dodgate-replan-outer-loop): today the emitted DoDGate runs
// its 3 in-phase fix rounds and then, if criteria remain unmet, does an unconditional
// `throw new Error('DoDGate failed: DoD not fully met ...')` — the run dies, there is no outer
// verify-loop. The generator must instead emit, around the Implement..DoDGate sequence, a bounded
// outer loop that on gate failure re-plans (a Replan worker fed the exact unmet criteria) and
// re-runs execution + the gate, with:
//   (a) an explicit ATTEMPT CAP (default 2), and a Replan step that runs on a non-first attempt;
//   (b) STALL DETECTION — if the unmet-criteria set is unchanged between two consecutive gate
//       runs, stop early;
//   (c) every non-green exit ESCALATES — writes state `status: 'escalated'` carrying the unmet
//       list — instead of only throwing.
//
// Because the whetstone fixer reads this check as the contract, it dictates the stable structural
// markers the emitted conductor .js must carry (mirroring dod-gate.check's DOD_CRITERIA / DoDGate
// convention). The fixer is free in everything else, but these names/shapes are the interface:
//   • `DOD_MAX_ATTEMPTS`            — the outer attempt-cap constant (default 2).
//   • an outer loop whose counter `attempt` is bounded by `DOD_MAX_ATTEMPTS`.
//   • a Replan worker (label/phase/comment matching /replan/i) that runs on gate failure.
//   • `prevUnmetKey` — the serialized unmet-id set from the previous gate run — compared to the
//     current run to detect a STALL (matched via /prevUnmetKey/ + /stall/i) and stop early.
//   • `status: 'escalated'` — the escalated state written on any non-green exit.
//
// Baseline (single-pass DoDGate + throw, no outer loop): assertions 1–5 FAIL → exit 1 (RED).
// After the fix (bounded replan/attempt loop + stall early-stop + escalated state): all hold → exit 0.
//
// RED-for-the-right-reason: the generator still RUNS and emits a parseable conductor (assertion 6
// stays green on baseline) — the failures are the MISSING outer-loop structure, not a crash.
//
// Locked (evals/**): the whetstone fixer may NEVER edit this file.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(HERE, '..', '..');                       // .../skills/conductor
const REPO = resolve(SKILL_DIR, '..', '..', '..', '..');           // repo root
const GEN = resolve(REPO, 'plugins/lirbox/skills/conductor/scripts/scaffold-workflow.cjs');

const TMP = mkdtempSync(join(tmpdir(), 'dodgate-replan-check-'));

// --- fixtures the check writes itself (never under evals/fixtures) ---
const promptsFile = join(TMP, 'prompts.json');
writeFileSync(promptsFile, JSON.stringify({ Implement: 'Do the work.' }));

const dodFile = join(TMP, 'dod.json');           // mixed checkable + judged
writeFileSync(dodFile, JSON.stringify({ criteria: [
  { id: 'ac1', text: 'unit tests green', tier: 'checkable', check: 'yarn test' },
  { id: 'ac2', text: 'error message is clear', tier: 'judged' },
] }));

// Run the generator; return { code, out }. code 0 = success, non-zero = rejection/error.
function gen(extraArgs) {
  try {
    const out = execFileSync('node', [GEN, ...extraArgs], { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out };
  } catch (e) {
    return { code: typeof e.status === 'number' ? e.status : 1, out: (e.stdout || '') + (e.stderr || '') };
  }
}

// Generate to a file and read it back. Returns the emitted source, or '' if generation failed.
function emit(label, extraArgs) {
  const outFile = join(TMP, label + '.js');
  const r = gen(['--name', label, '--out', outFile, '--force', '--prompts-file', promptsFile, ...extraArgs]);
  if (r.code !== 0) return '';
  try { return execFileSync('cat', [outFile], { encoding: 'utf8' }); } catch { return ''; }
}

// node --check on a string of source (written to disk) → true iff it parses.
function nodeCheck(src) {
  const f = join(TMP, 'nodecheck.js');
  writeFileSync(f, src);
  try { execFileSync('node', ['--check', f], { stdio: 'ignore' }); return true; }
  catch { return false; }
}

const results = [];
function ok(pass, label) {
  results.push({ pass, label });
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${label}`);
}

// --- main generation: DoD gate + Implement work phase + Writeup/PR present (needs --pr) ---
const src = emit('dod-outer', ['--phases', 'Implement', '--pr', '--dod-file', dodFile]);

// 1. attempt-cap constant baked in (default 2)
ok(/const DOD_MAX_ATTEMPTS\s*=/.test(src),
  '1. `const DOD_MAX_ATTEMPTS =` (outer attempt-cap constant) baked into the conductor');

// 2. bounded outer loop keyed on an `attempt` counter and capped by DOD_MAX_ATTEMPTS
ok(/attempt\b[\s\S]{0,60}DOD_MAX_ATTEMPTS/.test(src),
  '2. an `attempt` loop bounded by DOD_MAX_ATTEMPTS wraps the gate (bounded outer replan loop)');

// 3. a Replan worker runs on gate failure (fed the unmet criteria)
ok(/replan/i.test(src),
  '3. a Replan step (label/phase matching /replan/i) is emitted for gate-failure re-planning');

// 4. stall detection: prior unmet-id set (`prevUnmetKey`) compared to stop early on no change
ok(/prevUnmetKey/.test(src) && /stall/i.test(src),
  '4. stall detection via `prevUnmetKey` (unchanged unmet-set → early stop)');

// 5. non-green exit escalates to state `status: 'escalated'` (not throw-only)
ok(/status:\s*'escalated'/.test(src),
  "5. gate failure sets state `status: 'escalated'` (with the unmet list) instead of only throwing");

// 6. RIGHT-REASON guard: the generator still emits a parseable conductor on baseline (the
//    failures above are the MISSING outer loop, not a generator crash / unparseable output).
ok(src !== '' && nodeCheck(src),
  '6. generator still runs and emits a `node --check`-clean conductor (RED is missing structure, not a crash)');

rmSync(TMP, { recursive: true, force: true });

const failed = results.filter((r) => !r.pass);
if (failed.length) {
  console.error(`\ncheck RED: ${failed.length}/${results.length} assertion(s) failed — DoDGate is single-pass + throw; no bounded replan/verify outer loop, no stall early-stop, no escalated state.`);
  process.exit(1);
}
console.log(`\ncheck GREEN: all ${results.length} outer-replan-loop assertions passed.`);
process.exit(0);
