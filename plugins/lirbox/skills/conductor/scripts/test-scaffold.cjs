#!/usr/bin/env node
/*
 * Regression safety net for scaffold-workflow.cjs.
 *
 * For a representative matrix of flag/profile combos, this harness:
 *   1. shells out to the generator to emit a workflow script,
 *   2. runs `node --check` on the emitted script (syntax/escaping gate),
 *   3. asserts the phase('…') titles in the emitted script exactly equal the
 *      generator's reported "Phases:" order — same set AND same order.
 *
 * Exits non-zero on the first failure (or summarises all and exits 1).
 *
 *   node test-scaffold.cjs
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const GEN = path.join(__dirname, 'scaffold-workflow.cjs');

// Representative matrix: bare, multi-phase, every individual flag, each profile,
// and a kitchen-sink combo. Each entry is [label, extraArgs].
const MATRIX = [
  ['bare', ['--phases', 'Work']],
  ['two-phase', ['--phases', 'Analyze,Implement']],
  ['ticket', ['--phases', 'Work', '--ticket']],
  ['pr', ['--phases', 'Work', '--pr']],
  ['merge-gates', ['--phases', 'Work', '--merge-gates']],
  ['enforce-code', ['--phases', 'Work', '--enforce-code']],
  ['enforce-tests', ['--phases', 'Work', '--enforce-tests']],
  ['enforce-docs', ['--phases', 'Work', '--enforce-docs']],
  ['cycle', ['--phases', 'Implement', '--cycle']],
  ['profile-lite', ['--phases', 'Work', '--profile', 'lite']],
  ['profile-delivery', ['--phases', 'Implement', '--profile', 'delivery']],
  ['combo-all', ['--phases', 'A,B', '--ticket', '--pr', '--enforce-code', '--enforce-tests']],
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'test-scaffold-'));
const promptsFile = path.join(tmp, 'prompts.json');
fs.writeFileSync(promptsFile, JSON.stringify({
  Analyze: 'Map the call sites.',
  Implement: 'Replace them.',
  A: 'Do A.',
  B: 'Do B.',
}));

// Pull phase('…') titles out of the emitted script, in emission order.
function emittedPhases(srcPath) {
  const src = fs.readFileSync(srcPath, 'utf8');
  return (src.match(/phase\('([^']*)'\)/g) || []).map((m) => m.slice(7, -2));
}

// Parse the generator's reported "Phases: a → b → c" line.
function reportedPhases(stdout) {
  const line = stdout.split('\n').find((l) => l.startsWith('Phases:'));
  if (!line) throw new Error('generator did not print a "Phases:" line');
  return line.replace('Phases:', '').trim().split('→').map((s) => s.trim()).filter(Boolean);
}

let failures = 0;
for (const [label, extra] of MATRIX) {
  const out = path.join(tmp, `wf-${label}.js`);
  const args = [GEN, '--name', `t-${label}`, '--out', out, '--force', '--prompts-file', promptsFile, ...extra];
  try {
    const stdout = execFileSync('node', args, { encoding: 'utf8' });

    // Gate 1: emitted script must parse.
    execFileSync('node', ['--check', out], { stdio: 'pipe' });

    // Gate 2: emitted phase order === reported phase order.
    const emitted = emittedPhases(out);
    const reported = reportedPhases(stdout);
    if (emitted.join(' | ') !== reported.join(' | ')) {
      console.error(`FAIL [${label}] phase-order mismatch`);
      console.error(`  emitted:  ${emitted.join(' → ')}`);
      console.error(`  reported: ${reported.join(' → ')}`);
      failures++;
      continue;
    }
    console.log(`PASS [${label}] ${reported.join(' → ')}`);
  } catch (e) {
    console.error(`FAIL [${label}] generation/check error: ${e.message.split('\n')[0]}`);
    if (e.stderr) console.error(`  ${String(e.stderr).trim().split('\n').slice(-3).join('\n  ')}`);
    failures++;
  }
}

fs.rmSync(tmp, { recursive: true, force: true });

if (failures) {
  console.error(`\n${failures} combo(s) FAILED`);
  process.exit(1);
}
console.log(`\nAll ${MATRIX.length} combos passed.`);
