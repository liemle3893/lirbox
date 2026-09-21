#!/usr/bin/env node
/*
 * board-selfcheck.mjs — the one runnable check behind board.mjs. assert-based, no framework.
 *
 *   node plugins/lirbox/scripts/board-selfcheck.mjs              # assert the real board   → exit 0
 *   node plugins/lirbox/scripts/board-selfcheck.mjs --mutations  # prove each assert RED   → exit 0
 *   node plugins/lirbox/scripts/board-selfcheck.mjs --board /path/to/board.mjs
 *
 * A check never seen failing is not a check. --mutations breaks one invariant at a time in a
 * FRESH temp dir (never a copy layered onto a previous one) and requires the guarding assertion to
 * go red; a mutation nothing catches is reported as UNCAUGHT and fails the run.
 */
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flagVal = (f) => { const i = argv.indexOf('--' + f); return i > -1 ? argv[i + 1] : null; };
const REAL_BOARD = resolve(flagVal('board') || join(HERE, 'board.mjs'));

const fresh = () => mkdtempSync(join(tmpdir(), 'board-selfcheck-'));

// Every invocation gets its own empty cwd unless one is handed in, so no assertion can pass on
// state another assertion left behind.
function board(boardPath, args, cwd = fresh()) {
  try {
    const stdout = execFileSync(process.execPath, [boardPath, ...args], { cwd, encoding: 'utf8', stdio: 'pipe' });
    return { code: 0, stdout, stderr: '', cwd };
  } catch (e) {
    return { code: e.status ?? -1, stdout: e.stdout || '', stderr: e.stderr || '', cwd };
  }
}

const sliceOf = (cwd, slug, id) => {
  const f = join(cwd, '.orchestration', slug, 'slices', `${id}.json`);
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
};

const ASSERTIONS = [
  ['self-report leaves verified_by null', (b) => {
    const cwd = fresh();
    board(b, ['--run', 'r', '--set', 's1', '--status', 'delivered', '--by', 'alice',
      '--criterion', 'node t.js :: exit 0'], cwd);
    const r = board(b, ['--run', 'r', '--set', 's1', '--status', 'delivered', '--verified-by', 'alice'], cwd);
    assert.notEqual(r.code, 0, 'a self-report must be refused');
    assert.equal(sliceOf(cwd, 'r', 's1').verified_by, null, 'verified_by must stay null after a self-report');
  }],

  ['verification by someone else is recorded', (b) => {
    const cwd = fresh();
    board(b, ['--run', 'r', '--set', 's1', '--status', 'delivered', '--by', 'alice',
      '--criterion', 'node t.js :: exit 0'], cwd);
    const r = board(b, ['--run', 'r', '--set', 's1', '--status', 'delivered', '--verified-by', 'bob'], cwd);
    assert.equal(r.code, 0, `verification by a third party must be accepted: ${r.stderr}`);
    assert.equal(sliceOf(cwd, 'r', 's1').verified_by, 'bob');
  }],

  // The two-call version of a self-report: get verified by somebody else, then quietly re-record
  // yourself as the implementor. Without a guard the slice ends up with one name on both lines and
  // still counts in `N of M delivered` — the column stops meaning anything a call later.
  ['re-signing as implementor after verification is refused', (b) => {
    const cwd = fresh();
    board(b, ['--run', 'r', '--set', 's1', '--status', 'delivered', '--by', 'bob',
      '--criterion', 'node t.js :: exit 0'], cwd);
    board(b, ['--run', 'r', '--set', 's1', '--status', 'delivered', '--verified-by', 'alice'], cwd);
    const r = board(b, ['--run', 'r', '--set', 's1', '--status', 'delivered', '--by', 'alice'], cwd);
    assert.notEqual(r.code, 0, 'taking over as implementor of a slice you verified must be refused');
    const s = sliceOf(cwd, 'r', 's1');
    assert.equal(s.implementor, 'bob', 'the refused write must not have reassigned the implementor');
    assert.notEqual(s.implementor, s.verified_by, 'implementor and verified_by must never be one name');
  }],

  ['verification with no implementor is refused', (b) => {
    const cwd = fresh();
    board(b, ['--run', 'r', '--set', 's1', '--status', 'delivered', '--criterion', 'node t.js :: exit 0'], cwd);
    const r = board(b, ['--run', 'r', '--set', 's1', '--status', 'delivered', '--verified-by', 'bob'], cwd);
    assert.notEqual(r.code, 0, 'verifying a slice nobody claimed must be refused');
    assert.equal(sliceOf(cwd, 'r', 's1').verified_by, null);
  }],

  ['a criterion with no command is refused', (b) => {
    const cwd = fresh();
    const r = board(b, ['--run', 'r', '--set', 's1', '--status', 'planned', '--criterion', ' :: exit 0'], cwd);
    assert.notEqual(r.code, 0, 'a criterion with no command must be refused');
    assert.equal(sliceOf(cwd, 'r', 's1'), null, 'a refused write must leave no slice file');
  }],

  ['a criterion with no expected value is refused', (b) => {
    const cwd = fresh();
    const r = board(b, ['--run', 'r', '--set', 's1', '--status', 'planned', '--criterion', 'node t.js :: '], cwd);
    assert.notEqual(r.code, 0, 'a criterion with no expected value must be refused');
    assert.equal(sliceOf(cwd, 'r', 's1'), null);
  }],

  ['N of M counts only delivered-and-verified', (b) => {
    const cwd = fresh();
    const c = ['--criterion', 'node t.js :: exit 0'];
    // s1 delivered + verified by someone else  → counts
    board(b, ['--run', 'r', '--set', 's1', '--status', 'delivered', '--by', 'alice', ...c], cwd);
    board(b, ['--run', 'r', '--set', 's1', '--status', 'delivered', '--verified-by', 'bob'], cwd);
    // s2 delivered, nobody verified            → does not count
    board(b, ['--run', 'r', '--set', 's2', '--status', 'delivered', '--by', 'alice', ...c], cwd);
    // s3 verified but not delivered            → does not count
    board(b, ['--run', 'r', '--set', 's3', '--status', 'in_progress', '--by', 'alice', ...c], cwd);
    board(b, ['--run', 'r', '--set', 's3', '--status', 'in_progress', '--verified-by', 'bob'], cwd);
    const r = board(b, ['--run', 'r'], cwd);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /\b1 of 3 delivered\b/, `expected "1 of 3 delivered", got:\n${r.stdout}`);
  }],

  ['an unknown status is refused', (b) => {
    const cwd = fresh();
    const r = board(b, ['--run', 'r', '--set', 's1', '--status', 'nearly'], cwd);
    assert.notEqual(r.code, 0, 'an unknown status must be refused');
    assert.equal(sliceOf(cwd, 'r', 's1'), null);
  }],

  ['a plain --run on an empty store prints 0 of 0', (b) => {
    const r = board(b, ['--run', 'nothing-here']);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /\b0 of 0 delivered\b/);
  }],
];

// Each mutation breaks exactly one invariant. `guards` names the assertion that must go red.
const MUTATIONS = [
  ['self-report guard removed', 'who === slice.implementor', 'false', 'self-report leaves verified_by null'],
  ['no-implementor guard removed', 'if (!slice.implementor)', 'if (false)', 'verification with no implementor is refused'],
  ['re-sign guard removed', 'args.by === slice.verified_by', 'false', 're-signing as implementor after verification is refused'],
  ['empty-command guard removed', 'if (!command)', 'if (false)', 'a criterion with no command is refused'],
  ['empty-expected guard removed', 'if (!expected)', 'if (false)', 'a criterion with no expected value is refused'],
  ['count ignores verification', "s.status === 'delivered' && !!s.verified_by", "s.status === 'delivered'", 'N of M counts only delivered-and-verified'],
  ['status allowlist removed', '!STATUSES.includes(args.status)', 'false', 'an unknown status is refused'],
];

function runAssertions(boardPath) {
  const red = [];
  for (const [name, fn] of ASSERTIONS) {
    try { fn(boardPath); } catch (e) { red.push([name, e.message.split('\n')[0]]); }
  }
  return red;
}

if (argv.includes('--mutations')) {
  const src = readFileSync(REAL_BOARD, 'utf8');
  const table = [];
  let bad = 0;
  for (const [name, find, replace, guards] of MUTATIONS) {
    const n = src.split(find).length - 1;
    if (n !== 1) { table.push([name, guards, `STALE (${n} matches for ${find})`]); bad++; continue; }
    const dir = mkdtempSync(join(tmpdir(), 'board-mutation-'));   // fresh per mutation, never layered
    const mutant = join(dir, 'board.mjs');
    writeFileSync(mutant, src.replace(find, replace));
    const red = runAssertions(mutant);
    const caught = red.some(([n2]) => n2 === guards);
    if (!caught) bad++;
    table.push([name, guards, caught ? `RED (${red.length} assertion(s) red)` : `UNCAUGHT — still green`]);
  }
  const w = [Math.max(...table.map((r) => r[0].length)), Math.max(...table.map((r) => r[1].length))];
  console.log(['MUTATION'.padEnd(w[0]), 'GUARDED BY'.padEnd(w[1]), 'RESULT'].join('  '));
  for (const r of table) console.log([r[0].padEnd(w[0]), r[1].padEnd(w[1]), r[2]].join('  '));
  if (bad) { console.error(`\n${bad} mutation(s) not caught — those assertions are not measuring.`); process.exit(1); }
  console.log(`\n${table.length} of ${table.length} mutations caught RED`);
} else {
  const red = runAssertions(REAL_BOARD);
  for (const [name] of ASSERTIONS) {
    const f = red.find(([n]) => n === name);
    console.log(f ? `  FAIL  ${name}\n        ${f[1]}` : `  ok    ${name}`);
  }
  if (red.length) { console.error(`\n${red.length} of ${ASSERTIONS.length} assertions red`); process.exit(1); }
  console.log(`\n${ASSERTIONS.length} of ${ASSERTIONS.length} assertions green`);
}
