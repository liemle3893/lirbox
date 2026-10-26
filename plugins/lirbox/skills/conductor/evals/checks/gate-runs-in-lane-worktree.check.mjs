#!/usr/bin/env node
// Frozen check: `gate --in <worktree>` judges the LANE's worktree — its checks run there, its docs
// are read there, the scorecard is written there — while the frozen DoD, the round count and the
// verdicts stay in the main checkout, out of the implementor's reach.
//
// A lane is a lirbox-builder subagent in its own worktree. Gated from the main checkout without
// --in, every check would run against code the lane never touched and pass or fail on the wrong
// tree — a gate measuring nothing.
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { checker, docs, freeze, repo, run } from './lib/gate-harness.mjs';

const c = checker('gate-runs-in-lane-worktree');
const main = repo();
const lane = mkdtempSync(join(tmpdir(), 'dodgate-lane-'));
spawnSync('git', ['init', '-q'], { cwd: lane });

freeze(main, 'l', [{ id: 'built', tier: 'checkable', text: 'the lane built it', check: 'test -f built' }], 'lirbox-builder');
writeFileSync(join(lane, 'built'), '');
docs(lane, 'l');

c.expect('the main checkout (no lane work) passed', run(main, ['gate', '--run', 'l']).code, 1);
c.expect('the lane worktree with the work and docs did not pass', run(main, ['gate', '--run', 'l', '--in', lane]).code, 0);
c.ok('the scorecard was not written into the lane worktree', existsSync(join(lane, 'docs', 'changes', 'l', 'dod.json')));
c.ok('the gate state left the main checkout', existsSync(join(main, '.orchestration', 'l', 'gate.json')) &&
  !existsSync(join(lane, '.orchestration')));

// Docs are the lane's too: docs only in the main checkout do not satisfy a lane gate.
const lane2 = mkdtempSync(join(tmpdir(), 'dodgate-lane-'));
writeFileSync(join(lane2, 'built'), '');
freeze(main, 'm', [{ id: 'built', tier: 'checkable', text: 'the lane built it', check: 'test -f built' }], 'lirbox-builder');
docs(main, 'm');
c.expect('a lane with no docs passed on docs that live in the main checkout', run(main, ['gate', '--run', 'm', '--in', lane2]).code, 1);

c.done();
