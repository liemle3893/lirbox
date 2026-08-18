#!/usr/bin/env node
// Frozen check: where nothing says otherwise, the base branch is main.
//
// The invariant, in one line: a house convention must never be encoded as a
// fact about every repo — but evidence in the repo still outranks the default.
//
// orch-lane.sh once hardcoded `--base dev`. Correct in the repos that use dev,
// and everywhere else `fatal: not a valid object name: 'dev'` — the same string
// a missing --cwd produces, so the two defects hid behind one message for a
// 72-hour run. Moving the guess into detection did not fix it by itself: the
// first cut scanned `dev develop main master`, which is the identical bias one
// level up. main leads every blind list now.
//
// The ordering that matters, and why it is not just "always main":
//   1. a checked-out integration branch  — someone already answered this
//   2. origin/HEAD                       — the remote's opinion
//   3. first existing of main/master/dev/develop
// cloudflare-os sits on dev while its origin/HEAD says main. Rule 1 is the only
// one that gets that repo right, and dropping it to "default to main" would put
// a confident wrong answer in front of the user.
//
// ORCH_CONFIG_OVERRIDE points at the script under test (set by prove-checks).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const script = process.env.ORCH_CONFIG_OVERRIDE
  || join(here, '..', '..', '..', 'lane-config', 'scripts', 'orch-config.sh');

const root = mkdtempSync(join(tmpdir(), 'base-branch-'));
const cleanup = () => rmSync(root, { recursive: true, force: true });
const fail = (m) => { cleanup(); throw new Error(m); };

let n = 0;
const repo = ({ initial, branches = [], head }) => {
  const d = join(root, `r${++n}`);
  const g = (...a) => execFileSync('git', ['-C', d, ...a], { stdio: 'pipe' });
  execFileSync('git', ['init', '-q', '-b', initial, d], { stdio: 'pipe' });
  g('-c', 'user.email=a@b.invalid', '-c', 'user.name=c', 'commit', '-q', '--allow-empty', '-m', 'x');
  for (const b of branches) g('branch', b);
  // -b: the head may be a branch that does not exist yet (a feature branch),
  // which is the whole point of the fallback cases.
  if (head && head !== initial) {
    if (branches.includes(head)) g('checkout', '-q', head);
    else g('checkout', '-q', '-b', head);
  }
  return d;
};

const suggest = (d) => {
  const out = execFileSync('zsh', [script, 'detect', d], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(out).suggested_base_branch;
};

const expect = (d, want, why) => {
  const got = suggest(d);
  if (got !== want) fail(`${why}\n  expected: ${want}\n  got:      ${got}`);
};

// -- the default, where the repo says nothing --------------------------------
expect(repo({ initial: 'main', branches: ['dev', 'develop'], head: 'feature/x' }), 'main',
  'a repo parked on a feature branch, holding both main and dev, must fall back to main. '
+ 'Preferring dev here is the original hardcode wearing a heuristic.');

expect(repo({ initial: 'main', branches: ['develop', 'dev', 'master'], head: 'wip' }), 'main',
  'main must lead the blind candidate list ahead of master, dev and develop');

// -- evidence still outranks the default -------------------------------------
expect(repo({ initial: 'main', branches: ['dev'], head: 'dev' }), 'dev',
  'a repo CHECKED OUT on dev has already answered the question — this is the rule '
+ 'that gets cloudflare-os right, where origin/HEAD says main and the team integrates on dev');

expect(repo({ initial: 'master', branches: [], head: 'master' }), 'master',
  'a master-only repo must not be told its base is a branch it does not have');

expect(repo({ initial: 'develop', branches: [], head: 'topic' }), 'develop',
  'with no candidate present at all, the suggestion must still resolve to a real branch');

// -- and it stays a suggestion, never a written answer -----------------------
// A confident wrong base cuts every worktree in the run from the wrong branch,
// so init leaves it unset and orch-lane.sh refuses rather than guessing.
const d = repo({ initial: 'main', branches: [], head: 'main' });
const cfgHome = mkdtempSync(join(tmpdir(), 'base-home-'));
execFileSync('zsh', [script, 'init', d], {
  env: { ...process.env, HOME: cfgHome }, stdio: 'pipe' });
const shown = execFileSync('zsh', [script, 'show', d], {
  env: { ...process.env, HOME: cfgHome }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
// `show` leads with a `# <path>` comment line before the JSON.
const cfg = JSON.parse(shown.split('\n').filter((l) => !l.startsWith('#')).join('\n'));
if (cfg.lanes.base_branch !== null) {
  fail('init WROTE a base branch instead of leaving it null. A detected guess '
     + 'presented as a decision is how every worktree gets cut from the wrong branch.');
}
rmSync(cfgHome, { recursive: true, force: true });

cleanup();
console.log('base-branch-defaults-to-main: OK');
