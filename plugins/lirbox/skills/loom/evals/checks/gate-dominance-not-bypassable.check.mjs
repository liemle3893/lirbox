// CHECK — validateGraph must read invariants from the APPROVED graph, never from the
// graph under validation. Reading them from `next` was a full bypass: submit
// mustCross: [] plus an unlocked bypass edge and validation returned [] while the
// terminal was reachable crossing no gate.
// Locked (evals/**): improvement loops may NEVER edit this file.
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const core = await import(resolve(HERE, '..', '..', 'scripts', 'graph-core.mjs'));

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
const v = core.validateGraph(attack, APPROVED, null);
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
ok(core.validateGraph(budget, APPROVED, null).some((m) => /budget/.test(m)),
  "prev's nodeBudget governs, not the submitted one");

if (bad) { console.error(`\ngate-dominance-not-bypassable: ${bad} failed`); process.exit(1); }
console.log('gate-dominance-not-bypassable: ok');
