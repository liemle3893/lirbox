// ACCEPTANCE-CHECK (whetstone item: flag-error-echo) — RED on baseline, GREEN after the fix.
//
// Concern: flag-validation errors should echo the offending value to speed debugging. Asserts that
// an invalid --model-mode value appears verbatim in the generator's error output.
//
// Locked (evals/**): the whetstone fixer may NEVER edit this file.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const GEN = resolve(HERE, '..', '..', 'scripts', 'scaffold-workflow.cjs');
const out = join(mkdtempSync(join(tmpdir(), 'wschk-err-')), 'wf.js');
const BAD = 'bogusvalue';

let combined = '';
try {
  execFileSync('node', [GEN, '--name', 'g', '--out', out, '--force', '--phases', 'Work', '--model-mode', BAD], { stdio: ['pipe', 'pipe', 'pipe'] });
} catch (e) {
  combined = (e.stderr ? e.stderr.toString() : '') + (e.stdout ? e.stdout.toString() : '');
}

if (!combined.includes(BAD)) {
  console.error(`FAIL: invalid --model-mode error does not echo the offending value "${BAD}". Got: ${combined.trim() || '(empty)'}`);
  process.exit(1);
}
console.log('PASS: invalid-flag error echoes the offending value');
