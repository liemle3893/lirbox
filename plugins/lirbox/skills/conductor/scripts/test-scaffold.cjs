#!/usr/bin/env node
/*
 * Regression safety net for scaffold-workflow.cjs.
 *
 * For a representative matrix of flag/profile combos, this harness:
 *   1. shells out to the generator to emit a workflow script,
 *   2. runs `node --check` on the emitted script (syntax/escaping gate),
 *   3. asserts the phase('…') titles in the emitted script exactly equal the
 *      generator's reported "Phases:" order — same set AND same order,
 *   4. asserts the emitted body has no runtime `meta.` access — the Workflow engine
 *      consumes `export const meta` as metadata, so `meta` is not a runtime binding.
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
  // model-mode + writeup combos — keep them inside the syntax/phase-order net too.
  ['balanced-bare', ['--phases', 'Work', '--model-mode', 'balanced']],
  ['balanced-delivery', ['--phases', 'Implement', '--profile', 'delivery', '--model-mode', 'balanced']],
  ['no-writeup', ['--phases', 'Work', '--pr', '--no-writeup']],
  ['writeup-only', ['--phases', 'Work', '--writeup']],
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

    // Gate 3: the emitted body must not reference `meta.` at runtime. The Workflow engine
    // consumes `export const meta` as metadata, so `meta` is NOT a binding in the executing
    // body — any `meta.<x>` access throws "meta is not defined" at launch (node --check can't
    // catch it). The phase order is baked in as a literal instead.
    if (/meta\./.test(fs.readFileSync(out, 'utf8'))) {
      console.error(`FAIL [${label}] generated body references \`meta.\` at runtime (would throw in the Workflow engine)`);
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

// --- Targeted eval/compare assertions: model-mode + writeup behavior ---------------------
// gen(extra) → emitted source string for a one-off combo.
function gen(label, extra) {
  const out = path.join(tmp, `eval-${label}.js`);
  execFileSync('node', [GEN, '--name', `e-${label}`, '--out', out, '--force', '--prompts-file', promptsFile, ...extra], { encoding: 'utf8' });
  execFileSync('node', ['--check', out], { stdio: 'pipe' });
  return fs.readFileSync(out, 'utf8');
}
function check(cond, msg) { if (cond) { console.log(`PASS [eval] ${msg}`); } else { console.error(`FAIL [eval] ${msg}`); failures++; } }
// genFails(extra) → true iff the generator exits non-zero (invalid-flag rejection).
function genFails(extra) {
  try { execFileSync('node', [GEN, '--name', 'e-bad', '--out', path.join(tmp, 'bad.js'), '--force', ...extra], { stdio: 'pipe' }); return false; }
  catch (_) { return true; }
}

try {
  // 1. default mode emits NO model: opt at all (byte-cost-free; the backward-compat invariant).
  check(!/model:\s*'/.test(gen('default', ['--phases', 'Work', '--pr', '--enforce-docs'])),
    "default mode emits no model: opt");

  // 2. balanced mode tiers each phase class: haiku (mechanical), opus (think), sonnet (work).
  // Opts are emitted as `phase: 'X', [agentType: '...',] model: 'Y',` on one line.
  const bal = gen('balanced', ['--phases', 'Implement', '--profile', 'delivery', '--model-mode', 'balanced']);
  check(/phase: phaseTitle, model: 'haiku'/.test(bal), "balanced: checkpoint → haiku");
  check(/phase: 'Setup', model: 'haiku'/.test(bal), "balanced: Setup → haiku");
  check(/phase: 'CodeGate',[^\n]*model: 'opus'/.test(bal), "balanced: CodeGate → opus");
  check(/phase: 'RED',[^\n]*model: 'opus'/.test(bal), "balanced: RED → opus");
  check(/phase: 'Writeup', model: 'opus'/.test(bal), "balanced: Writeup → opus");
  check(/phase: 'Implement', model: 'sonnet'/.test(bal), "balanced: work phase → sonnet");
  check(/phase: 'PR', model: 'haiku'/.test(bal), "balanced: PR → haiku");
  check(/phase: 'Verify', model: 'haiku'/.test(bal), "balanced: Verify → haiku");

  // 3. --model-think overrides the think tier (opus → fable).
  check(/phase: 'CodeGate',[^\n]*model: 'fable'/.test(gen('think-fable', ['--phases', 'Implement', '--cycle', '--model-mode', 'balanced', '--model-think', 'fable'])),
    "--model-think fable: CodeGate → fable");

  // 4. writeup wiring: a --pr run gets a Writeup phase BEFORE PR that targets docs/changes + both skills.
  const pr = gen('pr-writeup', ['--phases', 'Work', '--pr']);
  const order = (pr.match(/phase\('([^']*)'\)/g) || []).map((m) => m.slice(7, -2));
  check(order.indexOf('Writeup') !== -1 && order.indexOf('Writeup') < order.indexOf('PR'), "writeup: Writeup phase emitted before PR");
  check(/docs\/changes\/\$\{NAME\}/.test(pr) && /lirbox:pr-writeup/.test(pr) && /lirbox:flowchart/.test(pr), "writeup: prompt targets docs/changes + pr-writeup + flowchart skills");
  check(/Reviewer artifacts are committed under docs\/changes\//.test(pr), "writeup: PR body links the artifacts");

  // 5. --no-writeup suppresses the Writeup phase entirely.
  check(!/phase\('Writeup'\)/.test(gen('no-writeup', ['--phases', 'Work', '--pr', '--no-writeup'])), "--no-writeup: no Writeup phase");

  // 6. DocsGate writes into the per-run docs/changes/<name>/ dir.
  check(/docs\/changes\/\$\{NAME\}\/summary\.md/.test(gen('docs', ['--phases', 'Work', '--enforce-docs'])), "DocsGate: summary.md under docs/changes/<name>/");

  // 7. invalid flag values are rejected.
  check(genFails(['--phases', 'Work', '--model-mode', 'bogus']), "invalid --model-mode rejected");
  check(genFails(['--phases', 'Work', '--model-mode', 'balanced', '--model-think', 'gpt']), "invalid --model-think rejected");
} catch (e) {
  console.error(`FAIL [eval] generation error: ${e.message.split('\n')[0]}`);
  failures++;
}

fs.rmSync(tmp, { recursive: true, force: true });

if (failures) {
  console.error(`\n${failures} combo(s) FAILED`);
  process.exit(1);
}
console.log(`\nAll ${MATRIX.length} combos passed.`);
