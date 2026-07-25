// ACCEPTANCE-CHECK (whetstone item: effort-think) — RED on baseline, GREEN after the fix.
//
// Concern: in auto model mode, think-class agent() calls should also carry effort: 'high';
// mechanical/work phases must NOT get an effort opt. Asserts think phases (RED, CodeGate) carry
// effort: 'high' and mechanical/work phases (PR, Implement) do not.
//
// REPAIRED 2026-07-25 (human-side eval maintenance; this file is under evals/** and so is locked to
// the whetstone fixer). It had rotted twice over:
//   1. It invoked `--profile delivery` with no DoD, which a later run made a hard error — so the
//      generation call THREW and the check failed with a stack trace instead of an assertion.
//      Fixed by passing --no-dod (this check is about model tiering, not the DoD).
//   2. It had no harness-error path, so ANY unrelated generator breakage reported as a RED verdict
//      on this concern. Now generation failure exits 2 (harness error), matching the convention in
//      the other checks; exit 1 means only "effort tiering is wrong".
// Also broadened: `auto` is now the DEFAULT mode (run conductor-20260725-065830), so the tiering is
// pinned on BOTH the explicit `--model-mode auto` path and the no-flag path that production uses.
//
// Locked (evals/**): the whetstone fixer may NEVER edit this file.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const GEN = resolve(HERE, '..', '..', 'scripts', 'scaffold-workflow.cjs');
const dir = mkdtempSync(join(tmpdir(), 'wschk-eff-'));

// Generate a delivery script; a generation failure is a HARNESS error (exit 2), not a RED verdict.
function generate(tag, extra) {
  const out = join(dir, tag + '.js');
  try {
    execFileSync('node', [GEN, '--name', 'g', '--out', out, '--force',
      '--phases', 'Implement', '--profile', 'delivery', '--no-dod', ...extra], { stdio: 'pipe' });
  } catch (e) {
    console.error(`PRECONDITION FAILED: delivery generation (${tag}) exited ${e.status}: unrelated `
      + `generator breakage, not this concern.\n${e.stderr || ''}`);
    process.exit(2);
  }
  return readFileSync(out, 'utf8');
}

let ok = true;
const fail = (m) => { console.error('FAIL: ' + m); ok = false; };

// `auto` is the default, so it must hold with the flag AND without it.
for (const [tag, extra] of [['explicit', ['--model-mode', 'auto']], ['default', []]]) {
  const src = generate(tag, extra);
  if (!/phase: 'CodeGate',[^\n]*effort: 'high'/.test(src)) fail(`${tag}: CodeGate (think-class) lacks effort: 'high'`);
  if (!/phase: 'RED',[^\n]*effort: 'high'/.test(src)) fail(`${tag}: RED (think-class) lacks effort: 'high'`);
  if (/phase: 'PR',[^\n]*effort:/.test(src)) fail(`${tag}: PR (mechanical) must not carry an effort opt`);
  if (/phase: 'Implement',[^\n]*effort:/.test(src)) fail(`${tag}: work phase must not carry an effort opt`);
}

// Under `inherit` nothing is tiered, so no effort opt may appear at all.
const inherit = generate('inherit', ['--model-mode', 'inherit']);
if (/\beffort: '/.test(inherit)) fail('inherit: no effort opt may be emitted in the untiered mode');

if (!ok) process.exit(1);
console.log("PASS: think phases carry effort: 'high' (explicit auto and by default); mechanical/work phases and inherit carry none");
