// FLOOR (characterization) — PASSES on baseline; pins conductor's RESUME PROTOCOL by EXECUTING the
// generated conductor, not by reading it.
//
// WHY THIS EXISTS, and why it executes rather than scans. "Does conductor resume after an
// interruption?" is the single strongest claim the skill makes, and it had never been tested — it was
// only ever described in references/workflow-runtime.md §4. It is also the wrong shape for a paid
// benchmark: resume is a DETERMINISTIC property, identical on every run, so a graded suite is the
// most expensive possible way to observe it. One free test settles it permanently.
//
// Every other conductor check greps the emitted text. That is exactly how this repo has shipped
// false greens (a check surviving the removal of the behaviour it named). So this test runs the real
// generated conductor with stubbed Workflow globals and observes WHICH WORKERS ACTUALLY RAN.
//
//   TRAP, found while writing this and worth keeping written down: `phase('Setup')` is emitted
//   OUTSIDE the `if (done.has('Setup'))` guard, so a skipped phase still announces itself. Asserting
//   on phase() calls would pass whether or not resume worked — a false green. The load-bearing
//   signal is the agent LABELS, because a skipped phase dispatches no worker.
//
// PINS (from references/workflow-runtime.md §4 and §6):
//   1. fresh run (no args)          → every phase's worker runs, Setup included.
//   2. args.phasesDone = [Setup]    → the Setup worker does NOT run; later phases still do.
//   3. args.phasesDone = [Setup,Work] → only the remaining phase's workers run (cumulative skip).
//   4. at-least-once: a phase absent from phasesDone ALWAYS re-runs. The checkpoint is written
//      AFTER the side effect, so a crash between them leaves the phase unrecorded and it must
//      repeat — bodies are idempotent by contract, never skipped on a guess.
//   5. FORGED STATE FAILS LOUDLY — the security property. phasesDone must be a contiguous prefix of
//      the phase order; a non-contiguous set (skipping Work) and an unknown phase name must BOTH
//      throw, so a corrupt or hand-edited state file can never silently skip Setup.
//
// Determinism: no network, no models, no filesystem beyond a temp dir. Every agent() is stubbed and
// returns a fixed permissive object. Generated with --no-plan-fanout so the work phase is one serial
// worker; the resume guard sits above fan-out and is identical either way.
// Locked (evals/**): the whetstone fixer may NEVER edit this file.
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL = resolve(HERE, '..', '..');
const GEN = process.env.GEN_OVERRIDE || join(SKILL, 'scripts', 'scaffold-workflow.cjs');

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) failures++; };

const tmp = mkdtempSync(join(tmpdir(), 'conductor-resume-'));
const out = join(tmp, 'probe.js');
execFileSync('node', [GEN, '--name', 'resume-probe', '--phases', 'Work,Review', '--no-plan-fanout', '--out', out, '--force'], { stdio: 'pipe' });
const src = readFileSync(out, 'utf8').replace(/^export const meta/m, 'const meta');

// Execute the real conductor with stubbed Workflow globals; collect the labels of dispatched workers.
//
// A Workflow script may use top-level `return` (the real runtime wraps it in an async function), so
// it is not a legal ESM module as-emitted. It is wrapped in an async IIFE in a temp module and
// imported — real module semantics, real top-level await, and no `new Function`. Each run gets a
// fresh filename because the ESM loader caches by URL and would otherwise replay the first run.
let runSeq = 0;
async function runConductor(args) {
  const labels = [];
  globalThis.agent = async (_p, o) => {
    labels.push((o && o.label) || '(unlabelled)');
    // Permissive: satisfies the shapes the conductor reads without steering any branch.
    return { ok: true, ready: true, passed: true, verdict: 'PASS', summary: '', items: [], findings: [] };
  };
  globalThis.parallel = async (thunks) => Promise.all(thunks.map((f) => f()));
  globalThis.pipeline = async (items, ...stages) => {
    const acc = [];
    for (const it of items) { let v = it; for (const s of stages) v = await s(v, it, 0); acc.push(v); }
    return acc;
  };
  globalThis.phase = () => {};
  globalThis.log = () => {};
  globalThis.workflow = async () => ({});
  globalThis.args = args;
  globalThis.budget = { total: null, spent: () => 0, remaining: () => Infinity };

  const mod = join(tmp, `run-${runSeq++}.mjs`);
  writeFileSync(mod, `export default await (async () => {\n${src}\n})();\n`);
  await import(pathToFileURL(mod).href);
  return labels;
}

const threw = async (args) => { try { await runConductor(args); return null; } catch (e) { return e.message; } };

const fresh = await runConductor(undefined);
ok(fresh.some((l) => /^setup/i.test(l)), '1. fresh run dispatches the Setup worker');
ok(fresh.length >= 3, `1b. fresh run dispatches every phase's worker (got ${fresh.length}: ${fresh.join(', ')})`);

const afterSetup = await runConductor({ phasesDone: ['Setup'] });
ok(!afterSetup.some((l) => /^setup/i.test(l)), '2. phasesDone=[Setup] skips the Setup worker');
ok(afterSetup.some((l) => /^work/i.test(l)), '2b. phasesDone=[Setup] still runs the Work worker');

const afterWork = await runConductor({ phasesDone: ['Setup', 'Work'] });
ok(!afterWork.some((l) => /^(setup|work)/i.test(l)), '3. phasesDone=[Setup,Work] skips both — the skip is cumulative');
ok(afterWork.length < afterSetup.length && afterSetup.length < fresh.length,
  `3b. each additional done phase dispatches strictly fewer workers (${fresh.length} → ${afterSetup.length} → ${afterWork.length})`);

// 4. At-least-once. Work is absent from phasesDone, so it MUST re-run even though Setup completed —
// the checkpoint lands after the side effect, so an interrupted phase is never recorded as done.
ok(afterSetup.filter((l) => /^work/i.test(l)).length > 0,
  '4. at-least-once: a phase absent from phasesDone re-runs rather than being assumed complete');

// 5. Forged state must fail loudly, not silently skip Setup.
const nonContiguous = await threw({ phasesDone: ['Setup', 'Review'] });
ok(!!nonContiguous && /contiguous prefix/i.test(nonContiguous),
  '5. non-contiguous phasesDone (skipping Work) throws, naming the contiguous-prefix contract');
const unknownPhase = await threw({ phasesDone: ['Nonexistent'] });
ok(!!unknownPhase && /unknown phase/i.test(unknownPhase),
  '5b. an unknown phase name in phasesDone throws');
const forgedSkipsSetup = await threw({ phasesDone: ['Work'] });
ok(!!forgedSkipsSetup,
  '5c. phasesDone=[Work] without Setup throws — a forged state can never skip Setup');

rmSync(tmp, { recursive: true, force: true });

if (failures) {
  console.error(`\n${failures} assertion(s) FAILED — the resume protocol is broken. A run interrupted mid-flight will either redo completed work, silently skip work it never did, or trust a forged state file. See references/workflow-runtime.md §4.`);
  process.exit(1);
}
console.log('\nresume protocol: ok (executed, not scanned)');
