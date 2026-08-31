#!/usr/bin/env node
// Frozen check: a config that cannot decide a lane must be REFUSED, and `init`
// must hand back one that can.
//
// The invariant, restated: `validate` is the whole gate. It must refuse a config
// with no profiles, a profile with no kind or no model, no baseline, no
// base_branch, or no gate_profile — and `init` must not produce a config that
// validate blesses and the first spawn then rejects.
//
// The original version of this check also asserted `init` ships ZERO profiles.
// That clause is gone deliberately. It froze a shape, not an invariant, and the
// shape was the defect: init wrote profiles:{}, base_branch:null and
// baseline:null, so `orch-lane.sh start` died three separate times in every new
// repo before a lane ever ran. "The user decides" was implemented as "fail at
// the user", which does not teach the decision — it just gets the tool dropped.
// What survives is the part that was always right: a MODEL is never guessed.
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

// This check is about config SHAPE (profiles/model/baseline/base_branch/
// gate_profile), not about whether an agent id resolves on a real harness —
// that is agent-name-checked's job. Strip any real claude/opencode off PATH
// so set-profile always sees an undeterminable registry (accept-everything)
// here, exactly as before agent validation existed — otherwise this check's
// result would depend on which harnesses happen to be installed on whatever
// machine runs it.
const realBinDir = (bin) => {
  try { return dirname(execFileSync('command', ['-v', bin], { shell: '/bin/zsh', encoding: 'utf8' }).trim()); }
  catch { return null; }
};
const excluded = new Set([realBinDir('claude'), realBinDir('opencode')].filter(Boolean));
const NO_HARNESS_PATH = (process.env.PATH || '').split(':').filter((d) => !excluded.has(d)).join(':');

const repo = mkdtempSync(join(tmpdir(), 'lane-config-'));
const home = mkdtempSync(join(tmpdir(), 'lane-home-'));
const run = (...args) => {
  try {
    return { code: 0, out: execFileSync('zsh', [script, ...args, repo], {
      env: { ...process.env, HOME: home, PATH: NO_HARNESS_PATH }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) { return { code: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') }; }
};

const fail = (m) => { rmSync(repo, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }); throw new Error(m); };

execFileSync('git', ['init', '-q', repo]);
writeFileSync(join(repo, 'pnpm-lock.yaml'), '');

if (run('init').code !== 0) fail('init failed');

const cfgPath = run('path').out.trim();
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));

// Whatever init declares, it must never name a model it could not know.
for (const [name, p] of Object.entries(cfg.profiles || {})) {
  if (p.model && !/^(claude|gpt|o\d)/.test(p.model)) {
    fail(`init invented a model '${p.model}' for profile '${name}' — a guessed model is a decision nobody made`);
  }
}

// The landmine regression: init must not hand back a config that fails at the
// first spawn. Either it validates, or init said out loud what is missing.
const initValidate = run('validate');
if (initValidate.code !== 0 && !/profiles|model|baseline|base_branch|gate_profile/.test(initValidate.out)) {
  fail(`init produced a config validate refuses without naming the missing field: ${initValidate.out}`);
}

// -- validate is the gate. Each guard isolated, by removing exactly one field --
const patch = (fn) => {
  const c = JSON.parse(readFileSync(cfgPath, 'utf8'));
  fn(c);
  writeFileSync(cfgPath, JSON.stringify(c, null, 2));
};

run('set-setup', '--baseline', '100 passed / 0 failed');
run('set-lanes', '--gate-profile', Object.keys(cfg.profiles || {})[0] || 'x');

patch((c) => { c.profiles = {}; c.default_profile = null; });
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
run('set-lanes', '--gate-profile', 'p1');
const ok = run('validate');
if (ok.code !== 0) fail(`validate refused a complete config: ${ok.out}`);

// gate_profile is not optional and used to be unchecked: gate-guard.sh refuses
// push, PR and merge-onto-base for a lane with no code_gate, and the gate cannot
// start without a profile to run on. A config that validates and cannot ship is
// a config that lied.
patch((c) => { delete c.lanes.gate_profile; });
if (run('validate').code === 0) fail('validate blessed a config with no lanes.gate_profile — no work can leave without a gate');
run('set-lanes', '--gate-profile', 'p1');

patch((c) => { c.lanes.gate_profile = 'not-a-profile'; });
if (run('validate').code === 0) fail('validate blessed a gate_profile that is not a declared profile');
run('set-lanes', '--gate-profile', 'p1');

patch((c) => { c.lanes.base_branch = ''; });
if (run('validate').code === 0) fail('validate blessed a config with no lanes.base_branch — every worktree is cut from it');

// Second repo, isolating the baseline guard the same way: a complete config
// EXCEPT for setup.baseline must still be refused.
const repo2 = mkdtempSync(join(tmpdir(), 'lane-config2-'));
const home2 = mkdtempSync(join(tmpdir(), 'lane-home2-'));
const run2 = (...args) => {
  try {
    return { code: 0, out: execFileSync('zsh', [script, ...args, repo2], {
      env: { ...process.env, HOME: home2, PATH: NO_HARNESS_PATH }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) { return { code: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') }; }
};
execFileSync('git', ['init', '-q', repo2]);
run2('init');
run2('set-profile', 'p1', '--kind', 'opencode', '--model', 'some/model');
run2('set-lanes', '--gate-profile', 'p1');
const cfg2 = run2('path').out.trim();
{ const c = JSON.parse(readFileSync(cfg2, 'utf8')); c.setup.baseline = null;
  writeFileSync(cfg2, JSON.stringify(c, null, 2)); }
if (run2('validate').code === 0) {
  rmSync(repo2, { recursive: true, force: true }); rmSync(home2, { recursive: true, force: true });
  fail('validate blessed a config with no setup.baseline');
}

for (const d of [repo, home, repo2, home2]) rmSync(d, { recursive: true, force: true });
console.log('GREEN config-refuses-unusable');
