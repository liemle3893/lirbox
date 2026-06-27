#!/usr/bin/env node
/*
 * Regression net for scaffold-improve.cjs.
 *
 * Part 1/2 (Task 2): for the flowchart slug, shell out to the generator, `node --check`
 *   the emitted loop, assert it contains the backlog GREEN-loop structure markers, and
 *   run the no-fs scan (the restricted conductor layer must never touch fs/git/clock/random
 *   outside agent() worker prompt strings).
 * Part 3 (Task 1): unit-test the pure decision helpers (surfaceAllows / verdictOf /
 *   shouldStop) exported from the generator.
 */
const path = require('path');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const GEN = path.join(__dirname, 'scaffold-improve.cjs');
const { surfaceAllows, verdictOf, shouldStop } = require(GEN);

let failures = 0;
function fail(m){ console.error(`FAIL ${m}`); failures++; }
function eq(a, e, m){ if (a===e){ console.log(`PASS unit: ${m}`); return; } fail(`unit: ${m} — expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`); }

// ============================================================================
// PART 1 + 2 — STRUCTURE & NO-FS GUARD for the emitted backlog GREEN loop.
// ============================================================================

// Required structure markers — each is [human label, RegExp that MUST appear in the emitted loop].
// These pin the spec §2 loop shape: Setup → Baseline (floor-must-pass) → per-item fix→eval→
// keep/revert with surface-lock → checkpoint → finalize.
const REQUIRED = [
  ['Setup phase',            /phase\('Setup'\)/],
  ['Baseline phase',         /phase\('Baseline'\)/],
  ['Items phase',            /phase\('Items'\)/],
  ['item loop',              /for \(let i = 0; i < ITEMS\.length; i\+\+\)/],
  ['baseline floor-must-pass', /Baseline floor failed — cannot improve a skill whose floor is red/],
  ['fixer worker',           /label: `fix:\$\{item\.id\}/],
  ['fixer retry bound',      /RETRIES/],
  ['eval worker',            /label: `eval:\$\{item\.id\}/],
  ['surface-lock untracked', /status --porcelain --untracked-files=all/],
  ['keep-or-revert decision',/verdictOf\(floorPassed, checkPassed, surfaceOk\)/],
  ['keep commits on branch', /git commit -m "whetstone\(/],
  ['revert resets worktree', /git reset --hard HEAD/],
  ['revert cleans untracked',/git clean -fd\b/],
  ['checkpoint worker',      /async function checkpoint\(/],
  ['surface-lock helper',    /function surfaceAllows\(files, editable, locked\)/],
  ['stop check',             /const stop = shouldStop\(/],
  ['finalize return',        /status: 'complete'/],
];

// Conductor-layer illegality scan (forked verbatim from prospector's test-optimize.cjs lines 80-94):
// the executing loop body (everything AFTER `const CONFIG`) must never touch fs/git/clock/randomness
// directly — those live only inside agent() worker prompt STRINGS, which are data, not executed by
// the conductor. So we scan the body with the agent(`…`) template literals stripped out, then forbid
// the restricted primitives. node --check cannot catch this — it is a string scan.
function conductorBody(src) {
  // drop the metadata block (it legitimately names phases) — keep only the executing body.
  const body = src.slice(src.indexOf('const CONFIG'));
  // strip agent(`…`) worker prompts (template literals): they are worker instructions (strings),
  // not conductor code. A non-greedy match up to the closing backtick is enough here because the
  // generated prompts contain no nested unescaped backticks at the top level.
  return body.replace(/`(?:[^`\\]|\\.)*`/g, '""');
}
const FORBIDDEN = [
  ["require(", /\brequire\s*\(/],
  ["fs.",      /\bfs\./],
  ["Date.now", /\bDate\.now\s*\(/],
  ["new Date", /\bnew Date\b/],
  ["Math.random", /\bMath\.random\s*\(/],
];

{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'test-improve-'));
  const slug = 'flowchart';
  const out = path.join(tmp, `wh-${slug}.js`);
  try {
    const stdout = execFileSync('node', [GEN, '--name', slug, '--out', out, '--force'], { encoding: 'utf8' });

    // Gate A: emitted loop must parse.
    execFileSync('node', ['--check', out], { stdio: 'pipe' });

    const src = fs.readFileSync(out, 'utf8');

    // Gate B: every required structure marker present.
    let okStruct = true;
    for (const [name, re] of REQUIRED) {
      if (!re.test(src)) { fail(`[${slug}] missing required structure: ${name}`); okStruct = false; }
    }

    // Gate C: the slug is actually baked in.
    if (!new RegExp(`name: '${slug}'`).test(src)) fail(`[${slug}] slug not baked into meta.name`);
    if (!new RegExp(`const NAME = '${slug}'`).test(src)) fail(`[${slug}] slug not baked into NAME const`);

    // Gate D: no restricted primitive at the conductor layer (string scan; node --check can't see it).
    const body = conductorBody(src);
    for (const [name, re] of FORBIDDEN) {
      if (re.test(body)) { fail(`[${slug}] conductor body uses restricted primitive \`${name}\` (must live in a worker)`); okStruct = false; }
    }

    // Sanity: the generator reported its structure line.
    if (!/^Phases: Setup → Baseline → Items/m.test(stdout)) {
      fail(`[${slug}] generator did not print the expected Phases line`);
    }

    if (okStruct) console.log(`PASS [${slug}] structure + no-fs guard`);
  } catch (e) {
    fail(`[${slug}] generation/check error: ${e.message.split('\n')[0]}`);
    if (e.stderr) console.error(`  ${String(e.stderr).trim().split('\n').slice(-3).join('\n  ')}`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ============================================================================
// PART 3 — UNIT tests of the exported pure decision helpers.
// ============================================================================

const ED = 'plugins/lirbox/skills/flowchart/**';
const LK = ['plugins/lirbox/skills/flowchart/evals/**', 'feedback/flowchart.jsonl'];
// in-surface edit → ok
eq(surfaceAllows(['plugins/lirbox/skills/flowchart/assets/validate.mjs'], ED, LK), true, 'editable file allowed');
// touches a locked test → blocked (the anti-gaming fence)
eq(surfaceAllows(['plugins/lirbox/skills/flowchart/evals/node-nonascii.test.mjs'], ED, LK), false, 'locked evals/ file blocked');
// touches the backlog → blocked
eq(surfaceAllows(['feedback/flowchart.jsonl'], ED, LK), false, 'locked backlog blocked');
// outside the skill entirely → blocked
eq(surfaceAllows(['plugins/lirbox/skills/conductor/SKILL.md'], ED, LK), false, 'out-of-skill file blocked');
// empty diff → blocked (a fix must change something)
eq(surfaceAllows([], ED, LK), false, 'empty diff blocked');
// mixed (one good, one locked) → blocked (ALL must pass)
eq(surfaceAllows(['plugins/lirbox/skills/flowchart/SKILL.md','plugins/lirbox/skills/flowchart/evals/x.test.mjs'], ED, LK), false, 'any locked file blocks the whole set');

eq(verdictOf(true,  true,  true ), 'kept',     'verdict: all green → kept');
eq(verdictOf(false, true,  true ), 'reverted', 'verdict: floor broke → reverted');
eq(verdictOf(true,  false, true ), 'reverted', 'verdict: check failed → reverted');
eq(verdictOf(true,  true,  false), 'reverted', 'verdict: surface violated → reverted');

eq(shouldStop(3, { items: 3 }), 'items',     'stop: all items done');
eq(shouldStop(2, { items: 3 }), null,        'stop: items remain → continue');
eq(shouldStop(0, { wallclockMin: 60 }, 60),  'wallclock', 'stop: wallclock hit');
eq(shouldStop(0, { wallclockMin: 60 }, 59),  null,        'stop: under wallclock → continue');
eq(shouldStop(0, { tokens: 1000 }, undefined, 1000), 'tokens', 'stop: tokens hit');
eq(shouldStop(0, {}, undefined, undefined),  null,        'stop: no budget → never');

// ============================================================================
// PART 4 — check-baseline.cjs discrimination gate (fail-before / pass-after).
// A legitimate acceptance-check MUST fail on the unmodified baseline; otherwise
// it proves nothing. check-baseline.cjs exits 0 iff the given check FAILS there.
// ============================================================================

const cb = path.join(__dirname, 'check-baseline.cjs');
function run(cmd){ try { execFileSync('node', [cb, cmd], { stdio: 'pipe' }); return 0; } catch(e){ return e.status || 1; } }
eq(run('exit 1'), 0, 'check-baseline: a check that FAILS on baseline is discriminating (exit 0)');
eq(run('true'),   1, 'check-baseline: a check that PASSES on baseline is non-discriminating (exit 1)');

// ============================================================================
// PART 5 — list-improvements.cjs + improve-report.cjs against a fixture ledger.
// Both run in the MAIN session and read .improve/state/<skill>.json. We write a
// temp fixture state (one kept item, one unresolved, one human-only), assert the
// list shows it with the right columns and the report writes a verdict table +
// counts, then clean up the fixtures we created.
// ============================================================================

const LIST = path.join(__dirname, 'list-improvements.cjs');
const REPORT = path.join(__dirname, 'improve-report.cjs');
const SKILL = 'fixture-skill';
const stateDir = path.join('.improve', 'state');
const reportDir = path.join('.improve', 'reports');
const fixState = path.join(stateDir, SKILL + '.json');
const fixReport = path.join(reportDir, SKILL + '.md');
// track whether these dirs pre-existed so we don't nuke a real .improve/ on cleanup.
const stateDirPre = fs.existsSync(stateDir);
const reportDirPre = fs.existsSync(reportDir);

fs.mkdirSync(stateDir, { recursive: true });
fs.writeFileSync(fixState, JSON.stringify({
  name: SKILL, skill: SKILL, skillPath: 'plugins/lirbox/skills/fixture-skill',
  status: 'complete', branch: 'improve/fixture-skill', worktree: '.worktrees/improve-fixture-skill',
  baseline: { floorPassed: true },
  startedAt: '2026-06-26T00:00:00.000Z', updatedAt: '2026-06-26T00:10:00.000Z', finishedAt: '2026-06-26T00:10:00.000Z',
  humanOnly: ['x'],
  items: [
    { id: 'a-kept',       type: 'concern',    change: 'fixed a',     floor: 'pass', check: 'pass', verdict: 'kept',       sha: 'deadbeefcafe1234' },
    { id: 'b-unresolved', type: 'suggestion', change: '(no change)', floor: 'pass', check: 'fail', verdict: 'unresolved', sha: null },
  ],
}, null, 2));

try {
  // list --all must surface the fixture run with kept=1 / unresolved=1 and the new columns.
  const listOut = execFileSync('node', [LIST, '--all'], { encoding: 'utf8' });
  eq(/\bfixture-skill\b/.test(listOut), true, 'list-improvements: fixture run shown with --all');
  eq(/NAME\s+STATUS\s+ITEMS\s+KEPT\s+UNRESOLVED\s+DURATION/.test(listOut), true, 'list-improvements: header has ITEMS/KEPT/UNRESOLVED columns');

  // report writes .improve/reports/fixture-skill.md with the verdict table + counts.
  execFileSync('node', [REPORT, SKILL], { encoding: 'utf8' });
  eq(fs.existsSync(fixReport), true, 'improve-report: writes .improve/reports/fixture-skill.md');
  const md = fs.readFileSync(fixReport, 'utf8');
  eq(/\bkept\b/.test(md), true, 'improve-report: report mentions kept');
  eq(/\bunresolved\b/.test(md), true, 'improve-report: report mentions unresolved');
  eq(/a-kept/.test(md) && /b-unresolved/.test(md), true, 'improve-report: per-item verdict table lists both items');
  eq(/git diff [^\n]*improve\/fixture-skill/.test(md), true, 'improve-report: includes git diff pointer to the branch');
} catch (e) {
  fail(`fixture-state report/list error: ${e.message.split('\n')[0]}`);
  if (e.stderr) console.error(`  ${String(e.stderr).trim().split('\n').slice(-3).join('\n  ')}`);
} finally {
  // clean up only what we created; leave any pre-existing real .improve/ alone.
  try { fs.rmSync(fixState, { force: true }); } catch {}
  try { fs.rmSync(fixReport, { force: true }); } catch {}
  if (!stateDirPre) { try { fs.rmSync(stateDir, { recursive: true, force: true }); } catch {} }
  if (!reportDirPre) { try { fs.rmSync(reportDir, { recursive: true, force: true }); } catch {} }
  // remove the .improve/ root only if we created it and it is now empty.
  try { if (fs.existsSync('.improve') && fs.readdirSync('.improve').length === 0) fs.rmdirSync('.improve'); } catch {}
}

// ============================================================================
// PART 4 — scaffold-readiness.cjs: makes a skill whetstone-ready (init mode).
// It must write the floor scaffolding, detect argument-hint (custom floor), produce a GREEN
// floor on the fresh skill, and be idempotent.
// ============================================================================
const SCAF = path.join(__dirname, 'scaffold-readiness.cjs');
const rtmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-readiness-'));
const rSkill = path.join(rtmp, 'tskill');
fs.mkdirSync(rSkill, { recursive: true });
fs.writeFileSync(path.join(rSkill, 'SKILL.md'),
  '---\nname: tskill\nargument-hint: "[x]"\ndescription: "tmp skill for the readiness test."\nallowed-tools:\n  - Read\n---\nBody.\n');
try {
  // cwd=rtmp so the scaffolder's feedback/<skill>.jsonl lands in the tmp dir, not the repo.
  const out = execFileSync('node', [SCAF, '--name', 'tskill', '--skill-path', rSkill], { encoding: 'utf8', cwd: rtmp });
  eq(/custom floor/.test(out), true, 'scaffold-readiness: argument-hint → custom floor (quick_validate skipped)');
  eq(fs.existsSync(path.join(rSkill, 'evals', 'run.mjs')), true, 'scaffold-readiness: writes evals/run.mjs');
  eq(fs.existsSync(path.join(rSkill, 'evals', 'floor', '00-structure.test.mjs')), true, 'scaffold-readiness: writes floor/00-structure.test.mjs');
  eq(fs.existsSync(path.join(rSkill, 'evals', 'checks', '.gitkeep')), true, 'scaffold-readiness: writes checks/.gitkeep');
  eq(fs.existsSync(path.join(rSkill, 'evals', 'README.md')), true, 'scaffold-readiness: writes evals/README.md');
  eq(fs.existsSync(path.join(rtmp, 'feedback', 'tskill.jsonl')), true, 'scaffold-readiness: writes empty feedback/<skill>.jsonl');
  // the scaffolded floor MUST be green on the fresh skill (throws → caught below).
  execFileSync('node', [path.join(rSkill, 'evals', 'run.mjs')], { stdio: 'pipe' });
  eq(true, true, 'scaffold-readiness: the scaffolded floor is GREEN on baseline');
  // idempotency: a second run must skip every file.
  const out2 = execFileSync('node', [SCAF, '--name', 'tskill', '--skill-path', rSkill], { encoding: 'utf8', cwd: rtmp });
  eq((out2.match(/skip \(exists\)/g) || []).length, 5, 'scaffold-readiness: idempotent re-run skips all 5 files');
} catch (e) {
  fail(`scaffold-readiness error: ${e.message.split('\n')[0]}`);
  if (e.stderr) console.error(`  ${String(e.stderr).trim().split('\n').slice(-3).join('\n  ')}`);
} finally {
  try { fs.rmSync(rtmp, { recursive: true, force: true }); } catch {}
}

if (failures) { console.error(`\n${failures} check(s) FAILED`); process.exit(1); }
console.log(`\nAll helper checks passed.`);
