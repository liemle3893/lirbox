#!/usr/bin/env node
/*
 * Regression safety net for scaffold-optimize.cjs (the optimization-LOOP generator).
 * Analogous to conductor's test-scaffold.cjs, but the generator bakes only the LOOP
 * STRUCTURE — the run CONFIG (goal/surface/metric/gate/budgets/baseline) is data-in via
 * Workflow `args.config`, so the emitted body is identical for every slug. The
 * "representative configs" here are therefore representative NAME slugs.
 *
 * It does three things:
 *   1. STRUCTURE: for a few representative slugs, shell out to the generator, `node --check`
 *      each emitted loop, and assert the generated conductor contains the required loop
 *      structure (Setup, baseline, the experiment loop, the checkpoint worker, the
 *      surface-lock check, the resume reachability guard, the finalize return).
 *   2. NO-FS GUARD: assert the emitted body never does fs/git/clock/random at the conductor
 *      layer (those are illegal in the restricted layer; every side-effect lives in agent()
 *      workers). node --check cannot catch this — it is a string scan.
 *   3. UNIT: import the generator's pure decision helpers and test them directly —
 *      isBetter (both directions, minDelta, non-finite), shouldStop (each budget +
 *      plateau + precedence), deriveEvalCap (≈ 3×, floor, factor override, junk input).
 *
 * Exits non-zero on the first failing class (summarised), zero only when every check passes.
 *
 *   node test-optimize.cjs
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const GEN = path.join(__dirname, 'scaffold-optimize.cjs');
const { isBetter, shouldStop, deriveEvalCap, withinEditBudget } = require(GEN);

let failures = 0;
function fail(msg) { console.error(`FAIL ${msg}`); failures++; }
function assert(cond, msg) { if (cond) return true; fail(msg); return false; }

// ============================================================================
// PART 1 + 2 — STRUCTURE & NO-FS GUARD over a representative matrix of slugs.
// ============================================================================

// The loop body is config-independent, so the matrix varies only the slug (and exercises the
// kebab validator's edges). Each entry is [label, slug].
const MATRIX = [
  ['simple', 'search-speed'],
  ['hyphenated', 'bundle-size-min'],
  ['numeric', 'p95-2'],
  ['single-char', 'x'],
];

// Required structure markers — each is [human label, RegExp that MUST appear in the emitted loop].
// These pin the spec §2 loop shape: Setup → Baseline → experiment loop (propose → bounded eval →
// keep-or-discard with surface-lock → checkpoint) → finalize, plus the resume reachability guard.
const REQUIRED = [
  ['Setup phase',              /phase\('Setup'\)/],
  ['Baseline phase',           /phase\('Baseline'\)/],
  ['Experiments phase',        /phase\('Experiments'\)/],
  ['experiment loop',          /for \(let i = 0; i < MAXEXP; i\+\+\)/],
  ['baseline gate-must-pass',  /gate failed — cannot optimize a broken base/],
  ['propose worker',           /label: `propose:\$\{g\}`/],
  ['eval worker',              /label: `eval:\$\{g\}`/],
  ['keep-or-discard decision', /const keep = gatePassed && beats && surfaceOk && sizeOk/],
  ['edit-budget helper',       /function withinEditBudget\(diffLines, maxDiffLines\)/],
  ['edit-budget check',        /const sizeOk = withinEditBudget\(diffLines, MAXDIFF\)/],
  ['edit-budget measured incl. untracked', /git add -AN && git -c core\.quotepath=false diff --numstat HEAD/],
  ['oversized-diff discard reason', /'oversized-diff'/],
  ['keep commits on branch',   /git commit -m "opt\(/],
  ['keep stages all (post surface-lock)', /git add -A/],
  ['discard resets whole worktree', /git reset --hard HEAD/],
  ['discard cleans untracked', /git clean -fd\b/],
  ['surface-lock lists untracked', /status --porcelain --untracked-files=all/],
  ['checkpoint worker',        /async function checkpoint\(/],
  ['checkpoint call in loop',  /await checkpoint\(`g\$\{g\}`\)/],
  ['surface-lock check',       /const surfaceOk = surfaceAllows\(diffFiles, SURFACE\)/],
  ['surface-lock helper',      /function surfaceAllows\(files, surface\)/],
  ['resume reachability guard',/Unreachable resume:/],
  ['stop-condition check',     /const stop = shouldStop\(/],
  ['finalize return',          /return \{\s*\n\s*workflow: NAME, status: 'complete', stopReason,/],
];

// Conductor-layer illegality scan: the executing loop body (everything AFTER `export const meta`)
// must never touch fs/git/clock/randomness directly — those live only inside agent() worker
// prompt STRINGS, which are data, not executed by the conductor. So we scan the body with the
// agent(`…`) template literals stripped out, then forbid the restricted primitives.
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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'test-optimize-'));

for (const [label, slug] of MATRIX) {
  const out = path.join(tmp, `opt-${label}.js`);
  try {
    const stdout = execFileSync('node', [GEN, '--name', slug, '--out', out, '--force'], { encoding: 'utf8' });

    // Gate A: emitted loop must parse.
    execFileSync('node', ['--check', out], { stdio: 'pipe' });

    const src = fs.readFileSync(out, 'utf8');

    // Gate B: every required structure marker present.
    let okStruct = true;
    for (const [name, re] of REQUIRED) {
      if (!re.test(src)) { fail(`[${label}] missing required structure: ${name}`); okStruct = false; }
    }

    // Gate C: the slug is actually baked in (the only thing that varies per run).
    if (!new RegExp(`name: '${slug}'`).test(src)) fail(`[${label}] slug not baked into meta.name`);
    if (!new RegExp(`const NAME     = '${slug}'`).test(src)) fail(`[${label}] slug not baked into NAME const`);

    // Gate D: no restricted primitive at the conductor layer (string scan; node --check can't see it).
    const body = conductorBody(src);
    for (const [name, re] of FORBIDDEN) {
      if (re.test(body)) { fail(`[${label}] conductor body uses restricted primitive \`${name}\` (must live in a worker)`); okStruct = false; }
    }

    // Sanity: the generator reported its structure line.
    if (!/^Phases: Setup → Baseline → Experiments/m.test(stdout)) {
      fail(`[${label}] generator did not print the expected Phases line`);
    }

    if (okStruct) console.log(`PASS [${label}] structure + no-fs guard (${slug})`);
  } catch (e) {
    fail(`[${label}] generation/check error: ${e.message.split('\n')[0]}`);
    if (e.stderr) console.error(`  ${String(e.stderr).trim().split('\n').slice(-3).join('\n  ')}`);
  }
}

fs.rmSync(tmp, { recursive: true, force: true });

// ============================================================================
// PART 3 — UNIT tests of the exported pure decision helpers.
// ============================================================================

function eq(actual, expected, msg) {
  if (actual === expected) { console.log(`PASS unit: ${msg}`); return; }
  fail(`unit: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// --- isBetter(metric, best, direction, minDelta) ---
// min direction: lower is better → keep iff best - metric >= minDelta.
// NOTE on the `>= minDelta` boundary: the rule is "beat best by AT LEAST minDelta". With the
// default minDelta=0 that is `>= 0`, so an EQUAL metric ties through as a (harmless) keep; a
// strict-improvement requirement needs a positive minDelta. These cases pin that documented
// boundary, not a strict-greater interpretation.
eq(isBetter(9, 10, 'min', 0), true,  'isBetter min: 9 < 10 with delta 0 → keep');
eq(isBetter(10, 10, 'min', 0), true,  'isBetter min: equal with delta 0 → keep (0 >= 0 boundary)');
eq(isBetter(11, 10, 'min', 0), false, 'isBetter min: worse with delta 0 → no keep');
eq(isBetter(9.6, 10, 'min', 0.5), false, 'isBetter min: 0.4 improvement < minDelta 0.5 → no keep');
eq(isBetter(9.5, 10, 'min', 0.5), true,  'isBetter min: 0.5 improvement == minDelta 0.5 → keep');
eq(isBetter(9.4, 10, 'min', 0.5), true,  'isBetter min: 0.6 improvement > minDelta 0.5 → keep');
// max direction: higher is better → keep iff metric - best >= minDelta.
eq(isBetter(11, 10, 'max', 0), true,  'isBetter max: 11 > 10 with delta 0 → keep');
eq(isBetter(10, 10, 'max', 0), true,  'isBetter max: equal with delta 0 → keep (0 >= 0 boundary)');
eq(isBetter(9, 10, 'max', 0), false, 'isBetter max: worse with delta 0 → no keep');
eq(isBetter(10.4, 10, 'max', 0.5), false, 'isBetter max: 0.4 gain < minDelta 0.5 → no keep');
eq(isBetter(10.5, 10, 'max', 0.5), true,  'isBetter max: 0.5 gain == minDelta 0.5 → keep');
// no baseline yet → any finite metric wins.
eq(isBetter(42, null, 'min', 5), true, 'isBetter: null best → any finite metric wins');
eq(isBetter(42, NaN, 'max', 5),  true, 'isBetter: NaN best → any finite metric wins');
// non-finite metric never beats best.
eq(isBetter(NaN, 10, 'min', 0),       false, 'isBetter: NaN metric never beats');
eq(isBetter(Infinity, 10, 'min', 0),  false, 'isBetter: Infinity metric never beats');
eq(isBetter('9', 10, 'min', 0),       false, 'isBetter: non-number metric never beats');

// --- shouldStop(experimentsDone, sinceKept, total, plateauStop, elapsedMin, tokensUsed) ---
// each budget on its own.
eq(shouldStop(5, 0, { experiments: 5 }, 0),                 'experiments', 'shouldStop: experiments budget hit');
eq(shouldStop(4, 0, { experiments: 5 }, 0),                 null,          'shouldStop: under experiments budget → continue');
eq(shouldStop(0, 0, { wallclockMin: 60 }, 0, 60),           'wallclock',   'shouldStop: wallclock budget hit');
eq(shouldStop(0, 0, { wallclockMin: 60 }, 0, 59),           null,          'shouldStop: under wallclock → continue');
eq(shouldStop(0, 0, { wallclockMin: 60 }, 0, undefined),    null,          'shouldStop: wallclock unknown (no worker measure) → continue');
eq(shouldStop(0, 0, { tokens: 1000 }, 0, undefined, 1000),  'tokens',      'shouldStop: tokens budget hit');
eq(shouldStop(0, 0, { tokens: 1000 }, 0, undefined, 999),   null,          'shouldStop: under tokens → continue');
eq(shouldStop(0, 3, {}, 3),                                 'plateau',     'shouldStop: plateau hit (sinceKept >= plateauStop)');
eq(shouldStop(0, 2, {}, 3),                                 null,          'shouldStop: under plateau → continue');
eq(shouldStop(0, 5, {}, 0),                                 null,          'shouldStop: plateau disabled when plateauStop 0');
// precedence: experiments is checked first.
eq(shouldStop(5, 9, { experiments: 5 }, 3),                 'experiments', 'shouldStop: experiments takes precedence over plateau');
eq(shouldStop(0, 0, {}, 0),                                 null,          'shouldStop: empty budgets → never stops');

// --- withinEditBudget(diffLines, maxDiffLines) — the edit-size budget ("textual learning rate"). ---
// disabled (absent/0/junk max) → always true, even with no measurement (back-compat).
eq(withinEditBudget(null, undefined), true,  'withinEditBudget: no budget, no measurement → true');
eq(withinEditBudget(9999, 0),         true,  'withinEditBudget: budget 0 = disabled → true');
eq(withinEditBudget(9999, -5),        true,  'withinEditBudget: negative budget = disabled → true');
// enabled → boundary at <= max.
eq(withinEditBudget(50, 100),  true,  'withinEditBudget: under budget → true');
eq(withinEditBudget(100, 100), true,  'withinEditBudget: exactly at budget → true');
eq(withinEditBudget(101, 100), false, 'withinEditBudget: over budget → false');
// enabled + unmeasured → conservatively over-budget (a bound you cannot verify is not met).
eq(withinEditBudget(null, 100), false, 'withinEditBudget: enabled but unmeasured → false');
eq(withinEditBudget(NaN, 100),  false, 'withinEditBudget: enabled but NaN measurement → false');

// --- deriveEvalCap(evalSec, factor) — default factor ~3 (spec §3), floored at 30. ---
eq(deriveEvalCap(20),      60, 'deriveEvalCap: 20s × 3 = 60');
eq(deriveEvalCap(100),    300, 'deriveEvalCap: 100s × 3 = 300');
eq(deriveEvalCap(5),       30, 'deriveEvalCap: 5s × 3 = 15, floored to 30');
eq(deriveEvalCap(0),       30, 'deriveEvalCap: 0 baseline → floor 30');
eq(deriveEvalCap(NaN),     30, 'deriveEvalCap: NaN baseline → floor 30');
eq(deriveEvalCap(-10),     30, 'deriveEvalCap: negative baseline → floor 30');
eq(deriveEvalCap(100, 2), 200, 'deriveEvalCap: factor override 2 → 200');
eq(deriveEvalCap(100, 0), 300, 'deriveEvalCap: junk factor 0 → default 3');
// the spec relation: cap ≈ 3 × evalSec for a non-trivial baseline (above the floor).
{
  const evalSec = 47;
  const cap = deriveEvalCap(evalSec);
  const ratio = cap / evalSec;
  eq(Math.abs(ratio - 3) < 0.05, true, `deriveEvalCap: cap/evalSec ≈ 3 (got ${ratio.toFixed(3)})`);
}

// ============================================================================
if (failures) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log(`\nAll checks passed (${MATRIX.length} slug(s) + unit suite).`);
