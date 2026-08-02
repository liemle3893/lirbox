#!/usr/bin/env node
/**
 * triage.cjs — decide what a RESUME should do with a persisted failure.
 *
 *   node triage.cjs .workflows/state/<name>.json
 *   -> {"action":"relaunch|ask|report","kind":…,"phase":…,"reason":…,"questions":[…],"hints":{…}}
 *
 * Why this is a script and not prose in SKILL.md: it decides whether the human is consulted at all,
 * and prose cannot be gated. Frozen check: evals/checks/triage-routing.check.mjs.
 *
 * The one rule worth stating twice: `failure.kind` is a WORKER SELF-REPORT, and this repo treats
 * those as untrusted claims (scripts/prompts/dodgate-verify.txt). Every route but one ends at a
 * human; `mechanical` auto-relaunches. So `mechanical` is RE-DERIVED here from the error text, and
 * an unrecognised error is a reason to ask, never to retry — a wrong retry walks straight back into
 * the wall this whole mechanism exists to remove.
 */
'use strict';
const fs = require('fs');

// Errors a retry can plausibly clear on its own. Anchored to the generator's own throw messages;
// deliberately short — anything not on this list routes to a question.
const MECHANICAL = [
  /did not integrate/i,
  /merge conflict/i,
  /worktrees not ready/i,
  /produced nothing/i,
  /worker\(s\) died/i,
  /timed? out/i,
];

function triage(state) {
  const f = state && state.failure;
  if (!f) return { action: 'relaunch', kind: null, reason: 'no failure recorded — ordinary resume' };

  const phase = f.phase || null;
  const text = [f.evidence, f.reason].filter(Boolean).join('\n');
  const base = { kind: f.kind || null, phase, reason: f.reason || '' };
  const hintFor = (h) => (phase && h ? { hints: { [phase]: h } } : {});

  switch (f.kind) {
    case 'unachievable-dod':
      // The one kind with no automated action. Amending frozen criteria is a human act: the gate
      // reads DOD_CRITERIA baked into the generated script, so editing the .dod.json file alone
      // changes nothing — a re-scaffold is required and that is the human's call, not the loop's.
      return { ...base, action: 'report', questions: f.questions || [] };

    case 'convergence-stall':
      // Carry the prior gate's findings forward so round 1 of the new run starts where round 3 of
      // the old one stopped, instead of re-reviewing the same diff from scratch.
      return {
        ...base, action: 'relaunch', questions: [],
        ...hintFor(f.hint || `A previous run failed here and did not converge: ${f.reason || ''}\n${f.evidence || ''}`),
      };

    case 'mechanical': {
      const recognised = MECHANICAL.some((re) => re.test(text));
      const repeat = Number(f.attempts || 1) >= 2;
      if (!recognised) {
        return { ...base, action: 'ask', why: 'claimed mechanical but the error text matches no known transient failure', questions: f.questions || [] };
      }
      if (repeat) {
        return { ...base, action: 'ask', why: 'the same failure signature already came back once — a repeat is not transient', questions: f.questions || [] };
      }
      return { ...base, action: 'relaunch', questions: [], ...hintFor(f.hint) };
    }

    case 'missing-info':
    default:
      // Unknown kinds land here on purpose: an unrecognised classification is not a licence to retry.
      return { ...base, action: 'ask', questions: f.questions || [], ...hintFor(f.hint) };
  }
}

if (require.main === module) {
  const path = process.argv[2];
  if (!path) { console.error('usage: triage.cjs <state.json>'); process.exit(2); }
  let state;
  try { state = JSON.parse(fs.readFileSync(path, 'utf8')); }
  catch (e) { console.error(`cannot read ${path}: ${e.message}`); process.exit(2); }
  console.log(JSON.stringify(triage(state), null, 2));
}

module.exports = { triage, MECHANICAL };
