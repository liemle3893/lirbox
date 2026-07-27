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

  process.stdout.write(`\n${failures ? `${failures} FAILURE(S)` : 'all green'}\n`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
