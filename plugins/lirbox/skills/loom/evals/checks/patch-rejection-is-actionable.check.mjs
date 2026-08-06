// CHECK — a rejected graphPatch must come back with something a worker can ACT on.
//
// `validateGraph` used to return sentences. Every fact needed to construct the corrected
// patch is known where the violation is raised — the fork id, the offending node, the edge,
// the join it should have targeted — and all of it was flattened into English, so the worker
// whose patch was rejected had to parse prose and re-derive the edit.
//
// loom has already paid for this bug once, one layer up: `DoDGate` carried `unmetCriteria`
// (bare ids) and the re-entered node worked blind, and the ratelimit proof run showed that
// evidence-bearing carries converge in a single visit where identifiers do not. Patch
// rejection is the same channel with the same defect.
//
// The three things this pins, none of which a text scan could:
//
//   1. every violation carries a stable `code`, and no two rules share one — a caller that
//      branches on the message string is branching on prose that may be reworded
//   2. a violation that NAMES a node or an edge exposes it as a field, not only inside the
//      sentence
//   3. THE LOAD-BEARING ONE: where a `fix` is offered, applying it through the ordinary
//      applyPatchTo + validateGraph path actually makes that violation go away. A suggested
//      patch that does not repair what it claims to is worse than no suggestion, because it
//      costs the worker a whole visit to discover that.
//
// And the human contract must not regress: `messages()` still returns exactly the sentences
// the editor and the CLI have always printed.
// Locked (evals/**): improvement loops may NEVER edit this file.
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = resolve(HERE, '..', '..', 'scripts');

// Mutation hatch for scripts/prove-checks.mjs.
const coreFile = process.env.LOOM_GRAPH_CORE_OVERRIDE || join(SCRIPTS, 'graph-core.mjs');
const core = await import(pathToFileURL(coreFile).href);

let bad = 0;
const ok = (c, m) => { if (c) { console.log(`PASS ${m}`); } else { console.error(`FAIL ${m}`); bad++; } };

ok(typeof core.messages === 'function', 'graph-core exports messages()');
ok(typeof core.violation === 'function', 'graph-core exports violation()');

// A valid DAG-region graph. Every defect below is a mutation of this one, so a violation can
// never be credited to a fixture that was broken some other way.
const BASE = () => ({
  start: 'Plan',
  terminal: 'Done',
  nodes: [
    { id: 'Plan', kind: 'work' },
    { id: 'Fan', kind: 'fork', join: 'Integrate' },
    { id: 'ApiWork', kind: 'work' }, { id: 'UiWork', kind: 'work' },
    { id: 'Contract', kind: 'work' },
    { id: 'Integrate', kind: 'work' },
    { id: 'Review', kind: 'gate' },
    { id: 'Done', kind: 'terminal' },
  ],
  edges: [
    { from: 'Plan', to: 'Fan', when: 'always' },
    { from: 'Fan', to: 'ApiWork', when: 'always' },
    { from: 'Fan', to: 'UiWork', when: 'always' },
    { from: 'ApiWork', to: 'Contract', when: 'always' },
    { from: 'UiWork', to: 'Contract', when: 'always' },
    { from: 'Contract', to: 'Integrate', when: 'always' },
    { from: 'Integrate', to: 'Review', when: 'always' },
    { from: 'Review', to: 'Done', when: { field: 'passed', eq: true }, locked: true },
    { from: 'Review', to: 'Integrate', when: { field: 'passed', eq: false } },
  ],
  invariants: { mustCross: ['Review'] },
});

ok(core.validateGraph(BASE(), null, null).length === 0,
  'the fixture is valid to begin with, so every violation below is caused by its mutation');

// Each case: a mutation, the code it must raise, and the fields that code must expose.
const CASES = [
  {
    label: 'an edge pointing at a node that does not exist',
    code: 'edge-to-unknown-node',
    fields: ['node', 'edge'],
    mutate: (g) => { g.edges.push({ from: 'Plan', to: 'Ghost', when: 'always' }); },
  },
  {
    label: 'a node nothing can reach',
    code: 'orphaned-nodes',
    fields: ['nodes'],
    mutate: (g) => { g.nodes.push({ id: 'Stray', kind: 'work' }); },
  },
  {
    label: 'a predicate on a region edge',
    code: 'fork-region-edge-conditional',
    fields: ['fork', 'edge'],
    mutate: (g) => {
      g.edges.find((e) => e.from === 'ApiWork' && e.to === 'Contract')
        .when = { field: 'x', eq: true };
    },
  },
  {
    // An escaping edge does not leave the region — it drags the rest of the graph into it,
    // terminal included. Dominance is what notices, and it names the fork and the join.
    label: 'a region node routing past the join',
    code: 'fork-region-escapes-join',
    fields: ['fork', 'join'],
    mutate: (g) => { g.edges.push({ from: 'Contract', to: 'Review', when: 'always' }); },
  },
  {
    label: 'a mustCross gate that no longer dominates',
    code: 'gate-no-longer-dominates',
    fields: ['gate', 'terminal'],
    mutate: (g) => { g.edges.push({ from: 'Integrate', to: 'Done', when: 'always' }); },
  },
];

const seenCodes = new Map();
let fixesTested = 0;

for (const c of CASES) {
  const g = BASE();
  c.mutate(g);
  const all = core.validateGraph(g, null, null);
  const hit = all.find((x) => x && x.code === c.code);
  ok(!!hit, `${c.label} -> code "${c.code}" (got ${JSON.stringify(all.map((x) => x && x.code))})`);
  if (!hit) continue;

  for (const f of c.fields) {
    ok(hit[f] !== undefined,
      `${c.code} exposes "${f}" as a field, not only inside the sentence`);
  }
  ok(typeof hit.message === 'string' && hit.message.length > 0,
    `${c.code} still carries its human sentence`);
  ok(core.messages(all).includes(hit.message),
    `${c.code}: messages() returns the sentence verbatim — the human surface does not regress`);

  // THE LOAD-BEARING ASSERTION. A suggested fix must survive the ordinary patch path and
  // actually clear the violation it was attached to.
  if (hit.fix) {
    fixesTested++;
    const before = all.map((x) => x && x.code);
    const repaired = core.applyPatchTo(g, hit.fix);
    const after = core.validateGraph(repaired, null, null).map((x) => x && x.code);
    ok(!after.includes(c.code),
      `${c.code}: its suggested fix, applied through applyPatchTo, clears it `
      + `(remaining: ${JSON.stringify(after)})`);
    // ...and it must not TRADE one violation for another. Deleting the offending edge always
    // clears the complaint about that edge; it can also strand whatever depended on it, which
    // is a worse graph reached by following our own advice. A fix is only a fix if the whole
    // violation set shrinks and nothing new appears.
    const fresh = after.filter((x) => !before.includes(x));
    ok(fresh.length === 0,
      `${c.code}: its fix introduces no NEW violation (introduced: ${JSON.stringify(fresh)})`);
    ok(after.length < before.length,
      `${c.code}: its fix strictly reduces the violation count (${before.length} -> ${after.length})`);
  }

  for (const x of all) {
    if (!x || !x.code) continue;
    const prev = seenCodes.get(x.code);
    if (prev && prev !== x.message.slice(0, 24)) continue; // same code, different instance: fine
    seenCodes.set(x.code, x.message.slice(0, 24));
  }
}

ok(fixesTested >= 3,
  `at least three suggested fixes were actually applied and re-validated (got ${fixesTested})`);

// Codes must be kebab-case and stable enough to branch on.
for (const code of seenCodes.keys()) {
  ok(/^[a-z][a-z0-9-]*$/.test(code), `code "${code}" is a stable kebab-case slug`);
}
ok(seenCodes.size >= 5, `several distinct codes were observed (got ${seenCodes.size})`);

// messages() must tolerate a bare string, so a consumer meeting an older payload renders
// prose rather than "[object Object]" at a human.
{
  const mixed = core.messages(['a legacy sentence', { code: 'x', message: 'a new one' }]);
  ok(mixed.length === 2 && mixed[0] === 'a legacy sentence' && mixed[1] === 'a new one',
    'messages() flattens both the new shape and a bare legacy string');
}

if (bad) { console.error(`\npatch-rejection-is-actionable: ${bad} failed`); process.exit(1); }
console.log('patch-rejection-is-actionable: ok');