#!/usr/bin/env node
// Frozen check: a config that cannot decide a lane must be REFUSED, and `init`
// must never invent the decision.
//
// The invariant: profiles are the user's judgement. If `init` ships profiles, or
// `validate` blesses a config with none / with a profile missing kind or model /
// with no suite baseline, then the orchestrator silently goes back to guessing —
// which is the exact failure this whole mechanism exists to stop.
//
// ORCH_CONFIG_OVERRIDE points at the script under test (set by prove-checks).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const script = process.env.ORCH_CONFIG_OVERRIDE
  || join(here, '..', '..', 'scripts', 'orch-config.sh');

const repo = mkdtempSync(join(tmpdir(), 'lane-config-'));
const home = mkdtempSync(join(tmpdir(), 'lane-home-'));
const run = (...args) => {
  try {
    return { code: 0, out: execFileSync('zsh', [script, ...args, repo], {
      env: { ...process.env, HOME: home }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) { return { code: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') }; }
};

const fail = (m) => { rmSync(repo, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }); throw new Error(m); };

execFileSync('git', ['init', '-q', repo]);
writeFileSync(join(repo, 'pnpm-lock.yaml'), '');

if (run('init').code !== 0) fail('init failed');

const cfgPath = run('path').out.trim();
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
if (Object.keys(cfg.profiles || {}).length !== 0) {
  fail(`init invented ${Object.keys(cfg.profiles).length} profile(s) — profiles are the user's decision, never a default`);
}

// Isolate the profiles guard: satisfy the baseline FIRST, so the only remaining
// reason to refuse is the absent profile. Without this the baseline check fires
// too and masks a removed profiles guard — prove-checks caught exactly that.
run('set-setup', '--baseline', '100 passed / 0 failed');
if (run('validate').code === 0) fail('validate blessed a config with no profiles');

// A profile with no model must be refused at write time.
if (run('set-profile', 'p1', '--kind', 'opencode').code === 0) {
  fail('set-profile accepted a profile with no model — an unnamed model is the harness default, not a decision');
}
// An unknown harness must be refused.
if (run('set-profile', 'p1', '--kind', 'gpt', '--model', 'm').code === 0) {
  fail('set-profile accepted an unknown harness kind');
}

run('set-profile', 'p1', '--kind', 'opencode', '--model', 'some/model');
const ok = run('validate');
if (ok.code !== 0) fail(`validate refused a complete config: ${ok.out}`);

// Second repo, isolating the baseline guard the same way: a complete config
// EXCEPT for setup.baseline must still be refused.
const repo2 = mkdtempSync(join(tmpdir(), 'lane-config2-'));
const home2 = mkdtempSync(join(tmpdir(), 'lane-home2-'));
const run2 = (...args) => {
  try {
    return { code: 0, out: execFileSync('zsh', [script, ...args, repo2], {
      env: { ...process.env, HOME: home2 }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) { return { code: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') }; }
};
execFileSync('git', ['init', '-q', repo2]);
run2('init');
run2('set-profile', 'p1', '--kind', 'opencode', '--model', 'some/model');
if (run2('validate').code === 0) {
  rmSync(repo2, { recursive: true, force: true }); rmSync(home2, { recursive: true, force: true });
  fail('validate blessed a config with no setup.baseline');
}

for (const d of [repo, home, repo2, home2]) rmSync(d, { recursive: true, force: true });
console.log('GREEN config-refuses-unusable');
