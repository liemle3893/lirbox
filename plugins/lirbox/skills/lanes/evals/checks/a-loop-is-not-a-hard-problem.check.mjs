#!/usr/bin/env node
// Frozen check: a lane restarted with nothing to show for it is refused.
//
// The invariant, in one line: retrying is bounded by PROGRESS, not by a budget.
//
// Ported from conductor, which never counts money. Its DoDGate bounds rounds
// (`for round = 1; round <= 3`) and then asks whether the unmet set CHANGED —
// `dodStalled` is literally "unmet set unchanged". Its triage.cjs classifies a
// thrown run into relaunch / ask / report because "a bare relaunch hits the
// same wall". A dollar cap cannot make that distinction: it stops a slow
// problem and a stuck one identically, and it stops the slow one at exactly
// the wrong moment.
//
// lanes' vocabulary for the same question: has this lane produced NEW evidence
// since its last restart? Restarting a lane that yielded nothing, again, is a
// loop — the shape that ran for a day and cost real money.
//
// The two arms that matter are the DISCRIMINATION: same restart count, the
// only difference being whether fresh evidence exists. Progress must pass and
// stall must fail, or the guard is just a retry counter with a story attached.
//
// ORCH_LANE_OVERRIDE points at the script under test (set by prove-checks).
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const script = process.env.ORCH_LANE_OVERRIDE
  || join(here, '..', '..', '..', '..', 'scripts', 'orch-lane.sh');

const tmp  = mkdtempSync(join(tmpdir(), 'stall-'));
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

const root = execFileSync('git', ['-C', repo, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const key  = execFileSync('git', ['-C', repo, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim();
const slug = createHash('sha1').update(key).digest('hex').slice(0, 12);

mkdirSync(join(home, '.claude', 'lirbox-lanes'), { recursive: true });
mkdirSync(join(home, '.claude', 'lirbox-orchestrator'), { recursive: true });
writeFileSync(join(home, '.claude', 'lirbox-orchestrator', `${slug}.json`), JSON.stringify({
  lanes: { base_branch: 'main', ready_timeout_ms: 60000, max_restarts: 2 },
  profiles: { 'agent-turn': { kind: 'opencode', model: 'test/model' } },
}, null, 2));
writeFileSync(join(home, '.claude', 'lirbox-lanes', `${slug}.tsv`), 'kb\nwZ:p1\n');

writeFileSync(join(bin, 'herdr'), `#!/bin/sh
case "$1 $2" in
  "pane process-info") echo '{"result":{"process_info":{"shell_pid":7,"foreground_process_group_id":7}}}' ;;
  "agent get")         echo '{"result":{"agent":{"agent_status":"gone"}}}' ;;
  *) : ;;
esac
exit 0
`);
chmodSync(join(bin, 'herdr'), 0o755);

const runDir = join(root, '.orchestration', 'r1');
mkdirSync(join(runDir, 'dispatch'), { recursive: true });
mkdirSync(join(runDir, 'evidence'), { recursive: true });

const LAST_RESTART = '2026-08-19T10:00:00Z';
const setRec = (restarts) => writeFileSync(join(runDir, 'dispatch', 'kb.json'), JSON.stringify({
  lane: 'kb', agent_name: 'kb', branch: 'kb', pane_id: 'wZ:p1', worktree: root,
  profile: 'agent-turn', state: 'dispatched', restarts, restarted_at: LAST_RESTART,
}));
const setEvidence = (rows) => writeFileSync(join(runDir, 'evidence', 'kb.json'), JSON.stringify(rows));

const env = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` };
const restart = (...extra) => {
  const r = spawnSync('zsh', [script, 'restart', 'kb', '--run', 'r1', ...extra],
    { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return { code: r.status ?? 1, out: (r.stdout || '') + (r.stderr || '') };
};

// -- 1. under the ceiling: a first retry is ordinary -------------------------
setRec(0); setEvidence([]);
if (restart().code !== 0) fail('the FIRST restart of a lane was refused. Retrying once is ordinary; '
  + 'a guard that fires immediately is a guard that gets --force-d by reflex.');

// -- 2. at the ceiling with NO new evidence: refused as a loop ----------------
setRec(2); setEvidence([]);
let r = restart();
if (r.code === 0) {
  fail('a lane restarted twice with NO evidence produced since the last restart was restarted '
     + 'again. That is the loop conductor refuses: unmet set unchanged means the theory is wrong, '
     + 'and further attempts are waste. This is the shape that ran for a day.');
}
if (!/loop, not a hard problem/i.test(r.out)) {
  fail(`refused, but not AS a loop — the message never makes the distinction, so the operator `
     + `cannot tell a stall from a rate limit: ${r.out.trim()}`);
}
if (!/rival/i.test(r.out)) {
  fail('the refusal does not tell the operator what to do instead. A block that names no next '
     + 'move is an obstacle, and obstacles get routed around.');
}

// -- 3. THE DISCRIMINATION: same count, but progress was made ---------------
// Identical restart count. The ONLY difference is an evidence record written
// AFTER the last restart. If this is refused too, the guard is a retry counter
// wearing a stall detector's message.
setRec(2);
setEvidence([{ lane: 'kb', kind: 'report', at: '2026-08-19T11:00:00Z', produced_by: 'kb' }]);
r = restart();
if (r.code !== 0) {
  fail('a lane that PRODUCED new evidence since its last restart was refused as stalled. '
     + 'Progress is exactly what distinguishes a hard problem from a loop — refusing it turns '
     + `this into a budget, which is the thing conductor deliberately does not do: ${r.out.trim()}`);
}

// -- 4. stale evidence is not progress --------------------------------------
// A record written BEFORE the last restart cannot be a result of it.
setRec(2);
setEvidence([{ lane: 'kb', kind: 'report', at: '2026-08-19T09:00:00Z', produced_by: 'kb' }]);
if (restart().code === 0) {
  fail('evidence predating the last restart counted as progress. Then any lane with any history '
     + 'restarts forever, and the guard never fires on the case it exists for.');
}

// -- 5. another lane's evidence is not this lane's progress -----------------
setRec(2);
setEvidence([{ lane: 'other', kind: 'report', at: '2026-08-19T11:00:00Z', produced_by: 'other' }]);
if (restart().code === 0) {
  fail("another lane's evidence satisfied this lane's progress test — the predicate is not scoped "
     + 'to the lane being restarted');
}

// -- 6. the deliberate escape stays open ------------------------------------
setRec(2); setEvidence([]);
if (restart('--force').code !== 0) {
  fail('--force was refused. A stall guard with no stated escape gets worked around silently '
     + 'instead of on the record — and sometimes the operator really has done the thinking.');
}

cleanup();
console.log('a-loop-is-not-a-hard-problem: OK');
