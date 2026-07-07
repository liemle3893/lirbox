// SKILL-TRAIN task (TRAIN split). deriveEvalCap sizes the per-experiment eval budget at ~3x the
// measured baseline eval time, floored at 30s. Grades the pure decision core exported by
// scripts/scaffold-optimize.cjs. PASSES on baseline.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { deriveEvalCap } = require(resolve(HERE, '..', '..', '..', 'scripts', 'scaffold-optimize.cjs'));

const ok = (c, m) => { if (!c) { console.error('FAIL ' + m); process.exit(1); } };
ok(deriveEvalCap(20) === 60, '20s x 3 = 60');
ok(deriveEvalCap(100) === 300, '100s x 3 = 300');
ok(deriveEvalCap(5) === 30, '5s x 3 = 15, floored to 30');
ok(deriveEvalCap(0) === 30, '0 baseline → floor 30');
console.log('13-helper-evalcap: ok');
