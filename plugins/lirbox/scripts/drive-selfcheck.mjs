#!/usr/bin/env node
/*
 * drive-selfcheck.mjs — the runnable check behind drive.mjs. assert-based, no framework, no herdr,
 * no network: the io drive.mjs talks to is faked here, with a virtual clock, so a stall of ten
 * minutes costs nothing to test.
 *
 *   node plugins/lirbox/scripts/drive-selfcheck.mjs              # assert the real driver  → exit 0
 *   node plugins/lirbox/scripts/drive-selfcheck.mjs --mutations  # prove each assert RED  → exit 0
 *
 * --mutations writes each mutant to a FRESH temp dir and imports it; a mutation no assertion catches
 * is UNCAUGHT and fails the run. A check never seen failing is not a check.
 */
import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REAL = join(HERE, 'drive.mjs');
const CFG = { poll_ms: 20_000, stall_ms: 600_000, lane_timeout_ms: 7_200_000 };

const ok = (c = 'node t.js') => ({ delivers: 'x', criteria: [{ command: c, expected: 'exit 0' }] });

// A scenario scripts what each lane does and what each criterion returns. Everything drive.mjs
// learns, it learns through these methods — so an assertion here is an assertion on the driver.
function fakeIO(sc = {}) {
  const t = { clock: 0, sha: 0, briefs: [], restarts: 0, resets: [], board: [], saved: null, jevAsked: [] };
  const plans = [...(sc.plans || [ok()])];
  const builds = [...(sc.builds || [{ commit: true }])];
  const exits = Object.fromEntries(Object.entries(sc.exits || {}).map(([k, v]) => [k, [...v]]));
  const jev = [...(sc.jev || [])];
  const slices = {}; const verdicts = {}; let complete = null;
  let lane = {};   // role → { statuses: [...], stall: bool }
  const io = {
    t,
    now: () => t.clock,
    sleep: (ms) => { t.clock += ms; },
    save: (s) => { t.saved = JSON.parse(JSON.stringify(s)); },
    intake: () => ({ route: sc.route || 'lane', reason: 'r' }),
    head: () => `sha${t.sha}`,
    brief: (role, text) => {
      if (sc.throwOn && sc.throwOn(role, t)) throw new Error('crash');
      t.briefs.push(role);
      if (/You were restarted/.test(text)) return;
      const m = /slice (\d+)/.exec(text); if (m) t.sliceId = Number(m[1]);
      if (role === 'planner') {
        const p = plans.shift();
        if (p && p.complete) complete = p.complete;
        else if (p) slices[t.sliceId] = p;
      }
      if (role === 'builder') { const b = builds.shift() || { commit: true }; if (b.commit) t.sha++; lane.builder = b; }
      if (role === 'verifier') { const v = (sc.verdicts || []).shift(); if (v) verdicts[t.sliceId] = { sha: v.sha ?? `sha${t.sha}`, ...v }; }
      lane[role] = { ...(lane[role] || {}), statuses: [...((lane[role] && lane[role].statuses) || sc.statuses?.[role] || ['working', 'idle'])] };
    },
    status: (role) => { const q = lane[role]?.statuses || ['idle']; return q.length > 1 ? q.shift() : q[0]; },
    tail: () => 'Allow edit? (y/n)',
    fingerprint: (role) => (sc.stall?.[role] ? 'same' : `fp${t.clock}`),
    restart: (role) => { t.restarts++; lane[role] = { statuses: [...(sc.afterRestart?.[role] || ['working'])] }; },
    monitor: () => {},
    run: (cmd) => { const q = exits[cmd]; return q && q.length ? q.shift() : 0; },
    reset: (role, sha) => { t.resets.push(sha); t.sha = Number(sha.slice(3)); },
    clearSlice: (id) => { delete slices[id]; },
    slice: (id) => slices[id] || null,
    complete: () => complete,
    verdict: (id) => verdicts[id] || null,
    board: (id, o) => t.board.push({ id, ...o }),
    jev: (state, options) => { t.jevAsked.push(Object.keys(options).sort()); return jev.length ? jev.shift() : null; },
  };
  return io;
}

const start = (extra = {}) => ({ phase: 'intake', task: 'do the thing', ...extra });

const ASSERTIONS = [
  ['green slice stops for review, verified by the driver', async (D) => {
    const io = fakeIO();
    const s = D.drive(start(), io, CFG, 'r');
    assert.equal(s.phase, 'review');
    assert.equal(s.verified_sha, 'sha1');
    assert.deepEqual(io.t.board.at(-1), { id: 1, status: 'delivered', verified_by: 'drive' });
  }],

  ['--continue after review plans the next slice; COMPLETE ends the run', async (D) => {
    const io = fakeIO({ plans: [{ complete: 'all shipped' }] });
    const s = D.drive({ phase: 'plan', task: 't', slice: 2, attempt: 0, rollbacks: 0, verified_sha: 'sha0' }, io, CFG, 'r');
    assert.equal(s.phase, 'done');
    assert.equal(s.reason, 'all shipped');
  }],

  ['red then jev retry rebuilds and goes green', async (D) => {
    const io = fakeIO({ builds: [{ commit: true }, { commit: true }], exits: { 'node t.js': [1, 0] }, jev: [{ choice: 'retry', confidence: 0.9 }] });
    const s = D.drive(start(), io, CFG, 'r');
    assert.equal(s.phase, 'review');
    assert.equal(s.attempt, 2);
  }],

  ['retry is not offered once attempts are spent', async (D) => {
    const io = fakeIO({ builds: [{ commit: true }, { commit: true }, { commit: true }], exits: { 'node t.js': [1, 1, 0] },
      jev: [{ choice: 'retry', confidence: 0.9 }, { choice: 'retry', confidence: 0.9 }] });
    const s = D.drive(start(), io, CFG, 'r');
    assert.equal(s.phase, 'escalated');
    assert.ok(!io.t.jevAsked[1].includes('retry'), `second decision offered ${io.t.jevAsked[1]}`);
  }],

  ['rollback resets the builder to the last verified sha and replans', async (D) => {
    const io = fakeIO({ plans: [ok(), { complete: 'done' }], exits: { 'node t.js': [1] }, jev: [{ choice: 'rollback', confidence: 0.9 }] });
    const s = D.drive(start(), io, CFG, 'r');
    assert.deepEqual(io.t.resets, ['sha0']);
    assert.equal(s.rollbacks, 1);
    assert.equal(s.phase, 'done');
  }],

  ['rollback is not offered past its cap', async (D) => {
    const io = fakeIO({ exits: { 'node t.js': [1] }, jev: [{ choice: 'rollback', confidence: 0.9 }] });
    const s = D.drive({ phase: 'plan', task: 't', slice: 1, attempt: 0, rollbacks: 1, verified_sha: 'sha0' }, io, CFG, 'r');
    assert.equal(s.phase, 'escalated');
    assert.deepEqual(io.t.resets, []);
  }],

  ['NOT_MEASURED escalates, never guesses', async (D) => {
    const io = fakeIO({ exits: { 'node t.js': [1] }, jev: [] });
    const s = D.drive(start(), io, CFG, 'r');
    assert.equal(s.phase, 'escalated');
    assert.match(s.reason, /NOT_MEASURED/);
  }],

  ['a low-confidence choice escalates', async (D) => {
    const io = fakeIO({ builds: [{ commit: true }, { commit: true }], exits: { 'node t.js': [1, 0] }, jev: [{ choice: 'retry', confidence: 0.2 }] });
    const s = D.drive(start(), io, CFG, 'r');
    assert.equal(s.phase, 'escalated');
  }],

  ['a builder that commits nothing is red', async (D) => {
    const io = fakeIO({ builds: [{ commit: false }], jev: [{ choice: 'escalate', confidence: 0.9 }] });
    const s = D.drive(start(), io, CFG, 'r');
    assert.equal(s.phase, 'escalated');
    assert.match(JSON.stringify(s.last.red), /HEAD did not move/);
  }],

  ['a hung lane is restarted once, then escalated as stalled', async (D) => {
    const io = fakeIO({ statuses: { builder: ['working'] }, stall: { builder: true }, afterRestart: { builder: ['working'] } });
    const s = D.drive(start(), io, CFG, 'r');
    assert.equal(s.phase, 'escalated');
    assert.match(s.reason, /^stalled/);
    assert.equal(io.t.restarts, 1);
  }],

  ['a lane that keeps moving is not a hang', async (D) => {
    const io = fakeIO({ statuses: { builder: [...Array(40).fill('working'), 'idle'] } });
    const s = D.drive(start(), io, CFG, 'r');
    assert.equal(s.phase, 'review');
    assert.equal(io.t.restarts, 0);
  }],

  ['a dead lane is restarted and its brief re-sent', async (D) => {
    const io = fakeIO({ statuses: { builder: ['missing'] }, afterRestart: { builder: ['working', 'idle'] } });
    const s = D.drive(start(), io, CFG, 'r');
    assert.equal(s.phase, 'review');
    assert.equal(io.t.restarts, 1);
    assert.equal(io.t.briefs.filter((b) => b === 'builder').length, 2);
  }],

  ['a blocked lane escalates with what it is asking', async (D) => {
    const io = fakeIO({ statuses: { builder: ['working', 'blocked'] } });
    const s = D.drive(start(), io, CFG, 'r');
    assert.equal(s.phase, 'escalated');
    assert.match(s.reason, /^blocked: Allow edit/);
  }],

  ['reject stops before any lane is briefed', async (D) => {
    const io = fakeIO({ route: 'reject' });
    const s = D.drive(start(), io, CFG, 'r');
    assert.equal(s.phase, 'rejected');
    assert.deepEqual(io.t.briefs, []);
  }],

  ['a crash resumes from the checkpoint without re-planning', async (D) => {
    const io1 = fakeIO({ throwOn: (role) => role === 'builder' });
    assert.throws(() => D.drive(start(), io1, CFG, 'r'));
    assert.equal(io1.t.saved.phase, 'build');
    const io2 = fakeIO({ plans: [] });
    io2.slice = () => ok();
    const s = D.drive(io1.t.saved, io2, CFG, 'r');
    assert.equal(s.phase, 'review');
    assert.ok(!io2.t.briefs.includes('planner'), 'resume must not re-plan');
  }],

  ['a judged criterion goes to a verifier, whose fail is red', async (D) => {
    const judged = { delivers: 'x', criteria: [{ command: 'node t.js', expected: 'exit 0' }, { command: 'look at it', expected: 'reads well' }] };
    const io = fakeIO({ plans: [judged], verdicts: [{ pass: false, observed: 'meh' }], jev: [{ choice: 'escalate', confidence: 0.9 }] });
    const s = D.drive(start(), io, CFG, 'r');
    assert.ok(io.t.briefs.includes('verifier'));
    assert.equal(s.phase, 'escalated');
    assert.match(JSON.stringify(s.last.red), /meh/);
  }],

  ['a verdict filed against another sha is not a verdict', async (D) => {
    const judged = { delivers: 'x', criteria: [{ command: 'look', expected: 'reads well' }] };
    const io = fakeIO({ plans: [judged], verdicts: [{ pass: true, sha: 'stale' }] });
    const s = D.drive(start(), io, CFG, 'r');
    assert.equal(s.phase, 'escalated');
    assert.match(s.reason, /no verdict/);
  }],

  ['a slice with no criteria is not a plan', async (D) => {
    const io = fakeIO({ plans: [{ delivers: 'x', criteria: [] }] });
    const s = D.drive(start(), io, CFG, 'r');
    assert.equal(s.phase, 'escalated');
  }],

  ['a replan that files nothing does not reuse the old slice', async (D) => {
    const io = fakeIO({ plans: [ok(), null], exits: { 'node t.js': [1] }, jev: [{ choice: 'replan', confidence: 0.9 }] });
    const s = D.drive(start(), io, CFG, 'r');
    assert.equal(s.phase, 'escalated');
    assert.match(s.reason, /filed no slice/);
  }],

  ['every transition is checkpointed', async (D) => {
    const io = fakeIO();
    const s = D.drive(start(), io, CFG, 'r');
    assert.deepEqual(io.t.saved, JSON.parse(JSON.stringify(s)));
  }],
];

const MUTATIONS = [
  ['blocked not detected', "if (st === 'blocked')", 'if (false)', 'a blocked lane escalates with what it is asking'],
  ['restart cap removed', 'if (restarts >= 1)', 'if (false)', 'a hung lane is restarted once, then escalated as stalled'],
  ['stall not detected', 'else if (io.now() - movedAt >= cfg.stall_ms)', 'else if (false)', 'a hung lane is restarted once, then escalated as stalled'],
  ['progress ignored (every poll is a stall)', 'if (f !== fp) { fp = f; movedAt = io.now(); }', 'if (fp === null) { fp = f; movedAt = io.now(); }', 'a lane that keeps moving is not a hang'],
  ['dead lane not re-briefed', 'io.brief(role, `${brief}', 'void (`${brief}', 'a dead lane is restarted and its brief re-sent'],
  ['retry cap removed', 'if (s.attempt < MAX_ATTEMPTS)', 'if (true)', 'retry is not offered once attempts are spent'],
  ['rollback cap removed', 'if (s.rollbacks < MAX_ROLLBACKS)', 'if (true)', 'rollback is not offered past its cap'],
  ['rollback does not reset', "io.reset('builder', s.verified_sha); ", '', 'rollback resets the builder to the last verified sha and replans'],
  ['confidence ignored', '(a.confidence ?? 0) >= MIN_CONFIDENCE', 'true', 'a low-confidence choice escalates'],
  ['NOT_MEASURED guessed as retry', ": 'escalate';", ": 'retry';", 'NOT_MEASURED escalates, never guesses'],
  ['no-commit not red', 'if (s.candidate_sha === s.verified_sha)', 'if (false)', 'a builder that commits nothing is red'],
  ['exit codes not compared', 'if (got !== c.exit)', 'if (false)', 'red then jev retry rebuilds and goes green'],
  ['judged criteria skip the verifier', "criteria.some((c) => c.kind === 'judged') ? 'verify' : 'accept'", "'accept'", 'a judged criterion goes to a verifier, whose fail is red'],
  ['verdict sha not checked', 'if (!v || v.sha !== s.candidate_sha)', 'if (!v)', 'a verdict filed against another sha is not a verdict'],
  ['criteria-less slice accepted', 'if (!slice || !slice.criteria?.length)', 'if (!slice)', 'a slice with no criteria is not a plan'],
  ['stale slice reused on replan', 'io.clearSlice(s.slice);', '', 'a replan that files nothing does not reuse the old slice'],
  ['reject ignored', "if (r.route === 'reject')", 'if (false)', 'reject stops before any lane is briefed'],
  ['no checkpoint', 'io.save(next);', '', 'every transition is checkpointed'],
  ['review is not a stop', "export const STOPS = ['review', ", 'export const STOPS = [', 'green slice stops for review, verified by the driver'],
];

async function runAssertions(path) {
  const D = await import(pathToFileURL(path).href + `?v=${Math.random()}`);
  const red = [];
  for (const [name, fn] of ASSERTIONS) {
    try { await fn(D); } catch (e) { red.push([name, String(e.message).split('\n')[0]]); }
  }
  return red;
}

const argv = process.argv.slice(2);
if (argv.includes('--mutations')) {
  const src = readFileSync(REAL, 'utf8');
  const table = []; let bad = 0;
  for (const [name, find, replace, guards] of MUTATIONS) {
    const n = src.split(find).length - 1;
    if (n !== 1) { table.push([name, guards, `STALE (${n} matches)`]); bad++; continue; }
    const mutant = join(mkdtempSync(join(tmpdir(), 'drive-mutation-')), 'drive.mjs');
    writeFileSync(mutant, src.replace(find, replace));
    const red = await runAssertions(mutant);
    const caught = red.some(([n2]) => n2 === guards);
    if (!caught) bad++;
    table.push([name, guards, caught ? `RED (${red.length} red)` : 'UNCAUGHT — still green']);
  }
  const w = [0, 1].map((i) => Math.max(...table.map((r) => r[i].length)));
  for (const r of table) console.log([r[0].padEnd(w[0]), r[1].padEnd(w[1]), r[2]].join('  '));
  if (bad) { console.error(`\n${bad} mutation(s) not caught`); process.exit(1); }
  console.log(`\n${table.length} of ${table.length} mutations caught RED`);
} else {
  const red = await runAssertions(REAL);
  for (const [name] of ASSERTIONS) {
    const f = red.find(([n]) => n === name);
    console.log(f ? `  FAIL  ${name}\n        ${f[1]}` : `  ok    ${name}`);
  }
  if (red.length) { console.error(`\n${red.length} of ${ASSERTIONS.length} assertions red`); process.exit(1); }
  console.log(`\n${ASSERTIONS.length} of ${ASSERTIONS.length} assertions green`);
}
