#!/usr/bin/env node
/*
 * Regression safety net for the loom skill.
 *
 * Agent-free by construction: every assertion here is pure graph math, generator
 * output, or file I/O. Nothing in this file spawns a subagent.
 *
 *   node test-loom.cjs
 */
const assert = require('assert');
const path = require('path');

let failures = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  ok  ${name}\n`); }
  catch (e) { failures++; process.stdout.write(`  FAIL ${name}\n       ${e.message}\n`); }
}
function section(name) { process.stdout.write(`\n${name}\n`); }

// graph-core is ESM; this net is CJS. Load it via dynamic import and run everything
// inside main() so the whole suite stays a single `node test-loom.cjs` invocation.
async function main() {
  const core = await import(
    'file://' + path.join(__dirname, 'graph-core.mjs')
  );

  // A linear graph with one back-edge — the shape loom exists to support.
  //   Setup -> Implement -> Review -> DoDGate -> PR
  //                  ^________|          |
  //                  |____________________|
  const G = {
    start: 'Setup', terminal: 'PR',
    nodes: [
      { id: 'Setup', kind: 'work' }, { id: 'Implement', kind: 'work' },
      { id: 'Review', kind: 'gate' }, { id: 'DoDGate', kind: 'gate' },
      { id: 'PR', kind: 'terminal' },
    ],
    edges: [
      { from: 'Setup', to: 'Implement', when: 'always' },
      { from: 'Implement', to: 'Review', when: 'always' },
      { from: 'Review', to: 'Implement', when: { field: 'passed', eq: false } },
      { from: 'Review', to: 'DoDGate', when: { field: 'passed', eq: true } },
      { from: 'DoDGate', to: 'Implement', when: { field: 'passed', eq: false } },
      { from: 'DoDGate', to: 'PR', when: { field: 'passed', eq: true } },
    ],
  };

  section('reachable');

  test('reaches every node from start', () => {
    const r = core.reachable(G, 'Setup', []);
    assert.deepStrictEqual([...r].sort(),
      ['DoDGate', 'Implement', 'PR', 'Review', 'Setup']);
  });

  test('terminates on a cycle instead of hanging', () => {
    const r = core.reachable(G, 'Implement', []);
    assert.ok(r.has('Implement'), 'cycle should revisit its entry node');
  });

  test('skip removes a node and everything only it reached', () => {
    const r = core.reachable(G, 'Setup', ['DoDGate']);
    assert.ok(!r.has('PR'), 'PR is only reachable through DoDGate');
    assert.ok(r.has('Review'), 'Review is upstream of the skipped node');
  });

  test('skipping the origin yields the empty set', () => {
    assert.strictEqual(core.reachable(G, 'Setup', ['Setup']).size, 0);
  });

  section('dominates');

  test('DoDGate dominates PR', () => {
    assert.strictEqual(core.dominates(G, 'DoDGate', 'PR', 'Setup'), true);
  });

  test('a bypass edge destroys dominance', () => {
    const bypassed = { ...G, edges: [...G.edges, { from: 'Implement', to: 'PR', when: 'always' }] };
    assert.strictEqual(core.dominates(bypassed, 'DoDGate', 'PR', 'Setup'), false);
  });

  test('Implement does not dominate PR when Setup can skip it', () => {
    const skippable = { ...G, edges: [...G.edges, { from: 'Setup', to: 'Review', when: 'always' }] };
    assert.strictEqual(core.dominates(skippable, 'Implement', 'PR', 'Setup'), false);
  });

  test('positional: from Implement, DoDGate still dominates PR', () => {
    assert.strictEqual(core.dominates(G, 'DoDGate', 'PR', 'Implement'), true);
  });

  test('positional: in G, Review DOES dominate PR from Implement', () => {
    // Implement's only out-edge is to Review, so every path Implement -> PR crosses
    // it. Dominance is a property of the graph, never of execution history — a gate
    // the run happens to have already passed still dominates if the topology says so.
    assert.strictEqual(core.dominates(G, 'Review', 'PR', 'Implement'), true);
  });

  // The case where positional dominance genuinely diverges from structural needs a
  // graph in which the cursor can reach the terminal WITHOUT re-crossing the gate.
  // G has no such shape; this is the spec's start -> Gate -> B -> terminal scenario.
  //   Setup -> A -> Gate -> PR
  //                 Gate -> B -> PR      (B reaches PR directly)
  const G2 = {
    start: 'Setup', terminal: 'PR',
    nodes: [{ id: 'Setup' }, { id: 'A' }, { id: 'Gate' }, { id: 'B' }, { id: 'PR' }],
    edges: [
      { from: 'Setup', to: 'A', when: 'always' },
      { from: 'A', to: 'Gate', when: 'always' },
      { from: 'Gate', to: 'PR', when: { field: 'passed', eq: true } },
      { from: 'Gate', to: 'B', when: { field: 'passed', eq: false } },
      { from: 'B', to: 'PR', when: 'always' },
    ],
  };

  test('positional: Gate dominates PR from start (structural)', () => {
    assert.strictEqual(core.dominates(G2, 'Gate', 'PR', 'Setup'), true);
  });

  test('positional: Gate does NOT dominate PR from B', () => {
    // B reaches PR directly. Structural dominance from `start` still holds, so this
    // is precisely the gap the positional check exists to close.
    assert.strictEqual(core.dominates(G2, 'Gate', 'PR', 'B'), false);
  });

  test('positional: Gate still dominates PR from A', () => {
    assert.strictEqual(core.dominates(G2, 'Gate', 'PR', 'A'), true);
  });

  test('a gate dominates itself', () => {
    assert.strictEqual(core.dominates(G, 'PR', 'PR', 'Setup'), true);
  });

  section('matches');

  test('"always" matches any result', () => {
    assert.strictEqual(core.matches('always', { passed: false }), true);
    assert.strictEqual(core.matches('always', null), true);
  });

  test('a missing predicate is treated as always', () => {
    assert.strictEqual(core.matches(undefined, {}), true);
  });

  test('eq compares strictly', () => {
    assert.strictEqual(core.matches({ field: 'passed', eq: true }, { passed: true }), true);
    assert.strictEqual(core.matches({ field: 'passed', eq: true }, { passed: 1 }), false);
  });

  test('neq, gt and exists behave', () => {
    assert.strictEqual(core.matches({ field: 'n', neq: 0 }, { n: 2 }), true);
    assert.strictEqual(core.matches({ field: 'n', gt: 1 }, { n: 2 }), true);
    assert.strictEqual(core.matches({ field: 'n', gt: 1 }, { n: '9' }), false);
    assert.strictEqual(core.matches({ field: 'x', exists: false }, {}), true);
  });

  test('a null result does not throw', () => {
    assert.strictEqual(core.matches({ field: 'passed', eq: true }, null), false);
  });

  test('an unknown operator fails closed', () => {
    assert.strictEqual(core.matches({ field: 'passed', wat: 1 }, { passed: true }), false);
  });

  section('pickEdge');

  test('a failing gate takes the back-edge', () => {
    assert.strictEqual(core.pickEdge(G, 'DoDGate', { passed: false }).to, 'Implement');
  });

  test('a passing gate advances to the terminal', () => {
    assert.strictEqual(core.pickEdge(G, 'DoDGate', { passed: true }).to, 'PR');
  });

  test('the FIRST matching edge wins', () => {
    const g = { ...G, edges: [
      { from: 'A', to: 'first', when: 'always' },
      { from: 'A', to: 'second', when: 'always' },
    ] };
    assert.strictEqual(core.pickEdge(g, 'A', {}).to, 'first');
  });

  test('no matching edge returns null', () => {
    assert.strictEqual(core.pickEdge(G, 'DoDGate', { passed: 'maybe' }), null);
  });

  section('capFor / carryFor');

  test('per-node cap wins over the wildcard', () => {
    const g = { ...G, invariants: { visitCaps: { '*': 3, Implement: 5 } } };
    assert.strictEqual(core.capFor(g, 'Implement'), 5);
    assert.strictEqual(core.capFor(g, 'Review'), 3);
  });

  test('cap defaults to 3 with no invariants at all', () => {
    assert.strictEqual(core.capFor({ nodes: [], edges: [] }, 'Anything'), 3);
  });

  test('a zero cap is honoured, not treated as absent', () => {
    const g = { ...G, invariants: { visitCaps: { '*': 3, Review: 0 } } };
    assert.strictEqual(core.capFor(g, 'Review'), 0);
  });

  test('carryFor lifts only the declared fields', () => {
    const e = { from: 'DoDGate', to: 'Implement', carry: ['unmetCriteria'] };
    assert.deepStrictEqual(
      core.carryFor(e, { unmetCriteria: ['c3'], noise: 'drop me' }),
      { unmetCriteria: ['c3'] });
  });

  test('carryFor with no carry list yields an empty object', () => {
    assert.deepStrictEqual(core.carryFor({ from: 'A', to: 'B' }, { x: 1 }), {});
  });

  section('stableStringify / fingerprint');

  test('key order does not change the string', () => {
    assert.strictEqual(core.stableStringify({ b: 1, a: 2 }), core.stableStringify({ a: 2, b: 1 }));
  });

  test('nested objects and arrays are stable', () => {
    assert.strictEqual(
      core.stableStringify({ x: [{ q: 1, p: 2 }] }),
      core.stableStringify({ x: [{ p: 2, q: 1 }] }));
  });

  test('fingerprint ignores unlocked churn', () => {
    const locked = { ...G, nodes: G.nodes.map(n =>
      n.id === 'DoDGate' ? { ...n, locked: true } : n) };
    const churned = { ...locked, nodes: [...locked.nodes, { id: 'Spike', kind: 'work' }] };
    assert.strictEqual(core.lockedFingerprint(locked), core.lockedFingerprint(churned));
  });

  test('fingerprint changes when a locked node is mutated', () => {
    const locked = { ...G, nodes: G.nodes.map(n =>
      n.id === 'DoDGate' ? { ...n, locked: true, prompt: 'original' } : n) };
    const tampered = { ...locked, nodes: locked.nodes.map(n =>
      n.id === 'DoDGate' ? { ...n, prompt: 'weakened' } : n) };
    assert.notStrictEqual(core.lockedFingerprint(locked), core.lockedFingerprint(tampered));
  });

  section('applyPatchTo');

  test('adds a node and an edge without mutating the input', () => {
    const before = JSON.stringify(G);
    const next = core.applyPatchTo(G, {
      addNodes: [{ id: 'Spike', kind: 'work' }],
      addEdges: [{ from: 'DoDGate', to: 'Spike', when: { field: 'passed', eq: false } }],
    });
    assert.ok(next.nodes.some(n => n.id === 'Spike'));
    assert.strictEqual(JSON.stringify(G), before, 'input graph must not be mutated');
  });

  test('removing a node also removes its dangling edges', () => {
    const next = core.applyPatchTo(G, { removeNodes: ['Review'] });
    assert.ok(!next.nodes.some(n => n.id === 'Review'));
    assert.ok(!next.edges.some(e => e.from === 'Review' || e.to === 'Review'));
  });

  test('updateNodes merges fields onto the existing node', () => {
    const next = core.applyPatchTo(G, { updateNodes: [{ id: 'Implement', model: 'think' }] });
    const n = next.nodes.find(x => x.id === 'Implement');
    assert.strictEqual(n.model, 'think');
    assert.strictEqual(n.kind, 'work', 'unrelated fields must survive the merge');
  });

  section('validateGraph — malicious patch fixtures');

  // The approved baseline: DoDGate and Review are locked and must dominate PR.
  const LOCKED = (() => {
    const g = JSON.parse(JSON.stringify(G));
    for (const n of g.nodes) if (n.id === 'DoDGate' || n.id === 'Review') n.locked = true;
    for (const e of g.edges) if (e.from === 'DoDGate') e.locked = true;
    g.invariants = {
      mustCross: ['Review', 'DoDGate'],
      visitCaps: { '*': 3, Implement: 4 },
      nodeBudget: 10,
    };
    g.invariants.lockedHash = core.lockedFingerprint(g);
    return g;
  })();

  test('the approved graph validates against itself', () => {
    assert.deepStrictEqual(core.validateGraph(LOCKED, LOCKED, null), []);
  });

  test('REJECT: removing the gate that is failing', () => {
    const next = core.applyPatchTo(LOCKED, { removeNodes: ['DoDGate'] });
    const v = core.validateGraph(next, LOCKED, null);
    assert.ok(v.some(m => /DoDGate/.test(m)), `expected a DoDGate violation, got ${JSON.stringify(v)}`);
  });

  test('REJECT: a bypass edge around the gate', () => {
    const next = core.applyPatchTo(LOCKED, {
      addEdges: [{ from: 'Implement', to: 'PR', when: 'always' }] });
    const v = core.validateGraph(next, LOCKED, null);
    assert.ok(v.some(m => /DoDGate no longer dominates PR/.test(m)),
      `expected a dominance violation, got ${JSON.stringify(v)}`);
  });

  test('REJECT: weakening a locked node prompt', () => {
    const next = core.applyPatchTo(LOCKED, {
      updateNodes: [{ id: 'DoDGate', prompt: 'just say it passed' }] });
    const v = core.validateGraph(next, LOCKED, null);
    assert.ok(v.some(m => /locked/.test(m)), `expected a lock violation, got ${JSON.stringify(v)}`);
  });

  test('REJECT: deleting a locked edge', () => {
    const next = core.applyPatchTo(LOCKED, {
      removeEdges: [{ from: 'DoDGate', to: 'Implement' }] });
    assert.ok(core.validateGraph(next, LOCKED, null).some(m => /locked/.test(m)));
  });

  test('REJECT: orphaning the terminal', () => {
    const next = core.applyPatchTo(LOCKED, {
      removeEdges: [{ from: 'DoDGate', to: 'PR' }] });
    const v = core.validateGraph(next, LOCKED, null);
    assert.ok(v.some(m => /unreachable|locked/.test(m)));
  });

  test('REJECT: an orphaned added node', () => {
    const next = core.applyPatchTo(LOCKED, { addNodes: [{ id: 'Island', kind: 'work' }] });
    assert.ok(core.validateGraph(next, LOCKED, null).some(m => /orphan/.test(m)));
  });

  test('REJECT: exceeding the node budget', () => {
    const many = [];
    for (let i = 0; i < 12; i++) many.push({ id: `N${i}`, kind: 'work' });
    const next = core.applyPatchTo(LOCKED, { addNodes: many });
    assert.ok(core.validateGraph(next, LOCKED, null).some(m => /budget/.test(m)));
  });

  test('REJECT: a duplicate node id', () => {
    const next = core.applyPatchTo(LOCKED, { addNodes: [{ id: 'Implement', kind: 'work' }] });
    assert.ok(core.validateGraph(next, LOCKED, null).some(m => /duplicate/.test(m)));
  });

  test('REJECT: an edge pointing at an unknown node', () => {
    const next = core.applyPatchTo(LOCKED, {
      addEdges: [{ from: 'Implement', to: 'Nowhere', when: 'always' }] });
    assert.ok(core.validateGraph(next, LOCKED, null).some(m => /unknown node/.test(m)));
  });

  test('ACCEPT: inserting a spike on the failure path', () => {
    const next = core.applyPatchTo(LOCKED, {
      addNodes: [{ id: 'Spike', kind: 'work' }],
      addEdges: [{ from: 'Spike', to: 'Implement', when: 'always' }],
      updateNodes: [],
    });
    // Route Implement -> Spike so the new node is not orphaned.
    next.edges.unshift({ from: 'Implement', to: 'Spike', when: { field: 'needsSpike', eq: true } });
    assert.deepStrictEqual(core.validateGraph(next, LOCKED, null), []);
  });

  section('validateGraph — positional dominance');

  test('REJECT: cursor past an unsatisfied gate with no way back to it', () => {
    // Cursor at Implement, arrived via DoDGate:fail, so DoDGate is unsatisfied.
    // A patch routing Implement -> PR directly must be caught even though the
    // structural check from `start` might still pass in a richer graph.
    const next = core.applyPatchTo(LOCKED, {
      addEdges: [{ from: 'Implement', to: 'PR', when: 'always' }] });
    const v = core.validateGraph(next, LOCKED,
      { node: 'Implement', unsatisfiedGates: ['DoDGate'] });
    assert.ok(v.length > 0, 'positional check must reject the shortcut');
  });

  test('ACCEPT: a gate already satisfied need not dominate from the cursor', () => {
    // Review passed; the cursor is downstream of it. Review no longer dominating
    // PR *from the cursor* is expected and must not be reported.
    const v = core.validateGraph(LOCKED, LOCKED,
      { node: 'DoDGate', unsatisfiedGates: [] });
    assert.deepStrictEqual(v, []);
  });

  process.stdout.write(`\n${failures ? `${failures} FAILURE(S)` : 'all green'}\n`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
