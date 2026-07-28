// FLOOR (characterization) — the regression net is GREEN.
// Runs scripts/test-loom.cjs, which pins all graph math, the generator, the emitted
// interpreter's shape, the server routes, the DoD freezing, and the report scripts.
// PASSES on baseline.
// Locked (evals/**): improvement loops may NEVER edit this file.
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const NET = resolve(HERE, '..', '..', 'scripts', 'test-loom.cjs');

try {
  execFileSync('node', [NET], { stdio: 'inherit' });
  console.log('01-net: ok (test-loom.cjs green)');
} catch {
  console.error('01-net: FAIL — scripts/test-loom.cjs did not pass');
  process.exit(1);
}
