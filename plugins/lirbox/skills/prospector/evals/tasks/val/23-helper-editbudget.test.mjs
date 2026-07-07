// SKILL-TRAIN task (VAL split — HELD OUT). withinEditBudget bounds the per-experiment diff size:
// at/under the cap passes, over fails, and an enabled-but-unmeasured diff is conservatively
// over-budget. Grades the pure decision core exported by scripts/scaffold-optimize.cjs.
// PASSES on baseline.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { withinEditBudget } = require(resolve(HERE, '..', '..', '..', 'scripts', 'scaffold-optimize.cjs'));

const ok = (c, m) => { if (!c) { console.error('FAIL ' + m); process.exit(1); } };
ok(withinEditBudget(100, 100) === true, 'exactly at budget → within');
ok(withinEditBudget(50, 100) === true, 'under budget → within');
ok(withinEditBudget(101, 100) === false, 'over budget → out');
ok(withinEditBudget(null, 100) === false, 'enabled but unmeasured → conservatively out');
console.log('23-helper-editbudget: ok');
