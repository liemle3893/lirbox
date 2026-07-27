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

  test('positional: a gate already behind the cursor no longer dominates', () => {
    // Cursor sits at Implement having arrived via DoDGate:fail. Review is upstream
    // of the cursor, so the remaining path need not cross it — this is exactly the
    // case structural dominance alone gets wrong.
    assert.strictEqual(core.dominates(G, 'Review', 'PR', 'Implement'), false);
  });

  test('a gate dominates itself', () => {
    assert.strictEqual(core.dominates(G, 'PR', 'PR', 'Setup'), true);
  });

  process.stdout.write(`\n${failures ? `${failures} FAILURE(S)` : 'all green'}\n`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
