#!/usr/bin/env node
// Frozen check: `pane split` may not claim the workspace it landed in.
//
// The invariant, in one line: the ledger records what this run BROUGHT INTO
// EXISTENCE, because that is the only thing it can safely authorize destroying.
//
// `worktree create` makes a new workspace, so its workspace_id is ours.
// `pane split` never makes one — it lands in an existing workspace, which by
// definition predates the split. Recording that id from a split writes a
// workspace we did not create into the file that grants destruction rights.
//
// Measured, 2026-08 run: bare `wV` sits on line 272 of the live ledger. `wV`
// predates every lane in that file and holds both the human's panes and the
// orchestrator's own terminal, `wV:p2A`. pane-guard goes out of its way to
// authorize `herdr worktree remove --workspace <ws>` for owned workspaces
// (see its `worktree` case, which exists because that verb names its target
// with a flag and a positional-shaped check would skip it). So the ledger
// authorized destroying the workspace the session itself was running in.
//
// After the spawn door closed, this is the only remaining route by which a
// foreign workspace token can reach the ledger at all: `agent start` and
// `worktree create` are absolutely denied to the model, while `pane split`
// stays an endorsed verb in the orchestrator's own command table.
//
// The pane id from a split IS ours — we just created that pane. Only the
// workspace is the lie, so this check requires the pane and refuses the
// workspace rather than dropping the branch wholesale.
//
// LANE_LEDGER_OVERRIDE / PANE_GUARD_OVERRIDE point at the hooks under test.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const hooks = join(here, '..', '..', '..', '..', 'hooks');
const ledgerHook = process.env.LANE_LEDGER_OVERRIDE || join(hooks, 'lane-ledger.sh');
const guardHook  = process.env.PANE_GUARD_OVERRIDE  || join(hooks, 'pane-guard.sh');

const tmp = mkdtempSync(join(tmpdir(), 'split-ws-'));
const repo = join(tmp, 'repo');
const home = join(tmp, 'home');
const cleanup = () => rmSync(tmp, { recursive: true, force: true });
const fail = (m) => { cleanup(); throw new Error(m); };

// A real repo: both hooks key the ledger off the git common dir.
mkdirSync(repo, { recursive: true });
const git = (...a) => execFileSync('git', ['-C', repo, ...a], { stdio: 'pipe' });
git('init', '-q', '-b', 'main');
git('config', 'user.email', 'c@example.invalid');
git('config', 'user.name', 'check');
writeFileSync(join(repo, 'f'), 'x');
git('add', '-A'); git('commit', '-qm', 'base');

const key = execFileSync('git', ['-C', repo, 'rev-parse', '--path-format=absolute',
  '--git-common-dir'], { encoding: 'utf8' }).trim();
const slug = createHash('sha1').update(key).digest('hex').slice(0, 12);
const ledger = join(home, '.claude', 'lirbox-lanes', `${slug}.tsv`);
mkdirSync(dirname(ledger), { recursive: true });

const env = { ...process.env, HOME: home };

// PostToolUse: the hook reads what herdr printed back.
const record = (command, stdout) => {
  execFileSync('zsh', [ledgerHook], {
    input: JSON.stringify({
      agent_type: 'lirbox:lirbox-herdr-orchestrator',
      cwd: repo,
      tool_input: { command },
      tool_response: { stdout },
    }),
    env, stdio: ['pipe', 'pipe', 'pipe'],
  });
};

const tokens = () => (existsSync(ledger)
  ? readFileSync(ledger, 'utf8').split('\n').filter(Boolean)
  : []);

// PreToolUse: 0 allowed, 2 denied.
const verdict = (command) => {
  try {
    execFileSync('zsh', [guardHook], {
      input: JSON.stringify({
        agent_type: 'lirbox:lirbox-herdr-orchestrator',
        cwd: repo,
        tool_input: { command },
      }),
      env, stdio: ['pipe', 'pipe', 'pipe'],
    });
    return 0;
  } catch (e) { return e.status ?? 1; }
};

// -- 1. a split records its pane and NOT the workspace it landed in ----------
record('HERDR_ENV=1 herdr pane split wV:p2A --direction down --json',
  '{"result":{"pane_id":"wV:p9","workspace_id":"wV"}}');

let have = tokens();
if (!have.includes('wV:p9')) {
  fail('the pane a split created was not recorded. That pane IS ours — we just '
     + 'made it — and without the row every later write into it is denied.');
}
if (have.includes('wV')) {
  fail('`pane split` claimed workspace "wV", which it did not create — a split '
     + 'lands in a workspace that already existed. pane-guard authorizes '
     + '`worktree remove --workspace <ws>` for owned workspaces, so this row '
     + "grants destruction of a workspace holding the human's panes and the "
     + "orchestrator's own terminal. Line 272 of the real ledger is this bug.");
}

// -- 2. and the guard consequently refuses to destroy that workspace ---------
if (verdict('HERDR_ENV=1 herdr worktree remove --workspace wV --force') !== 2) {
  fail('`worktree remove --workspace wV` was ALLOWED. The split wrote wV into '
     + 'the ledger and the guard read it as a workspace this run created. '
     + 'That command destroys checkouts, and wV is where the session lives.');
}

// -- 3. no regression: a real creation still records both -------------------
// `worktree create` DOES bring a workspace into existence, so its id is ours
// and must stay ours — a fix that drops the whole branch would silently deny
// every teardown of a lane this run legitimately created.
record('HERDR_ENV=1 herdr worktree create --cwd ' + repo + ' --branch x --no-focus --json',
  '{"result":{"root_pane":{"pane_id":"wY:p1"},"workspace":{"workspace_id":"wY"}}}');

have = tokens();
for (const t of ['wY:p1', 'wY']) {
  if (!have.includes(t)) {
    fail(`\`worktree create\` no longer records "${t}". It genuinely creates the `
       + 'workspace, so refusing to own it makes every legitimate teardown of '
       + 'this run\'s own lanes fail as "a pane this run did not create".');
  }
}
if (verdict('HERDR_ENV=1 herdr worktree remove --workspace wY --force') !== 0) {
  fail('removing a workspace this run created was denied — the guard now blocks '
     + 'its own sanctioned teardown, which is how dead panes accumulate');
}

cleanup();
console.log('split-claims-no-workspace: OK');
