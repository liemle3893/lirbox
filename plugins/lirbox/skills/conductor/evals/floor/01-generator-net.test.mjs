// FLOOR (characterization) — the generator regression net is GREEN.
//
// Runs scripts/test-scaffold.cjs, which pins the WHOLE generator: 16 flag/profile combos
// (syntax + emitted-vs-reported phase order + the conductor-purity string-scan) plus 17 eval
// assertions (default byte-cost-free, balanced model tiers, writeup wiring, DocsGate path,
// invalid-flag rejection). This is the behavioral core a whetstone fix must never regress — a
// candidate that breaks it goes RED here and is reverted. PASSES on baseline.
//
// Locked (evals/**): the whetstone fixer may NEVER edit this file.
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const NET = resolve(HERE, '..', '..', 'scripts', 'test-scaffold.cjs');

try {
  execFileSync('node', [NET], { stdio: 'inherit' });
  console.log('01-generator-net: ok (test-scaffold.cjs green)');
} catch {
  console.error('01-generator-net: FAIL — scripts/test-scaffold.cjs did not pass');
  process.exit(1);
}
