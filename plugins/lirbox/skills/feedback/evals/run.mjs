#!/usr/bin/env node
// FLOOR RUNNER (scaffolded by scaffold-readiness.cjs). Runs every floor/*.test.mjs and exits 0 iff
// all pass. The floor is whetstone's always-on correctness fence: GREEN on baseline, kept green on
// every kept change. Acceptance-checks live separately under checks/ (RED on baseline) and are run
// one-at-a-time by the loop — they must NOT live in floor/.
//
// Locked (evals/**): the whetstone fixer may NEVER edit this file.
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
let tests;
try { tests = readdirSync(join(HERE, 'floor')).filter((f) => f.endsWith('.test.mjs')).sort(); }
catch (e) { console.error('floor runner: cannot read floor/: ' + e.message); process.exit(1); }
if (!tests.length) { console.error('floor runner: no *.test.mjs under floor/ — a floor with no tests is not a floor'); process.exit(1); }

let failed = 0;
for (const t of tests) {
  try { execFileSync('node', [join(HERE, 'floor', t)], { stdio: 'inherit' }); console.log(`floor PASS  ${t}`); }
  catch { console.error(`floor FAIL  ${t}`); failed++; }
}
if (failed) { console.error(`\nFloor RED: ${failed} test(s) failed.`); process.exit(1); }
console.log(`\nFloor GREEN: all ${tests.length} characterization test(s) passed.`);
