// FLOOR (characterization) — PASSES on the committed baseline. Locked (evals/**).
// Pins the report contract: validate.mjs accepts a well-formed report and rejects
// each way the contract can break (bad verdict, conditions mismatch, bad status,
// leftover placeholder).
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

ok(validateExit('clean.html') === 0, 'a well-formed report passes (exit 0)');
ok(validateExit('refuted-but-go.html') === 1, 'a REFUTED row with a non-NO-GO verdict is flagged (exit 1)');
ok(validateExit('conditions-mismatch.html') === 1, 'open items without matching conditions are flagged (exit 1)');
ok(validateExit('bad-status.html') === 1, 'an out-of-set data-status is flagged (exit 1)');
ok(validateExit('placeholder-left.html') === 1, 'a leftover {{placeholder}} is flagged (exit 1)');

if (failures) { console.error(`\n${failures} floor check(s) FAILED`); process.exit(1); }
console.log('\nfloor: plan-check report contract characterization green.');
