// ACCEPTANCE CHECK (RED on baseline) — scaffold-workflow.cjs must bake a Definition-of-Done gate.
//
// Concern (feedback/conductor.jsonl → dod-gate): the generator must accept `--dod-file <json>`
// (contract { criteria: [{ id, text, tier: 'checkable'|'judged', check? }] }, check required iff
// tier is checkable) and, from it, emit a verifiable DoD meter into the conductor:
//   1. bake `const DOD_CRITERIA = [` into the script with the criteria verbatim;
//   2. emit a DoDBaseline phase BEFORE the work phases (only when a checkable criterion exists);
//   3. emit a DoDGate phase BEFORE the Writeup phase;
//   4. persist the criteria via the checkpoint payload — `dod: { criteria: DOD_CRITERIA }`;
//   5. carry a scorecard into the PR worker — the script contains `Definition of done`;
//   6. the emitted script passes `node --check`;
//   7. `--profile lite` WITHOUT `--dod-file` (and without `--no-dod`) exits non-zero;
//   8. a checkable criterion missing its `check` command exits non-zero;
//   9. `--no-dod --profile delivery` succeeds and emits NO DoDGate phase.
//
// Baseline (generator ignores --dod-file entirely): assertions 1–5 and 7–8 FAIL → exit 1 (RED).
// After the fix, all nine hold → exit 0 (GREEN).
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

const TMP = mkdtempSync(join(tmpdir(), 'dod-gate-check-'));

// --- fixtures the check writes itself (never under evals/fixtures) ---
const promptsFile = join(TMP, 'prompts.json');
writeFileSync(promptsFile, JSON.stringify({ Work: 'Do the work.', Implement: 'Do the work.' }));

const dodFile = join(TMP, 'dod.json');           // mixed checkable + judged
writeFileSync(dodFile, JSON.stringify({ criteria: [
  { id: 'ac1', text: 'unit tests green', tier: 'checkable', check: 'yarn test' },
  { id: 'ac2', text: 'error message is clear', tier: 'judged' },
] }));

const judgedFile = join(TMP, 'dod-judged.json');  // judged-only → NO DoDBaseline
writeFileSync(judgedFile, JSON.stringify({ criteria: [
  { id: 'ac1', text: 'error message is clear', tier: 'judged' },
] }));

const badFile = join(TMP, 'dod-bad.json');        // checkable, no check command
writeFileSync(badFile, JSON.stringify({ criteria: [
  { id: 'x', text: 'y', tier: 'checkable' },
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

// --- main generation: DoD + Writeup + PR present (needs --pr so Writeup/PR phases exist) ---
const dodSrc = emit('dod-main', ['--phases', 'Work', '--pr', '--dod-file', dodFile]);
const phaseOrder = dodSrc ? (dodSrc.match(/phase\('([^']*)'\)/g) || []).map((m) => m.slice(7, -2)) : [];

// 1. criteria baked in verbatim
ok(/const DOD_CRITERIA = \[/.test(dodSrc) && /unit tests green/.test(dodSrc),
  '1. `const DOD_CRITERIA = [` baked in with the criteria text verbatim');

// 2. DoDBaseline before the work phases (a checkable criterion exists)
ok(phaseOrder.indexOf('DoDBaseline') !== -1
   && phaseOrder.indexOf('DoDBaseline') < phaseOrder.indexOf('Work'),
  "2. phase('DoDBaseline') emitted BEFORE the work phase");

// 3. DoDGate before Writeup
ok(phaseOrder.indexOf('DoDGate') !== -1
   && phaseOrder.indexOf('Writeup') !== -1
   && phaseOrder.indexOf('DoDGate') < phaseOrder.indexOf('Writeup'),
  "3. phase('DoDGate') emitted BEFORE phase('Writeup')");

// 4. checkpoint persists the criteria
ok(/dod: \{ criteria: DOD_CRITERIA \}/.test(dodSrc),
  '4. checkpoint payload persists `dod: { criteria: DOD_CRITERIA }`');

// 5. PR worker carries the scorecard
ok(/Definition of done/.test(dodSrc),
  '5. emitted script carries a `Definition of done` scorecard (PR body)');

// 6. emitted script parses
ok(dodSrc !== '' && nodeCheck(dodSrc),
  '6. emitted script passes `node --check`');

// 7. lite profile without --dod-file (and without --no-dod) is rejected
ok(gen(['--name', 'nodod-lite', '--out', join(TMP, 'nodod-lite.js'), '--force',
        '--prompts-file', promptsFile, '--phases', 'Work', '--profile', 'lite']).code !== 0,
  '7. `--profile lite` without --dod-file / --no-dod exits non-zero');

// 8. checkable criterion missing its check command is rejected
ok(gen(['--name', 'badcheck', '--out', join(TMP, 'badcheck.js'), '--force',
        '--prompts-file', promptsFile, '--phases', 'Work', '--dod-file', badFile]).code !== 0,
  '8. checkable criterion without a `check` command exits non-zero');

// 9. --no-dod --profile delivery succeeds and emits NO DoDGate
const noDodSrc = emit('nodod-delivery', ['--phases', 'Implement', '--profile', 'delivery', '--no-dod']);
ok(noDodSrc !== '' && !/phase\('DoDGate'\)/.test(noDodSrc),
  "9. `--no-dod --profile delivery` succeeds and emits NO phase('DoDGate')");

// bonus consistency: judged-only DoD emits no DoDBaseline (part of assertion 2's contract)
const judgedSrc = emit('dod-judged', ['--phases', 'Work', '--pr', '--dod-file', judgedFile]);
ok(judgedSrc !== '' && /phase\('DoDGate'\)/.test(judgedSrc) && !/phase\('DoDBaseline'\)/.test(judgedSrc),
  '2b. judged-only DoD emits DoDGate but NO DoDBaseline');

rmSync(TMP, { recursive: true, force: true });

const failed = results.filter((r) => !r.pass);
if (failed.length) {
  console.error(`\ncheck RED: ${failed.length}/${results.length} assertion(s) failed — DoD gate not wired into the generator.`);
  process.exit(1);
}
console.log(`\ncheck GREEN: all ${results.length} DoD-gate assertions passed.`);
process.exit(0);
