#!/usr/bin/env node
// Frozen check: the agent prompt names every door the agent will be refused by.
//
// The invariant, in one line: the checklist is DERIVED from the shipped surface,
// never listed here — so a new subcommand or a new hook breaks this check until
// the prompt is told about it.
//
// This exists because the previous wiring check was an allowlist. It asserted
// five hardcoded tokens (transition.mjs, reconcile.mjs, dispatch/<lane>.json,
// sha_at_dispatch, would_overturn) and was GREEN through two commits that added
// `orch-lane.sh gate`, a gate-guard hook, and a whole enforced refusal on push
// — none of which the agent prompt mentioned. The prompt could not interpret a
// denial it had never heard of.
//
// A check that only guards what someone remembered to add to it is the "check
// that cannot fail" class this skill names as its dominant defect, applied to
// the check itself. The fix is not to add the missing entries; it is to stop
// having entries.
//
// Two derivations, both from files that are the source of truth:
//   * every `<sub>)` label inside orch-lane.sh's `case "$SUB" in`
//   * every hooks/*.sh
//
// ORCH_LANE_OVERRIDE / AGENT_MD_OVERRIDE point at the files under test.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..', '..');          // plugins/lirbox
const scriptPath = process.env.ORCH_LANE_OVERRIDE || join(root, 'scripts', 'orch-lane.sh');
const agentPath  = process.env.AGENT_MD_OVERRIDE  || join(root, 'agents', 'lirbox-herdr-orchestrator.md');
const hooksDir   = join(root, 'hooks');

const fail = (m) => { throw new Error(m); };

const script = readFileSync(scriptPath, 'utf8');
const agent  = readFileSync(agentPath, 'utf8');

// ---- derive: the subcommands orch-lane.sh actually answers to ---------------
const caseStart = script.indexOf('case "$SUB" in');
if (caseStart < 0) fail('orch-lane.sh has no `case "$SUB" in` — the derivation source is gone, so '
  + 'this check would silently pass on an empty list. That is the failure mode it exists to stop.');
const caseBody = script.slice(caseStart, script.indexOf('\nesac', caseStart));
const subs = [...caseBody.matchAll(/^([a-z][a-z-]*)\)/gm)].map((m) => m[1]);

if (subs.length < 3) {
  fail(`only ${subs.length} subcommand(s) derived from orch-lane.sh — the parse is broken, and a `
     + 'broken derivation makes this check vacuous rather than red.');
}

// ---- derive: the hooks that ship -------------------------------------------
const hooks = readdirSync(hooksDir).filter((f) => f.endsWith('.sh')).map((f) => basename(f, '.sh'));
if (hooks.length < 3) fail(`only ${hooks.length} hook(s) found in ${hooksDir} — derivation broken`);

// ---- assert: the prompt names every one of them ----------------------------
const missingSubs = subs.filter((s) => {
  const re = new RegExp(`(orch-lane\\.sh|\\$LANE|LANE)\\s+${s}\\b`);
  return !re.test(agent);
});
if (missingSubs.length) {
  fail(`the agent prompt never names these orch-lane.sh subcommand(s): ${missingSubs.join(', ')}.\n`
     + `  Derived from ${scriptPath}\n`
     + '  The orchestrator meets the refusal these implement with no idea the verb exists. That is\n'
     + '  how `orch-lane.sh gate` shipped: the door was built and the thing that has to walk\n'
     + '  through it was never told.');
}

const missingHooks = hooks.filter((h) => !agent.includes(h));
if (missingHooks.length) {
  fail(`the agent prompt never names these hook(s): ${missingHooks.join(', ')}.\n`
     + `  Derived from ${hooksDir}\n`
     + '  Every one of these can refuse a command the orchestrator issues. A denial from a hook the\n'
     + '  prompt has never heard of is uninterpretable — and an uninterpretable denial is what got\n'
     + '  read as "another session owns this pane" and answered by destroying a cluster.');
}

// ---- assert: naming is not enough for the ones that refuse ------------------
// A filename in a source list would satisfy the loop above while telling the
// orchestrator nothing. Each refusing hook has to appear with its refusal.
for (const [hook, needles, why] of [
  ['pane-guard',  [/DENIED|denied|refus/i],            'the spawn and ownership refusals'],
  ['gate-guard',  [/push|pull request|\bPR\b|merge/i], 'what it refuses to let leave'],
  ['model-policy',[/profile/i],                        'that the profile decides kind and model'],
  ['lane-gate',   [/turn|monitor|stop/i],              'that it can refuse to end the turn'],
  ['lane-ledger', [/ledger/i],                         'that it is what builds the ownership ledger'],
]) {
  if (!hooks.includes(hook)) continue;                       // renamed or gone: the loop above owns that
  const idx = agent.indexOf(hook);
  const window = agent.slice(Math.max(0, idx - 600), idx + 600);
  if (!needles.some((re) => re.test(window))) {
    fail(`the agent prompt names ${hook} but never says ${why}. A filename in a list is not a\n`
       + '  contract — the orchestrator has to know what the thing does to it.');
  }
}

// ---- assert: POLICY-OVERRIDE is documented as the escape --------------------
// Three hooks accept it. A refusal with an escape nobody knows about gets
// routed around silently instead of on the record.
// "mentioned somewhere" is not an invariant — the token appears in several
// unrelated places, so a bare presence test cannot fail and proves nothing.
// The escape has to be documented WHERE the refusals are listed, or the
// orchestrator reads the hook table and learns there is no way through.
const tableAt = agent.indexOf('gate-guard.sh');
if (tableAt < 0) fail('the hook table is gone — the derivation above should have caught this first');
if (!/POLICY-OVERRIDE/.test(agent.slice(tableAt, tableAt + 1200))) {
  fail('the hook table never states POLICY-OVERRIDE. Three of these hooks accept it; a refusal\n'
     + '  whose escape is documented somewhere else entirely gets routed around silently instead\n'
     + '  of taken deliberately and on the record.');
}

console.log(`agent-names-every-door: OK  (${subs.length} subcommands, ${hooks.length} hooks, derived)`);
