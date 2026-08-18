#!/usr/bin/env node
// Frozen check: the spawn door has to OPEN.
//
// The invariant, in one line: every lane operation the orchestrator is told to
// route through orch-lane.sh must actually succeed against herdr's real
// contract — because a sanctioned path that errors is not a gate, it is a
// detour sign, and the run takes the detour.
//
// This is not hypothetical. Measured across the 66 session transcripts of the
// 2026-08 cloudflare-os run: 26 `orch-lane.sh start` invocations, ZERO clean
// successes, then ~130 raw `herdr agent start` calls and no dispatch schema.
// Everything the script owns went with it — the lane cap in that config was 2
// and the run held 5, not because anyone overrode it but because the only code
// path that reads the cap sits below the line that always died.
//
// Four defects, each proven RED here before it was fixed:
//
//   1. lanes.timeout_ms (1800000, a lane-runtime intent) was passed to herdr's
//      --timeout, which is an agent READINESS wait capped at 300000.
//      -> invalid_agent_timeout x9
//   2. `worktree create` carried no --cwd, so herdr resolved the source repo
//      from whatever the human last focused. -> worktree_create_failed x3,
//      and three checkouts cut into another session's repo.
//   3. `agent start` fired immediately after `worktree create`, before the
//      pane was at a shell prompt. -> agent_pane_busy x8
//   4. flags the profile owns answered "unknown flag", and a name-shaped
//      mistake blamed the wrong argument. -> x3
//
// ORCH_LANE_OVERRIDE points at the script under test (set by prove-checks).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const script = process.env.ORCH_LANE_OVERRIDE
  || join(here, '..', '..', '..', '..', 'scripts', 'orch-lane.sh');

const tmp = mkdtempSync(join(tmpdir(), 'spawn-door-'));
const repo = join(tmp, 'repo');
const home = join(tmp, 'home');
const bin  = join(tmp, 'bin');
const cleanup = () => rmSync(tmp, { recursive: true, force: true });
const fail = (m) => { cleanup(); throw new Error(m); };

// -- a real git repo, because the script resolves the root and the config key --
mkdirSync(repo, { recursive: true }); mkdirSync(bin, { recursive: true });
const git = (...a) => execFileSync('git', ['-C', repo, ...a], { stdio: 'pipe' });
git('init', '-q', '-b', 'dev');
git('config', 'user.email', 'c@example.invalid');
git('config', 'user.name', 'check');
writeFileSync(join(repo, 'f'), 'x');
git('add', '-A'); git('commit', '-qm', 'base');

// macOS resolves /var through a symlink; compare against what git reports, not
// against the path we happened to construct.
const root = execFileSync('git', ['-C', repo, 'rev-parse', '--show-toplevel'],
  { encoding: 'utf8' }).trim();
const key = execFileSync('git', ['-C', repo, 'rev-parse', '--path-format=absolute',
  '--git-common-dir'], { encoding: 'utf8' }).trim();
const slug = createHash('sha1').update(key).digest('hex').slice(0, 12);
const cfgDir = join(home, '.claude', 'lirbox-orchestrator');
mkdirSync(cfgDir, { recursive: true });
mkdirSync(join(home, '.claude', 'lirbox-lanes'), { recursive: true });
const cfgPath = join(cfgDir, `${slug}.json`);

// The config that killed the real run: a lane-runtime number on a readiness knob.
const writeCfg = (lanes) => writeFileSync(cfgPath, JSON.stringify({
  lanes: { base_branch: 'dev', ...lanes },
  profiles: { 'agent-turn': { kind: 'opencode', model: 'test/model', flags: ['--auto'] } },
}, null, 2));
writeCfg({ ready_timeout_ms: 1800000, context_cap_tokens: 300000 });

// -- a herdr that answers the way the real one does --------------------------
writeFileSync(join(bin, 'herdr'), `#!/bin/sh
LOG="${tmp}/calls.log"; N="${tmp}/n"; READY="${tmp}/ready"; EARLY="${tmp}/early"
echo "$*" >> "$LOG"
case "$1 $2" in
  "worktree create")
    echo '{"result":{"root_pane":{"pane_id":"wZ:p1"},"workspace":{"workspace_id":"wZ"}}}' ;;
  "pane process-info")
    c=$(cat "$N" 2>/dev/null || echo 0); c=$((c+1)); echo $c > "$N"
    if [ "$c" -gt 2 ]; then
      : > "$READY"
      echo '{"result":{"process_info":{"shell_pid":7,"foreground_process_group_id":7}}}'
    else
      echo '{"result":{"process_info":{"shell_pid":7,"foreground_process_group_id":99}}}'
    fi ;;
  "agent start")
    [ -f "$READY" ] || : > "$EARLY" ;;
  "agent get")
    echo '{"result":{"agent":{"agent_status":"gone"}}}' ;;
  *) : ;;
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

// -- 1. the readiness timeout is inside herdr's contract ---------------------
// herdr agent start --timeout: "default: 30000; max: 300000". A config value
// above that is not a slow spawn, it is no spawn at all.
let d = run('start', 'probe', '--profile', 'agent-turn', '--run', 't1', '--dry-run');
if (d.code !== 0) fail(`--dry-run failed outright: ${d.out}`);
const to = d.out.match(/--timeout (\d+)/);
if (!to) fail('the planned agent start carries no --timeout at all');
const ms = Number(to[1]);
if (ms > 300000 || ms <= 3000) {
  fail(`--timeout ${ms} is outside herdr's accepted range (3000 < t <= 300000). `
     + 'herdr answers invalid_agent_timeout and no lane ever starts.');
}

// A config carrying only the legacy lanes.timeout_ms must not resurrect it.
writeCfg({ timeout_ms: 1800000 });
d = run('start', 'probe', '--profile', 'agent-turn', '--run', 't1', '--dry-run');
const legacy = Number((d.out.match(/--timeout (\d+)/) || [])[1]);
if (!(legacy > 3000 && legacy <= 300000)) {
  fail(`a stale lanes.timeout_ms=1800000 still reaches herdr as --timeout ${legacy}`);
}
writeCfg({ ready_timeout_ms: 60000 });

// -- 2. the source repo is pinned, never inherited from focus ----------------
d = run('start', 'probe', '--profile', 'agent-turn', '--run', 't1', '--dry-run');
const wt = d.out.split('\n').find((l) => l.includes('worktree create')) || '';
if (!/--cwd\s/.test(wt)) {
  fail('worktree create carries no --cwd — herdr resolves the source repo from '
     + "the human's focus, and cuts the checkout wherever they were last looking");
}
if (!wt.includes(`--cwd ${root}`)) fail(`--cwd does not name this repo: ${wt}`);
// The planned command and the issued one are different lines in this script, so
// assert the real invocation too — a --cwd that survives only in --dry-run
// output is a plan nobody executes.

// -- 4. flags the profile owns, and the name slot ----------------------------
if (run('start', 'probe', '--profile', 'agent-turn', '--run', 't1', '--dry').code !== 0) {
  fail('--dry was refused; the documented spelling drifted from the accepted one');
}
const kind = run('start', 'probe', '--kind', 'claude', '--profile', 'agent-turn', '--run', 't1', '--dry-run');
if (kind.code === 0) fail('--kind was accepted, re-deciding per spawn what the profile owns');
if (!/profile/.test(kind.out)) fail(`--kind refused without naming the profile: ${kind.out}`);
const noname = run('start', '--profile', 'agent-turn', '--run', 't1', '--dry-run');
if (noname.code === 0) fail('a missing lane name was accepted');
if (/unknown flag: agent-turn/.test(noname.out)) {
  fail('a missing lane name is reported as a bad flag two arguments later');
}

// -- 3. the agent is never started before the pane is a shell ----------------
const real = run('start', 'probe', '--profile', 'agent-turn', '--run', 't1');
if (real.code !== 0) fail(`a full start failed against a conforming herdr: ${real.out}`);
const calls = readFileSync(join(tmp, 'calls.log'), 'utf8');
const issued = calls.split('\n').find((l) => l.startsWith('worktree create')) || '';
if (!issued.includes(`--cwd ${root}`)) {
  fail(`the worktree create actually issued carries no --cwd for this repo: ${issued}`);
}
if (!/pane process-info/.test(calls)) {
  fail('the pane was never checked for readiness before agent start — this is the '
     + 'race that answered agent_pane_busy on 8 of 26 real starts');
}
if (existsSync(join(tmp, 'early'))) {
  fail('agent start fired while the pane was still busy');
}
if (!existsSync(join(repo, '.orchestration/t1/dispatch/probe.json'))) {
  fail('a successful start wrote no dispatch record — the lane cannot be found again');
}

// -- 5. a lane that cannot be found again was never dispatched --------------
// The dispatch record used to be written only when --run happened to be passed.
// The real run left 83 records against ~143 starts; every gap is a lane no
// successor — and no `restart` — can locate.
if (run('start', 'norun', '--profile', 'agent-turn', '--dry-run').code === 0) {
  fail('start without --run was accepted; that lane would leave no dispatch record');
}

// -- 6. the base branch is a decision, not a hardcoded "dev" ----------------
writeCfg({ ready_timeout_ms: 60000, base_branch: null });
const nobase = run('start', 'probe2', '--profile', 'agent-turn', '--run', 't1', '--dry-run');
if (nobase.code === 0) {
  fail('start ran with no lanes.base_branch — it is back to guessing which branch '
     + 'every worktree is cut from, which fails as "not a valid object name"');
}
writeCfg({ ready_timeout_ms: 60000, base_branch: 'no-such-branch' });
if (run('start', 'probe2', '--profile', 'agent-turn', '--run', 't1', '--dry-run').code === 0) {
  fail('a base branch that resolves nowhere was accepted; it fails at spawn instead');
}
writeCfg({ ready_timeout_ms: 60000 });

// -- 7. restart re-arms the EXISTING pane, and cuts no second worktree -------
// ~half of the real run's spawns were this: /clear boundaries, wedges, deaths.
// `start` cannot serve them, and a /clear silently drops the --agent profile,
// so restarting through the profile is what puts the bounded context back.
// The log is append-only and `start` already spawned this lane WITH its profile.
// Searching the whole file would match that line and stay green while restart
// dropped the profile entirely — so look only at what restart itself issued.
const before = readFileSync(join(tmp, 'calls.log'), 'utf8');
const re = run('restart', 'probe', '--run', 't1');
if (re.code !== 0) fail(`restart of a recorded lane failed: ${re.out}`);
const log2 = readFileSync(join(tmp, 'calls.log'), 'utf8').slice(before.length);
if ((log2.match(/^worktree create/gm) || []).length !== 0) {
  fail('restart cut a new worktree — it must re-arm the checkout the lane already has');
}
if (!/agent start probe .*--agent agent-turn/.test(log2)) {
  fail('restart did not re-apply the profile; a /clear drops it and this is what puts it back');
}
if (!/agent start probe .*--pane wZ:p1/.test(log2)) {
  fail('restart did not target the pane named in the dispatch record');
}
const rec = JSON.parse(readFileSync(join(repo, '.orchestration/t1/dispatch/probe.json'), 'utf8'));
if (rec.restarts !== 1) fail(`restart was not recorded on the lane (restarts=${rec.restarts})`);
if (!rec.sha_at_dispatch) fail('restart erased sha_at_dispatch — the field that tells a lane '
  + 'that died after committing from one that never started');

// A name this run does NOT own fails on ownership and never reaches the record
// guard — testing with one would prove nothing. Own it, but leave it unrecorded:
// exactly a lane whose start skipped the dispatch write.
writeFileSync(join(home, '.claude', 'lirbox-lanes',
  `${slug}.tsv`), `probe\norphan\n`);
const ghost = run('restart', 'orphan', '--run', 't1');
if (ghost.code === 0) fail('restart of an owned lane with no dispatch record was accepted');
if (!/dispatch record/.test(ghost.out)) {
  fail('restart refused an unrecorded lane without saying the record is what is '
     + `missing — the operator is sent hunting instead: ${ghost.out.trim()}`);
}

cleanup();
console.log('spawn-door-opens: OK');
