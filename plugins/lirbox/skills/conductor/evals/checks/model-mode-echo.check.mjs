// ACCEPTANCE-CHECK (whetstone item: model-mode-echo) — RED on baseline, GREEN after the fix.
//
// Concern: the generator's stdout summary should report the active model mode so the operator sees
// it at a glance. Asserts that running with --model-mode balanced prints a line naming the mode.
//
// Locked (evals/**): the whetstone fixer may NEVER edit this file.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const GEN = resolve(HERE, '..', '..', 'scripts', 'scaffold-workflow.cjs');
const out = join(mkdtempSync(join(tmpdir(), 'wschk-echo-')), 'wf.js');

const stdout = execFileSync('node', [GEN, '--name', 'g', '--out', out, '--force', '--phases', 'Work', '--model-mode', 'balanced'], { encoding: 'utf8' });

// Require an explicit mention of BOTH the concept ("model") and the active mode ("balanced").
if (!/model/i.test(stdout) || !/balanced/i.test(stdout)) {
  console.error('FAIL: generator stdout does not report the model mode. Got:\n' + stdout);
  process.exit(1);
}
console.log('PASS: generator stdout reports the balanced model mode');
