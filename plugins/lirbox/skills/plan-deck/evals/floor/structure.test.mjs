// FLOOR (characterization) — PASSES on the committed baseline. Locked (evals/**).
// Pins the plan-deck report contract: validate.mjs accepts a well-formed page and
// rejects each way it can break (leftover placeholder, badge gap, TOC/order mismatch,
// buried decisions lead, duplicate title).
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

ok(validateExit('clean.html') === 0, 'a well-formed plan-deck passes (exit 0)');
ok(validateExit('placeholder-left.html') === 1, 'a leftover {{placeholder}} is flagged (exit 1)');
ok(validateExit('badge-gap.html') === 1, 'a gapped section-badge sequence is flagged (exit 1)');
ok(validateExit('toc-order-mismatch.html') === 1, 'a TOC/section order mismatch is flagged (exit 1)');
ok(validateExit('decisions-not-first.html') === 1, 'a decisions lead that is not first is flagged (exit 1)');
ok(validateExit('two-title.html') === 1, 'a duplicate <h1 class="title"> is flagged (exit 1)');

if (failures) { console.error(`\n${failures} floor check(s) FAILED`); process.exit(1); }
console.log('\nfloor: plan-deck report contract characterization green.');
