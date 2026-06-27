#!/usr/bin/env node
// FLOOR RUNNER for the conductor skill (the lirbox:whetstone target floor).
//
// The floor is whetstone's always-on correctness fence: a deterministic command that MUST exit 0
// on the unmodified baseline AND after every kept change, or the candidate is reverted. It runs
// ONLY the characterization tests under evals/floor/ — these PASS on baseline (they pin behavior
// that must not regress). Acceptance-checks live separately under evals/checks/ (RED on baseline)
// and are run one-at-a-time by the whetstone loop — they must NOT run here.
//
// CUSTOM FLOOR (decision 2026-06-27: keep the `argument-hint` frontmatter). conductor's floor does
// NOT call skill-creator's quick_validate.py — that validator hard-fails on the valid Claude Code
// `argument-hint` key. floor/00-structure.test.mjs does a lenient structural check instead. So the
// whetstone floor command for conductor is simply:
//     node plugins/lirbox/skills/conductor/evals/run.mjs
//
// Locked (evals/**): the whetstone fixer may NEVER edit this file.
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
  console.error(`floor runner: no *.test.mjs under ${FLOOR_DIR} — a floor with no tests is not a floor`);
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
if (failed) { console.error(`\nFloor RED: ${failed} characterization test(s) failed.`); process.exit(1); }
console.log(`\nFloor GREEN: all ${tests.length} characterization test(s) passed.`);
