// ACCEPTANCE-CHECK (arena: engagement-measured-not-assumed) — RED on baseline, GREEN after the fix.
//
// Concern: the scoreboard reported engagement it never measured. `swe-score.mjs` loadCells()
// hardcoded `engaged: true` on every cell it reconstructed from a `.grade` file, and `swe-run.mjs`
// only wrote a `.grade` file on the ENGAGED path — so a non-engaged cell left no artifact, could
// never appear in a `--cells` rebuild, and the rebuilt row read 100% engaged by construction.
//
// The fix must not swap one silent assumption for another: a legacy grade record (no `engaged`
// field) is UNKNOWN, not engaged, and its row keeps the † "assumed, not measured" marker.
//
// Assertions:
//   1. A grade record with `engaged: false` is counted as NON-engaged (measured path).
//   2. A rebuilt row whose cells all carry `engaged` renders WITHOUT †.
//   3. A LEGACY grade record with no `engaged` field is NOT counted as measured-engaged, keeps the
//      pre-existing numbers, and its row still renders WITH †.
//   4. swe-run.mjs writes a `.grade` record for EVERY cell — not only inside the engaged branch —
//      carrying the engagement it measured from the wf/ branch.
//
// Locked (evals/**): a fixer may NEVER edit this file.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = resolve(HERE, '..', '..', 'scripts');
const SCORE = join(SCRIPTS, 'swe-score.mjs');
const REPO = resolve(HERE, '..', '..', '..', '..', '..', '..'); // checks → evals → arena → skills → lirbox → plugins → repo
const REAL_SCORES = join(REPO, 'docs', 'arena', 'scores');

let ok = true;
const fail = (m) => { console.error('FAIL: ' + m); ok = false; };

const root = mkdtempSync(join(tmpdir(), 'arena-eng-check-'));
const NAMES = ['zz-eng-check-measured', 'zz-eng-check-legacy'];

// Rebuild a scorecard from `.grade` records, rendering the scoreboard into a scratch dir so the
// real docs/arena/scores/ is never touched. Returns { score, card, board }.
function rebuild(name, records) {
  const cellsDir = join(root, name + '-cells');
  const board = join(root, name + '-board');
  mkdirSync(cellsDir, { recursive: true });
  mkdirSync(board, { recursive: true });
  for (const [file, rec] of Object.entries(records)) writeFileSync(join(cellsDir, file), JSON.stringify(rec));
  const out = execFileSync('node', [SCORE, '--cells', cellsDir, '--name', name, '--config', '{}'],
    { encoding: 'utf8', env: { ...process.env, ARENA_SCORES_DIR: board } });
  if (!existsSync(join(board, name + '.json'))) {
    throw new Error(`swe-score.mjs did not honour ARENA_SCORES_DIR — no ${name}.json in the scratch board`);
  }
  return {
    score: JSON.parse(out).score,
    card: JSON.parse(readFileSync(join(board, name + '.json'), 'utf8')),
    row: readFileSync(join(board, 'README.md'), 'utf8').split('\n').find((l) => l.startsWith(`| ${name} |`)) || '',
  };
}

try {
  // ---- 1 + 2: records that CARRY engagement are measured, and render without † --------------
  const measured = rebuild(NAMES[0], {
    'a--run0.grade': { task: 'a', engaged: true, resolved: true, p2p: { pass: true }, f2p: { passed: 3, total: 3 } },
    'b--run0.grade': { task: 'b', engaged: false, resolved: false, reason: 'no-conductor-engagement', f2p: { passed: 0, total: 0 } },
    'c--run0.grade': { task: 'c', engaged: true, resolved: false, p2p: { pass: true }, f2p: { passed: 1, total: 3 } },
  });
  if (measured.score.total !== 3 || measured.score.resolved !== 1) {
    fail(`headline changed: expected 1/3 resolved, got ${measured.score.resolved}/${measured.score.total}`);
  }
  if (measured.score.engagementRate !== 0.667) {
    fail(`a grade record with engaged:false was not counted as non-engaged — engagementRate ${measured.score.engagementRate}, expected 0.667 (2 of 3)`);
  }
  if (measured.score.engagementMeasured !== 3) {
    fail(`all 3 records carried engagement but engagementMeasured is ${JSON.stringify(measured.score.engagementMeasured)}, expected 3`);
  }
  const flags = measured.card.cells.map((c) => c.engaged);
  if (JSON.stringify(flags) !== JSON.stringify([true, false, true])) {
    fail(`cell engagement was not read from the grade records: got ${JSON.stringify(flags)}, expected [true,false,true]`);
  }
  if (!measured.row) fail(`no scoreboard row rendered for ${NAMES[0]}`);
  else {
    if (measured.row.includes('†')) fail(`a fully measured row was marked † (assumed): ${measured.row.trim()}`);
    if (!measured.row.includes('| 2/3 |')) fail(`Engaged column should read 2/3 for the measured row: ${measured.row.trim()}`);
    if (!measured.row.includes('| 1/2 |')) fail(`Resolved|Eng should read 1/2 (1 of the 2 engaged cells resolved): ${measured.row.trim()}`);
  }

  // ---- 3: LEGACY records (no engaged field) stay UNKNOWN — never promoted to measured ------
  const legacy = rebuild(NAMES[1], {
    'a--old.grade': { task: 'a', resolved: true, p2p: { pass: true }, f2p: { passed: 3, total: 3 } },
    'b--old.grade': { task: 'b', resolved: true, p2p: { pass: true }, f2p: { passed: 3, total: 3 } },
  });
  if (legacy.score.engagementMeasured !== 0) {
    fail(`legacy records carry no engagement, but engagementMeasured is ${JSON.stringify(legacy.score.engagementMeasured)}, expected 0`);
  }
  const legacyFlags = legacy.card.cells.map((c) => c.engaged);
  if (legacyFlags.some((e) => e === true)) {
    fail(`a legacy record with NO engaged field was recorded as engaged:true — that is the assumption the fix removes: ${JSON.stringify(legacyFlags)}`);
  }
  if (legacy.score.engagementRate !== 1) {
    fail(`legacy rows must keep their existing numbers (unknown still counts in the numerator): engagementRate ${legacy.score.engagementRate}, expected 1`);
  }
  if (!legacy.row) fail(`no scoreboard row rendered for ${NAMES[1]}`);
  else if (!legacy.row.includes('†')) fail(`a legacy (never-measured) row lost its † marker: ${legacy.row.trim()}`);

  // ---- 4: swe-run writes a grade record for EVERY cell, not only the engaged branch --------
  const runSrc = readFileSync(join(SCRIPTS, 'swe-run.mjs'), 'utf8');
  if (!/engaged:\s*!!wf/.test(runSrc)) fail('swe-run.mjs no longer measures engagement as `engaged: !!wf`');
  const anchor = runSrc.indexOf('no-conductor-engagement');
  const open = anchor < 0 ? -1 : runSrc.indexOf('{', runSrc.indexOf('else', anchor));
  let close = -1;
  if (open > -1) {
    let depth = 0;
    for (let i = open; i < runSrc.length; i++) {
      if (runSrc[i] === '{') depth++;
      else if (runSrc[i] === '}') { depth--; if (!depth) { close = i; break; } }
    }
  }
  if (close < 0) {
    fail('could not locate the engaged branch in swe-run.mjs — this check can no longer verify where .grade is written');
  } else {
    const writes = [];
    for (let i = runSrc.indexOf("'.grade')"); i > -1; i = runSrc.indexOf("'.grade')", i + 1)) writes.push(i);
    if (!writes.length) fail('swe-run.mjs writes no .grade record at all');
    const outside = writes.filter((i) => i < open || i > close);
    if (!outside.length) {
      fail('swe-run.mjs writes .grade ONLY inside the engaged branch — non-engaged cells leave no record, '
        + 'so a --cells rebuild can never see them and reports engagement it never measured');
    } else if (!/\bcell\b/.test(runSrc.slice(outside[0], outside[0] + 240))) {
      fail('the unconditional .grade write does not carry the cell record (and so not its measured `engaged` flag)');
    }
  }
} finally {
  rmSync(root, { recursive: true, force: true });
  // Safety net: if the scratch-board seam was not honoured, the run leaked scorecards into docs/.
  for (const n of NAMES) rmSync(join(REAL_SCORES, n + '.json'), { force: true });
}

if (!ok) process.exit(1);
console.log('PASS: engagement is read from the grade record (false counts as non-engaged, absent stays † unknown) and swe-run records every cell');
