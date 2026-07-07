// SKILL-TRAIN task (VAL split — HELD OUT). shouldStop enforces the stop budgets: the experiments
// cap and the plateau counter (and returns null while under them). Grades the pure decision core
// exported by scripts/scaffold-optimize.cjs. PASSES on baseline.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { shouldStop } = require(resolve(HERE, '..', '..', '..', 'scripts', 'scaffold-optimize.cjs'));

const ok = (c, m) => { if (!c) { console.error('FAIL ' + m); process.exit(1); } };
ok(shouldStop(5, 0, { experiments: 5 }, 0) === 'experiments', 'experiments budget hit → stop');
ok(shouldStop(4, 0, { experiments: 5 }, 0) === null, 'under experiments budget → continue');
ok(shouldStop(0, 3, {}, 3) === 'plateau', 'plateau hit → stop');
ok(shouldStop(0, 2, {}, 3) === null, 'under plateau → continue');
console.log('22-helper-shouldstop: ok');
