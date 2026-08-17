#!/usr/bin/env node
// Frozen check: the Stop gate tells a STOPPED lane apart from a working one, and
// answers it with SIGCONT instead of "arm a Monitor".
//
// The invariant, in one line: a hook that exits 2 outranks every word of the
// skill, so the hook is where "flat counters are two states" has to be true.
//
// Why it exists. lane-gate.sh joins the live pane table against the ledger and
// branches on `agent_status`. A stopped lane reads `working` there — `T` is
// alive, holding all its memory, and never scheduled — so the LIVE branch told
// the orchestrator to arm a Monitor and hold the turn open, waiting on a process
// the kernel will never run again. No value of agent_status could have fixed it:
// process state is not in that table.
//
// It is measured, not asserted: a real process is SIGSTOPped inside a lane's
// checkout and the hook is run against it, then CONTINUED and the hook run
// again. The second half is the half that matters — a gate that fires on every
// live lane would pass the first assertion and teach nothing.
//
// LANE_GATE_OVERRIDE points at the hook under test (set by prove-checks).
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, existsSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const hook = process.env.LANE_GATE_OVERRIDE
  || join(here, '..', '..', '..', '..', 'hooks', 'lane-gate.sh');
if (!existsSync(hook)) throw new Error(`the Stop gate is gone: ${hook}`);

// Anything missing here means the check could not measure. That is harness rot
// (exit 2), never a pass — a green from a machine with no lsof would be a lie.
const rot = (m) => { console.error(`HARNESS ROT: ${m}`); process.exit(2); };
for (const bin of ['zsh', 'jq', 'lsof', 'ps', 'git']) {
  if (spawnSync('sh', ['-c', `command -v ${bin}`], { stdio: 'ignore' }).status !== 0) {
    rot(`${bin} not on PATH — this check cannot measure the gate without it`);
  }
}

const box = mkdtempSync(join(tmpdir(), 'lanes-stopgate-'));
let child = null;
const cleanup = () => {
  if (child && child.pid) {
    try { process.kill(child.pid, 'SIGCONT'); } catch { /* already gone */ }
    try { process.kill(child.pid, 'SIGKILL'); } catch { /* already gone */ }
  }
  rmSync(box, { recursive: true, force: true });
};
const fail = (m) => { cleanup(); throw new Error(m); };

// -- the repo the orchestrator is running in ---------------------------------
const repo = join(box, 'repo');
mkdirSync(repo, { recursive: true });
execFileSync('git', ['-C', repo, 'init', '-q']);

// The ledger path lane-gate.sh derives. Recomputed with the SAME git call rather
// than assumed, so a symlinked /tmp cannot make this miss.
const key = execFileSync('git', ['-C', repo, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
  { encoding: 'utf8' }).trim();
const ledgerDir = join(box, 'home', '.claude', 'lirbox-lanes');
mkdirSync(ledgerDir, { recursive: true });
const LANE = 'verify-k2v';
const PANE = 'w3G:p1';
writeFileSync(join(ledgerDir, `${createHash('sha1').update(key).digest('hex').slice(0, 12)}.tsv`), `${LANE}\n`);

// -- the lane's checkout, and a harness sitting in it -------------------------
const checkout = realpathSync(mkdtempSync(join(box, 'worktree-')));
const fake = join(checkout, 'opencode');
writeFileSync(fake, '#!/bin/sh\nsleep 300\n');
chmodSync(fake, 0o755);

// -- a herdr that answers exactly the two calls the gate makes ----------------
const stubs = join(box, 'bin');
mkdirSync(stubs, { recursive: true });
writeFileSync(join(stubs, 'herdr'), `#!/bin/sh
case "$1 $2" in
  "agent list") cat <<'JSON'
{"result":{"agents":[{"name":"${LANE}","pane_id":"${PANE}","agent_status":"working"}]}}
JSON
  ;;
  "pane list") cat <<'JSON'
{"result":{"panes":[{"pane_id":"${PANE}","cwd":"${checkout}","agent_status":"working"}]}}
JSON
  ;;
  *) exit 1 ;;
esac
`);
chmodSync(join(stubs, 'herdr'), 0o755);

// -- run the gate ------------------------------------------------------------
const stdin = JSON.stringify({
  agent_type: 'lirbox:lirbox-herdr-orchestrator',
  stop_hook_active: false,
  background_tasks: [],
  cwd: repo,
});
const runGate = () => {
  const r = spawnSync('zsh', [hook], {
    input: stdin,
    encoding: 'utf8',
    env: { ...process.env, HOME: join(box, 'home'), PATH: `${stubs}:${process.env.PATH}` },
  });
  return { code: r.status, err: (r.stderr || '') + (r.stdout || '') };
};

child = spawn(fake, ['--agent', LANE, '--model', 'probe'], { cwd: checkout, stdio: 'ignore' });
child.on('error', () => {});
const pid = child.pid;

const argvOf = () => {
  try { return execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }); }
  catch { return ''; }
};
const statOf = () => {
  try { return execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).trim(); }
  catch { return ''; }
};
const spinUntil = (pred, ms, what) => {
  const until = Date.now() + ms;
  while (!pred() && Date.now() < until) { /* spin */ }
  if (!pred()) { cleanup(); rot(`the fixture never ${what}`); }
};

// Stopping before the exec lands would leave the fixture named after the shell
// and sitting in the wrong cwd — the whole run would prove nothing.
spinUntil(() => argvOf().includes('opencode --agent'), 10_000, 'showed a lane-shaped argv');
try { process.kill(pid, 'SIGSTOP'); } catch (e) { cleanup(); rot(`could not stop the fixture (${e.message})`); }
spinUntil(() => statOf().startsWith('T'), 10_000, 'reached state T');

// 1. STOPPED — the gate must say so, and must name the only thing that frees it.
const stopped = runGate();
if (stopped.code !== 2) {
  fail(`a lane stopped in ${checkout} did not block the Stop gate (exit ${stopped.code}) — the turn ends with a lane the kernel will never schedule`);
}
// `kill -CONT`, not a bare "CONT": prose explaining that SIGCONT is what frees a
// stopped process is not a command anyone can run. Matching the looser form let a
// mutation swap the runnable line for ctrl+c and still pass.
if (!/kill -CONT/.test(stopped.err)) {
  fail(`the gate blocked but never names a runnable \`kill -CONT\`, so it cannot be acted on:\n${stopped.err}`);
}
if (/[Aa]rm a Monitor/.test(stopped.err)) {
  fail(`the gate answered a STOPPED lane with "arm a Monitor" — waiting on a process that will never run again:\n${stopped.err}`);
}
if (!stopped.err.includes(LANE)) {
  fail(`the gate blocked without naming which lane is stopped:\n${stopped.err}`);
}

// 2. RUNNING — same lane, same pane, same everything but the signal. A gate that
//    cannot tell these two apart is not measuring the state, it is always firing.
try { process.kill(pid, 'SIGCONT'); } catch { /* nothing to continue */ }
spinUntil(() => !statOf().startsWith('T') && statOf() !== '', 10_000, 'came back off T');

const running = runGate();
if (/kill -CONT/.test(running.err)) {
  fail(`the gate reported a stop for a lane that is running (stat=${statOf()}) — it is firing on the lane, not on its state:\n${running.err}`);
}

cleanup();
console.log('stop-gate-routes-a-stop-to-cont: OK');
