#!/usr/bin/env node
// Frozen check: the identity the hooks gate on is the identity the plugin
// publishes.
//
// The invariant, in one line: every hook's `agent_type` literal equals
// `<plugin.json name>:<the orchestrator agent's frontmatter name>`, derived from
// those two files rather than written down here.
//
// Why. All five hooks scope on one string. It is the entire reason they are
// inert in other people's work — and the entire reason they are NOT inert for a
// real run. A plugin rename, or an agent rename, moves the published identity
// and leaves the literal behind; every hook then matches nothing, and the spawn
// door, the model policy and the push gate all go quietly open. Nothing fails,
// no command is refused, and the first symptom is a lane that pushed.
//
// Measured before writing this, because the obvious assumption was wrong in a
// way that mattered: `agent_type` IS populated for a main session started with
// `claude --agent <id>` — it is not a subagent-only field — and for a PLUGIN
// agent it arrives fully qualified (`lirbox:lirbox-herdr-orchestrator`), while a
// repo-local agent arrives bare (`probe-orch`). Both were confirmed with a probe
// hook against a real `claude -p` run. That distinction is exactly what this
// check freezes: the qualified form is what the hooks must carry, and it is
// derivable, so it does not need to be believed.
//
// A hardcoded literal here would pass through a rename in step with the hooks
// and prove nothing. Derivation is the whole check.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const plugin = join(here, '..', '..', '..', '..');
const manifestPath = process.env.PLUGIN_MANIFEST_OVERRIDE
  || join(plugin, '.claude-plugin', 'plugin.json');
const agentPath = process.env.ORCH_AGENT_OVERRIDE
  || join(plugin, 'agents', 'lirbox-herdr-orchestrator.md');
const hooksDir = join(plugin, 'hooks');
// Per-hook FILE overrides, matching the shape prove-checks hands a mutated copy
// in. A directory override was the first attempt and it made this check red for
// the wrong reason: readdirSync threw on the file path it was given, which reads
// as a caught mutation while detecting nothing.
const hookSource = (f) => process.env[`${f.replace(/[-.]/g, '_').replace(/_sh$/, '').toUpperCase()}_OVERRIDE`]
  || join(hooksDir, f);

const fail = (m) => { throw new Error(m); };

const pluginName = JSON.parse(readFileSync(manifestPath, 'utf8')).name;
if (!pluginName) fail(`${manifestPath} declares no name — the derivation source is gone, and a `
  + 'broken derivation makes this check vacuous rather than red.');

const fm = readFileSync(agentPath, 'utf8').match(/^---\n([\s\S]*?)\n---/);
if (!fm) fail(`${agentPath} has no frontmatter block`);
const agentName = (fm[1].match(/^name:\s*(\S+)/m) || [])[1];
if (!agentName) fail(`${agentPath} frontmatter declares no name`);

// The identity claude publishes for a plugin agent, and the one it hands a hook
// as agent_type — qualified, not bare.
const expected = `${pluginName}:${agentName}`;

const hooks = readdirSync(hooksDir).filter((f) => f.endsWith('.sh'));
if (hooks.length < 3) fail(`only ${hooks.length} hook(s) in ${hooksDir} — derivation broken`);

// Which hooks MUST carry it, derived: any hook that can refuse. `exit 2` is a
// PreToolUse denial and a Stop-hook block — the thing nothing can talk its way
// past, and therefore the thing that must know whose command it is looking at.
//
// Counting agent-scoped hooks instead was the first attempt and it was
// false-green: a hook that dropped the literal ENTIRELY stopped being counted
// rather than being caught, so the check read "one fewer scoped hook" as
// "nothing to check here" — the exact reading that lets a guard go open.
let gated = 0;
for (const f of hooks) {
  const text = readFileSync(hookSource(f), 'utf8');
  const canRefuse = /\bexit 2\b/.test(text);
  const literals = [...text.matchAll(/agent_type[\s\S]{0,120}?"([^"]*:[^"]*)"/g)].map((m) => m[1]);
  if (canRefuse && !literals.length) {
    fail(`${f} can refuse a command (it exits 2) and gates on no agent_type at all.\n`
       + '  It now runs on every Bash call in every repo on this machine, and a denial from a\n'
       + '  hook the session has never heard of is uninterpretable — that is what got read as\n'
       + '  "another session owns this pane" and answered by destroying a cluster.');
  }
  if (!literals.length) continue;                 // not an agent-scoped hook
  gated++;
  for (const lit of literals) {
    if (lit !== expected) {
      fail(`${f} gates on "${lit}" but this plugin publishes "${expected}".\n`
         + `  Derived from ${manifestPath} (name) and ${agentPath} (frontmatter name).\n`
         + '  A hook whose agent_type matches nothing is not a stricter hook, it is an absent one:\n'
         + '  the spawn door, the model policy and the push gate all go quietly open, nothing is\n'
         + '  refused, and the first symptom is a lane that pushed.');
    }
  }
}
if (gated < 3) {
  fail(`only ${gated} hook(s) gate on agent_type. That string is why these hooks are inert in `
     + 'other people\'s work; a hook that dropped it now runs on every Bash call in every repo '
     + 'on the machine, and a PreToolUse hook that denies is the one thing nothing can talk its '
     + 'way past.');
}

console.log(`hook-scope-matches-the-agent-id: OK  (${gated} hook(s) gate on "${expected}", derived)`);
