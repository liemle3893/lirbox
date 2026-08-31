#!/usr/bin/env node
// Frozen check: the herdr-policing hooks are inert outside their subject.
//
// The invariant, in one line: pane-guard, model-policy and gate-guard fire ONLY
// for the orchestrator agent, and only on a command that is theirs to police —
// a herdr command for the first two, a branch with a dispatch record for the
// third.
//
// Why. The plugin installs at USER scope, so these three run on every Bash call
// in every repo on the machine. A PreToolUse hook that DENIES is the one thing
// in lanes nothing can talk its way past — which is exactly why it must have no
// opinion about work that is not a run. A denial from a hook the session has
// never heard of is uninterpretable, and an uninterpretable denial is what got
// read as "another session owns this pane" and answered by destroying a cluster.
//
// A note on the predicate, because the obvious one is wrong. `HERDR_ENV=1` looks
// like the scope test: herdr sets it in every pane it creates, so every lane and
// every orchestrator pane carries it. But orch-lane.sh ALSO sets it per
// invocation (`h() { HERDR_ENV=1 herdr ... }`), which is how an orchestrator in a
// plain terminal drives herdr at all — and in that session the hook's own env has
// it unset while the spawns still land. A bare `[[ $HERDR_ENV == 1 ]] || exit 0`
// would ungate precisely the case the spawn door exists for. So the scope is
// drawn on the SUBJECT — who is asking, and what they asked — not on the ambient
// environment, and this check exists to keep it there.
//
// Five arms:
//   1. not the orchestrator -> silent, even on a raw `herdr agent start`
//   2. orchestrator, ordinary command -> silent
//   3. gate-guard, a push on a branch with no dispatch record -> silent
//   4. HERDR_ENV set changes none of the above (it is not the predicate)
//   5. positive control: the orchestrator's raw spawn IS denied, so 1-4 are not
//      passing because the hooks stopped working
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const plugin = join(here, '..', '..', '..', '..');
// One override per hook, each a FILE: that is the shape prove-checks hands a
// mutated copy in.
const hookPath = (name) => process.env[`${name.replace(/-/g, '_').toUpperCase()}_OVERRIDE`]
  || join(plugin, 'hooks', `${name}.sh`);

const tmp = mkdtempSync(join(tmpdir(), 'hook-scope-'));
const repo = join(tmp, 'repo');
const cleanup = () => rmSync(tmp, { recursive: true, force: true });
const fail = (m) => { cleanup(); throw new Error(m); };

mkdirSync(repo, { recursive: true });
execFileSync('git', ['init', '-q', '-b', 'main', repo], { stdio: 'pipe' });
const git = (...a) => execFileSync('git', ['-C', repo, ...a], { stdio: 'pipe' });
git('config', 'user.email', 'c@example.invalid'); git('config', 'user.name', 'check');
writeFileSync(join(repo, 'f'), 'x'); git('add', '-A'); git('commit', '-qm', 'base');

const ORCH = 'lirbox:lirbox-herdr-orchestrator';
const fire = (hook, { agent = ORCH, cmd, herdrEnv = false } = {}) => {
  const env = { ...process.env };
  if (herdrEnv) env.HERDR_ENV = '1'; else delete env.HERDR_ENV;
  const payload = JSON.stringify({
    agent_type: agent, cwd: repo, tool_name: 'Bash', tool_input: { command: cmd },
  });
  try {
    const out = execFileSync('zsh', [hookPath(hook)],
      { input: payload, env, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { code: 0, out };
  } catch (e) { return { code: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') }; }
};
const silent = (r) => r.code === 0 && !/DENIED|REFUS/i.test(r.out);

const RAW_SPAWN = 'herdr agent start x --kind claude';
const GUARDS = ['pane-guard', 'model-policy'];

// -- 5 first: the positive control. Everything below is an absence, and an
//    absence proves nothing until the presence is shown.
for (const h of GUARDS) {
  const r = fire(h, { cmd: RAW_SPAWN });
  if (silent(r)) {
    fail(`${h} did not deny the orchestrator's raw \`herdr agent start\`. Every other arm of this `
       + 'check asserts silence, and silence from a hook that no longer fires at all is a check '
       + `that cannot fail:\n${r.out}`);
  }
}

// -- 1. someone who is not the orchestrator ------------------------------------
for (const agent of ['', 'general-purpose', 'lirbox:lirbox-builder']) {
  for (const h of [...GUARDS, 'gate-guard']) {
    const r = fire(h, { agent, cmd: RAW_SPAWN });
    if (!silent(r)) {
      fail(`${h} fired for agent_type "${agent || '(none)'}". The plugin installs at USER scope, so `
         + 'this hook runs on every Bash call in every repo on this machine — it must have no '
         + `opinion about work that is not an orchestrated run:\n${r.out}`);
    }
  }
}

// -- 2. the orchestrator, doing something that is not herdr --------------------
for (const cmd of ['ls -la', 'npm test', 'git status', 'cat README.md']) {
  for (const h of GUARDS) {
    const r = fire(h, { cmd });
    if (!silent(r)) fail(`${h} fired on \`${cmd}\`, which drives no herdr:\n${r.out}`);
  }
}

// -- 3. gate-guard, an outward verb with no run on file ------------------------
for (const cmd of ['git push origin HEAD:main', 'gh pr create --fill',
                   `git -C ${repo} push origin HEAD:main`]) {
  const r = fire('gate-guard', { cmd });
  if (!silent(r)) {
    fail(`gate-guard refused \`${cmd}\` with no dispatch record anywhere. Its predicate is bounded `
       + 'to the one lane whose branch is being pushed; refusing without a run makes every push '
       + `in every repo on this machine the orchestrator's business:\n${r.out}`);
  }
}

// -- 4. HERDR_ENV is not the predicate ----------------------------------------
// Set it, and nothing above changes. It cannot be the scope test: orch-lane.sh
// sets it per invocation, so an orchestrator in a plain terminal has it unset
// here while its spawns land — gating on it would ungate the spawn door.
for (const h of [...GUARDS, 'gate-guard']) {
  const off = fire(h, { agent: 'general-purpose', cmd: RAW_SPAWN, herdrEnv: false });
  const on = fire(h, { agent: 'general-purpose', cmd: RAW_SPAWN, herdrEnv: true });
  if (silent(off) !== silent(on)) {
    fail(`${h} behaves differently with HERDR_ENV set for a non-orchestrator caller. The scope is `
       + 'the subject — who asked and what they asked — not the ambient environment, because '
       + 'HERDR_ENV is unset in exactly the session that most needs the spawn door.');
  }
}
const inPane = fire('pane-guard', { cmd: RAW_SPAWN, herdrEnv: true });
if (silent(inPane)) {
  fail('pane-guard stopped denying the raw spawn once HERDR_ENV was set. Being inside a herdr pane '
     + 'is the normal case for an orchestrator, so that is where the door must hold hardest.');
}

cleanup();
console.log('PASS hooks-stay-out-of-other-work');
