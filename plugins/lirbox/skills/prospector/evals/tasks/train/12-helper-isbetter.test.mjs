// SKILL-TRAIN task (TRAIN split). The keep-decision helper isBetter honors direction + minDelta:
// a candidate must strictly beat the incumbent by at least minDelta. Grades the pure decision core
// exported by scripts/scaffold-optimize.cjs. PASSES on baseline.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { isBetter } = require(resolve(HERE, '..', '..', '..', 'scripts', 'scaffold-optimize.cjs'));

const ok = (c, m) => { if (!c) { console.error('FAIL ' + m); process.exit(1); } };
// direction=max: bigger wins, but only past minDelta.
ok(isBetter(102, 100, 'max', 1) === true, 'max: +2 beats incumbent (minDelta 1)');
ok(isBetter(100.5, 100, 'max', 1) === false, 'max: +0.5 within minDelta → not better');
// direction=min: smaller wins.
ok(isBetter(98, 100, 'min', 1) === true, 'min: -2 beats incumbent');
ok(isBetter(100, 100, 'min', 1) === false, 'min: equal → not better');
console.log('12-helper-isbetter: ok');
