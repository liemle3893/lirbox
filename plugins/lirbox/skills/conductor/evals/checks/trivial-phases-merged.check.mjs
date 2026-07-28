// ACCEPTANCE CHECK (RED on baseline) — cheap and no-op phases must not each pay a full phase slot
// plus a dedicated checkpoint worker.
//
// Concern (feedback/conductor.jsonl → trivial-phases-pay-full-phase-and-checkpoint-cost): measured
// on the delivery golden snapshot, a run emits 14 phases, 26 static agent() sites and 15
// checkpoint() calls — and checkpoint() is itself one of those 26 sites, so it is ONE worker
// definition firing fifteen times. The runtime floor is therefore ~40 subagent spin-ups before any
// gate round, panel dimension or plan item multiplies it, and roughly a third of that is workers
// whose entire job is `cat > state.json`. The phases paying that toll are not equal: Setup is a
// worktree add plus a symlink, DoDBaseline runs N commands, PR pushes and calls gh, and Brief /
// TicketUpdate are guarded no-ops (`if (!TICKET) log(...)`) on any non-ticket run.
//
// Frozen contract:
//   1. The delivery profile emits at most 9 `await checkpoint(` calls.
//   2. Specifically, the CHEAP phases stop buying a dedicated checkpoint worker: Setup (a worktree
//      add plus a symlink), Brief (one tracker call), Verify and ReVerify (run the suite), PR
//      (push + gh) and TicketUpdate (one tracker call) must emit no `checkpoint('<self>')`.
//   3. The EXPENSIVE phases keep theirs — DoDBaseline, RED, the work phase, PathGap, CodeGate,
//      DocsGate, DoDGate and Writeup must each still checkpoint. This fences the fix against simply
//      deleting checkpoints wholesale to hit the budget.
//
//      DoDBaseline is deliberately EXPENSIVE despite running in seconds: it measures each checkable
//      criterion BEFORE any work, so re-running it on a resume after work had landed would record a
//      post-work state as the baseline and destroy the honesty check. Cheapness to re-RUN is not the
//      test; cheapness to re-run CORRECTLY is.
//
// WHY this attacks checkpoints rather than merging the phases: the backlog item proposed collapsing
// Setup+DoDBaseline+Brief into one Prepare phase and folding ReVerify into the code-quality gate.
// Both are blocked by LOCKED frozen checks that the loop may not edit and the floor runs every
// round — frontend-gate-phase.check.mjs asserts phase('ReVerify') exists and orders before
// FrontendGate, and dod-gate.check.mjs asserts phase('DoDBaseline') exists before the work phase
// AND that a judged-only DoD emits none (a contract a merged Prepare phase could not express). A
// check demanding those phases disappear would contradict two green checks, so every fix satisfying
// it would fail the floor and be reverted. The phase-merge idea needs those contracts renegotiated
// first, by hand; it is out of scope here.
//
// The saving is real without the merge: 14 phases each buy a phase worker AND a checkpoint worker,
// and dropping the 6 cheap ones removes 6 subagent dispatches per delivery run.
//
// Resume stays correct: `done` is an in-memory Set that still accumulates every completed phase, so
// the NEXT checkpoint persists a phasesDone that includes the un-checkpointed ones — the
// contiguous-prefix resume guard still holds. The only cost is that a crash between a cheap phase
// and the next checkpoint re-runs that cheap phase, which is precisely the intended trade (every
// phase is already required to be idempotent).
// Baseline (RED): delivery emits 15 checkpoint workers across 14 phases, and every cheap phase
// buys one. Assertions 1 and 2 fail.
//
// HOW this is judged: by GENERATING a delivery script and reading the emitted text — no LLM, no
// network. The assertions target which phases emit `checkpoint('<self>')` and the total count, not
// any particular spelling of the fix.
//
// Exit codes: 0 = GREEN (contract holds), 1 = RED (contract violated), 2 = harness error
// (generation failed / the script could not be produced) so a RED verdict never means "the
// generator broke".
//
// Locked (evals/**): the whetstone fixer may NEVER edit this file.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL = resolve(HERE, '..', '..');
const GEN = join(SKILL, 'scripts', 'scaffold-workflow.cjs');

const tmp = mkdtempSync(join(tmpdir(), 'trivial-phases-'));
const fail = [];

function harnessDie(msg) {
  console.error('HARNESS ERROR: ' + msg);
  rmSync(tmp, { recursive: true, force: true });
  process.exit(2);
}

function generate(label, extra) {
  const out = join(tmp, `wf-${label}.js`);
  try {
    execFileSync('node', [GEN, '--name', `t-${label}`, '--out', out, '--force', ...extra], { encoding: 'utf8' });
  } catch (e) {
    harnessDie(`generation failed for ${label}: ${(e.stdout || '') + (e.stderr || e.message)}`);
  }
  try {
    return readFileSync(out, 'utf8');
  } catch (e) {
    harnessDie(`emitted script unreadable for ${label}: ${e.message}`);
  }
}

// meta.phases titles, in order.
function phasesOf(src) {
  const m = src.match(/export const meta = \{[\s\S]*?\n\}/);
  if (!m) harnessDie('no meta block in the emitted script');
  return [...m[0].matchAll(/\{ title: '([^']+)' \}/g)].map((x) => x[1]);
}

const prompts = join(tmp, 'prompts.json');
writeFileSync(prompts, JSON.stringify({ Implement: 'Do the work.' }));

const dod = join(tmp, 'dod.json');
writeFileSync(dod, JSON.stringify({
  criteria: [{ id: 'c1', text: 'suite green', tier: 'checkable', check: 'true' }],
}));

// ---- A. delivery profile -----------------------------------------------------------------------
const delivery = generate('delivery', [
  '--profile', 'delivery', '--phases', 'Implement', '--prompts-file', prompts, '--dod-file', dod,
]);
const dPhases = phasesOf(delivery);

// 1. checkpoint budget
const checkpoints = (delivery.match(/await checkpoint\(/g) || []).length;
if (checkpoints > 9) {
  fail.push(`delivery emits ${checkpoints} checkpoint workers (budget: <= 9)`);
}

// 2. cheap phases buy no checkpoint worker
const CHEAP = ['Setup', 'Brief', 'Verify', 'ReVerify', 'PR', 'TicketUpdate'];
for (const p of CHEAP) {
  if (!dPhases.includes(p)) continue;               // phase absent under this flag set — nothing to assert
  if (delivery.includes(`checkpoint('${p}')`)) {
    fail.push(`cheap phase '${p}' still buys a dedicated checkpoint worker`);
  }
}

// 3. expensive phases keep theirs (fence against deleting checkpoints wholesale to hit the budget)
const EXPENSIVE = ['DoDBaseline', 'RED', 'Implement', 'PathGap', 'CodeGate', 'DocsGate', 'DoDGate', 'Writeup'];
for (const p of EXPENSIVE) {
  if (!dPhases.includes(p)) continue;
  if (!delivery.includes(`checkpoint('${p}')`)) {
    fail.push(`expensive phase '${p}' lost its checkpoint — redo cost there is exactly what a checkpoint is for`);
  }
}

rmSync(tmp, { recursive: true, force: true });

if (fail.length) {
  console.error('RED — cheap phases still buy dedicated checkpoint workers:');
  for (const f of fail) console.error('  - ' + f);
  console.error(`\n  delivery phases (${dPhases.length}): ${dPhases.join(' -> ')}`);

  process.exit(1);
}
console.log('GREEN — checkpoint toll is paid only where redo is expensive.');
process.exit(0);
