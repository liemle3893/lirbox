#!/usr/bin/env node
// FLOOR RUNNER — runs ONLY the characterization/floor tests under evals/floor/.
// The floor must PASS on the unmodified baseline (a whetstone acceptance-check must
// FAIL on baseline), so they cannot share a runner. This is the floor command:
//     node plugins/lirbox/skills/plan-deck/evals/run.mjs
// Exits 0 iff every evals/floor/*.test.mjs passes; 1 if any fails or none are found.
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const FLOOR_DIR = join(HERE, 'floor');

let tests;
try {
  tests = readdirSync(FLOOR_DIR).filter((f) => f.endsWith('.test.mjs')).sort();
} catch (e) {
  console.error(`floor runner: cannot read ${FLOOR_DIR}: ${e.message}`);
  process.exit(1);
}
if (tests.length === 0) {
  console.error(`floor runner: no *.test.mjs under ${FLOOR_DIR}`);
  process.exit(1);
}

let failed = 0;
for (const t of tests) {
  try {
    execFileSync('node', [join(FLOOR_DIR, t)], { stdio: 'inherit' });
    console.log(`floor PASS  ${t}`);
  } catch {
    console.error(`floor FAIL  ${t}`);
    failed++;
  }
}

if (failed) {
  console.error(`\nFLOOR RED: ${failed}/${tests.length} floor test(s) failed.`);
  process.exit(1);
}
console.log(`\nFLOOR GREEN: ${tests.length}/${tests.length} floor test(s) passed.`);
