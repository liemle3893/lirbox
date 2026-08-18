#!/usr/bin/env node
// Frozen check: a lane can only be created through orch-lane.sh.
//
// The invariant, in one line: the sanctioned path is the ONLY path, because a
// path that is merely recommended is the one that loses under time pressure.
//
// Measured, 2026-08 run: orch-lane.sh errored on all 26 of its invocations, the
// orchestrator finished the job with ~130 raw `herdr agent start` calls, and
// everything the script owns went dark with it — the --cwd pin, the wait for a
// shell prompt, lanes.base_branch, the dispatch record, and lanes.max_concurrent,
// which that config set to 2 while five lanes ran. Nothing overrode the cap. The
// only code that reads it sits inside the command nobody could call.
//
// Why an absolute deny is safe: PreToolUse only ever sees commands the MODEL
// issues. orch-lane.sh runs herdr as a child process, never as a tool call, so
// the door is never knocked on by the door.
//
// PANE_GUARD_OVERRIDE points at the hook under test (set by prove-checks).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const hook = process.env.PANE_GUARD_OVERRIDE
  || join(here, '..', '..', '..', '..', 'hooks', 'pane-guard.sh');

const cwd = mkdtempSync(join(tmpdir(), 'only-door-'));
const cleanup = () => rmSync(cwd, { recursive: true, force: true });
const fail = (m) => { cleanup(); throw new Error(m); };

const verdict = (command) => {
  const payload = JSON.stringify({
    agent_type: 'lirbox:lirbox-herdr-orchestrator',
    cwd,
    tool_input: { command },
  });
  try {
    execFileSync('zsh', [hook], { input: payload, stdio: ['pipe', 'pipe', 'pipe'] });
    return 0;
  } catch (e) { return e.status ?? 1; }
};

const L = '${CLAUDE_PLUGIN_ROOT}/scripts/orch-lane.sh';

// -- denied: the two verbs that bring a lane into existence ------------------
for (const [cmd, what] of [
  ['HERDR_ENV=1 herdr agent start raw --kind opencode --pane wZ:p1 --timeout 1800000 -- --agent agent-turn --auto',
   'a raw agent start'],
  ['HERDR_ENV=1 herdr worktree create --branch x --base dev --label x --no-focus --json',
   'a raw worktree create'],
  ['cd /repo && HERDR_ENV=1 herdr agent start raw --kind claude --pane wZ:p1 -- --agent Plan',
   'a raw agent start buried in a compound command'],
]) {
  if (verdict(cmd) !== 2) {
    fail(`${what} was allowed. Everything orch-lane.sh owns — the --cwd pin, the `
       + `shell-prompt wait, base_branch, the dispatch record, max_concurrent — `
       + `is skipped on that path, and the cap becomes unreachable code.`);
  }
}

// -- allowed: the door itself, and every read ------------------------------
for (const [cmd, what] of [
  [`${L} start lane-a --profile agent-turn --run tracks`, 'the sanctioned start'],
  [`${L} restart lane-a --run tracks`, 'the sanctioned restart'],
  [`HERDR_ENV=1 herdr workspace focus wV; ${L} restart lane-a --run tracks`,
   'the sanctioned path alongside another herdr noun'],
  ['HERDR_ENV=1 herdr agent read wV:p42', 'reading a pane'],
  ['HERDR_ENV=1 herdr agent list', 'listing agents'],
  ['HERDR_ENV=1 herdr pane process-info --pane wZ:p1', 'the readiness probe itself'],
]) {
  if (verdict(cmd) !== 0) {
    fail(`${what} was denied. A gate that blocks its own sanctioned path is the `
       + `reason the last one got routed around.`);
  }
}

// -- the deliberate escape stays open, and has to be said out loud -----------
if (verdict('HERDR_ENV=1 herdr agent start raw --kind opencode --pane wZ:p1 -- --agent agent-turn '
  + '# POLICY-OVERRIDE: re-arming a pane herdr created before this run') !== 0) {
  fail('POLICY-OVERRIDE was refused; a gate with no stated escape gets worked '
     + 'around silently instead of on the record');
}

// -- the denial has to name the way out -------------------------------------
let msg = '';
try {
  execFileSync('zsh', [hook], {
    input: JSON.stringify({ agent_type: 'lirbox:lirbox-herdr-orchestrator', cwd,
      tool_input: { command: 'herdr agent start raw --kind opencode --pane wZ:p1 -- --agent x' } }),
    stdio: ['pipe', 'pipe', 'pipe'] });
} catch (e) { msg = (e.stderr || '').toString(); }
// Anchor on the usage LINE, not the word: the prose below it also says
// "restarting", so a loose match stays green while the command disappears.
for (const want of ['orch-lane.sh', 'restart <name> --run', 'POLICY-OVERRIDE']) {
  if (!msg.includes(want)) {
    fail(`the denial never mentions "${want}" — a block that does not name the `
       + `correct verb is an obstacle, and obstacles get routed around`);
  }
}

cleanup();
console.log('spawn-is-the-only-door: OK');
