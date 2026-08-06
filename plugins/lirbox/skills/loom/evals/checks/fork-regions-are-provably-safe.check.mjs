// CHECK — a fork region must be structurally safe BEFORE anything runs concurrently.
//
// A `fork` node opens a REGION that closes at its `join`. Inside a region an edge means
// DEPENDS ON, not go-to-next, so the region is a genuine DAG: a node with two arrows in
// waits for both, a node with one waits only for that one. It is the only construct in
// loom that runs two workers at once, and the only one that can say "these are
// independent" rather than "pick one".
//
// Every rule below is a BOUNDARY rule — it constrains how a region connects to the rest
// of the graph, never what it looks like inside. That is deliberate: the inside has to be
// free to be any DAG, and the safety argument has to survive that.
//
//   one exit         a node escaping the region would walk the rest of the graph
//                    concurrently with itself
//   region edges     a dependency is not a choice; a predicate here is a decision never
//   unconditional    made, and "every region node runs" is what the reasoning rests on
//   acyclic          a dependency cycle is a DEADLOCK, not a retry loop — each node
//                    waiting on the other, with no verdict able to break it
//   no gate inside   NOT because it would go unexecuted (it would run). A gate exists to
//                    fail BACKWARDS, and inside a region that is either the cycle above or
//                    an escape from the join. A node that cannot route its failure is not
//                    a gate
//   no nested fork   a region is already a DAG and expresses anything a nested fork could
//
// This check is BEHAVIOURAL, not a text scan: it calls validateGraph with one valid DAG
// region and with a mutation of that same graph per rule, so a rule that stops firing is
// caught even if its source text survives.
// Locked (evals/**): improvement loops may NEVER edit this file.
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = resolve(HERE, '..', '..', 'scripts');

// Mutation hatch for scripts/prove-checks.mjs — it copies the skill tree, mutates
// graph-core.mjs in the copy, and points this variable at it.
const coreFile = process.env.LOOM_GRAPH_CORE_OVERRIDE || join(SCRIPTS, 'graph-core.mjs');
const core = await import(pathToFileURL(coreFile).href);

let bad = 0;
const ok = (c, m) => { if (c) { console.log(`PASS ${m}`); } else { console.error(`FAIL ${m}`); bad++; } };

// A REAL DAG region, not two lanes:
//   Fan => { ApiWork, UiWork } ; Contract needs BOTH ; UiPolish needs UiWork only
//   -> Integrate -> Review -> Done         (the gate sits AFTER the join)
const FORK = () => ({
  start: 'Plan',
  terminal: 'Done',
  nodes: [
    { id: 'Plan', kind: 'work' },
    { id: 'Fan', kind: 'fork', join: 'Integrate' },
    { id: 'ApiWork', kind: 'work' }, { id: 'UiWork', kind: 'work' },
    { id: 'Contract', kind: 'work' }, { id: 'UiPolish', kind: 'work' },
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
    { from: 'UiWork', to: 'UiPolish', when: 'always' },
    { from: 'Contract', to: 'Integrate', when: 'always' },
    { from: 'UiPolish', to: 'Integrate', when: 'always' },
    { from: 'Integrate', to: 'Review', when: 'always' },
    { from: 'Review', to: 'Done', when: { field: 'passed', eq: true }, locked: true },
    { from: 'Review', to: 'Integrate', when: { field: 'passed', eq: false } },
  ],
  invariants: { mustCross: ['Review'] },
});

// THE POSITIVE CONTROL, and it is doing real work here: `Contract` is reachable from BOTH
// ApiWork and UiWork. An implementation that required branches to be node-disjoint — the
// shape this model had before it was a DAG — rejects this graph, so this single assertion
// is what stops the feature silently regressing to parallel lanes.
const clean = core.validateGraph(FORK(), null, null);
ok(clean.length === 0,
  `a DAG region with a shared dependency is ACCEPTED (got ${JSON.stringify(clean)})`);

const rejects = (label, needle, mutate) => {
  const g = FORK();
  mutate(g);
  const v = core.validateGraph(g, null, null);
  ok(v.some((m) => m.includes(needle)), `REJECTED: ${label} (got ${JSON.stringify(v)})`);
};

rejects('a region node that escapes instead of reaching the join',
  'without crossing its join Integrate',
  (g) => { g.edges.find((e) => e.from === 'UiPolish').to = 'Review'; });

rejects('a dependency cycle inside the region — a deadlock, not a retry',
  'dependency cycle',
  (g) => { g.edges.push({ from: 'Contract', to: 'ApiWork', when: 'always' }); });

rejects('a predicate on a region edge', 'carries a predicate',
  (g) => {
    g.edges.find((e) => e.from === 'UiWork' && e.to === 'UiPolish').when = { field: 'ui', eq: true };
  });

rejects('a nested fork inside a region', 'nested fork',
  (g) => { g.nodes.find((n) => n.id === 'UiWork').kind = 'fork'; });

rejects('a mustCross gate hidden inside the region', 'sits inside fork region',
  (g) => {
    g.nodes.find((n) => n.id === 'Contract').kind = 'gate';
    g.invariants.mustCross = ['Contract', 'Review'];
  });

rejects('a fork with a single entry', 'at least 2 independent entry nodes',
  (g) => {
    g.edges = g.edges.filter((e) => !(e.from === 'Fan' && e.to === 'UiWork'));
    g.edges = g.edges.filter((e) => e.from !== 'UiWork');
    g.nodes = g.nodes.filter((n) => n.id !== 'UiWork' && n.id !== 'UiPolish');
    g.edges = g.edges.filter((e) => e.to !== 'UiPolish');
  });

rejects('a fork declaring a prompt', 'must not declare a prompt or schema',
  (g) => { g.nodes.find((n) => n.id === 'Fan').prompt = 'decide the split'; });

rejects('a fork whose join does not exist', 'naming an existing node',
  (g) => { g.nodes.find((n) => n.id === 'Fan').join = 'Nope'; });

// The region helpers are what every rule above is computed from; a wrong boundary would
// make all of them agree with each other and with nothing else.
{
  const g = FORK();
  const fork = g.nodes.find((n) => n.id === 'Fan');
  ok(typeof core.regionNodes === 'function' && typeof core.regionPreds === 'function'
    && typeof core.regionOrder === 'function' && typeof core.regionSinks === 'function',
    'the region helpers are exported from graph-core');
  const region = core.regionNodes(g, fork);
  ok([...region].sort().join(',') === 'ApiWork,Contract,UiPolish,UiWork',
    `the region stops AT the join, excluding it (got ${[...region].sort().join(',')})`);
  const preds = core.regionPreds(g, region, 'Contract').map((e) => e.from).sort().join(',');
  ok(preds === 'ApiWork,UiWork',
    `a node's dependencies are its in-region predecessors (got ${preds})`);
  ok(core.regionSinks(g, region, 'Integrate').sort().join(',') === 'Contract,UiPolish',
    'the sinks are the nodes feeding the join');
  const order = core.regionOrder(g, region) || [];
  ok(order.length === region.size && order.indexOf('Contract') > order.indexOf('ApiWork')
    && order.indexOf('Contract') > order.indexOf('UiWork'),
    `regionOrder returns a dependency-respecting order (got ${order.join(' -> ')})`);
}

if (bad) { console.error(`\nfork-regions-are-provably-safe: ${bad} failed`); process.exit(1); }
console.log('fork-regions-are-provably-safe: ok');
