#!/usr/bin/env node
/* Regression net for scaffold-arena.cjs + arena-report.cjs:
 *   1. HELPER UNITS  — the pure decision/scoring helpers.
 *   2. STRUCTURE     — required markers in the emitted loop.
 *   3. NO-FS GUARD   — conductor-layer purity scan of the emitted body (string scan; node --check can't see it).
 *   4. REPORT RENDER — renderLeaderboard ranks configs and emits a win-rate matrix.
 */
const path = require('path');
const GEN = path.join(__dirname, 'scaffold-arena.cjs');
const { configHash, planCells, pickPairSamples, resolveForfeit, tallyVerdicts, winRateMatrix, bradleyTerry, generate } = require(GEN);
const { renderLeaderboard } = require(path.join(__dirname, 'arena-report.cjs'));

let failures = 0;
function fail(msg) { console.error(`FAIL ${msg}`); failures++; }
function assert(cond, msg) { if (cond) return; fail(msg); }
function eq(a, b, msg) { assert(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }

// ---------------------------------------------------------------- 1. HELPER UNITS
{
  const a = configHash({ model: 'opus', mode: 'auto', effort: 'high' });
  const b = configHash({ effort: 'high', mode: 'auto', model: 'opus' });
  assert(a === b, 'configHash: key order does not change the hash');
  assert(a !== configHash({ model: 'opus', mode: 'auto', effort: 'medium' }), 'configHash: differing config differs');
  assert(/^[0-9a-f]+$/.test(a), 'configHash: hex string');
}
{
  const cells = planCells(['t1', 't2'], [{ effort: 'high' }, { effort: 'medium' }], 3);
  eq(cells.length, 12, 'planCells: 2 tasks × 2 configs × 3 runs = 12');
  eq(cells.filter((c) => c.taskId === 't1' && c.configHash === configHash({ effort: 'high' })).length, 3, 'planCells: 3 runs per cell');
}
{
  const s = pickPairSamples(3, 3, 5);
  eq(s.length, 5, 'pickPairSamples: one entry per pass');
  assert(s.every((p) => p.aIdx >= 0 && p.aIdx < 3 && p.bIdx >= 0 && p.bIdx < 3), 'pickPairSamples: indices in range');
  eq(s.filter((p) => p.swap).length, 2, 'pickPairSamples: 5 passes → 2 swapped');
  eq(pickPairSamples(3, 3, 5), pickPairSamples(3, 3, 5), 'pickPairSamples: deterministic');
}
{
  eq(resolveForfeit(0, 3), 'B', 'resolveForfeit: A all-forfeit → B wins');
  eq(resolveForfeit(3, 0), 'A', 'resolveForfeit: B all-forfeit → A wins');
  eq(resolveForfeit(0, 0), 'tie', 'resolveForfeit: both forfeit → tie');
  eq(resolveForfeit(2, 1), null, 'resolveForfeit: both valid → judge');
}
{
  const t = tallyVerdicts([
    { winner: 'A', swap: false }, // true A
    { winner: 'A', swap: true },  // shown-A was true B → B win
    { winner: 'tie', swap: false },
  ]);
  eq(t, { aWins: 1, bWins: 1, ties: 1 }, 'tallyVerdicts: swap-aware un-mapping');
}
{
  const m = winRateMatrix([{ a: 'x', b: 'y', aWins: 3, bWins: 1, ties: 0 }], ['x', 'y']);
  eq(m.x.y, 0.75, 'winRateMatrix: x beats y 3/4');
  eq(m.y.x, 0.25, 'winRateMatrix: symmetric complement');
  assert(m.x.x === null, 'winRateMatrix: diagonal null');
}
{
  const r = bradleyTerry([{ a: 'x', b: 'y', aWins: 9, bWins: 1, ties: 0 }], ['x', 'y']);
  assert(r.x > r.y, 'bradleyTerry: x (9-1) rated above y');
  eq(bradleyTerry([{ a: 'x', b: 'y', aWins: 9, bWins: 1, ties: 0 }], ['x', 'y']), r, 'bradleyTerry: deterministic');
  // 3-config dominance order strong > mid > weak
  const t3 = [
    { a: 's', b: 'm', aWins: 8, bWins: 2, ties: 0 },
    { a: 's', b: 'w', aWins: 9, bWins: 1, ties: 0 },
    { a: 'm', b: 'w', aWins: 7, bWins: 3, ties: 0 },
  ];
  const r3 = bradleyTerry(t3, ['s', 'm', 'w']);
  assert(r3.s > r3.m && r3.m > r3.w, 'bradleyTerry: 3-config dominance order s>m>w');
}
if (!failures) console.log('PASS helper units');

// ---------------------------------------------------------------- 2 + 3. STRUCTURE + PURITY
const src = generate('arena-test');
const STRUCTURE = [
  ['meta block',            /export const meta = \{/],
  ['phase Setup',           /phase\('Setup'\)/],
  ['phase Execute',         /phase\('Execute'\)/],
  ['phase Judge',           /phase\('Judge'\)/],
  ['phase Score',           /phase\('Score'\)/],
  ['phase Finalize',        /phase\('Finalize'\)/],
  ['args string-normalize', /if \(typeof args === 'string'\) args = JSON\.parse\(args\)/],
  ['config from args',      /const CONFIG\s*=/],
  ['checkpoint worker',     /async function checkpoint\(/],
  ['cell runner',           /function runCell\(/],
  ['inlined bradleyTerry',  /function bradleyTerry\(/],
  ['inlined tallyVerdicts', /function tallyVerdicts\(/],
  ['inlined planCells',     /function planCells\(/],
  ['runCell has schema',    /function runCell\([\s\S]*?schema:/],
  ['judgePass has schema',  /function judgePass\([\s\S]*?schema:/],
  ['per-cell cap',          /CELLCAPSEC/],
  ['promote to docs/arena', /docs\/arena\//],
  ['stream-json trace',     /stream-json/],
  ['asserts conductor ran', /\.workflows\/|wf\/ branch|Workflow tool_use/],
];
let okStruct = true;
for (const [name, re] of STRUCTURE) if (!re.test(src)) { fail(`structure: missing ${name}`); okStruct = false; }
if (okStruct) console.log('PASS structure markers');

// Conductor-layer purity: scan everything AFTER `export const meta`, minus template literals (worker
// prompt STRINGS are data, not executed by the conductor).
function conductorBody(s) {
  const i = s.indexOf('export const meta');
  return s.slice(i).replace(/`(?:\\[\s\S]|[^`\\])*`/g, '``');
}
const body = conductorBody(src);
const FORBIDDEN = [
  ['require(', /\brequire\s*\(/],
  ['fs.', /\bfs\s*\./],
  ['Date.now', /\bDate\.now\s*\(/],
  ['new Date()', /\bnew Date\s*\(\s*\)/],
  ['Math.random', /\bMath\.random\s*\(/],
  ['child_process', /child_process/],
];
let okPure = true;
for (const [name, re] of FORBIDDEN) if (re.test(body)) { fail(`purity: forbidden ${name} at conductor layer`); okPure = false; }
if (okPure) console.log('PASS conductor purity (no fs/git/clock/random)');

// ---------------------------------------------------------------- 4. REPORT RENDER
{
  const state = {
    name: 'x',
    ratings: { aaaa1111: 2.0, bbbb2222: 0.5 },
    matrix: { aaaa1111: { aaaa1111: null, bbbb2222: 0.8 }, bbbb2222: { aaaa1111: 0.2, bbbb2222: null } },
    tallies: [{ a: 'aaaa1111', b: 'bbbb2222', aWins: 8, bWins: 2, ties: 0 }],
    runs: [{ taskId: 't', configHash: 'bbbb2222', runIndex: 0, forfeit: true, forfeitReason: 'timeout' }],
  };
  const { html, md } = renderLeaderboard(state);
  assert(html.indexOf('aaaa1111') < html.indexOf('bbbb2222'), 'report: higher-rated config listed first');
  assert(/win.?rate/i.test(md), 'report: md has win-rate matrix');
  assert(/forfeit/i.test(md) && md.indexOf('timeout') > -1, 'report: forfeited cell flagged, not dropped');
  if (!failures) console.log('PASS report render');
}

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nALL PASS');
