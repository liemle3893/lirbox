// FLOOR (characterization) test — PASSES on the unmodified baseline.
//
// Asserts the behavior validate.mjs ALREADY has, so it can never go red without a
// regression: non-ASCII in an EDGE label is flagged, and a clean file is not. The
// floor is the safety net the whetstone loop must keep green on every kept change;
// a fix that breaks this characterization is reverted.
//
// Locked (evals/**): the fixer may never edit this file.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const VALIDATE = join(HERE, '..', '..', 'assets', 'validate.mjs');
const FIX = (name) => join(HERE, '..', 'fixtures', name);

// returns the validate.mjs exit code (0 = clean, 1 = findings)
function validateExit(fixture) {
  try {
    execFileSync('node', [VALIDATE, FIX(fixture)], { stdio: 'pipe' });
    return 0;
  } catch (e) {
    return typeof e.status === 'number' ? e.status : 1;
  }
}

let failures = 0;
function ok(cond, msg) {
  if (cond) { console.log(`PASS floor: ${msg}`); return; }
  console.error(`FAIL floor: ${msg}`);
  failures++;
}

// EDGE non-ASCII is already flagged on baseline → validate must FAIL (exit 1).
ok(validateExit('edge-nonascii.html') === 1, 'non-ASCII em-dash in an EDGE label is flagged (exit 1)');
// A clean fixture must stay clean → validate must PASS (exit 0).
ok(validateExit('clean.html') === 0, 'a fully clean flowchart passes (exit 0)');

if (failures) {
  console.error(`\n${failures} floor check(s) FAILED`);
  process.exit(1);
}
console.log('\nfloor: edge-nonascii characterization green.');
