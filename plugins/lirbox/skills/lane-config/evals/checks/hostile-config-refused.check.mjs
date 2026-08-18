#!/usr/bin/env node
// Frozen check: the lane flag policy holds at ALL THREE places a stored string
// can become part of a spawned command line, and a bad write never destroys the
// config.
//
// The invariant. A profile's `flags` array is spliced into
// `herdr agent start ... -- --agent <p> <flags>`. Nothing used to look at it:
// orch-config.sh stored whatever it was handed, orch-lane.sh spliced it
// verbatim, and model-policy.sh compared --kind/--model/--effort and nothing
// else. So one `set-profile impl --flags '--dangerously-skip-permissions'` made
// every later lane in that repo an ungated one — permanently, since the config
// outlives the session, and silently, since no path printed a word.
//
// That single write is exactly what a hostile checkout can talk an agent into.
// The config lives in $HOME so a repo cannot write it directly, but a README, an
// issue body or a CI log can ask for the command, and an agent that runs it has
// made the change stick.
//
// So this drives the hostile inputs end to end and requires a refusal at each
// gate — plus one legitimate profile that must still work, because a gate that
// refuses everything is not a gate, it is an outage.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SKILL = join(here, '..', '..');
const REPO = join(SKILL, '..', '..', '..', '..');
const PLUGIN = join(REPO, 'plugins', 'lirbox');

// Each file under test can be swapped for a mutated copy (prove-checks sets these).
const SRC = {
  config: process.env.ORCH_CONFIG_OVERRIDE || join(SKILL, 'scripts', 'orch-config.sh'),
  policy: process.env.FLAG_POLICY_OVERRIDE || join(PLUGIN, 'scripts', 'lane-flag-policy.zsh'),
  lane: process.env.ORCH_LANE_OVERRIDE || join(PLUGIN, 'scripts', 'orch-lane.sh'),
  hook: process.env.MODEL_POLICY_OVERRIDE || join(PLUGIN, 'hooks', 'model-policy.sh'),
};

// Rebuild the plugin layout in scratch, because each script finds the shared
// policy by a path relative to its own location. Same shape, swappable files.
const tmp = mkdtempSync(join(tmpdir(), 'hostile-cfg-'));
const trash = [tmp];
const done = () => { for (const d of trash) rmSync(d, { recursive: true, force: true }); };
const fail = (m) => { done(); throw new Error(m); };

const plug = join(tmp, 'plug');
mkdirSync(join(plug, 'scripts'), { recursive: true });
mkdirSync(join(plug, 'hooks'), { recursive: true });
mkdirSync(join(plug, 'skills', 'lane-config', 'scripts'), { recursive: true });
const CFG_SH = join(plug, 'skills', 'lane-config', 'scripts', 'orch-config.sh');
const LANE_SH = join(plug, 'scripts', 'orch-lane.sh');
const HOOK_SH = join(plug, 'hooks', 'model-policy.sh');
cpSync(SRC.config, CFG_SH);
cpSync(SRC.lane, LANE_SH);
cpSync(SRC.hook, HOOK_SH);
// Copied only if it is there. A tree without the shared policy is precisely the
// state this check exists to describe, and it must fail on a flag getting
// through — not on a missing file. A RED that means "ENOENT" proves nothing
// about the invariant and would still be RED after somebody fixed the bug.
if (existsSync(SRC.policy)) cpSync(SRC.policy, join(plug, 'scripts', 'lane-flag-policy.zsh'));

const repo = mkdtempSync(join(tmpdir(), 'hostile-repo-'));
const home = mkdtempSync(join(tmpdir(), 'hostile-home-'));
trash.push(repo, home);
execFileSync('git', ['init', '-q', repo]);

const zsh = (script, args, opts = {}) => {
  try {
    return { code: 0, out: execFileSync('zsh', [script, ...args], {
      env: { ...process.env, HOME: home }, encoding: 'utf8', cwd: opts.cwd || repo,
      input: opts.input, stdio: ['pipe', 'pipe', 'pipe'] }) };
  } catch (e) { return { code: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') }; }
};
const cfg = (...args) => zsh(CFG_SH, [...args, repo]);
const lane = (...args) => zsh(LANE_SH, args);
const hook = (command) => zsh(HOOK_SH, [], {
  input: JSON.stringify({ agent_type: 'lirbox:lirbox-herdr-orchestrator', cwd: repo, tool_input: { command } }),
});

if (cfg('init').code !== 0) fail('init failed — the harness is broken, not the policy');
const CFG_PATH = cfg('path').out.trim();
const read = () => readFileSync(CFG_PATH, 'utf8');

// ---- 1. write time: a capability flag may not be stored -------------------
let r = cfg('set-profile', 'impl', '--kind', 'claude', '--model', 'claude-sonnet-5',
  '--flags', '--dangerously-skip-permissions');
if (r.code === 0) fail('set-profile STORED --dangerously-skip-permissions. Every lane in this repo now spawns with permissions off, and no gate downstream looks at `flags`.');
if (read().includes('dangerously')) fail('set-profile refused but wrote the flag anyway');

// ---- 2. write time: a token carrying shell syntax may not be stored --------
r = cfg('set-profile', 'impl', '--kind', 'claude', '--model', 'claude-sonnet-5', '--flags', '$(id)');
if (r.code === 0) fail('set-profile stored a flag containing shell substitution — a stored flag must be inert in every consumer, including ones not written yet');

// ---- 3. a rejected write must not destroy the config ----------------------
// `--argjson` took whatever it was handed: `--max oops` made jq fail, the new
// content become the empty string, and write() truncate the file while exiting 0.
const beforeBytes = read();
r = cfg('set-lanes', '--max', 'oops');
if (r.code === 0) fail('set-lanes accepted a non-numeric --max');
if (read() !== beforeBytes) fail('a REFUSED set-lanes still modified the config — a failed write must leave the file exactly as it was');

// 3b. And independently of argument validation: when the jq that BUILDS the new
// content fails for any reason, the write must not happen. Argument checks and a
// fail-closed write are two guards, and a check that only exercises the first
// reports green while the second is gone. Feed it a config jq cannot process, so
// the arguments are fine and the pipeline is what breaks.
const GARBAGE = 'this is not json\n';
writeFileSync(CFG_PATH, GARBAGE);
r = cfg('set-lanes', '--max', '4');
if (r.code === 0) fail('set-lanes reported success while its jq pipeline failed');
if (read() !== GARBAGE) fail(`write() replaced the config after its input failed to build — that is how a working config became an empty file while the command exited 0. On disk now: ${JSON.stringify(read())}`);

// ---- 4. read time: schema catches a config that arrived another way --------
// "Never hand-edit the JSON" is a rule; validate is the mechanism.
writeFileSync(CFG_PATH, JSON.stringify({
  version: 1,
  profiles: { impl: { kind: 'claude', model: 'claude-sonnet-5', flags: ['--dangerously-skip-permissions'] } },
  default_profile: 'impl',
  lanes: { max_concurrent: 2, timeout_ms: 120000, context_cap_tokens: 300000 },
  setup: { install: null, build: null, test: null, baseline: '1 passed' },
  evil: 'planted',
}, null, 2));
r = cfg('validate');
if (r.code === 0) fail('validate blessed a hand-written config carrying --dangerously-skip-permissions');
if (!/dangerously/.test(r.out)) fail(`validate refused but never named the flag; a reason nobody can act on is not a refusal:\n${r.out}`);
if (!/evil/.test(r.out)) fail(`validate did not report the unknown top-level key 'evil' — an off-schema config is one nothing here wrote:\n${r.out}`);

// ---- 5. spawn time: the splice site refuses it too -------------------------
// validate passing an hour ago is not a property of the file now.
r = lane('start', 'impl-lane', '--profile', 'impl', '--branch', 'b', '--dry-run');
if (r.code === 0) fail('orch-lane.sh SPLICED --dangerously-skip-permissions into the spawn. The write-time gate is not the last word: the file can be edited after it passes.');
if (/dangerously/.test(r.out.split('\n').filter((l) => l.startsWith('herdr ')).join('\n'))) {
  fail('orch-lane.sh emitted the denied flag in the command it printed');
}

// ---- 6. command time: the model can write the flag itself -----------------
r = hook('herdr agent start impl-lane --kind claude --pane p1 -- --agent impl --model claude-sonnet-5 --dangerously-skip-permissions');
if (r.code !== 2) fail(`model-policy.sh allowed a spawn command carrying --dangerously-skip-permissions (exit ${r.code}). The config gate cannot see a command the model wrote by hand.`);

// ---- 7. and the legitimate path still works -------------------------------
// A gate that refuses everything is an outage wearing a gate's clothes.
rmSync(CFG_PATH);
if (cfg('init').code !== 0) fail('re-init failed');
r = cfg('set-profile', 'impl', '--kind', 'claude', '--model', 'claude-sonnet-5', '--effort', 'high', '--flags', '--auto --verbose');
if (r.code !== 0) fail(`set-profile refused an ordinary profile: ${r.out}`);
if (cfg('set-lanes', '--max', '4').code !== 0) fail('set-lanes refused a plain integer');
if (cfg('set-setup', '--baseline', '100 passed / 0 failed', '--test', 'npm test').code !== 0) fail('set-setup refused an ordinary command');
r = cfg('validate');
if (r.code !== 0) fail(`validate refused a config it just wrote itself: ${r.out}`);
r = lane('start', 'impl-lane', '--profile', 'impl', '--branch', 'b', '--dry-run');
if (r.code !== 0) fail(`orch-lane.sh refused a clean profile: ${r.out}`);
if (!/--auto/.test(r.out) || !/--verbose/.test(r.out)) fail(`orch-lane.sh dropped the profile's ordinary flags:\n${r.out}`);
r = hook('herdr agent start impl-lane --kind claude --pane p1 --timeout 120000 -- --agent impl --model claude-sonnet-5 --effort high --auto');
if (r.code !== 0) fail(`model-policy.sh denied a compliant spawn (exit ${r.code}): ${r.out}`);

done();
console.log('GREEN hostile-config-refused');
