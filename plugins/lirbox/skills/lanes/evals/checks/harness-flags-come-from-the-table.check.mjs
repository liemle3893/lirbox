#!/usr/bin/env node
// Frozen check: what a lane is STARTED with comes from the harness table, and
// every harness gets its own spelling.
//
// The invariant, in one line: a lane must reach its harness carrying its
// bounded-context profile, its model and its effort in flags that harness
// actually has — because the failure mode when it does not is silence.
//
// orch-lane.sh built one literal vector: `-- --agent <profile> --model <model>`.
// That is claude/opencode syntax. omp carries its profile as
// `--append-system-prompt <file>` and its effort as `--thinking`, and a TUI
// ignores unknown flags without error — so an omp lane started the old way
// reports a clean start, shows a healthy pane, and runs for hours with no
// invariants and no ubiquitous language. It is the same defect a herdr /clear
// causes, which is the one `restart` exists to undo, and nothing in the run
// surfaces it.
//
// Three arms, one per way that can break:
//   1. the launch vector uses each kind's own flags
//   2. a kind herdr cannot start is refused BEFORE a worktree exists, naming
//      herdr as the blocker rather than surfacing an enum error
//   3. model-policy.sh reads those same flags — a hook that only knows --agent
//      denies every correct omp spawn as having no profile, which pushes the
//      orchestrator to POLICY-OVERRIDE its way around a working gate
//
// ORCH_LANE_OVERRIDE / MODEL_POLICY_OVERRIDE point at the scripts under test.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const plugin = join(here, '..', '..', '..', '..');
const script = process.env.ORCH_LANE_OVERRIDE || join(plugin, 'scripts', 'orch-lane.sh');
const hook = process.env.MODEL_POLICY_OVERRIDE || join(plugin, 'hooks', 'model-policy.sh');

const tmp = mkdtempSync(join(tmpdir(), 'harness-flags-'));
const repo = join(tmp, 'repo'), home = join(tmp, 'home'), bin = join(tmp, 'bin');
const cleanup = () => rmSync(tmp, { recursive: true, force: true });
const fail = (m) => { cleanup(); throw new Error(m); };

mkdirSync(repo, { recursive: true }); mkdirSync(bin, { recursive: true });
const git = (...a) => execFileSync('git', ['-C', repo, ...a], { stdio: 'pipe' });
execFileSync('git', ['init', '-q', '-b', 'main', repo], { stdio: 'pipe' });
git('config', 'user.email', 'c@example.invalid'); git('config', 'user.name', 'check');
writeFileSync(join(repo, 'f'), 'x'); git('add', '-A'); git('commit', '-qm', 'base');

// The agent markdown a file-carried profile points at.
const agentDir = join(repo, '.claude', 'agents');
mkdirSync(agentDir, { recursive: true });
writeFileSync(join(agentDir, 'lane-ctx.md'), '# invariants\n');
// macOS resolves /var through a symlink and the script reports the repo root as
// git sees it. Compare against that, not against the path we constructed.
const root = execFileSync('git', ['-C', repo, 'rev-parse', '--show-toplevel'],
  { encoding: 'utf8' }).trim();
const agentFile = join(root, '.claude', 'agents', 'lane-ctx.md');

const key = execFileSync('git', ['-C', repo, 'rev-parse', '--path-format=absolute',
  '--git-common-dir'], { encoding: 'utf8' }).trim();
const slug = createHash('sha1').update(key).digest('hex').slice(0, 12);
const cfgDir = join(home, '.claude', 'lirbox-orchestrator');
mkdirSync(cfgDir, { recursive: true });
mkdirSync(join(home, '.claude', 'lirbox-lanes'), { recursive: true });
const cfgPath = join(cfgDir, `${slug}.json`);
writeFileSync(cfgPath, JSON.stringify({
  lanes: { base_branch: 'main', ready_timeout_ms: 60000, gate_profile: 'c-lane' },
  profiles: {
    'c-lane':   { kind: 'claude', model: 'claude-sonnet-5', effort: 'medium' },
    'omp-lane': { kind: 'omp', model: 'muse-spark-1.2', effort: 'high',
                  agent: 'lane-ctx', flags: ['--auto-approve'] },
    'jc-lane':  { kind: 'jcode', model: 'some-model' },
  },
}, null, 2));

// The run precondition `start` checks before anything else — fixture only.
mkdirSync(join(repo, '.orchestration', 't1'), { recursive: true });
writeFileSync(join(repo, '.orchestration', 't1', 'items.md'), '1. the only item — blocks: none\n');
writeFileSync(join(repo, '.orchestration', 't1', 'baseline.txt'), 'true   exit: 0\n');

// A herdr whose kind enum matches the real one: omp in, jcode out.
writeFileSync(join(bin, 'herdr'), `#!/bin/sh
case "$1 $2 $3" in
  "agent start --help")
    echo '      --kind <KIND>  [possible values: claude, omp, opencode, codex]' ;;
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

// -- 1. each kind gets its own spelling --------------------------------------
let d = run('start', 'l1', '--profile', 'c-lane', '--run', 't1', '--dry-run');
if (d.code !== 0) fail(`claude lane refused outright: ${d.out}`);
if (!/--agent c-lane\b/.test(d.out)) fail('a claude lane must carry --agent <profile>');
if (!/--model claude-sonnet-5\b/.test(d.out)) fail('a claude lane must carry --model');
if (!/--effort medium\b/.test(d.out)) fail('a claude lane must carry --effort');

d = run('start', 'l2', '--profile', 'omp-lane', '--run', 't1', '--dry-run');
if (d.code !== 0) fail(`omp lane refused outright: ${d.out}`);
if (/--agent /.test(d.out)) {
  fail('an omp lane carries --agent, a flag omp does not have. omp ignores unknown '
     + 'flags without error, so this lane starts clean and runs with NO invariants.');
}
if (!d.out.includes(`--append-system-prompt ${agentFile}`)) {
  fail(`an omp lane must carry --append-system-prompt <path to the agent md>: ${d.out}`);
}
if (!/--thinking high\b/.test(d.out)) {
  fail('an omp lane must carry --thinking, omp’s effort flag — --effort is claude’s spelling '
     + 'and omp would drop it silently');
}
if (!/--auto-approve\b/.test(d.out)) fail('the profile’s own flags must still ride along');

// -- 2. a kind herdr cannot start is refused, and herdr is named --------------
d = run('start', 'l3', '--profile', 'jc-lane', '--run', 't1', '--dry-run');
if (d.code === 0) fail('a lane was planned on a harness herdr cannot start');
if (!/herdr/.test(d.out)) {
  fail('the refusal does not name herdr as the blocker, so it reads as a broken '
     + 'orchestrator and gets routed around');
}

// -- 3. the hook reads the same flags ----------------------------------------
const askHook = (command) => {
  const input = JSON.stringify({
    agent_type: 'lirbox:lirbox-herdr-orchestrator', cwd: repo, tool_input: { command } });
  try {
    execFileSync('zsh', [hook], { input, env, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { code: 0, out: '' };
  } catch (e) { return { code: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') }; }
};

let h = askHook(`herdr agent start l2 --kind omp --pane w1:p1 -- `
  + `--append-system-prompt ${agentFile} --model muse-spark-1.2 --thinking high --auto-approve`);
if (h.code !== 0) {
  fail('model-policy denied a CORRECT omp spawn. A gate that refuses the sanctioned '
     + `command is a detour sign, and the run takes the detour: ${h.out}`);
}

h = askHook('herdr agent start l2 --kind omp --pane w1:p1 -- --model muse-spark-1.2 --thinking high');
if (h.code === 0) fail('model-policy allowed an omp lane with NO bounded-context profile');

h = askHook(`herdr agent start l2 --kind omp --pane w1:p1 -- `
  + `--append-system-prompt ${agentFile} --model something-else --thinking high`);
if (h.code === 0) fail('model-policy allowed an omp lane on a model the profile does not declare');

cleanup();
console.log('harness-flags-come-from-the-table: OK');
