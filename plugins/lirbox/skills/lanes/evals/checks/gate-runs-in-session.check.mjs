#!/usr/bin/env node
// Frozen check: the code gate runs in THIS session unless it cannot.
//
// The invariant, in one line: a claude gate profile produces its verdict from an
// in-session subagent — no pane, no worktree — and every other profile keeps the
// pane, with both handed the same brief.
//
// Why. gate-guard.sh is the thing that actually enforces the gate, and it asks
// only `produced_by != <implementor>`, `gate_passed == true`, `build_exit == 0`.
// It never asks how the gate ran. "Separate context than the implementor" is the
// whole requirement, and a subagent satisfies it — so cutting a pane for it buys
// nothing and costs the entire lane surface: a profile table, an `--agent <name>`
// resolved at spawn, a pane lifecycle. In the 2026-08 run behind this, that cost
// was real: `claude --agent gate` (no such agent) exited instantly, herdr reported
// `timed out waiting for agent startup`, it read as the documented cold-pane
// failure, and a restart reproduced it exactly. The same run's Criticals were all
// found by in-session subagents; the panes reported four true green numbers over
// per-tool grants that were completely inert.
//
// Three arms, one per way this can break:
//   1. a claude gate profile still spawns — the whole change reverted
//   2. an omp/opencode gate profile is forced in-session, where its harness
//      cannot run at all — the gate silently becomes whatever claude is
//   3. the two modes get different briefs. The verdict contract is the part that
//      cannot fork: drop gated_sha or the build_exit paragraph from one path and
//      that path's gate goes green on the honour system, which is the single
//      failure the whole mechanism exists to stop.
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

const tmp = mkdtempSync(join(tmpdir(), 'gate-in-session-'));
const repo = join(tmp, 'repo'), home = join(tmp, 'home'), bin = join(tmp, 'bin');
const log = join(tmp, 'herdr.log');
const cleanup = () => rmSync(tmp, { recursive: true, force: true });
const fail = (m) => { cleanup(); throw new Error(m); };

mkdirSync(repo, { recursive: true }); mkdirSync(bin, { recursive: true });
const git = (...a) => execFileSync('git', ['-C', repo, ...a], { stdio: 'pipe' });
execFileSync('git', ['init', '-q', '-b', 'main', repo], { stdio: 'pipe' });
git('config', 'user.email', 'c@example.invalid'); git('config', 'user.name', 'check');
writeFileSync(join(repo, 'f'), 'x'); git('add', '-A'); git('commit', '-qm', 'base');
// The lane's branch already exists — the gate reviews a diff, it does not cut one.
git('branch', 'work-l1');

const agentDir = join(repo, '.claude', 'agents');
mkdirSync(agentDir, { recursive: true });
writeFileSync(join(agentDir, 'lane-ctx.md'), '# invariants\n');

const root = execFileSync('git', ['-C', repo, 'rev-parse', '--show-toplevel'],
  { encoding: 'utf8' }).trim();
const key = execFileSync('git', ['-C', repo, 'rev-parse', '--path-format=absolute',
  '--git-common-dir'], { encoding: 'utf8' }).trim();
const slug = createHash('sha1').update(key).digest('hex').slice(0, 12);
const cfgDir = join(home, '.claude', 'lirbox-orchestrator');
mkdirSync(cfgDir, { recursive: true });
mkdirSync(join(home, '.claude', 'lirbox-lanes'), { recursive: true });
writeFileSync(join(cfgDir, `${slug}.json`), JSON.stringify({
  lanes: { base_branch: 'main', ready_timeout_ms: 60000, gate_profile: 'c-gate' },
  profiles: {
    'c-gate':   { kind: 'claude', model: 'claude-opus-5', effort: 'high',
                  agent: 'lirbox-code-reviewer' },
    'omp-gate': { kind: 'omp', model: 'muse-spark-1.2', agent: 'lane-ctx' },
  },
}, null, 2));

// The run: preconditions `start` checks, plus the dispatch record `gate` reads.
const runDir = join(repo, '.orchestration', 't1');
mkdirSync(join(runDir, 'dispatch'), { recursive: true });
writeFileSync(join(runDir, 'items.md'), '1. the only item — blocks: none\n');
writeFileSync(join(runDir, 'baseline.txt'), 'true   exit: 0\n');
// The lane's checkout has to exist: a subagent has no tree of its own.
const wtree = join(tmp, 'checkout');
mkdirSync(wtree, { recursive: true });
writeFileSync(join(runDir, 'dispatch', 'l1.json'), JSON.stringify({
  lane: 'l1', agent_name: 'l1', branch: 'work-l1', worktree: wtree,
  pane_id: 'wX:p1', profile: 'builder', state: 'dispatched',
}, null, 2));

// A herdr that records what it was asked to do and refuses to cut a tree. The
// refusal is deliberate: the pane path only has to be ENTERED to be observed,
// and a fake that succeeded would leave `start` polling for a shell.
writeFileSync(join(bin, 'herdr'), `#!/bin/sh
case "$1 $2 $3" in
  "agent start --help")
    echo '      --kind <KIND>  [possible values: claude, omp, opencode, codex]'
    exit 0 ;;
esac
echo "$@" >> ${log}
case "$1 $2" in
  "worktree create") exit 1 ;;
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

// -- 1. a claude gate profile is produced in-session --------------------------
let d = run('gate', 'l1', '--run', 't1');
// Assert the MODE before the exit code. A gate that took the pane path fails here
// for whatever the pane path happened to trip over, and that message would say
// nothing about the invariant this check exists for.
if (!/gate mode: subagent/.test(d.out)) {
  fail('a claude gate profile did not resolve to an in-session subagent. gate-guard.sh '
     + 'asks only that the producer is not the implementor — a pane buys nothing here '
     + 'and brings back the whole spawn surface, including the `--agent <name>` that '
     + `cannot be diagnosed from a startup timeout:\n${d.out}`);
}
if (herdrLog().trim() !== '') {
  fail(`an in-session gate still called herdr — it cut a pane or a tree:\n${herdrLog()}`);
}
if (d.code !== 0) fail(`the in-session gate resolved its mode and then refused: ${d.out}`);
// The three things the Agent-tool call needs. A mode line with no agent, model or
// brief path is an instruction the orchestrator has to guess its way through, and
// guessing the agent id is exactly how the 2026-08 gate died.
for (const [what, re] of [
  ['the agent id from the profile', /lirbox-code-reviewer/],
  ['the model from the profile',    /claude-opus-5/],
  ['the brief file to pass whole',  /gate-l1-brief\.md/],
  ['the verdict path to wait for',  /gate-l1-code_gate\.json/],
]) {
  if (!re.test(d.out)) fail(`the subagent instruction never names ${what}:\n${d.out}`);
}
const subagentBrief = join(runDir, 'evidence', 'gate-l1-brief.md');
if (!existsSync(subagentBrief)) fail('no brief was written for the subagent to be handed');
const subText = readFileSync(subagentBrief, 'utf8');
// A subagent inherits the orchestrator's cwd, not the lane's. Unstated, it reviews
// whatever tree the orchestrator happens to be in — a gate on the wrong diff.
if (!subText.includes(wtree)) {
  fail('the subagent brief never names the checkout to work in. A subagent inherits '
     + 'this session\'s cwd, so an unstated tree means it gates the wrong diff.');
}

// -- 2. a harness that cannot run in-session keeps its pane -------------------
rmSync(log, { force: true });
d = run('gate', 'l1', '--run', 't1', '--profile', 'omp-gate');
if (/gate mode: subagent/.test(d.out)) {
  fail('an omp gate profile was forced in-session. omp cannot run as a subagent of '
     + 'this session, so the declared reviewer is silently replaced by whatever '
     + 'claude is — the profile table stops meaning anything.');
}
if (!/worktree create/.test(herdrLog())) {
  fail(`an omp gate never reached the pane path — it gated nothing:\n${d.out}`);
}

// -- 3. both modes are handed the same verdict contract ----------------------
const paneBrief = readFileSync(subagentBrief, 'utf8');   // arm 2 rewrote it in pane mode
const contract = (t) => {
  const i = t.indexOf('Review it, and FIX');
  if (i < 0) fail('a brief lost its review instruction entirely');
  return t.slice(i);
};
if (contract(paneBrief) !== contract(subText)) {
  fail('the pane brief and the subagent brief carry different verdict contracts. '
     + 'The shape, gated_sha and the build_exit paragraph are what stop a gate '
     + 'going green on the honour system; a per-mode copy is a per-mode loophole.');
}
for (const needle of ['"gated_sha"', '"build_exit"', 'build_exit is read, not taken on trust',
                      '"produced_by": "gate-l1"']) {
  if (!subText.includes(needle)) fail(`the subagent brief dropped ${needle}`);
}

cleanup();
console.log('PASS gate-runs-in-session');
