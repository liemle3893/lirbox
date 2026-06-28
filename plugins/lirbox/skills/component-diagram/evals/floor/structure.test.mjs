// FLOOR (characterization) — PASSES on the committed baseline. Asserts behavior validate.mjs
// ALREADY has, so it can't go red without a regression. Locked (evals/**): never edited by a fixer.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const VALIDATE = join(HERE, '..', '..', 'assets', 'validate.mjs');
const FIX = (n) => join(HERE, '..', 'fixtures', n);
function validateExit(fixture) {
  try { execFileSync('node', [VALIDATE, FIX(fixture)], { stdio: 'pipe' }); return 0; }
  catch (e) { return typeof e.status === 'number' ? e.status : 1; }
}
let failures = 0;
const ok = (cond, msg) => { if (cond) console.log(`PASS floor: ${msg}`); else { console.error(`FAIL floor: ${msg}`); failures++; } };

ok(validateExit('clean.html') === 0, 'a clean component diagram passes (exit 0)');
ok(validateExit('raw-paren.html') === 1, 'a raw "(" in a node label is flagged (exit 1)');
ok(validateExit('diamond.html') === 1, 'a decision diamond {…} is flagged (exit 1)');
ok(validateExit('no-subgraph.html') === 1, 'a boundary-less graph is flagged (exit 1)');

if (failures) { console.error(`\n${failures} floor check(s) FAILED`); process.exit(1); }
console.log('\nfloor: component structure characterization green.');
