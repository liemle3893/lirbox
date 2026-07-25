// ACCEPTANCE-CHECK (whetstone item: model-flag-guard) — RED on baseline, GREEN after the fix.
//
// Concern: --model-think / --model-work must fail loudly (non-zero exit) in the mode that emits no
// `model:` opt, rather than being silently accepted and ignored.
//
// RETARGETED 2026-07-25 (human-side eval amendment, outside a whetstone run) for the
// `model-mode-auto-by-default` item: `auto` becomes the default and the no-model-opt mode is now
// named `inherit`. So the guard inverts — the tuning flags are VALID with no mode flag (auto is
// the default) and must be REJECTED under `--model-mode inherit`. This file is under evals/** and
// therefore locked to the whetstone fixer; only a human may retarget it, which is why it lands
// before the run rather than inside it. It is RED until that item is kept.
//
// Locked (evals/**): the whetstone fixer may NEVER edit this file.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const GEN = resolve(HERE, '..', '..', 'scripts', 'scaffold-workflow.cjs');
const dir = mkdtempSync(join(tmpdir(), 'wschk-mfg-'));

// Returns the generator's exit code for one flag set (0 = accepted).
const run = (extra) => {
  try {
    execFileSync('node', [GEN, '--name', 'g', '--out', join(dir, 'wf.js'), '--force', '--phases', 'Work', ...extra], { stdio: 'pipe' });
    return 0;
  } catch (e) { return typeof e.status === 'number' ? e.status : 1; }
};

let ok = true;

// Under `inherit` no `model:` opt is emitted, so the tuning flags would be silently ignored → reject.
if (run(['--model-mode', 'inherit', '--model-think', 'fable']) === 0) {
  console.error('FAIL: --model-think under --model-mode inherit was silently accepted (exit 0); it should error');
  ok = false;
}
if (run(['--model-mode', 'inherit', '--model-work', 'fable']) === 0) {
  console.error('FAIL: --model-work under --model-mode inherit was silently accepted (exit 0); it should error');
  ok = false;
}

// With no mode flag the default is `auto`, which DOES emit `model:` opts — the flags must be accepted.
if (run(['--model-think', 'fable']) !== 0) {
  console.error('FAIL: --model-think with no --model-mode flag was rejected; auto is the default, so it must be accepted');
  ok = false;
}

if (!ok) process.exit(1);
console.log('PASS: model tuning flags rejected under --model-mode inherit, accepted under the auto default');
