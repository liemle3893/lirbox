// CHECK — positional dominance must FAIL CLOSED when a patch removes the node the run
// is standing on. A permissive guard let a rename skip the positional check entirely
// while the locked fingerprint stayed valid and structural dominance still held.
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

// ATTRIBUTED, not merely non-empty. This fixture can trip unrelated structural violations,
// so `length > 0` stays true even with positional dominance deleted outright — the baseline
// would look healthy while the very thing it is a baseline FOR was gone.
{
  const base = core.messages(core.validateGraph(G, G, cursor));
  ok(base.some((m) => /no longer dominates .* from C/.test(m)),
    `baseline POSITIONAL violation fires from C (got ${JSON.stringify(base)})`);
}

const renamed = core.applyPatchTo(G, {
  removeNodes: ['C'], addNodes: [{ id: 'C2' }],
  addEdges: [{ from: 'B', to: 'C2', when: 'always' }, { from: 'C2', to: 'PR', when: 'always' }],
});
ok(core.lockedFingerprint(renamed) === G.invariants.lockedHash,
  'fixture is only meaningful if the lock check stays silent');
const v = core.messages(core.validateGraph(renamed, G, cursor));
ok(v.length > 0, 'renaming the cursor node is REJECTED');
// v.length > 0 alone is vacuous: this fixture's G3-shape graph can independently trip an
// unrelated structural violation, so "REJECTED" can pass even with the cursor check gone
// entirely. Attribute the rejection to the cursor check specifically.
const cursorViolations = v.filter((m) => /cursor node/.test(m));
ok(cursorViolations.length > 0,
  'the rejection is attributable to the cursor check, not to an unrelated structural violation');
ok(v.some((m) => /cursor node C was removed/.test(m)), 'explicit cursor-removal violation');

if (bad) { console.error(`\ncursor-rename-fails-closed: ${bad} failed`); process.exit(1); }
console.log('cursor-rename-fails-closed: ok');
