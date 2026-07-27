// CHECK — positional dominance must FAIL CLOSED when a patch removes the node the run
// is standing on. A permissive guard let a rename skip the positional check entirely
// while the locked fingerprint stayed valid and structural dominance still held.
// Locked (evals/**): improvement loops may NEVER edit this file.
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const core = await import(resolve(HERE, '..', '..', 'scripts', 'graph-core.mjs'));

const G = {
  start: 'Setup', terminal: 'PR',
  nodes: [{ id: 'Setup' }, { id: 'A' }, { id: 'Gate', locked: true },
          { id: 'B' }, { id: 'C' }, { id: 'PR' }],
  edges: [
    { from: 'Setup', to: 'A', when: 'always' },
    { from: 'A', to: 'Gate', when: 'always' },
    { from: 'Gate', to: 'PR', when: { field: 'passed', eq: true }, locked: true },
    { from: 'Gate', to: 'B', when: { field: 'passed', eq: false }, locked: true },
    { from: 'B', to: 'C', when: 'always' },
    { from: 'C', to: 'PR', when: 'always' },
  ],
  invariants: { mustCross: ['Gate'], visitCaps: { '*': 3 }, nodeBudget: 40 },
};
G.invariants.lockedHash = core.lockedFingerprint(G);
const cursor = { node: 'C', unsatisfiedGates: ['Gate'] };

let bad = 0;
const ok = (c, m) => { if (c) { console.log(`PASS ${m}`); } else { console.error(`FAIL ${m}`); bad++; } };

ok(core.validateGraph(G, G, cursor).length > 0, 'baseline positional violation fires from C');

const renamed = core.applyPatchTo(G, {
  removeNodes: ['C'], addNodes: [{ id: 'C2' }],
  addEdges: [{ from: 'B', to: 'C2', when: 'always' }, { from: 'C2', to: 'PR', when: 'always' }],
});
ok(core.lockedFingerprint(renamed) === G.invariants.lockedHash,
  'fixture is only meaningful if the lock check stays silent');
const v = core.validateGraph(renamed, G, cursor);
ok(v.length > 0, 'renaming the cursor node is REJECTED');
ok(v.some((m) => /cursor node C was removed/.test(m)), 'explicit cursor-removal violation');

if (bad) { console.error(`\ncursor-rename-fails-closed: ${bad} failed`); process.exit(1); }
console.log('cursor-rename-fails-closed: ok');
