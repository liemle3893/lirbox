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
// Frozen contract (see the backlog item text):
//   1. The front matter merges — Setup + DoDBaseline + Brief become ONE phase. They consume none
//      of each other's output (Brief hits the tracker and never touches the worktree).
//   2. ReVerify is folded into the code-quality gate's exit condition rather than being its own
//      phase: CodeGate already cannot pass without buildExit === 0 (the build-evidence contract),
//      so a separate phase re-proves what the prior gate just proved.
//   3. The delivery profile emits at most 9 `await checkpoint(` calls (a checkpoint exists to avoid
//      re-running EXPENSIVE work; a seconds-cheap idempotent phase does not need one).
// NOT asserted, and deliberately so: the backlog item originally claimed Brief/TicketUpdate should
// not be EMITTED on a non-ticket run because the generator knows at scaffold time. It does not —
// `TICKET` is read from `args.ticket` at LAUNCH (`const TICKET = (args && args.ticket) ? ... : null`),
// so a scaffold cannot know whether a ticket will be supplied, and the runtime `if (!TICKET)` guard
// is the correct design. A bare scaffold already emits only Setup -> Implement. That claim was
// dropped from the contract rather than frozen into a check that would push the loop toward a
// wrong fix.
//
// Phases that stay separate (expensive to redo, which is what a checkpoint is FOR): Implement, RED,
// CodeGate, PathGap, DoDGate, Writeup, DocsGate. The principle is self-limiting — it never merges
// anything expensive — and the generator already REQUIRES every phase to be idempotent
// (at-least-once on resume), which is exactly what makes merging the cheap ones safe.
//
// Baseline (RED): delivery emits Setup, DoDBaseline and Brief as three separate phases, emits
// ReVerify as its own phase, and emits 15 checkpoint workers across 14 phases. All three
// assertions fail.
//
// HOW this is judged: by GENERATING scripts and reading the emitted text — no LLM, no network. The
// assertions target the emitted phase list and checkpoint count, not any particular spelling of the
// fix, so a fix is free to name the merged phase whatever it likes as long as the three originals
// stop being separate phases.
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

// 1. the front matter merged — Setup/DoDBaseline/Brief must not all survive as separate phases
const frontSurvivors = ['Setup', 'DoDBaseline', 'Brief'].filter((p) => dPhases.includes(p));
if (frontSurvivors.length > 1) {
  fail.push(`front matter not merged: ${frontSurvivors.join(', ')} are still separate phases (${dPhases.length} phases total)`);
}

// 2. ReVerify folded into the gate, not its own phase
if (dPhases.includes('ReVerify')) {
  fail.push('ReVerify is still a separate phase — it re-proves what CodeGate\'s buildExit===0 already established');
}

// 3. checkpoint budget
const checkpoints = (delivery.match(/await checkpoint\(/g) || []).length;
if (checkpoints > 9) {
  fail.push(`delivery emits ${checkpoints} checkpoint workers (budget: <= 9)`);
}

rmSync(tmp, { recursive: true, force: true });

if (fail.length) {
  console.error('RED — trivial phases still pay full phase + checkpoint cost:');
  for (const f of fail) console.error('  - ' + f);
  console.error(`\n  delivery phases (${dPhases.length}): ${dPhases.join(' -> ')}`);

  process.exit(1);
}
console.log('GREEN — cheap/no-op phases are merged and the checkpoint budget holds.');
process.exit(0);
