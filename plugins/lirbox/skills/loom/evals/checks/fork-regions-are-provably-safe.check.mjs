// CHECK — a fork region must be structurally safe BEFORE anything runs concurrently.
//
// A `fork` node takes every out-edge at once. That is the only construct in loom where two
// workers run simultaneously, and it is the only thing the model has ever had that can say
// "these are independent" rather than "pick one". It is also the only construct that can
// quietly destroy every guarantee the skill sells, so each rule below buys the concurrency
// back:
//
//   one exit      a branch that escapes the region walks the rest of the graph concurrently
//                 with its own sibling
//   disjointness  two branches sharing a node means two workers racing it, and visit
//                 accounting that cannot be per-branch
//   unconditional every branch always runs; a predicate there is a choice never made, and
//   fork edges    it is what makes the dominance reasoning sound instead of probabilistic
//   no gate in    a mustCross gate guarding ONE branch is not a gate on the run: the sibling
//   a branch      branch reaches the join, and so the terminal, without ever crossing it
//
// This check is BEHAVIOURAL, not a text scan: it calls validateGraph with one valid fork
// graph and with a mutation of that same graph per rule, so a rule that stops firing is
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

// Plan -> Fan =>{ApiWork -> ApiTest, UiWork} -> Integrate -> Review -> Done
// Two independent branches, one join, and the only gate AFTER the join.
const FORK = () => ({
  start: 'Plan',
  terminal: 'Done',
  nodes: [
    { id: 'Plan', kind: 'work' },
    { id: 'Fan', kind: 'fork', join: 'Integrate' },
    { id: 'ApiWork', kind: 'work' }, { id: 'ApiTest', kind: 'work' },
    { id: 'UiWork', kind: 'work' },
    { id: 'Integrate', kind: 'work' },
    { id: 'Review', kind: 'gate' },
    { id: 'Done', kind: 'terminal' },
  ],
  edges: [
    { from: 'Plan', to: 'Fan', when: 'always' },
    { from: 'Fan', to: 'ApiWork', when: 'always' },
    { from: 'Fan', to: 'UiWork', when: 'always' },
    { from: 'ApiWork', to: 'ApiTest', when: 'always' },
    { from: 'ApiTest', to: 'Integrate', when: 'always' },
    { from: 'UiWork', to: 'Integrate', when: 'always' },
    { from: 'Integrate', to: 'Review', when: 'always' },
    { from: 'Review', to: 'Done', when: { field: 'passed', eq: true }, locked: true },
    { from: 'Review', to: 'Integrate', when: { field: 'passed', eq: false } },
  ],
  invariants: { mustCross: ['Review'] },
});

// THE POSITIVE CONTROL. Every rejection below is a mutation of this one graph, so a
// rejection can never be credited to a fixture that was broken some other way — and a
// validator that rejects everything is caught here rather than reported as five passes.
const clean = core.validateGraph(FORK(), null, null);
ok(clean.length === 0,
  `a valid two-branch fork with the gate after the join is ACCEPTED (got ${JSON.stringify(clean)})`);

const rejects = (label, needle, mutate) => {
  const g = FORK();
  mutate(g);
  const v = core.validateGraph(g, null, null);
  ok(v.some((m) => m.includes(needle)), `REJECTED: ${label} (got ${JSON.stringify(v)})`);
};

rejects('a branch that escapes its region instead of reaching the join',
  'without crossing its join Integrate',
  (g) => { g.edges.find((e) => e.from === 'ApiTest').to = 'Review'; });

rejects('two branches sharing a node', 'node-disjoint',
  (g) => { g.edges.find((e) => e.from === 'UiWork').to = 'ApiTest'; });

rejects('a predicate on a fork edge', 'carries a predicate',
  (g) => {
    g.edges.find((e) => e.from === 'Fan' && e.to === 'UiWork').when = { field: 'ui', eq: true };
  });

rejects('a mustCross gate hidden inside one branch', 'sits inside fork branch',
  (g) => {
    g.nodes.find((n) => n.id === 'ApiTest').kind = 'gate';
    g.invariants.mustCross = ['ApiTest', 'Review'];
    g.edges.push({ from: 'ApiTest', to: 'ApiWork', when: { field: 'passed', eq: false } });
  });

// The friendly message above is ADDITIVE. The structural proof it explains must still fire
// on its own — if the explanation ever replaced the proof, a graph would be rejected for a
// reason that is easy to argue away rather than for the one that is not.
{
  const g = FORK();
  g.nodes.find((n) => n.id === 'ApiTest').kind = 'gate';
  g.invariants.mustCross = ['ApiTest', 'Review'];
  g.edges.push({ from: 'ApiTest', to: 'ApiWork', when: { field: 'passed', eq: false } });
  const v = core.validateGraph(g, null, null);
  ok(v.some((m) => m.includes('ApiTest no longer dominates Done')),
    'the underlying dominance proof still fires independently of the friendlier message');
}

rejects('a fork with a single branch', 'at least 2 concurrent branches',
  (g) => {
    g.edges = g.edges.filter((e) => !(e.from === 'Fan' && e.to === 'UiWork'));
    g.nodes = g.nodes.filter((n) => n.id !== 'UiWork');
  });

rejects('a fork declaring a prompt', 'must not declare a prompt or schema',
  (g) => { g.nodes.find((n) => n.id === 'Fan').prompt = 'decide the split'; });

rejects('a fork whose join does not exist', 'naming an existing node',
  (g) => { g.nodes.find((n) => n.id === 'Fan').join = 'Nope'; });

// branchRegion is what every rule above is computed from; a wrong boundary would make all
// of them agree with each other and with nothing else.
{
  const g = FORK();
  ok(typeof core.branchRegion === 'function', 'branchRegion is exported from graph-core');
  if (typeof core.branchRegion === 'function') {
    const api = [...core.branchRegion(g, 'ApiWork', 'Integrate')].sort().join(',');
    ok(api === 'ApiTest,ApiWork', `branchRegion stops AT the join, excluding it (got ${api})`);
  }
}

if (bad) { console.error(`\nfork-regions-are-provably-safe: ${bad} failed`); process.exit(1); }
console.log('fork-regions-are-provably-safe: ok');