#!/usr/bin/env node
// Frozen check: closing a working lane says what it is abandoning.
//
// The invariant, in one line: the operator learns what only that pane knew
// BEFORE the pane is gone — because after it is gone, nothing points at the
// files it left behind.
//
// `close` carries two refusals: the lane is still working/blocked, and its
// checkout has uncommitted work. The only way past the first is `--force`, and
// the second was written `if dirty && ! FORCE`. So for any WORKING lane — the
// only case where a kill abandons anything — the dirty listing was structurally
// unreachable. The guard existed and could never fire in the situation it was
// built for.
//
// Measured, 2026-08 run: a verifier lane was killed mid-task holding an
// unrestored red-arm mutant in packages/kb/src/lifecycle.ts — the K1.2
// delete-permission guard deleted to prove the arm went red, never put back.
// Nothing pointed at it. It surfaced hours later only because a disk audit
// happened to walk that tree.
//
// The listing is information, not a veto: --force still closes. It just stops
// closing silently.
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

const tmp  = mkdtempSync(join(tmpdir(), 'close-abandons-'));
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

const root = execFileSync('git', ['-C', repo, 'rev-parse', '--show-toplevel'],
  { encoding: 'utf8' }).trim();
const key = execFileSync('git', ['-C', repo, 'rev-parse', '--path-format=absolute',
  '--git-common-dir'], { encoding: 'utf8' }).trim();
const slug = createHash('sha1').update(key).digest('hex').slice(0, 12);

mkdirSync(join(home, '.claude', 'lirbox-lanes'), { recursive: true });
mkdirSync(join(home, '.claude', 'lirbox-orchestrator'), { recursive: true });
writeFileSync(join(home, '.claude', 'lirbox-orchestrator', `${slug}.json`),
  JSON.stringify({
    lanes: { base_branch: 'main', ready_timeout_ms: 60000 },
    profiles: { 'agent-turn': { kind: 'opencode', model: 'test/model' } },
  }, null, 2));
// The lane is one this run created, so ownership is not what is being tested.
writeFileSync(join(home, '.claude', 'lirbox-lanes', `${slug}.tsv`), 'vk\nwZ:p1\n');

// The lane's checkout, mid-task: a deliberately mutated file, not committed.
const wtree = join(tmp, 'wt-vk');
git('worktree', 'add', '-q', '-b', 'vk', wtree);
writeFileSync(join(wtree, 'lifecycle.ts'), 'export const guard = null; // red arm, not restored\n');
writeFileSync(join(wtree, 'scratch.md'), 'notes\n');

// herdr reports the lane; agent_status is the knob this check turns.
const stub = (status) => {
  writeFileSync(join(bin, 'herdr'), `#!/bin/sh
echo "$*" >> "${tmp}/calls.log"
case "$1 $2" in
  "agent list")
    echo '{"result":{"agents":[{"name":"vk","pane_id":"wZ:p1","agent_status":"${status}","cwd":"${wtree}"}]}}' ;;
  *) : ;;
esac
exit 0
`);
  chmodSync(join(bin, 'herdr'), 0o755);
};

const env = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` };
// spawnSync, not execFileSync: the listing is diagnostic and goes to stderr
// alongside `die`, so a runner that keeps only stdout on success cannot see the
// thing being tested.
const run = (...args) => {
  const r = spawnSync('zsh', [script, ...args],
    { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return { code: r.status ?? 1, out: (r.stdout || '') + (r.stderr || '') };
};

// -- 1. a forced close of a WORKING lane names what it leaves behind --------
stub('working');
const forced = run('close', 'vk', '--force');
if (forced.code !== 0) fail(`close --force on a working lane refused outright: ${forced.out}`);
for (const f of ['lifecycle.ts', 'scratch.md']) {
  if (!forced.out.includes(f)) {
    fail(`closing a working lane never mentioned "${f}", which is uncommitted in `
       + 'its checkout. --force is the ONLY way to close a working lane, and the '
       + 'dirty listing sits behind `&& (( ! FORCE ))` — so in the one case where '
       + 'a kill abandons work, the operator is told nothing. That is how an '
       + 'unrestored red-arm mutant sat unnoticed for hours.');
  }
}

// -- 2. no regression: the refusals still refuse ---------------------------
// The listing is information, not a licence — an unforced close of a working
// lane must still stop, or "tell them what is lost" has been traded for
// "kill it and mention the files".
const unforced = run('close', 'vk');
if (unforced.code === 0) {
  fail('close without --force killed a working lane. The listing must be added '
     + 'ABOVE the force guard, not by removing the guard.');
}
if (!/working/.test(unforced.out)) {
  fail(`a working lane was refused without saying it is working: ${unforced.out.trim()}`);
}

stub('done');
const dirty = run('close', 'vk');
if (dirty.code === 0) {
  fail('an idle lane with an uncommitted checkout was closed without --force; '
     + 'that work is known only to that pane');
}
if (!/uncommitted/.test(dirty.out)) {
  fail(`the dirty refusal no longer says what is wrong: ${dirty.out.trim()}`);
}

cleanup();
console.log('close-says-what-it-abandons: OK');
