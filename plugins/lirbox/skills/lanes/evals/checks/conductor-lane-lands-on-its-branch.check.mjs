#!/usr/bin/env node
// Frozen check: a conductor lane's brief carries the merge-back, and its run
// name comes from the lane rather than from the goal.
//
// The invariant, in one line: `orch-lane.sh conductor` writes the brief itself,
// and that brief names `wf/<lane>`, the merge of it onto the lane's branch, and
// the log that confirms the branch is not empty.
//
// Why. Conductor commits to its own branch `wf/<name>` in its own worktree —
// NOT to the lane's branch. gate-guard.sh gates the branch named in the lane's
// dispatch record. So a conductor lane that never merges back produces an empty
// lane branch, and the gate then reviews an empty diff and reports a clean
// pass: the lane says complete, the gate says passed, and nothing shipped.
// Every artifact in the run agrees, which is why this cannot be left to a
// freehand brief the orchestrator writes from memory — the same reason `gate`
// generates its verdict contract instead of describing it.
//
// The second half is the run name. Handed a goal, conductor kebabs a name out
// of it; a restarted pane re-briefed with the same goal can kebab a different
// one, fork a second workflow and orphan the first one's state. The name is
// derived from the lane so that a re-brief resumes by construction.
//
// Four arms, one per way this can break:
//   1. the brief drops the merge-back — the empty-branch failure above
//   2. the brief lets the run name be derived from the goal — a restart forks
//   3. a non-claude profile is accepted, where `Skill(lirbox:conductor)` does
//      not resolve and the lane implements the goal by hand instead
//   4. the brief is written but no lane is ever started or handed it
//
// ORCH_LANE_OVERRIDE points at the script under test (set by prove-checks).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const plugin = join(here, '..', '..', '..', '..');
const script = process.env.ORCH_LANE_OVERRIDE || join(plugin, 'scripts', 'orch-lane.sh');

const tmp = mkdtempSync(join(tmpdir(), 'conductor-lane-'));
const repo = join(tmp, 'repo'), home = join(tmp, 'home'), bin = join(tmp, 'bin');
const log = join(tmp, 'herdr.log');
const cleanup = () => rmSync(tmp, { recursive: true, force: true });
const fail = (m) => { cleanup(); throw new Error(m); };

mkdirSync(repo, { recursive: true }); mkdirSync(bin, { recursive: true });
const git = (...a) => execFileSync('git', ['-C', repo, ...a], { stdio: 'pipe' });
execFileSync('git', ['init', '-q', '-b', 'main', repo], { stdio: 'pipe' });
git('config', 'user.email', 'c@example.invalid'); git('config', 'user.name', 'check');
writeFileSync(join(repo, 'f'), 'x'); git('add', '-A'); git('commit', '-qm', 'base');

const agentDir = join(repo, '.claude', 'agents');
mkdirSync(agentDir, { recursive: true });
writeFileSync(join(agentDir, 'lane-ctx.md'), '# invariants\n');
// The shape `orch-config.sh init` writes as default_profile: a lirbox lane agent,
// claude kind, and no Skill anywhere in its tool list.
writeFileSync(join(agentDir, 'hands.md'),
  '---\nname: hands\ntools: Read, Edit, Write, Bash, Grep, Glob, TodoWrite\n---\n\nyou implement\n');

const key = execFileSync('git', ['-C', repo, 'rev-parse', '--path-format=absolute',
  '--git-common-dir'], { encoding: 'utf8' }).trim();
const slug = createHash('sha1').update(key).digest('hex').slice(0, 12);
const cfgDir = join(home, '.claude', 'lirbox-orchestrator');
mkdirSync(cfgDir, { recursive: true });
mkdirSync(join(home, '.claude', 'lirbox-lanes'), { recursive: true });
writeFileSync(join(cfgDir, `${slug}.json`), JSON.stringify({
  default_profile: 'gp',
  lanes: { base_branch: 'main', ready_timeout_ms: 60000, gate_profile: 'gp' },
  profiles: {
    gp:      { kind: 'claude', model: 'claude-opus-5', agent: 'general-purpose' },
    'omp-b': { kind: 'omp', model: 'muse-spark-1.2', agent: 'lane-ctx' },
    hands:   { kind: 'claude', model: 'claude-sonnet-5', agent: 'hands' },
  },
  setup: { test: 'pnpm test', baseline: 'pnpm test' },
}, null, 2));

// The run: the preconditions `start` checks before the first lane.
const runDir = join(repo, '.orchestration', 't1');
mkdirSync(join(runDir, 'dispatch'), { recursive: true });
writeFileSync(join(runDir, 'items.md'), '1. the only item — blocks: none\n');
writeFileSync(join(runDir, 'baseline.txt'), 'pnpm test   exit: 1  (3 failed)\n');
const wtree = join(tmp, 'checkout');
mkdirSync(wtree, { recursive: true });

// A herdr that completes a spawn. It has to SUCCEED, not just be entered: the
// brief is submitted on the far side of it, and `brief`'s own exit code is what
// both callers read to decide whether the lane was dispatched at all. The refusal
// is deliberate: the pane path only has to be ENTERED to be observed, and a
// fake that succeeded would leave `start` polling for a shell that never comes.
writeFileSync(join(bin, 'herdr'), `#!/bin/sh
case "$1 $2 $3" in
  "agent start --help")
    echo '      --kind <KIND>  [possible values: claude, omp, opencode, codex]'
    exit 0 ;;
esac
echo "$@" >> ${log}
case "$1 $2" in
  "worktree create")
    echo '{"result":{"root_pane":{"pane_id":"wX:p1"},"workspace":{"workspace_id":"wX"},"worktree":{"path":"${wtree}"}}}' ;;
  "pane process-info")
    echo '{"result":{"process_info":{"shell_pid":42,"foreground_process_group_id":42}}}' ;;
  "agent get")
    echo '{"result":{"agent":{"agent_status":"working"}}}' ;;
  "agent list")
    echo '{"result":{"agents":[]}}' ;;
esac
exit 0
`);
chmodSync(join(bin, 'herdr'), 0o755);

const env = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` };
const run = (...args) => {
  try {
    return { code: 0, out: execFileSync('zsh', [script, ...args],
      { cwd: repo, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) { return { code: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') }; }
};
const herdrLog = () => (existsSync(log) ? readFileSync(log, 'utf8') : '');

const GOAL = 'port the retry policy onto the shared client';
const briefPath = join(runDir, 'evidence', 'cw-brief.md');

// -- rehearsal: the brief is written, and it is the thing under test ----------
let d = run('conductor', 'cw', '--run', 't1', '--goal', GOAL, '--dry-run');
if (d.code !== 0) fail(`a rehearsed conductor lane refused outright:\n${d.out}`);
if (!existsSync(briefPath)) {
  fail('no brief was written. `conductor` exists to generate the one paragraph an '
     + 'orchestrator writing a brief by hand forgets; a subcommand that starts a '
     + 'lane and leaves the brief to the caller is the status quo it replaces.');
}
const brief = readFileSync(briefPath, 'utf8');

// -- 1. the merge-back, which is the whole point ------------------------------
if (!/wf\/cw/.test(brief)) {
  fail('the brief never names `wf/cw`. Conductor commits there, not to the lane\'s '
     + 'branch, and a lane that does not know that leaves its branch empty.');
}
if (!/git merge[^\n]*wf\/cw/.test(brief)) {
  fail('the brief names conductor\'s branch but never tells the lane to merge it onto '
     + 'its own. gate-guard.sh gates the branch in the dispatch record: unmerged, the '
     + 'gate reviews an empty diff and reports a clean pass.');
}
if (!/git log[^\n]*\bcw\b[^\n]*\^main/.test(brief)) {
  fail('the brief asks for the merge but never for the log that confirms the lane '
     + 'branch is non-empty. A merge that silently no-ops is the failure this brief '
     + 'exists to catch, and it is only visible in that output.');
}

// -- 2. the run name is the lane's, not one derived from the goal -------------
if (!/run name `cw`/.test(brief)) {
  fail('the brief does not fix conductor\'s run name to the lane name. Handed a goal, '
     + 'conductor kebabs a name out of it — so a restarted pane re-briefed with the '
     + 'same goal can fork a second workflow and orphan the first one\'s state file.');
}

// -- 3. a harness that cannot invoke the skill is refused, not started --------
rmSync(log, { force: true });
d = run('conductor', 'cw2', '--run', 't1', '--goal', GOAL, '--profile', 'omp-b', '--dry-run');
if (d.code === 0) {
  fail('an omp profile was accepted for a conductor lane. `Skill(lirbox:conductor)` '
     + 'does not resolve on omp, so that lane implements the goal by hand — which is '
     + 'indistinguishable from a working conductor lane until you read the branch.');
}

// -- 4. it actually starts a lane and hands it the brief ----------------------
rmSync(log, { force: true });
d = run('conductor', 'cw3', '--run', 't1', '--goal', GOAL);
if (!/worktree create/.test(herdrLog())) {
  fail(`a real conductor lane never reached the spawn path — it wrote a brief and `
     + `dispatched nothing:\n${d.out}`);
}
if (!/agent prompt/.test(herdrLog())) {
  fail(`the lane was started and never handed its brief. A lane that is running with `
     + `no brief looks identical to one working on it:\n${herdrLog()}`);
}
// The exit code, not just the side effects. Both callers wrap `brief` in
// `|| die`, so a successful dispatch that exits non-zero reports "the brief did
// not submit" over a lane that is working — and the documented answer to a failed
// dispatch is to start another lane.
if (d.code !== 0) {
  fail(`a conductor lane that spawned and submitted its brief still exited ${d.code}. `
     + `Its caller reads that as a failed dispatch:\n${d.out}`);
}

// -- 5. a claude profile whose AGENT cannot call Skill is refused too ---------
// The kind is necessary and not sufficient, and this is the DEFAULT path:
// `orch-config.sh init` writes default_profile = builder, whose agent is
// lirbox-builder — Read/Edit/Write/Bash/Grep/Glob/TodoWrite, no Skill. That lane
// starts clean, reads a brief telling it to invoke the skill, cannot, and
// implements the goal by hand. Every artifact looks like a working conductor
// lane; only the branch shows the difference.
d = run('conductor', 'cw5', '--run', 't1', '--goal', GOAL, '--profile', 'hands', '--dry-run');
if (d.code === 0) {
  fail('a claude profile whose agent carries no Skill tool was accepted for a '
     + 'conductor lane. It cannot invoke lirbox:conductor and will hand-implement '
     + `the goal instead — indistinguishable from success until you read the branch:\n${d.out}`);
}
if (!/Skill/.test(d.out)) {
  fail(`the refusal never says the agent lacks Skill, so it reads as an unrelated `
     + `config error and gets routed around:\n${d.out}`);
}
// ...and an agent with no markdown at all is ACCEPTED: a built-in like
// general-purpose has no file anywhere and carries every tool. Refusing on
// "cannot tell" would deny the one profile shape that actually works.
d = run('conductor', 'cw6', '--run', 't1', '--goal', GOAL, '--dry-run');
if (d.code !== 0) {
  fail('a profile pointing at a built-in agent — no markdown anywhere, full tool '
     + `set — was refused. Cannot-tell is not absence:\n${d.out}`);
}

// -- 6. no goal is a refusal, not an empty workflow ---------------------------
d = run('conductor', 'cw4', '--run', 't1');
if (d.code === 0) fail('a conductor lane was dispatched with no goal to scaffold from.');

cleanup();
console.log('PASS conductor-lane-lands-on-its-branch');
