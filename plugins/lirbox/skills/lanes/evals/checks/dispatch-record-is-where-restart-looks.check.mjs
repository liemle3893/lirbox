#!/usr/bin/env node
// Frozen check: the record `start` writes is the record `restart` reads.
//
// The invariant, in one line: a lane must be findable again from anywhere in
// the repo, because the whole point of the dispatch record is that a
// replacement orchestrator — or the same one after a /clear — can pick the
// lane up without having watched it start.
//
// Two ways that broke, both silent:
//
//   1. `start` wrote the record to a PWD-relative `.orchestration/<run>/…`
//      while `restart` read it from an absolute `$ROOT/.orchestration/<run>/…`.
//      Start from a subdirectory or a worktree and the record lands somewhere
//      restart will never look. Its refusal then says "no dispatch record —
//      start a fresh lane instead", so the recovery path for a wedged pane
//      becomes cutting another checkout. The 2026-08 run did exactly that for
//      every wedged pane; ~/.herdr reached 16GB.
//
//   2. The record never carried `worktree`, and restart reads `.worktree`.
//      So WTREE was always empty: the "the checkout this lane worked in is
//      gone" guard could never fire, and `sha_at_restart` was taken from
//      `${WTREE:-$ROOT}` — the MAIN repo's HEAD, not the lane's. That is the
//      field SKILL.md leans on to tell a lane that died after committing from
//      one that never started, and it was measuring the wrong tree.
//
// A record that exists but cannot be found, and a field that is read but never
// written, fail the same way: they look like a working store.
//
// ORCH_LANE_OVERRIDE points at the script under test (set by prove-checks).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, statSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const script = process.env.ORCH_LANE_OVERRIDE
  || join(here, '..', '..', '..', '..', 'scripts', 'orch-lane.sh');

const tmp  = mkdtempSync(join(tmpdir(), 'dispatch-rec-'));
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

// macOS resolves /var through a symlink; take the paths git reports.
const root = execFileSync('git', ['-C', repo, 'rev-parse', '--show-toplevel'],
  { encoding: 'utf8' }).trim();
const key = execFileSync('git', ['-C', repo, 'rev-parse', '--path-format=absolute',
  '--git-common-dir'], { encoding: 'utf8' }).trim();
const slug = createHash('sha1').update(key).digest('hex').slice(0, 12);

mkdirSync(join(home, '.claude', 'lirbox-lanes'), { recursive: true });
mkdirSync(join(home, '.claude', 'lirbox-orchestrator'), { recursive: true });
writeFileSync(join(home, '.claude', 'lirbox-orchestrator', `${slug}.json`),
  JSON.stringify({
    lanes: { base_branch: 'main', ready_timeout_ms: 60000, context_cap_tokens: 300000 },
    profiles: { 'agent-turn': { kind: 'opencode', model: 'test/model', flags: ['--auto'] } },
    setup: { install: 'true', test: 'true' },
  }, null, 2));

// FIXTURE ONLY — no assertion below depends on these. `start` refuses the first
// lane of a run without them (see first-lane-costs-a-baseline). This check is
// about WHERE the record lands and WHAT it carries, not about run preconditions,
// so it satisfies that gate in setup rather than re-testing it.
mkdirSync(join(repo, '.orchestration', 't1'), { recursive: true });
writeFileSync(join(repo, '.orchestration', 't1', 'items.md'),
  '1. the only item — blocks: none\n');
writeFileSync(join(repo, '.orchestration', 't1', 'baseline.txt'),
  'true   exit: 0\n');

// The lane's real checkout. herdr would cut this; the stub hands back its path,
// which is the value the dispatch record has to carry.
const wtree = join(tmp, 'wt-probe');
git('worktree', 'add', '-q', '-b', 'probe', wtree);
const wtreeReal = execFileSync('git', ['-C', wtree, 'rev-parse', '--show-toplevel'],
  { encoding: 'utf8' }).trim();
// Move the lane's HEAD so "which tree was measured" is answerable, not a
// coincidence: root and worktree must not share a HEAD.
execFileSync('git', ['-C', wtree, 'config', 'user.email', 'c@example.invalid'], { stdio: 'pipe' });
execFileSync('git', ['-C', wtree, 'config', 'user.name', 'check'], { stdio: 'pipe' });
writeFileSync(join(wtree, 'lane-work'), 'y');
execFileSync('git', ['-C', wtree, 'add', '-A'], { stdio: 'pipe' });
execFileSync('git', ['-C', wtree, 'commit', '-qm', 'lane commit'], { stdio: 'pipe' });
const laneSha = execFileSync('git', ['-C', wtree, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const rootSha = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (laneSha === rootSha) fail('setup: the lane checkout and the repo share a HEAD, so this check could not tell them apart');

writeFileSync(join(bin, 'herdr'), `#!/bin/sh
echo "$*" >> "${tmp}/calls.log"
case "$1 $2" in
  "worktree create")
    echo '{"result":{"worktree":{"path":"${wtreeReal}"},"root_pane":{"pane_id":"wZ:p1"},"workspace":{"workspace_id":"wZ"}}}' ;;
  "pane process-info")
    echo '{"result":{"process_info":{"shell_pid":7,"foreground_process_group_id":7}}}' ;;
  "agent get")
    echo '{"result":{"agent":{"agent_status":"gone"}}}' ;;
  *) : ;;
esac
exit 0
`);
chmodSync(join(bin, 'herdr'), 0o755);

const env = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` };
const run = (cwd, ...args) => {
  try {
    return { code: 0, out: execFileSync('zsh', [script, ...args],
      { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) { return { code: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') }; }
};

// -- 1. start from a SUBDIRECTORY still records where restart looks ----------
// The root case already passes and always did; the subdirectory is the case
// that decides whether the record is addressed absolutely or by accident.
const sub = join(repo, 'packages', 'kb');
mkdirSync(sub, { recursive: true });

const started = run(sub, 'start', 'probe', '--profile', 'agent-turn', '--run', 't1');
if (started.code !== 0) fail(`start failed against a conforming herdr: ${started.out}`);

const canonical = join(root, '.orchestration', 't1', 'dispatch', 'probe.json');
if (!existsSync(canonical)) {
  const strayed = join(sub, '.orchestration', 't1', 'dispatch', 'probe.json');
  fail('the dispatch record is not at ' + canonical
     + (existsSync(strayed) ? ` — it landed at ${strayed} instead, PWD-relative. ` : ' — it was not written. ')
     + 'restart resolves that path from the repo root, so this lane cannot be '
     + 'restarted from anywhere but the directory it happened to start in. Its '
     + 'refusal then says "start a fresh lane instead", which is how a wedged '
     + 'pane becomes a second checkout.');
}

// -- 2. the record carries the fields restart actually reads ----------------
const rec = JSON.parse(readFileSync(canonical, 'utf8'));
if (!rec.worktree) {
  fail('the dispatch record carries no `worktree`, and restart reads `.worktree`. '
     + 'Empty means the "this checkout is gone" guard can never fire, and '
     + "sha_at_restart is measured against the MAIN repo instead of the lane's "
     + 'tree — the field that separates a lane that died after committing from '
     + 'one that never started.');
}
if (!statSync(rec.worktree).isDirectory()) {
  fail(`the record's worktree does not exist: ${rec.worktree}`);
}
if (!rec.lane) {
  fail('the dispatch record names no `lane`. SKILL.md documents the record as '
     + 'carrying it, and it is the key everything else joins on.');
}

// -- 3. restart from the repo root finds it, and measures the lane's tree ----
const re = run(root, 'restart', 'probe', '--run', 't1');
if (re.code !== 0) fail(`restart could not pick up a lane started from a subdirectory: ${re.out}`);

// jq pretty-prints, so the summary spans lines — take from its opening brace.
let emitted;
try { emitted = JSON.parse(re.out.slice(re.out.lastIndexOf('{'))); }
catch { fail(`restart printed no JSON summary: ${re.out}`); }
if (!emitted.worktree) {
  fail('restart reports an empty worktree for a lane that has one — the operator '
     + 'is told nothing about which checkout was re-armed');
}
if (emitted.sha_at_restart !== laneSha) {
  fail(`sha_at_restart is ${emitted.sha_at_restart}, but the lane's checkout is at `
     + `${laneSha} (the main repo is at ${rootSha}). Restart measured the wrong `
     + 'tree, so "has the branch moved since sha_at_dispatch" — the redispatch '
     + 'trap discriminator — answers about a tree the lane never touched.');
}

cleanup();
console.log('dispatch-record-is-where-restart-looks: OK');
