// ACCEPTANCE-CHECK (whetstone item: model-flag-guard) — RED on baseline, GREEN after the fix.
//
// Concern: passing --model-think / --model-work WITHOUT --model-mode balanced should fail loudly
// (non-zero exit), not be silently accepted and ignored. Asserts the generator exits non-zero when
// --model-think is passed in default mode.
//
// Locked (evals/**): the whetstone fixer may NEVER edit this file.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const GEN = resolve(HERE, '..', '..', 'scripts', 'scaffold-workflow.cjs');
const out = join(mkdtempSync(join(tmpdir(), 'wschk-mfg-')), 'wf.js');

let exit = 0;
try {
  execFileSync('node', [GEN, '--name', 'g', '--out', out, '--force', '--phases', 'Work', '--model-think', 'fable'], { stdio: 'pipe' });
} catch (e) { exit = typeof e.status === 'number' ? e.status : 1; }

if (exit === 0) {
  console.error('FAIL: --model-think without --model-mode balanced was silently accepted (exit 0); it should error');
  process.exit(1);
}
console.log(`PASS: --model-think without --model-mode balanced is rejected (exit ${exit})`);
