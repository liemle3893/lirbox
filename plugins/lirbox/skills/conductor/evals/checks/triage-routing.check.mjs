// ACCEPTANCE CHECK — resume triage must be DATA, and it must not take a worker's word for the one
// route that skips the human.
//
// Concern (feedback/conductor.jsonl -> triage-routing). The routing that decides what a resume does
// with a persisted failure — relaunch, ask, or report — cannot live in SKILL.md prose: prose is
// ungateable, and this repo's rule is that every skill change lands behind a discrimination-gated
// frozen check. It moves into `scripts/triage.cjs`: state.json in, {action, kind, questions, hints}
// out, so SKILL.md step 4 only has to run it and obey.
//
// The sharp edge is `mechanical`. Every other route ends at a human; that one auto-relaunches, so a
// misclassification walks straight back into the wall this whole design exists to remove. The
// postmortem's `kind` is a worker self-report, and this repo already rules those untrusted
// (scripts/prompts/dodgate-verify.txt). So triage RE-DERIVES mechanical from the error text and
// treats an unrecognised error as a reason to ask, not to retry.
//
// Structural contract (the fixer reads this check as the spec):
//   * `node scripts/triage.cjs <state.json>` prints JSON with at least { action, kind }.
//   * action is one of relaunch | ask | report.
//   * mechanical + recognised error text + first sighting            -> relaunch
//   * mechanical + recognised error text + attempts >= 2             -> ask   (a repeat is not transient)
//   * mechanical CLAIMED but error text unrecognised                 -> ask   (self-report alone earns nothing)
//   * missing-info with open questions                               -> ask, carrying those questions
//   * convergence-stall                                              -> relaunch, carrying a hint keyed by phase
//   * unachievable-dod                                               -> report (no automated action; a human decides)
//   * no failure block at all                                        -> relaunch (an ordinary resume)
//
// Baseline: RED — scripts/triage.cjs does not exist, so every routing assertion fails.
//
// RED-for-the-right-reason: assertion 0 (the fixtures themselves are well-formed) stays GREEN on
// baseline, so a RED verdict is the MISSING router, not a broken check.
//
// Locked (evals/**): the whetstone fixer may NEVER edit this file.
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..', '..', '..', '..');
const TRIAGE = process.env.TRIAGE_OVERRIDE || resolve(REPO, 'plugins/lirbox/skills/conductor/scripts/triage.cjs');
const TMP = mkdtempSync(join(tmpdir(), 'triage-check-'));

const results = [];
const ok = (pass, msg) => { results.push({ pass, msg }); console.log(`${pass ? 'PASS' : 'FAIL'} ${msg}`); };

const state = (failure) => ({
  workflow: 'demo', status: failure ? 'escalated' : 'running',
  branch: 'wf/demo', worktree: '.worktrees/demo',
  phasesDone: ['Setup'], results: {}, ...(failure ? { failure } : {}),
});

// A real message from the generator's integrate guard — the mechanical pattern set must recognise it.
const MECHANICAL_ERR = 'Implement: level 1 did not integrate into wf/demo — merge conflict in src/a.ts';
const OPAQUE_ERR = 'Implement: the vendor API rejected the credential supplied in VENDOR_TOKEN';

const CASES = {
  'mechanical-first':    state({ phase: 'Implement', kind: 'mechanical', reason: 'integrate failed', evidence: MECHANICAL_ERR, signature: 'Implement::integrate', attempts: 1 }),
  'mechanical-repeat':   state({ phase: 'Implement', kind: 'mechanical', reason: 'integrate failed', evidence: MECHANICAL_ERR, signature: 'Implement::integrate', attempts: 2 }),
  'mechanical-claimed':  state({ phase: 'Implement', kind: 'mechanical', reason: 'looked transient', evidence: OPAQUE_ERR, signature: 'Implement::vendor', attempts: 1 }),
  'missing-info':        state({ phase: 'Implement', kind: 'missing-info', reason: 'no credential', evidence: OPAQUE_ERR, signature: 'Implement::vendor', attempts: 1, questions: [{ id: 'q1', question: 'Which token?', why: 'blocked' }] }),
  'convergence-stall':   state({ phase: 'CodeGate', kind: 'convergence-stall', reason: 'same finding 3 rounds', evidence: 'unresolved high: n+1 query', signature: 'CodeGate::high', attempts: 1, hint: 'the n+1 in repo.ts was attempted twice' }),
  'unachievable-dod':    state({ phase: 'DoDGate', kind: 'unachievable-dod', reason: 'criterion c3 unverifiable', evidence: 'unmet: c3', signature: 'DoDGate::c3', attempts: 1 }),
  'no-failure':          state(null),
};

ok(Object.values(CASES).every((s) => s && s.workflow === 'demo' && typeof s.status === 'string'),
  '0. routing fixtures are well-formed state objects');

const run = (name) => {
  const f = join(TMP, `${name}.json`);
  writeFileSync(f, JSON.stringify(CASES[name], null, 2));
  try {
    return JSON.parse(execFileSync('node', [TRIAGE, f], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  } catch { return null; }
};

const VALID = new Set(['relaunch', 'ask', 'report']);

const first = existsSync(TRIAGE) ? run('mechanical-first') : null;
ok(!!first && VALID.has(first.action),
  '1. triage.cjs runs on a state file and prints a valid action');

ok(!!first && first.action === 'relaunch',
  '2. mechanical + recognised error + first sighting -> relaunch');

const repeat = run('mechanical-repeat');
ok(!!repeat && repeat.action === 'ask',
  '3. mechanical + recognised error + attempts >= 2 -> ask (a repeat is not transient)');

const claimed = run('mechanical-claimed');
ok(!!claimed && claimed.action === 'ask',
  '4. mechanical CLAIMED but the error text is unrecognised -> ask (the self-report earns nothing on its own)');

const missing = run('missing-info');
ok(!!missing && missing.action === 'ask' && Array.isArray(missing.questions) && missing.questions.length >= 1,
  '5. missing-info -> ask, carrying the postmortem\'s open questions');

const stall = run('convergence-stall');
ok(!!stall && stall.action === 'relaunch' && stall.hints && typeof stall.hints.CodeGate === 'string' && stall.hints.CodeGate.length > 0,
  '6. convergence-stall -> relaunch, carrying a hint keyed by the failed phase');

const dod = run('unachievable-dod');
ok(!!dod && dod.action === 'report',
  '7. unachievable-dod -> report (no automated action; a human decides)');

const none = run('no-failure');
ok(!!none && none.action === 'relaunch',
  '8. a state with no failure block -> relaunch (an ordinary resume)');

rmSync(TMP, { recursive: true, force: true });

const failed = results.filter((r) => !r.pass);
if (failed.length) {
  console.error(`\ncheck RED: ${failed.length}/${results.length} assertion(s) failed — resume routing is not data, or it `
    + `trusts a worker's self-reported kind for the one route that skips the human.`);
  process.exit(1);
}
console.log(`\ncheck GREEN: all ${results.length} triage-routing assertions passed.`);
process.exit(0);
