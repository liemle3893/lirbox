#!/usr/bin/env node
// Frozen check: for a NAME-carried harness (claude, opencode) `set-profile`
// and `validate` must reject an agent id that harness itself does not know —
// and must NEVER reject one it does, including the harness's own built-ins
// (`Explore`, `Plan`, `general-purpose`, ...), which have no markdown file
// anywhere. A false refusal there is worse than the spawn failure this check
// exists to catch (issue #88: `claude --agent gate`, no such agent, silent
// until spawn — reported as "timed out waiting for agent startup").
//
// Hermetic: CI has no claude/opencode. Fake both on PATH, and strip any real
// claude/opencode directory out of PATH so this proves the SCRIPT's logic,
// not what happens to be installed on the machine running it.
//
// ORCH_CONFIG_OVERRIDE points at the script under test (set by prove-checks).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const script = process.env.ORCH_CONFIG_OVERRIDE
  || join(here, '..', '..', 'scripts', 'orch-config.sh');

const realBinDir = (bin) => {
  try { return dirname(execFileSync('command', ['-v', bin], { shell: '/bin/zsh', encoding: 'utf8' }).trim()); }
  catch { return null; }
};
const excluded = new Set([realBinDir('claude'), realBinDir('opencode')].filter(Boolean));
const realPath = (process.env.PATH || '').split(':').filter((d) => !excluded.has(d));

// Writes a fake `claude` that always refuses the probe with the given list —
// exactly what the real binary does for a bogus --agent, which is all the
// probe ever sends it.
const fakeClaude = (dir, agents) => {
  writeFileSync(join(dir, 'claude'), `#!/bin/sh\necho "--agent 'x' not found. Available agents: ${agents.join(', ')}" >&2\nexit 1\n`);
  chmodSync(join(dir, 'claude'), 0o755);
};
const fakeOpencode = (dir, agents) => {
  writeFileSync(join(dir, 'opencode'), `#!/bin/sh\nif [ "$1" = "agent" ] && [ "$2" = "list" ]; then\n${agents.map((a) => `echo '${a}'`).join('\n')}\nexit 0\nfi\nexit 1\n`);
  chmodSync(join(dir, 'opencode'), 0o755);
};

const fail = (m) => { throw new Error(m); };

// One throwaway repo+config+PATH per scenario, so a leftover profile from one
// assertion can never leak into the next.
const scenario = (setup) => {
  const repo = mkdtempSync(join(tmpdir(), 'lane-config-agent-'));
  const home = mkdtempSync(join(tmpdir(), 'lane-config-agent-home-'));
  const bin = mkdtempSync(join(tmpdir(), 'lane-config-agent-bin-'));
  setup(bin);
  const env = { ...process.env, HOME: home, PATH: [bin, ...realPath].join(':') };
  const run = (...args) => {
    try {
      return { code: 0, out: execFileSync('zsh', [script, ...args, repo], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
    } catch (e) { return { code: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') }; }
  };
  execFileSync('git', ['init', '-q', repo]);
  run('init');
  const cleanup = () => { for (const d of [repo, home, bin]) rmSync(d, { recursive: true, force: true }); };
  return { run, cleanup };
};

// -- claude: an unknown agent must be refused, naming what IS available --
{
  const { run, cleanup } = scenario((bin) => fakeClaude(bin, ['claude', 'general-purpose']));
  const r = run('set-profile', 'p1', '--kind', 'claude', '--model', 'm', '--agent', 'mygate');
  cleanup();
  if (r.code === 0) fail(`set-profile accepted 'mygate' on a claude registry that does not have it: ${r.out}`);
  if (!r.out.includes('general-purpose')) fail(`refusal did not name the available agents: ${r.out}`);
}

// -- claude: the built-ins must NEVER be false-refused (the point of this check) --
{
  const { run, cleanup } = scenario((bin) => fakeClaude(bin, ['claude', 'Explore', 'Plan', 'general-purpose']));
  const r = run('set-profile', 'p1', '--kind', 'claude', '--model', 'm', '--agent', 'Explore');
  cleanup();
  if (r.code !== 0) fail(`set-profile refused 'Explore', a built-in the harness itself lists: ${r.out}`);
}

// -- opencode: same shape, its own registry --
{
  const { run, cleanup } = scenario((bin) => fakeOpencode(bin, ['build (primary)', 'general (subagent)']));
  const bad = run('set-profile', 'p1', '--kind', 'opencode', '--model', 'm', '--agent', 'nope-not-real');
  if (bad.code === 0) { cleanup(); fail(`set-profile accepted 'nope-not-real' on an opencode registry that does not have it: ${bad.out}`); }
  const ok = run('set-profile', 'p2', '--kind', 'opencode', '--model', 'm', '--agent', 'general');
  cleanup();
  if (ok.code !== 0) fail(`set-profile refused 'general', which the opencode registry lists: ${ok.out}`);
}

// -- no claude on PATH at all: undeterminable must never refuse --
{
  const { run, cleanup } = scenario(() => {}); // empty bin dir — no fakes at all
  const r = run('set-profile', 'p1', '--kind', 'claude', '--model', 'm', '--agent', 'anything-at-all');
  cleanup();
  if (r.code !== 0) fail(`set-profile refused an agent when the claude registry could not be determined at all: ${r.out}`);
}

// -- init's OWN output must survive its own validate --
// The registry check is only half the fix; the other half is that init stopped
// shipping an agent id no registry has. claude resolves a plugin-shipped
// subagent as `<plugin>:<file>` and only that way, so the bare file name is in
// no registry anywhere — init writing it hands every new repo a config its own
// validate refuses on a field the user never chose. The fake registry below is
// what a real claude with the plugin installed answers.
{
  const { run, cleanup } = scenario((bin) => fakeClaude(bin, [
    'claude', 'Explore', 'Plan', 'general-purpose',
    'lirbox:lirbox-planner', 'lirbox:lirbox-verifier', 'lirbox:lirbox-builder',
  ]));
  const r = run('validate');
  cleanup();
  if (/agent registry/.test(r.out)) fail(`init wrote profiles its own validate refuses: ${r.out}`);
}

console.log('GREEN agent-name-checked');
