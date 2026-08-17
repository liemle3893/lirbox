// Floor: the agent and the skill are still wired to each other.
//
// The skill is a protocol; the agent is its only intended caller. Nothing at runtime fails if that
// coupling is edited away — the agent simply stops opening a store and every run silently goes back
// to being unrecoverable. This is the check that notices.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const skill = readFileSync(join(here, '..', '..', 'SKILL.md'), 'utf8');
const agentPath = join(here, '..', '..', '..', '..', 'agents', 'lirbox-herdr-orchestrator.md');

let agent;
try { agent = readFileSync(agentPath, 'utf8'); }
catch { throw new Error(`the orchestrator agent is gone: ${agentPath}`); }

// The agent must know how to drive the store.
for (const [what, re] of [
  ['transition.mjs (the only sanctioned writer)', /transition\.mjs/],
  ['reconcile.mjs (drift detection before publish/handover)', /reconcile\.mjs/],
  ['the dispatch record', /dispatch\/<lane>\.json/],
  ['sha_at_dispatch (redispatch safety)', /sha_at_dispatch/],
  ['would_overturn (what makes handover work)', /would_overturn/],
]) if (!re.test(agent)) throw new Error(`agent no longer references ${what}`);

// …and must still carry both refusals, in its own words or the skill's.
if (!/self-report can never become verified/i.test(agent))
  throw new Error('agent dropped the self-report refusal — the reason the store exists');
if (!/durable\b[^.\n]*\bnot verified|committed, not verified/i.test(agent))
  throw new Error('agent dropped "durable is not verified" — the trap that puts red commits on a remote');

// The skill must point back, or the agent is undiscoverable from it.
if (!/lirbox-herdr-orchestrator/.test(skill))
  throw new Error('SKILL.md no longer names the lirbox-herdr-orchestrator agent');

// The ordering fact found by running it: there is no verified -> published edge.
const { TABLE } = await import(join(here, '..', '..', 'scripts', 'transition.mjs'));
if (TABLE.verified.includes('published'))
  throw new Error('TABLE gained verified -> published; publishing uncommitted work is not a state');
if (!TABLE.durable.includes('published'))
  throw new Error('TABLE lost durable -> published; nothing can publish');
if (!/[Vv]erify before you commit/.test(skill))
  throw new Error('SKILL.md no longer pins the verify-before-commit order');

// The Stop gate is the third party to this wiring, and the one that outranks both:
// it exits 2. Nothing at runtime fails when a hook stops being registered — the
// command simply never runs and every turn looks fine — so this is the check that
// notices. `stop-gate-routes-a-stop-to-cont` proves the gate BEHAVES; this proves
// it is still plugged in at all.
const hooksJson = join(here, '..', '..', '..', '..', 'hooks', 'hooks.json');
let hooks;
try { hooks = JSON.parse(readFileSync(hooksJson, 'utf8')); }
catch { throw new Error(`the plugin hook manifest is gone or unparseable: ${hooksJson}`); }

const stopCommands = (hooks.hooks?.Stop ?? []).flatMap((g) => (g.hooks ?? []).map((h) => h.command ?? ''));
if (!stopCommands.some((c) => c.includes('lane-gate.sh'))) {
  throw new Error('lane-gate.sh is no longer registered on Stop — the turn can end on a live or stopped lane and nothing objects');
}

const gate = readFileSync(join(here, '..', '..', '..', '..', 'hooks', 'lane-gate.sh'), 'utf8');
// The gate and the skill have to agree about the stopped state. The skill can be
// re-read and argued with; the gate cannot, so a gate that answered a stop with
// "arm a Monitor" would quietly overrule the contract on every turn.
if (!/kill -CONT/.test(gate))
  throw new Error('lane-gate.sh dropped the kill -CONT remedy — a stopped lane gets told to arm a Monitor and wait on a process the kernel will never schedule');
