#!/usr/bin/env node
// SCORED RUNNER (scaffolded by scaffold-readiness.cjs --scored) — the prospector skill-train metric.
// Runs every tasks/<split>/*.test.mjs and prints ONE machine-parseable line:
//     score=<pass-percentage> (passed=<k>/<n>, split=<split>)
// prospector metric config (recipe: prospector/references/skill-train.md):
//     { "cmd": "node plugins/lirbox/skills/flowchart/evals/run-scored.mjs --split val", "parse": "score=([0-9.]+)", "direction": "max" }
// TRAIN/VAL SPLIT: the keep decision MUST run on --split val (held out); only --split train results
// may be shown to the propose/fix worker — otherwise the skill overfits the tasks that judge it.
// Exit 0 iff the score was measured (any pass rate); non-zero only for structural errors.
//
// Locked (evals/**): a loop worker may NEVER edit this file or the tasks.
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const i = process.argv.indexOf('--split');
const split = i > -1 ? process.argv[i + 1] : 'val';
if (split !== 'train' && split !== 'val') { console.error('run-scored: --split must be train|val'); process.exit(1); }
let tests;
try { tests = readdirSync(join(HERE, 'tasks', split)).filter((f) => f.endsWith('.test.mjs')).sort(); }
catch (e) { console.error('run-scored: cannot read tasks/' + split + '/: ' + e.message); process.exit(1); }
if (!tests.length) { console.error('run-scored: no *.test.mjs under tasks/' + split + '/ — a score over zero tasks is meaningless'); process.exit(1); }

let passed = 0;
for (const t of tests) {
  try { execFileSync('node', [join(HERE, 'tasks', split, t)], { stdio: 'pipe' }); passed++; console.log(`task PASS  ${t}`); }
  catch { console.log(`task FAIL  ${t}`); }
}
console.log(`score=${(100 * passed / tests.length).toFixed(2)} (passed=${passed}/${tests.length}, split=${split})`);
