// FLOOR (characterization) — PASSES on the committed baseline. Locked (evals/**).
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

ok(validateExit('clean.html') === 0, 'a clean sequence diagram passes (exit 0)');
ok(validateExit('no-autonumber.html') === 1, 'a missing autonumber is flagged (exit 1)');
ok(validateExit('parity.html') === 1, 'a message/STEPLIST count mismatch is flagged (exit 1)');
ok(validateExit('literal-newline.html') === 1, 'a literal \\n in message text is flagged (exit 1)');

if (failures) { console.error(`\n${failures} floor check(s) FAILED`); process.exit(1); }
console.log('\nfloor: sequence structure characterization green.');
