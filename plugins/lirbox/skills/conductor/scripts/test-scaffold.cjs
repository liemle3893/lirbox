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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'test-scaffold-'));
const promptsFile = path.join(tmp, 'prompts.json');
fs.writeFileSync(promptsFile, JSON.stringify({
  Analyze: 'Map the call sites.',
  Implement: 'Replace them.',
  A: 'Do A.',
  B: 'Do B.',
}));
// DoD fixtures: a mixed checkable+judged file, and a judged-only file (no baseline phase).
const dodFile = path.join(tmp, 'dod.json');
fs.writeFileSync(dodFile, JSON.stringify({ criteria: [
  { id: 'ac1', text: 'unit tests green', tier: 'checkable', check: 'yarn test' },
  { id: 'ac2', text: 'error message is clear', tier: 'judged' },
] }));
const dodJudgedFile = path.join(tmp, 'dod-judged.json');
fs.writeFileSync(dodJudgedFile, JSON.stringify({ criteria: [
  { id: 'ac1', text: 'error message is clear', tier: 'judged' },
] }));

// Representative matrix: bare, multi-phase, every individual flag, each profile,
// and a kitchen-sink combo. Each entry is [label, extraArgs].
// Profiles now REQUIRE a DoD (--dod-file) — the lite/delivery entries carry the fixture.
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
  ['profile-lite', ['--phases', 'Work', '--profile', 'lite', '--dod-file', dodFile]],
  ['profile-delivery', ['--phases', 'Implement', '--profile', 'delivery', '--dod-file', dodFile]],
  ['combo-all', ['--phases', 'A,B', '--ticket', '--pr', '--enforce-code', '--enforce-tests']],
  // model-mode + writeup combos — keep them inside the syntax/phase-order net too.
  ['auto-bare', ['--phases', 'Work', '--model-mode', 'auto']],
  ['auto-delivery', ['--phases', 'Implement', '--profile', 'delivery', '--model-mode', 'auto', '--dod-file', dodFile]],
  ['no-writeup', ['--phases', 'Work', '--pr', '--no-writeup']],
  ['writeup-only', ['--phases', 'Work', '--writeup']],
  // DoD combos.
  ['dod-bare', ['--phases', 'Work', '--dod-file', dodFile]],
  ['no-dod-delivery', ['--phases', 'Implement', '--profile', 'delivery', '--no-dod']],
];

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

// Conductor-layer purity scan (ported from prospector/whetstone test nets, per CLAUDE.md:
// "Their test-*.cjs enforce this with a string scan"). fs/git/Date.now()/Math.random()/require()
// may appear ONLY inside worker prompt STRINGS (data, not executed by the conductor). So slice to
// the executing body (drops the header comment + the `export const meta` block, both of which name
// these primitives in prose) and strip every `…` template literal (the worker prompts), then forbid
// the restricted primitives in what remains.
function conductorBody(src) {
  const body = src.slice(src.indexOf('const NAME'));
  return body.replace(/`(?:[^`\\]|\\.)*`/g, '""');
}
const FORBIDDEN = [
  ['require(', /\brequire\s*\(/],
  ['fs.', /\bfs\./],
  ['Date.now', /\bDate\.now\s*\(/],
  ['new Date', /\bnew Date\b/],
  ['Math.random', /\bMath\.random\s*\(/],
];

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

    // Gate 4: no restricted primitive at the conductor layer (string scan; node --check can't see
    // it). These belong only inside worker prompts — a leak into the conductor body throws at launch.
    const body = conductorBody(fs.readFileSync(out, 'utf8'));
    let pure = true;
    for (const [pName, re] of FORBIDDEN) {
      if (re.test(body)) {
        console.error(`FAIL [${label}] conductor body uses restricted primitive \`${pName}\` (must live in a worker prompt)`);
        failures++; pure = false;
      }
    }
    if (!pure) continue;
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

  // 2. auto mode tiers each phase class: haiku (mechanical), opus (think), sonnet (work).
  // Opts are emitted as `phase: 'X', [agentType: '...',] model: 'Y',` on one line.
  const auto = gen('auto', ['--phases', 'Implement', '--profile', 'delivery', '--model-mode', 'auto', '--dod-file', dodFile]);
  check(/phase: phaseTitle, model: 'haiku'/.test(auto), "auto: checkpoint → haiku");
  check(/phase: 'Setup', model: 'haiku'/.test(auto), "auto: Setup → haiku");
  check(/phase: 'CodeGate',[^\n]*model: 'opus'/.test(auto), "auto: CodeGate → opus");
  check(/phase: 'RED',[^\n]*model: 'opus'/.test(auto), "auto: RED → opus");
  check(/phase: 'Writeup', model: 'opus'/.test(auto), "auto: Writeup → opus");
  check(/phase: 'Implement', model: 'sonnet'/.test(auto), "auto: work phase → sonnet");
  check(/phase: 'PR', model: 'haiku'/.test(auto), "auto: PR → haiku");
  check(/phase: 'Verify', model: 'haiku'/.test(auto), "auto: Verify → haiku");

  // 3. --model-think overrides the think tier (opus → fable).
  check(/phase: 'CodeGate',[^\n]*model: 'fable'/.test(gen('think-fable', ['--phases', 'Implement', '--cycle', '--model-mode', 'auto', '--model-think', 'fable'])),
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

  // 8. DoD anchor + round carryover (issue #12): gate loops scope findings to the captured
  //    goal/AC and feed the prior round forward so retries converge instead of re-reviewing raw.
  const dod = gen('dod', ['--phases', 'Implement', '--ticket', '--enforce-code']);
  check(/results\.brief\.goal/.test(dod) && /results\.brief\.acceptanceCriteria/.test(dod),
    "DoD anchor: CodeGate prompt interpolates results.brief.goal/acceptanceCriteria");
  check(/round > 1 && last/.test(dod) && /last\.summary/.test(dod),
    "carryover: round>1 gate prompt references the prior round's last.summary");
  check(/\+ dod \+ carry/.test(dod), "gate prompt appends the dod + carry anchors");
  // The anchor is guarded on results.brief, so a NON-ticket enforce-code run still carries rounds
  // but never dereferences a missing brief.
  const noTicket = gen('carry-only', ['--phases', 'Implement', '--enforce-code']);
  check(/results\.brief \?/.test(noTicket), "DoD anchor is guarded on results.brief (safe without --ticket)");
  check(/round > 1 && last/.test(noTicket), "carryover present even without a ticket");

  // 7. invalid flag values are rejected.
  check(genFails(['--phases', 'Work', '--model-mode', 'bogus']), "invalid --model-mode rejected");
  check(genFails(['--phases', 'Work', '--model-mode', 'auto', '--model-think', 'gpt']), "invalid --model-think rejected");

  // 9. DoD gate: --dod-file bakes criteria in, emits DoDBaseline + DoDGate in the right slots,
  //    persists criteria via checkpoint, and puts the scorecard in the PR body.
  const dodGen = gen('dod-gate', ['--phases', 'Work', '--pr', '--dod-file', dodFile]);
  const dodOrder = (dodGen.match(/phase\('([^']*)'\)/g) || []).map((m) => m.slice(7, -2));
  check(dodOrder.indexOf('DoDBaseline') !== -1 && dodOrder.indexOf('DoDBaseline') < dodOrder.indexOf('Work'),
    'dod: DoDBaseline emitted before the work phases');
  check(dodOrder.indexOf('DoDGate') !== -1 && dodOrder.indexOf('DoDGate') < dodOrder.indexOf('Writeup'),
    'dod: DoDGate emitted before Writeup/PR');
  check(/const DOD_CRITERIA = \[/.test(dodGen) && /unit tests green/.test(dodGen),
    'dod: criteria baked into the script verbatim');
  check(/dod: \{ criteria: DOD_CRITERIA \}/.test(dodGen),
    'dod: checkpoint payload persists the criteria to state.json');
  check(/Definition of done/.test(dodGen), 'dod: PR body carries the scorecard');
  check(!/phase\('DoDBaseline'\)/.test(gen('dod-judged', ['--phases', 'Work', '--dod-file', dodJudgedFile])),
    'dod: judged-only criteria emit no DoDBaseline phase');
  check(!/phase\('DoDGate'\)/.test(gen('no-dod', ['--phases', 'Work', '--profile', 'delivery', '--no-dod'])),
    '--no-dod: DoDGate suppressed');
  check(genFails(['--phases', 'Work', '--profile', 'lite']),
    'profile lite without --dod-file (and without --no-dod) rejected');
  check(genFails(['--phases', 'Work', '--profile', 'delivery']),
    'profile delivery without --dod-file (and without --no-dod) rejected');
  const badDod = path.join(tmp, 'dod-bad.json');
  fs.writeFileSync(badDod, JSON.stringify({ criteria: [{ id: 'x', text: 'y', tier: 'checkable' }] }));
  check(genFails(['--phases', 'Work', '--dod-file', badDod]),
    'checkable criterion without a check command rejected');
  fs.writeFileSync(badDod, JSON.stringify({ criteria: [{ id: 'x', text: 'y', tier: 'maybe' }] }));
  check(genFails(['--phases', 'Work', '--dod-file', badDod]), 'bad tier rejected');
  fs.writeFileSync(badDod, JSON.stringify({ criteria: [] }));
  check(genFails(['--phases', 'Work', '--dod-file', badDod]), 'empty criteria array rejected');

  // 10. Panel CodeGate: delivery default ON (guard → dimensions → ≥80 filter → lead loop);
  //     lite/merged Review stays single-agent; --review-panel/--no-review-panel override.
  const panel = gen('panel', ['--phases', 'Implement', '--profile', 'delivery', '--dod-file', dodFile]);
  check(/codegate:guard/.test(panel) && /const DIMENSIONS = \[/.test(panel),
    'panel: delivery emits diff guard + dimension fan-out');
  check(/"key":"history"/.test(panel), 'panel: delivery includes the git-history dimension');
  check(/confidence >= 80/.test(panel), 'panel: findings below 80 confidence dropped');
  check(/codegate:lead-r/.test(panel) && /agentType: 'lirbox:lirbox-code-reviewer'/.test(panel),
    'panel: lead fix-loop runs on the code-reviewer agent');
  const forced = gen('panel-forced', ['--phases', 'Work', '--enforce-code', '--review-panel']);
  check(/const DIMENSIONS = \[/.test(forced) && !/"key":"history"/.test(forced),
    '--review-panel: panel outside delivery has no history dimension');
  check(!/const DIMENSIONS/.test(gen('panel-off', ['--phases', 'Implement', '--profile', 'delivery', '--no-review-panel', '--dod-file', dodFile])),
    '--no-review-panel: delivery reverts to the single-agent CodeGate');
  check(!/const DIMENSIONS/.test(gen('lite-single', ['--phases', 'Work', '--profile', 'lite', '--dod-file', dodFile])),
    'lite: merged Review phase stays single-agent');
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
