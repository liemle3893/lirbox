#!/usr/bin/env node
// Frozen check: the first lane of a run cannot start before the run is written
// down and the baseline is measured.
//
// The invariant, in one line: something other than lane availability has to
// decide what is worked on first.
//
// Measured, 2026-08 run: `start` had no first-start precondition, so the only
// ordering predicate left was which lane happened to be free — "both lanes are
// free, so I'm putting one on". The run never executed the three-minute suite
// it had itself declared expired three times; it quoted a 25-failure count from
// a tree that had since moved twenty commits; and the partition that reframed
// the entire day — 10 of 219 test files actually need the service everything
// was blocked on — arrived at hour five, from the human, as a question.
//
// Two files, neither a design document:
//   items.md      the lane split. numbered items, and which blocks which.
//   baseline.txt  the test command and the exit code it ACTUALLY returned.
//
// The teeth matter more than the existence. A gate satisfied by two empty files
// is exactly the "check that cannot fail" this skill names as its dominant
// defect class, so this check proves the gate reads the CONTENT: prose with no
// numbered item is refused, and a baseline with no observed exit code is
// refused. An exit code is the one line nobody can write without running the
// thing.
//
// Scoped to the FIRST start: once a lane is dispatched the run has a shape, and
// a gate that fires on every spawn is noise that gets answered with a stub.
//
// ORCH_LANE_OVERRIDE points at the script under test (set by prove-checks).
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const script = process.env.ORCH_LANE_OVERRIDE
  || join(here, '..', '..', '..', '..', 'scripts', 'orch-lane.sh');

const tmp  = mkdtempSync(join(tmpdir(), 'first-lane-'));
const repo = join(tmp, 'repo');
const home = join(tmp, 'home');
const bin  = join(tmp, 'bin');
const cleanup = () => rmSync(tmp, { recursive: true, force: true });
const fail = (m) => { cleanup(); throw new Error(m); };

mkdirSync(repo, { recursive: true }); mkdirSync(bin, { recursive: true });
const git = (...a) => execFileSync('git', ['-C', repo, ...a], { stdio: 'pipe' });
git('init', '-q', '-b', 'main');
git('config', 'user.email', 'c@example.invalid');
git('config', 'user.name', 'check');
writeFileSync(join(repo, 'f'), 'x');
git('add', '-A'); git('commit', '-qm', 'base');

const root = execFileSync('git', ['-C', repo, 'rev-parse', '--show-toplevel'],
  { encoding: 'utf8' }).trim();
const key = execFileSync('git', ['-C', repo, 'rev-parse', '--path-format=absolute',
  '--git-common-dir'], { encoding: 'utf8' }).trim();
const slug = createHash('sha1').update(key).digest('hex').slice(0, 12);

mkdirSync(join(home, '.claude', 'lirbox-lanes'), { recursive: true });
mkdirSync(join(home, '.claude', 'lirbox-orchestrator'), { recursive: true });
writeFileSync(join(home, '.claude', 'lirbox-orchestrator', `${slug}.json`),
  JSON.stringify({
    lanes: { base_branch: 'main', ready_timeout_ms: 60000, max_concurrent: 4 },
    profiles: { 'agent-turn': { kind: 'opencode', model: 'test/model', flags: ['--auto'] } },
    setup: { install: 'true', test: 'true' },
  }, null, 2));

writeFileSync(join(bin, 'herdr'), `#!/bin/sh
case "$1 $2" in
  "worktree create")
    echo '{"result":{"worktree":{"path":"${repo}"},"root_pane":{"pane_id":"wZ:p1"},"workspace":{"workspace_id":"wZ"}}}' ;;
  "pane process-info")
    echo '{"result":{"process_info":{"shell_pid":7,"foreground_process_group_id":7}}}' ;;
  "agent list")
    echo '{"result":{"agents":[]}}' ;;
  *) : ;;
esac
exit 0
`);
chmodSync(join(bin, 'herdr'), 0o755);

const env = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` };
const start = (name, run, ...extra) => {
  const r = spawnSync('zsh', [script, 'start', name, '--profile', 'agent-turn',
    '--run', run, ...extra], { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return { code: r.status ?? 1, out: (r.stdout || '') + (r.stderr || '') };
};

const runDir = (run) => join(root, '.orchestration', run);
const seed = (run, { items, baseline }) => {
  mkdirSync(runDir(run), { recursive: true });
  if (items !== undefined) writeFileSync(join(runDir(run), 'items.md'), items);
  if (baseline !== undefined) writeFileSync(join(runDir(run), 'baseline.txt'), baseline);
};

const GOOD_ITEMS = `# run r
1. redis provisioning in workspace-compute — blocks: none
2. kb retrieval guards — blocks: 1
`;
const GOOD_BASELINE = `pnpm run types:check   exit: 2   (3 errors, all fake-pg.test-util.ts:518)
pnpm test              exit: 1   (25 failed, 1240 passed)
`;

// -- 1. neither file: the first lane is refused, and both are named ----------
let r = start('probe', 'r1');
if (r.code === 0) {
  fail('the first lane of a run started with no items.md and no baseline.txt. '
     + 'Nothing then orders the work except which lane is free — the predicate '
     + 'that spent the 2026-08 run on the hardest coupled thing while a '
     + 'three-minute suite that would have partitioned it went unrun.');
}
for (const want of ['items.md', 'baseline.txt']) {
  if (!r.out.includes(want)) {
    fail(`the refusal never names "${want}" — a block that does not say what to `
       + `write is an obstacle, and obstacles get routed around: ${r.out.trim()}`);
  }
}

// -- 2. one of the two is not enough ---------------------------------------
seed('r2', { items: GOOD_ITEMS });
r = start('probe', 'r2');
if (r.code === 0) fail('a run with items.md but no measured baseline started its first lane');
if (!r.out.includes('baseline.txt')) fail(`the refusal does not name the missing file: ${r.out.trim()}`);

seed('r3', { baseline: GOOD_BASELINE });
r = start('probe', 'r3');
if (r.code === 0) fail('a run with a baseline but no lane split started its first lane');
if (!r.out.includes('items.md')) fail(`the refusal does not name the missing file: ${r.out.trim()}`);

// -- 3. teeth: two files that say nothing do not satisfy it -----------------
// This is the arm that separates a real gate from a ritual. Both of these
// would pass an existence check.
seed('r4', {
  items: 'We need to get dev green and finish KB.\nIt is mostly the KB work.\n',
  baseline: GOOD_BASELINE,
});
r = start('probe', 'r4');
if (r.code === 0) {
  fail('items.md containing only restated prose was accepted. A goal restated is '
     + 'not a decomposition — there is still nothing that says which item blocks '
     + 'which, so there is still nothing to order the work by.');
}

seed('r5', {
  items: GOOD_ITEMS,
  baseline: 'we will run pnpm test and see how it goes. probably around 25 failures.\n',
});
r = start('probe', 'r5');
if (r.code === 0) {
  fail('a baseline.txt with no observed exit code was accepted. An exit code is '
     + 'the one line that cannot be written without running the thing; without '
     + 'it the file records an intention, and every later "it is green now" is '
     + 'measured against a number nobody took.');
}

// -- 3b. a rehearsal is not a dispatch: --dry-run reports, never blocks ------
// `--dry-run` issues nothing, so gating it blocks inspection for no gain. But
// it must not lie either: a rehearsal that printed a clean plan for a start the
// real command refuses is worse than the block.
const dry = start('probe', 'r7', '--dry-run');
if (dry.code !== 0) {
  fail('--dry-run was refused for a run with no plan yet. It dispatches nothing '
     + `— gating a rehearsal is friction with no lane at the end of it: ${dry.out.trim()}`);
}
if (!/items\.md/.test(dry.out) || !/baseline\.txt/.test(dry.out)) {
  fail('--dry-run printed a plan without warning that the real start refuses. '
     + 'A rehearsal that reports success for a command that will not run is the '
     + `worse half of both options: ${dry.out.trim()}`);
}

// -- 4. a run that did the work starts -------------------------------------
seed('r6', { items: GOOD_ITEMS, baseline: GOOD_BASELINE });
r = start('probe', 'r6');
if (r.code !== 0) {
  fail(`a run with a real lane split and a measured baseline was still refused. `
     + `A gate that blocks its own sanctioned path is the reason the last one `
     + `got routed around: ${r.out.trim()}`);
}

// -- 5. only the FIRST start pays it ---------------------------------------
// r6 now has a dispatch record. Remove both files: lane two must still start.
// A gate that re-fires every spawn is noise, and noise is answered with a stub.
rmSync(join(runDir('r6'), 'items.md'));
rmSync(join(runDir('r6'), 'baseline.txt'));
r = start('probe2', 'r6');
if (r.code !== 0) {
  fail('the second lane of a run already under way was refused. The decomposition '
     + `is a start-of-run decision, not a toll on every spawn: ${r.out.trim()}`);
}

cleanup();
console.log('first-lane-costs-a-baseline: OK');
