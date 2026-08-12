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
