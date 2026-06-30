// FLOOR (characterization) — the generator regression net is GREEN.
//
// Runs scripts/test-optimize.cjs, which pins the WHOLE optimization-loop generator: representative
// slugs (syntax via `node --check` + the spec §2 loop-structure markers + the conductor-purity
// string-scan that forbids fs/git/Date.now/Math.random in the emitted body) plus the unit suite for
// the pure decision helpers (isBetter both directions/minDelta/non-finite, shouldStop each
// budget+plateau+precedence, deriveEvalCap ≈3×/floor/factor). This is the behavioral core a
// whetstone fix must never regress — a candidate that breaks it goes RED here and is reverted.
// PASSES on baseline.
//
// Locked (evals/**): the whetstone fixer may NEVER edit this file.
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const NET = resolve(HERE, '..', '..', 'scripts', 'test-optimize.cjs');

try {
  execFileSync('node', [NET], { stdio: 'inherit' });
  console.log('01-generator-net: ok (test-optimize.cjs green)');
} catch {
  console.error('01-generator-net: FAIL — scripts/test-optimize.cjs did not pass');
  process.exit(1);
}
