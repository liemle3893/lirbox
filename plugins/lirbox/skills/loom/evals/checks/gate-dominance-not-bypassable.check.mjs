// CHECK — validateGraph must read invariants from the APPROVED graph, never from the
// graph under validation. Reading them from `next` was a full bypass: submit
// mustCross: [] plus an unlocked bypass edge and validation returned [] while the
// terminal was reachable crossing no gate.
// Locked (evals/**): improvement loops may NEVER edit this file.
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
// Mutation hatch for scripts/prove-checks.mjs: it copies the skill tree, mutates ONE
// file in the copy, and points this variable at it. Without a hatch a check cannot be
// mutation-proven, and an unproven check is not known to be measuring anything.
const coreFile = process.env.LOOM_GRAPH_CORE_OVERRIDE
  || resolve(HERE, '..', '..', 'scripts', 'graph-core.mjs');
const core = await import(pathToFileURL(coreFile).href);

const APPROVED = {
  start: 'Setup', terminal: 'Done',
  nodes: [{ id: 'Setup' }, { id: 'Implement' }, { id: 'Review', locked: true },
          { id: 'DoDGate', locked: true }, { id: 'PR' }, { id: 'Done' }],
  edges: [
    { from: 'Setup', to: 'Implement', when: 'always' },
    { from: 'Implement', to: 'Review', when: 'always' },
    { from: 'Review', to: 'Implement', when: { field: 'passed', eq: false } },
    // LOCK THE PASSING EDGE, LEAVE THE FAILING EDGE UNLOCKED — same convention as the
    // seeds. The non-passing-edge rule exempts only `locked && when.eq === true`, so an
    // UNLOCKED pass edge is treated as a bypass and correctly rejected; and a LOCKED fail
    // edge silently shadows any node spliced onto the fail path. Getting this backwards
    // makes the fixture itself invalid — verified: it yields
    // "Review non-passing edge -> DoDGate can reach Done without re-crossing Review".
    { from: 'Review', to: 'DoDGate', when: { field: 'passed', eq: true }, locked: true },
    { from: 'DoDGate', to: 'Implement', when: { field: 'passed', eq: false } },
    { from: 'DoDGate', to: 'PR', when: { field: 'passed', eq: true }, locked: true },
    { from: 'PR', to: 'Done', when: 'always' },
  ],
  invariants: { mustCross: ['Review', 'DoDGate'], visitCaps: { '*': 3 }, nodeBudget: 40 },
};
APPROVED.invariants.lockedHash = core.lockedFingerprint(APPROVED);

let bad = 0;
const ok = (c, m) => { if (c) { console.log(`PASS ${m}`); } else { console.error(`FAIL ${m}`); bad++; } };

ok(core.validateGraph(APPROVED, APPROVED, null).length === 0, 'approved graph validates clean');

const attack = JSON.parse(JSON.stringify(APPROVED));
attack.invariants.mustCross = [];
attack.edges.push({ from: 'Implement', to: 'Done', when: 'always' });
const v = core.messages(core.validateGraph(attack, APPROVED, null));
ok(v.length > 0, 'emptying mustCross + unlocked bypass edge is REJECTED');
ok(v.some((m) => /dominates/.test(m)), "prev's mustCross still governs");
ok(core.reachable(attack, 'Setup', ['DoDGate']).has('Done'),
  'fixture is only meaningful if the bypass really reaches the terminal');

const budget = JSON.parse(JSON.stringify(APPROVED));
budget.invariants.nodeBudget = 9999;
for (let i = 0; i < 60; i++) {
  budget.nodes.push({ id: `P${i}` });
  budget.edges.push({ from: 'Implement', to: `P${i}`, when: 'always' });
}
ok(core.messages(core.validateGraph(budget, APPROVED, null)).some((m) => /budget/.test(m)),
  "prev's nodeBudget governs, not the submitted one");

// ONLY the locked PASSING edge is exempt from the non-passing-edge rule, and both halves of
// that sentence are load-bearing. Testing dominance without testing the exemption leaves the
// rule's actual escape hatch unmeasured — which is where a bypass would be built.
{
  // (a) an unconditional edge out of a gate is the bypass wearing a different predicate:
  //     pass/fail still route correctly, so it looks harmless, while every OFF-SHAPE result
  //     falls through it.
  const always = JSON.parse(JSON.stringify(APPROVED));
  always.edges.push({ from: 'DoDGate', to: 'Done', when: 'always' });
  ok(core.messages(core.validateGraph(always, APPROVED, null))
    .some((m) => /non-passing edge/.test(m)),
    'an unconditional edge out of a gate is rejected — not only an eq:false one');

  // (b) a MINTED passing edge must not be exempted. The exemption is tied to `locked`, which
  //     a patch cannot forge without moving lockedFingerprint; testing eq === true alone
  //     would let any invented field claim the exemption.
  const minted = JSON.parse(JSON.stringify(APPROVED));
  minted.edges.push({ from: 'DoDGate', to: 'Done', when: { field: 'anythingAtAll', eq: true } });
  ok(core.messages(core.validateGraph(minted, APPROVED, null))
    .some((m) => /non-passing edge/.test(m)),
    'an UNLOCKED eq:true edge is not exempt — the exemption is tied to the freeze, not the value');
}

if (bad) { console.error(`\ngate-dominance-not-bypassable: ${bad} failed`); process.exit(1); }
console.log('gate-dominance-not-bypassable: ok');
