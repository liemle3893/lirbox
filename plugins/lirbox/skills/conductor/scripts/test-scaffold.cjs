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
 * It then byte-compares a canonical combo set against committed golden snapshots in
 * scripts/snapshots/ (regenerated from the pinned inputs in scripts/snapshots/inputs/ —
 * generator output is deterministic and cwd-/out-path-/input-path-independent). After an
 * INTENTIONAL generator change, refresh the fixtures and commit them with the change:
 *
 *   node test-scaffold.cjs --update-snapshots
 *
 * The snapshot dir can be overridden (tamper/regen experiments) with the SNAPSHOT_DIR env
 * var or --snapshot-dir <dir>; the flag wins over the env var.
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
  // (`auto` is the DEFAULT, so every other entry above already exercises it; these pin the
  // explicit-flag spelling and the opt-in `inherit` mode.)
  ['auto-bare', ['--phases', 'Work', '--model-mode', 'auto']],
  ['inherit', ['--phases', 'Work', '--model-mode', 'inherit']],
  ['auto-delivery', ['--phases', 'Implement', '--profile', 'delivery', '--model-mode', 'auto', '--dod-file', dodFile]],
  ['no-writeup', ['--phases', 'Work', '--pr', '--no-writeup']],
  ['writeup-only', ['--phases', 'Work', '--writeup']],
  // DoD combos.
  ['dod-bare', ['--phases', 'Work', '--dod-file', dodFile]],
  ['no-dod-delivery', ['--phases', 'Implement', '--profile', 'delivery', '--no-dod']],
  // FrontendGate combos (--frontend web|mobile|both).
  ['frontend-web', ['--phases', 'Work', '--frontend', 'web']],
  ['frontend-mobile-lite', ['--phases', 'Work', '--profile', 'lite', '--frontend', 'mobile', '--dod-file', dodFile]],
  ['frontend-both-delivery', ['--phases', 'Implement', '--profile', 'delivery', '--frontend', 'both', '--dod-file', dodFile]],
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

// Gate-1 parse probe. `node --check` CANNOT validate a generated conductor: measured 2026-07-30 on
// node v22.21.1, it stops validating everything after the first ESM statement, and every emitted
// script opens with `export const meta`. A syntax error injected into the executing body
// (`const = = CORRUPTED(` before `phase('Setup')`) passes `--check` cleanly, and a bare top-level
// `return 1` passes too — so the old gate could not fail. Errors BEFORE the first export/import are
// still caught, which is why this went unnoticed.
//
// The runtime wraps the script in an async function (it uses top-level await and top-level return),
// so compiling it as that function's BODY is what actually parses it. Same probe as the Harbor
// task's `parses_as_workflow_body` criterion.
const PARSE_PROBE = "const fs=require('fs');"
  + "const s=fs.readFileSync(process.argv[1],'utf8')"
  + ".replace(/^export const meta/m,'const meta');"
  + "const AF=Object.getPrototypeOf(async function(){}).constructor;"
  + "new AF('args','log','phase','agent','parallel','pipeline','budget','workflow',s);";

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

    // Gate 1: emitted script must parse — as the async function body the runtime wraps it in, NOT
    // via `node --check`, which is vacuous past the leading `export` (see PARSE_PROBE).
    execFileSync('node', ['-e', PARSE_PROBE, out], { stdio: 'pipe' });

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
  // 1. `inherit` mode emits NO model:/effort: opt at all (byte-cost-free; the backward-compat
  //    invariant). Retargeted from the old `default` mode when auto became the default: the
  //    byte-cost-free path still has to exist and still has to be byte-cost-free — it is just
  //    opted into by name now.
  const inheritSrc = gen('inherit', ['--phases', 'Work', '--pr', '--enforce-docs', '--model-mode', 'inherit']);
  check(!/model:\s*'/.test(inheritSrc), "inherit mode emits no model: opt");
  check(!/effort:\s*'/.test(inheritSrc), "inherit mode emits no effort: opt");

  // 1b. With NO --model-mode flag the default is `auto`, so the tiered opts ARE emitted.
  const defaultSrc = gen('default', ['--phases', 'Work', '--pr', '--enforce-docs']);
  check(/phase: 'Setup', model: 'haiku'/.test(defaultSrc), "no --model-mode flag: auto is the default (Setup → haiku)");
  check(/phase: 'Work', model: 'sonnet'/.test(defaultSrc), "no --model-mode flag: work phase → sonnet");

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
  check(genFails(['--phases', 'Work', '--model-mode', 'default']), "legacy --model-mode default rejected (auto is the default; use inherit)");
  check(genFails(['--phases', 'Work', '--model-mode', 'auto', '--model-think', 'gpt']), "invalid --model-think rejected");
  check(genFails(['--phases', 'Work', '--frontend', 'desktop']), "invalid --frontend rejected");

  // 11. FrontendGate: ordered after the code-quality gate, before DoDGate/Writeup; both targets
  //     emitted under both; the verifier agents are swappable via --agent-web/--agent-mobile.
  const fg = gen('frontend', ['--phases', 'Implement', '--profile', 'delivery', '--frontend', 'both', '--dod-file', dodFile]);
  const fgOrder = (fg.match(/phase\('([^']*)'\)/g) || []).map((m) => m.slice(7, -2));
  check(fgOrder.indexOf('ReVerify') < fgOrder.indexOf('FrontendGate')
    && fgOrder.indexOf('FrontendGate') < fgOrder.indexOf('DoDGate'),
    'frontend: FrontendGate between ReVerify and DoDGate under delivery');
  check(/agentType: 'lirbox:lirbox-web-verifier'/.test(fg) && /agentType: 'lirbox:lirbox-mobile-verifier'/.test(fg),
    'frontend: both verifier agents dispatched under --frontend both');
  check(/frontend-evidence\/manifest\.json/.test(fg), 'frontend: prompt targets the evidence manifest');
  check(/retrying on a generic subagent/.test(fg), 'frontend: typed dispatch degrades to a generic subagent');
  const fgLite = gen('frontend-lite', ['--phases', 'Work', '--profile', 'lite', '--frontend', 'web', '--dod-file', dodFile]);
  const fgLiteOrder = (fgLite.match(/phase\('([^']*)'\)/g) || []).map((m) => m.slice(7, -2));
  check(fgLiteOrder.indexOf('Review') < fgLiteOrder.indexOf('FrontendGate')
    && fgLiteOrder.indexOf('FrontendGate') < fgLiteOrder.indexOf('DoDGate'),
    'frontend: FrontendGate between Review and DoDGate under lite');
  check(!/agentType: 'lirbox:lirbox-web-verifier'/.test(gen('frontend-none', ['--phases', 'Work', '--frontend', 'web', '--agent-web', 'none']))
    , '--agent-web none drops the agentType (generic subagent)');
  check(!/phase\('FrontendGate'\)/.test(gen('frontend-off', ['--phases', 'Work'])), 'no --frontend: no FrontendGate phase');

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

  // 9b. Plan-of-record half of DoDGate: the frozen criteria are written before anything has read
  //     the repo, so they cannot name a work item the planner invented at runtime — a criterion set
  //     can go fully MET while an item was silently skipped. The gate verifies both views IN
  //     PARALLEL and unions their unmet rows, so replan/fix/stall/escalate all route on the union.
  const goalGen = gen('dod-goals', ['--phases', 'Analyze,Implement', '--profile', 'delivery', '--dod-file', dodFile]);
  check(/const PLAN_KEYS = \["analyze","implement"\]/.test(goalGen),
    'goals: PLAN_KEYS names every plan-fanout work phase key');
  check(/const goalItems = PLAN_KEYS\.flatMap/.test(goalGen),
    'goals: plan-of-record derived from the PERSISTED plans, not re-decomposed');
  const dodGateBody = goalGen.slice(goalGen.indexOf("if (done.has('DoDGate'))"));
  // Both verifiers must live inside the SAME parallel([...]) — slice from its opening to the
  // destructured result's first use, so a sequential second await could not pass this.
  const parBlock = dodGateBody.slice(
    dodGateBody.indexOf('const [dodVerdict, goalVerdict] = await parallel(['),
    dodGateBody.indexOf('dodLast = dodVerdict'),
  );
  check(parBlock.includes('dodgate:verify-a') && parBlock.includes('dodgate:goals-a'),
    'goals: DoD verify + plan verify dispatch in ONE parallel() (no added wall-clock)');
  check(/const allUnmet = \(\) => \[\.\.\.dodUnmet\(\), \.\.\.goalUnmet\(\)\]/.test(dodGateBody),
    'goals: unmet set is the UNION of criteria and plan items');
  check(!/const unmet = dodUnmet\(\)/.test(dodGateBody)
    && !/unmet: dodUnmet\(\)/.test(dodGateBody)
    && !/unmetKey = dodUnmet\(\)/.test(dodGateBody),
    'goals: replan/escalate/stall route on allUnmet(), never dodUnmet() alone');
  check(/const goalsAnswered = !goalItems\.length \|\| /.test(dodGateBody)
    && /&& goalsAnswered && unmet\.length === 0/.test(dodGateBody),
    'goals: a DEAD plan verifier cannot read as "nothing unmet" — no verdicts, no pass');
  // The plan-of-record does not exist without a runtime planner, so the second verifier (and its
  // whole prompt) must not be emitted at all under --no-plan-fanout — dead prompt text is tokens.
  const goalNoFanout = gen('dod-goals-serial', ['--phases', 'Work', '--profile', 'delivery', '--dod-file', dodFile, '--no-plan-fanout']);
  check(!/dodgate:goals/.test(goalNoFanout) && !/PLAN_KEYS/.test(goalNoFanout)
    && /const goalItems = \[\]/.test(goalNoFanout),
    '--no-plan-fanout: no plan verifier emitted, goalItems is empty');

  // 9c. Dead-worker guard: parallel() yields null for an agent that died, and recording that as a
  //     completed item IS the drift — the item vanishes from the plan-of-record and the run walks
  //     on to a gate that can pass without it. Every plan-fanout combo must hard-fail instead.
  for (const [label, argv] of [
    ['bare', ['--phases', 'Work']],
    ['delivery', ['--phases', 'Implement', '--profile', 'delivery', '--dod-file', dodFile]],
  ]) {
    const g = gen('dead-item-' + label, argv);
    check(/const deadItems = level\.filter\(\(it, i\) => !levelOut\[i\]\)/.test(g)
      && /if \(deadItems\.length\) throw new Error\(/.test(g)
      && g.indexOf('const deadItems') < g.indexOf('levelOut.forEach'),
      `dead-item guard hard-fails before results are recorded (${label})`);
  }

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

// --- Golden snapshots: byte-pin the emitted output for a canonical combo set -------------
// The structural gates above only sample the output; these snapshots pin every byte of six
// canonical combos, so ANY unintended change to emitted worker prompts or conductor logic
// fails loudly. Inputs are the committed fixtures under <snapshotDir>/inputs/ (prompt text
// and DoD criteria are baked into output verbatim, so byte-equality needs pinned inputs;
// input file PATHS are not embedded, so regenerating against copies is safe).
const argv = process.argv.slice(2);
const snapDirFlag = argv.indexOf('--snapshot-dir');
const SNAP_DIR = snapDirFlag !== -1 && argv[snapDirFlag + 1]
  ? path.resolve(argv[snapDirFlag + 1])
  : (process.env.SNAPSHOT_DIR ? path.resolve(process.env.SNAPSHOT_DIR) : path.join(__dirname, 'snapshots'));
const UPDATE_SNAPSHOTS = argv.includes('--update-snapshots');
const SNAP_PROMPTS = path.join(SNAP_DIR, 'inputs', 'prompts.json');
const SNAP_DOD = path.join(SNAP_DIR, 'inputs', 'dod.json');
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');

// Canonical combo set (label → generator args). Every run is
//   node scaffold-workflow.cjs --name snap --out <tmp>/<label>.js --force <args>
// with cwd = repo root. The first six labels are the PINNED contract of
// evals/checks/scaffold-golden-snapshots.check.mjs — keep them in lockstep (that check requires
// `default.js` by name, so the label stays even though the no-flag default is now `auto`).
// `inherit` is an extra local combo pinning the opt-in byte-cost-free mode.
const SNAP_COMBOS = [
  ['default',    ['--phases', 'Work', '--prompts-file', SNAP_PROMPTS]],
  ['lite',       ['--phases', 'Work', '--profile', 'lite', '--dod-file', SNAP_DOD, '--prompts-file', SNAP_PROMPTS]],
  ['delivery',   ['--phases', 'Implement', '--profile', 'delivery', '--dod-file', SNAP_DOD, '--prompts-file', SNAP_PROMPTS]],
  ['cycle',      ['--phases', 'Implement', '--cycle', '--prompts-file', SNAP_PROMPTS]],
  ['panel',      ['--phases', 'Work', '--enforce-code', '--review-panel', '--prompts-file', SNAP_PROMPTS]],
  ['model-auto', ['--phases', 'Work', '--model-mode', 'auto', '--prompts-file', SNAP_PROMPTS]],
  ['model-inherit', ['--phases', 'Work', '--model-mode', 'inherit', '--prompts-file', SNAP_PROMPTS]],
];

if (!fs.existsSync(SNAP_PROMPTS) || !fs.existsSync(SNAP_DOD)) {
  console.error(`FAIL [snapshot] pinned input fixtures missing under ${path.join(SNAP_DIR, 'inputs')} (prompts.json + dod.json are committed data — restore them)`);
  failures++;
} else {
  for (const [label, extra] of SNAP_COMBOS) {
    const snapPath = path.join(SNAP_DIR, `${label}.js`);
    const outPath = path.join(tmp, `snap-${label}.js`);
    try {
      execFileSync('node', [GEN, '--name', 'snap', '--out', outPath, '--force', ...extra],
        { encoding: 'utf8', stdio: 'pipe', cwd: REPO_ROOT });
      if (UPDATE_SNAPSHOTS) {
        fs.mkdirSync(SNAP_DIR, { recursive: true });
        fs.copyFileSync(outPath, snapPath);
        console.log(`UPDATE [snapshot:${label}] wrote ${snapPath}`);
      } else if (!fs.existsSync(snapPath)) {
        console.error(`FAIL [snapshot:${label}] missing golden snapshot ${snapPath} — run \`node test-scaffold.cjs --update-snapshots\` and commit it`);
        failures++;
      } else if (!fs.readFileSync(outPath).equals(fs.readFileSync(snapPath))) {
        console.error(`FAIL [snapshot:${label}] regenerated output differs from ${snapPath}`);
        console.error('  If the generator change is INTENTIONAL: node test-scaffold.cjs --update-snapshots, review the fixture diff, commit it with the change.');
        failures++;
      } else {
        console.log(`PASS [snapshot:${label}] byte-equals golden snapshot`);
      }
    } catch (e) {
      console.error(`FAIL [snapshot:${label}] generation error: ${e.message.split('\n')[0]}`);
      failures++;
    }
  }
}

fs.rmSync(tmp, { recursive: true, force: true });

if (failures) {
  console.error(`\n${failures} combo(s) FAILED`);
  process.exit(1);
}
console.log(`\nAll ${MATRIX.length} combos passed.`);
