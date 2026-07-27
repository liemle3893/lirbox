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
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');

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

  // The approved baseline: DoDGate and Review are locked and must dominate PR.
  const LOCKED = (() => {
    const g = JSON.parse(JSON.stringify(G));
    for (const n of g.nodes) if (n.id === 'DoDGate' || n.id === 'Review') n.locked = true;
    // MIRROR THE SEEDS: only a gate's PASSING edge is locked.
    for (const e of g.edges) {
      if ((e.from === 'DoDGate' || e.from === 'Review') && e.when && e.when.eq === true) {
        e.locked = true;
      }
    }
    g.invariants = {
      mustCross: ['Review', 'DoDGate'],
      visitCaps: { '*': 3, Implement: 4 },
      nodeBudget: 10,
    };
    g.invariants.lockedHash = core.lockedFingerprint(g);
    return g;
  })();

  test('applyPatchTo output does not alias the caller\'s patch object', () => {
    // A shallow merge in updateNodes leaves nested values shared with the patch, so a
    // caller mutating its own patch afterwards silently mutates an approved graph
    // without it ever passing back through validateGraph.
    const nested = { retries: 3, notes: ['a'] };
    const out = core.applyPatchTo(LOCKED, { updateNodes: [{ id: 'Implement', config: nested }] });
    const node = out.nodes.find((n) => n.id === 'Implement');
    assert.notStrictEqual(node.config, nested, 'returned graph aliases the patch object');
    nested.notes.push('mutated later');
    assert.deepStrictEqual(node.config.notes, ['a'],
      'mutating the caller\'s patch changed the already-returned graph');
  });

  test('applyPatchTo ignores non-array patch fields', () => {
    const out = core.applyPatchTo(LOCKED, { addNodes: 'not-an-array', removeNodes: 42 });
    assert.deepStrictEqual(out.nodes.map((n) => n.id).sort(),
      LOCKED.nodes.map((n) => n.id).sort(),
      'a non-array patch field must be ignored, not iterated character-by-character');
  });

  section('validateGraph — malicious patch fixtures');

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
      removeEdges: [{ from: 'DoDGate', to: 'PR' }] });
    assert.ok(core.validateGraph(next, LOCKED, null).some(m => /locked/.test(m)));
  });

  test('REJECT: orphaning the terminal', () => {
    const next = core.applyPatchTo(LOCKED, {
      removeEdges: [{ from: 'DoDGate', to: 'PR' }] });
    const v = core.validateGraph(next, LOCKED, null);
    assert.ok(v.some(m => /unreachable|locked/.test(m)));
  });

  test('REJECT: any non-passing gate edge that leads onward', () => {
    // Dominance proves the gate is VISITED, not that it PASSED. Each of these leaves the
    // gate on every path — so the dominance check stays silent — while letting a run that
    // did not pass reach the terminal.
    for (const [label, patch] of [
      ['failure edge rerouted onward', {
        removeEdges: [{ from: 'DoDGate', to: 'Implement' }],
        addEdges: [{ from: 'DoDGate', to: 'PR', when: { field: 'passed', eq: false } }],
      }],
      // An appended `always` edge is the same bypass with a different predicate: pass and
      // fail still route correctly, but every OFF-SHAPE result falls through to it — which
      // also defeats Task 4's hard-fail, since pickEdge now finds a match.
      ['appended always-edge to the terminal', {
        addEdges: [{ from: 'DoDGate', to: 'PR', when: 'always' }],
      }],
      ['appended edge with an unrelated predicate', {
        addEdges: [{ from: 'DoDGate', to: 'PR', when: { field: 'n', gt: 0 } }],
      }],
      // A minted pass edge cannot carry `locked: true`, but without the lock check it
      // would be exempted even on an unrelated field.
      ['minted pass edge on an unrelated field', {
        addEdges: [{ from: 'DoDGate', to: 'PR', when: { field: 'anythingAtAll', eq: true } }],
      }],
      ['minted pass edge reusing the real field', {
        addEdges: [{ from: 'DoDGate', to: 'PR', when: { field: 'passed', eq: true } }],
      }],
    ]) {
      const v = core.validateGraph(core.applyPatchTo(LOCKED, patch), LOCKED, null);
      assert.ok(v.some((m) => /non-passing edge/.test(m)),
        `${label} is a bypass and must be rejected, got ${JSON.stringify(v)}`);
    }
  });

  test('ACCEPT: a gate failure edge that loops back through the gate', () => {
    // Every legitimate reshaping of the failure path must still pass: splice a node in,
    // route to an earlier node, or self-loop (bounded by visitCaps).
    for (const [label, patch] of [
      ['splice a Spike', {
        removeEdges: [{ from: 'DoDGate', to: 'Implement' }],
        addNodes: [{ id: 'Spike', kind: 'work' }],
        addEdges: [{ from: 'DoDGate', to: 'Spike', when: { field: 'passed', eq: false } },
                   { from: 'Spike', to: 'Implement', when: 'always' }],
      }],
      ['self-loop', {
        removeEdges: [{ from: 'DoDGate', to: 'Implement' }],
        addEdges: [{ from: 'DoDGate', to: 'DoDGate', when: { field: 'passed', eq: false } }],
      }],
    ]) {
      const next = core.applyPatchTo(LOCKED, patch);
      assert.ok(!core.validateGraph(next, LOCKED, null).some((m) => /non-passing edge/.test(m)),
        `${label} is legitimate failure-path reshaping and must be accepted`);
    }
  });

  test('REJECT: a dead-end node with no outgoing edge', () => {
    // Reachable, not the terminal, nowhere to go. The interpreter would throw on arrival;
    // this catches it before the run starts.
    const next = core.applyPatchTo(LOCKED, {
      addNodes: [{ id: 'DeadEnd', kind: 'work' }],
      addEdges: [{ from: 'Implement', to: 'DeadEnd', when: { field: 'x', eq: 1 } }],
    });
    const v = core.validateGraph(next, LOCKED, null);
    assert.ok(v.some((m) => /dead-end/.test(m)),
      `expected a dead-end violation, got ${JSON.stringify(v)}`);
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

  section('validateGraph — invariants are the approved contract');

  test('REJECT: emptying mustCross to bypass every gate', () => {
    // The full-bypass attack. Locked nodes and edges are untouched, so the fingerprint
    // still matches; the added edge is unlocked; and with mustCross emptied there would
    // be nothing left to check. Reading invariants from `prev` is what stops this.
    const attack = JSON.parse(JSON.stringify(LOCKED));
    attack.invariants.mustCross = [];
    attack.edges.push({ from: 'Implement', to: 'PR', when: 'always' });
    const v = core.validateGraph(attack, LOCKED, null);
    assert.ok(v.length > 0, 'a graph reaching the terminal without crossing any gate was ACCEPTED');
    assert.ok(v.some((m) => /dominates/.test(m)),
      `expected a dominance violation from prev's mustCross, got ${JSON.stringify(v)}`);
    assert.ok(v.some((m) => /invariants were modified/.test(m)),
      'the invariant substitution itself must also be reported');
  });

  test('REJECT: raising nodeBudget in the submitted graph', () => {
    const attack = JSON.parse(JSON.stringify(LOCKED));
    attack.invariants.nodeBudget = 9999;
    for (let i = 0; i < 12; i++) {
      attack.nodes.push({ id: `Pad${i}`, kind: 'work' });
      attack.edges.push({ from: 'Implement', to: `Pad${i}`, when: 'always' });
    }
    const v = core.validateGraph(attack, LOCKED, null);
    assert.ok(v.some((m) => /budget/.test(m)),
      `prev's nodeBudget (10) must govern, not the submitted 9999 — got ${JSON.stringify(v)}`);
  });

  test('pre-approval, the graph may still declare its own invariants', () => {
    // With no prior graph there is nothing to be frozen against, so seeding works.
    assert.deepStrictEqual(core.validateGraph(LOCKED, null, null), []);
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

  test('REJECT: renaming the node the run is standing on', () => {
    // The positional check keys off cursor.node. Delete-and-re-add it under a new id with
    // identical shape and the check has nothing to anchor to — so it must FAIL CLOSED.
    // Structural dominance cannot catch this: renaming a mid-graph node leaves every path
    // from `start` intact. Needs a graph where the cursor sits PAST the gate on a fail
    // branch whose downstream edges are unlocked, so the locked fingerprint stays valid.
    const G3 = {
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
    G3.invariants.lockedHash = core.lockedFingerprint(G3);
    const cursor = { node: 'C', unsatisfiedGates: ['Gate'] };

    // Baseline: unchanged graph is already correctly rejected from this position.
    assert.ok(core.validateGraph(G3, G3, cursor).length > 0,
      'baseline positional violation should fire before the rename');

    const renamed = core.applyPatchTo(G3, {
      removeNodes: ['C'], addNodes: [{ id: 'C2' }],
      addEdges: [{ from: 'B', to: 'C2', when: 'always' },
                 { from: 'C2', to: 'PR', when: 'always' }],
    });
    assert.strictEqual(core.lockedFingerprint(renamed), G3.invariants.lockedHash,
      'fixture is only meaningful if the lock check stays silent');
    const v = core.validateGraph(renamed, G3, cursor);
    assert.ok(v.length > 0,
      'renaming the cursor node silently skipped positional dominance — the run can now ' +
      'reach the terminal without recrossing an unsatisfied gate');
    assert.ok(v.some((m) => /cursor node C was removed/.test(m)),
      `expected an explicit cursor-removal violation, got ${JSON.stringify(v)}`);
  });

  test('ACCEPT: a gate already satisfied need not dominate from the cursor', () => {
    // Review passed; the cursor is downstream of it. Review no longer dominating
    // PR *from the cursor* is expected and must not be reported.
    const v = core.validateGraph(LOCKED, LOCKED,
      { node: 'DoDGate', unsatisfiedGates: [] });
    assert.deepStrictEqual(v, []);
  });

  section('generator');

  const GEN = path.join(__dirname, 'scaffold-loom.cjs');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'test-loom-'));
  const graphFile = path.join(tmp, 'graph.json');
  fs.writeFileSync(graphFile, JSON.stringify({ ...LOCKED, name: 'demo', goal: 'demo goal' }));
  const outFile = path.join(tmp, 'demo.js');
  execFileSync('node', [GEN, '--name', 'demo', '--graph', graphFile, '--out', outFile]);
  const emitted = fs.readFileSync(outFile, 'utf8');

  test('emitted script parses', () => {
    execFileSync('node', ['--check', outFile]);
  });

  // The restricted-layer scan. It MUST be scoped to executing code before it runs.
  //
  // Scanning the raw emitted text produces guaranteed false positives, because two kinds
  // of legitimate content name these primitives in prose:
  //   - graph-core.mjs's own header comment documents its purity rule ("no Date.now(),
  //     no Math.random(), no crypto") and is required to travel into the conductor
  //     byte-for-byte by the inlining test;
  //   - node prompts are DATA and may say anything, including "don't use fs.".
  //
  // conductor hit exactly this and fixed it the same way (test-scaffold.cjs, conductorBody).
  // loom differs in one respect: conductor slices from `const NAME`, which for loom would
  // skip the inlined graph-core FUNCTIONS — those are executing code and must stay scanned.
  // So strip comments and blank every string/template literal instead, keeping all real code.
  // ONE tokenizer, single pass, explicit mode stack. Returns executing code only:
  // comments dropped, string and template-literal TEXT dropped, template
  // INTERPOLATIONS kept as code.
  //
  // Three earlier attempts failed, and the progression is the lesson:
  //   1. Regex chain blanking template literals WHOLE — hid executing code inside a
  //      real `${...}`.
  //   2. Regex extracting `${...}` bodies — could not tell an escaped `\${crypto}`
  //      (inert placeholder data) from a live one, and `[^{}]*` could not match across
  //      nested braces, so `${f({a:1})}` extracted nothing.
  //   3. Whole-blanking PLUS a separate `liveInterpolations` character walk to prove
  //      nothing live was inside. Two functions parsing JavaScript by different rules
  //      DISAGREED: the walk did not strip comments first, so a single unpaired
  //      backtick in a comment — an ordinary markdown slip like "see the `foo function"
  //      — shifted its open/close parity and made it report 0 while a real
  //      `${Date.now()}` existed. The scan then blanked that literal away on the
  //      strength of the false proof. `node --check` cannot help: an unpaired backtick
  //      inside a comment is syntactically inert.
  //
  // The fix is not a fourth heuristic. It is refusing to have two parsers: one pass
  // that understands comments, strings and templates together, so nothing can disagree.
  const codeOnly = (src) => {
    let out = '';
    let i = 0;
    const n = src.length;
    const stack = [{ mode: 'code', depth: 0, interp: false }];
    let prev = '';   // last significant char emitted in code mode — decides regex vs divide

    while (i < n) {
      const top = stack[stack.length - 1];
      const c = src[i], c2 = src[i + 1];

      if (top.mode === 'tmpl') {
        if (c === '\\') { i += 2; continue; }                 // escaped char in template text
        if (c === '`') { stack.pop(); out += '""'; prev = '"'; i++; continue; }
        if (c === '$' && c2 === '{') {                         // live interpolation -> code
          stack.push({ mode: 'code', depth: 0, interp: true });
          out += ' '; prev = ''; i += 2; continue;
        }
        i++; continue;                                         // literal text -> dropped
      }

      if (c === '/' && c2 === '/') { while (i < n && src[i] !== '\n') i++; continue; }
      if (c === '/' && c2 === '*') {
        i += 2;
        while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
        i += 2; continue;
      }
      // Regex literal. Without this, a regex containing `}`, a backtick, or a quote is
      // read as code and derails the mode stack — `/}/` inside an interpolation popped it
      // early, and a backtick inside a regex opened a phantom template — hiding every
      // forbidden primitive after it. All three were real FALSE NEGATIVES.
      // A `/` opens a regex only in expression position; otherwise it is division.
      // The body is DATA (it cannot execute), so it is blanked — the point is only that
      // its contents must not be mistaken for a string, template, or closing brace.
      //
      // KNOWN LIMITATION, deliberately not fixed. The expression-position test keys off
      // PUNCTUATION in `prev`, not keywords. So `return /foo+/;` reads the `/` as
      // division; if the regex body then ends in a trigger-set character (a trailing `+`
      // is enough) the real closing `/` is taken as opening a new regex, and same-line
      // code after it is swallowed. Contained to one line by the newline bail below.
      //
      // Do not "fix" this by adding keywords to the trigger set — that was measured and
      // it trades one false negative for another: a keyword regex matches `o.return / 2`
      // (the `.` counts as a word boundary), so division after a property named `return`
      // then gets eaten instead, and `return /a[/` stays broken regardless. Making this
      // correct needs a real JS lexer, not a bigger heuristic.
      //
      // Accepted because: no regex literal exists anywhere in graph-core.mjs or the
      // generator; the blast radius is one physical line; and this scan guards a rule
      // (no fs/Date.now in the conductor layer) that the restricted runtime would fail
      // loudly on anyway. If regex literals ever enter the scanned sources, revisit with
      // a real lexer rather than another heuristic.
      if (c === '/' && (prev === '' || '=(,:[!&|?{};+-*%~^<>'.includes(prev))) {
        i++;
        let inClass = false;
        while (i < n) {
          const d = src[i];
          if (d === '\\') { i += 2; continue; }
          if (d === '[') inClass = true;
          else if (d === ']') inClass = false;
          else if (d === '/' && !inClass) { i++; break; }
          else if (d === '\n') break;        // unterminated — bail, don't swallow the file
          i++;
        }
        while (i < n && /[gimsuyd]/.test(src[i])) i++;         // flags
        out += '""'; prev = '"';
        continue;
      }
      if (c === "'" || c === '"') {
        const q = c; i++;
        while (i < n && src[i] !== q) { if (src[i] === '\\') i++; i++; }
        i++; out += '""'; prev = '"'; continue;
      }
      if (c === '`') { stack.push({ mode: 'tmpl' }); i++; continue; }
      if (top.interp) {
        if (c === '{') { top.depth++; out += c; prev = c; i++; continue; }
        if (c === '}') {
          if (top.depth === 0) { stack.pop(); out += ' '; prev = ''; i++; continue; }
          top.depth--; out += c; prev = c; i++; continue;
        }
      }
      out += c;
      if (!/\s/.test(c)) prev = c;
      i++;
    }
    return out;
  };
  const conductorBody = codeOnly;

  const FORBIDDEN = [
    ['require(', /\brequire\s*\(/],
    ['import', /^\s*import\s/m],
    ['Date.now', /\bDate\.now\s*\(/],
    ['new Date', /\bnew Date\b/],
    ['Math.random', /\bMath\.random\s*\(/],
    ['crypto', /\bcrypto\b/],
    ['fs.', /\bfs\s*\./],
    ['child_process', /child_process/],
  ];
  const emittedBody = conductorBody(emitted);
  for (const [name, re] of FORBIDDEN) {
    test(`emitted conductor body contains no ${name}`, () => {
      assert.ok(!re.test(emittedBody),
        `forbidden ${name} found in EXECUTING code of the generated conductor`);
    });
  }

  test('the purity scan still has teeth', () => {
    // A scoped scan that cannot fail is worse than no scan. Inject each forbidden
    // primitive into executing code and confirm the scan catches every one.
    for (const [label, code] of [
      ['Date.now', 'const t = Date.now()'],
      ['Math.random', 'const r = Math.random()'],
      ['require', 'const x = require("fs")'],
      ['fs.', 'fs.writeFileSync(a, b)'],
      ['new Date', 'const d = new Date()'],
      ['crypto', 'const h = crypto.createHash("sha256")'],
    ]) {
      const tampered = conductorBody(emitted.replace('const NAME =', code + '\nconst NAME ='));
      assert.ok(FORBIDDEN.some(([, re]) => re.test(tampered)),
        `scan failed to catch an injected ${label} — the scoping is too aggressive`);
    }
  });

  test('the tokenizer sees code the previous three approaches missed', () => {
    // Each entry is a shape that defeated an earlier attempt. No separate invariant
    // is needed now: the tokenizer reads interpolations as code directly.
    const F = FORBIDDEN;
    const caught = (src) => F.some(([, re]) => re.test(conductorBody(src)));

    assert.ok(caught('const x = `a ${Date.now()} b`'), 'live interpolation');
    assert.ok(caught('const x = `${f({a: Date.now()})}`'), 'nested braces');
    assert.ok(caught('const x = `${ `${Date.now()}` }`'), 'nested template in interpolation');
    // The parity bug: one unpaired backtick in a comment used to hide everything after it.
    assert.ok(caught([
      '// see the `unclosed markdown code span',
      'const legit = `safe, no interpolation`',
      'const bad = `real: ${Date.now()}`',
    ].join('\n')), 'stray backtick in a line comment must not shift template parity');
    assert.ok(caught([
      '/* mentions `export { ... }; without closing */',
      'const bad = `real: ${Math.random()}`',
    ].join('\n')), 'stray backtick in a block comment');

    // Regex literals — three false negatives found by attacking the tokenizer directly.
    assert.ok(caught('const x = `${ s.replace(/}/, "") + Date.now() }`'),
      'a regex containing } must not pop the interpolation early');
    assert.ok(caught('const r = /`/; const t = Date.now()'),
      'a backtick inside a regex must not open a phantom template literal');
    assert.ok(caught('const r = /"/; const t = Date.now()'),
      'a quote inside a regex must not open a phantom string');
    assert.ok(caught('const r = /[/]/; const t = Date.now()'),
      'a / inside a regex char class does not end the regex');

    // ...and division must NOT be mistaken for a regex, or everything after it vanishes.
    assert.ok(caught('const a = b / c; const t = Date.now()'), 'division is not a regex');
    assert.ok(caught('const a = (x) / 2; const r = Math.random()'), 'division after a paren');
  });

  test('the tokenizer still ignores prose and data', () => {
    const F = FORBIDDEN;
    const clean = (src) => !F.some(([, re]) => re.test(conductorBody(src)));

    assert.ok(clean('// never call Date.now() or Math.random()'), 'prose in a line comment');
    assert.ok(clean('/*\n * no Date.now(), no Math.random(), no crypto.\n */'),
      "graph-core's own prose header");
    assert.ok(clean('const t = `do not use Date.now() here`'), 'prose in template text');
    assert.ok(clean('const p = `NODE: \\${nodeId} visit \\${visit}`'), 'escaped placeholders');
    assert.ok(clean('const p = `\\${crypto}`'),
      'a placeholder NAMED crypto must not false-positive');
    assert.ok(clean('const s = "use fs. and Date.now()"'), 'forbidden words in a string');
    assert.ok(clean('const s = "${Date.now()}"'), 'interpolation-looking text in a plain string');
    assert.ok(clean('const r = /Date\\.now\\(/; const x = 1'),
      'a forbidden pattern inside a regex body is data, not a call');
  });

  test('prose inside a template literal still does not false-positive', () => {
    // The other direction: blanking must still remove literal TEXT, or the
    // escaped prompt templates would trip the scan again.
    const proseOnly = emitted.replace('const NAME =',
      'const t = `do not call Date.now() or Math.random() here`\nconst NAME =');
    assert.ok(!FORBIDDEN.some(([, re]) => re.test(conductorBody(proseOnly))),
      'literal prose inside a template literal must not be scanned as code');
  });

  test('meta is a literal and never read at runtime', () => {
    assert.ok(/^export const meta = \{/m.test(emitted));
    const body = emitted.slice(emitted.indexOf('\n}\n') + 3);
    assert.ok(!/\bmeta\s*\./.test(body), 'meta is metadata, not a runtime binding');
  });

  test('inlined graph-core matches the module byte-for-byte', () => {
    const src = fs.readFileSync(path.join(__dirname, 'graph-core.mjs'), 'utf8');
    const expected = src.replace(/^export \{[^}]*\};?\s*$/m, '').trimEnd();
    assert.ok(emitted.includes(expected),
      'the generator must inline graph-core.mjs verbatim — no second implementation');
  });

  test('the graph is spliced in as DATA', () => {
    assert.ok(/const GRAPH_V0 = \{/.test(emitted));
    assert.ok(emitted.includes('"DoDGate"') || emitted.includes('DoDGate'));
  });

  test('prompt placeholders are escaped, not interpolated', () => {
    // `node --check` CANNOT catch this. An unescaped placeholder inside the emitted
    // template literal parses perfectly and only throws ReferenceError once a workflow
    // runs. The escaped form is the only static evidence that it will behave.
    for (const ph of ['nodeId', 'visit', 'cap', 'carryText', 'nodePrompt', 'terminal']) {
      assert.ok(emitted.includes('\\${' + ph + '}'),
        `placeholder ${ph} must appear ESCAPED in the emitted template literal`);
      assert.ok(!new RegExp('[^\\\\\\\\]\\\\$\\\\{' + ph + '\\\\}').test(emitted),
        `found an UNESCAPED ${ph} placeholder — it will interpolate at generation time ` +
        'and the conductor will throw ReferenceError on its first run');
    }
  });

  test('placeholder substitution uses sub(), not String.replace', () => {
    assert.ok(/function sub\(text, vars\)/.test(emitted),
      'the emitted conductor needs its own sub() helper');
    assert.ok(!/\.replace\('\$\{/.test(emitted),
      "String.replace with a '${...}' pattern swaps only the FIRST occurrence and expands " +
      'special patterns found in the replacement value');
  });

  test('a prompt containing a special replacement pattern survives', () => {
    // A node prompt legitimately containing dollar-ampersand must not corrupt the output.
    const f = path.join(tmp, 'special.json');
    const g = JSON.parse(JSON.stringify({ ...LOCKED, name: 'special', goal: 'g' }));
    g.nodes = g.nodes.map((n) => n.id === 'Implement'
      ? { ...n, prompt: "handle the $& and $` and $' cases" } : n);
    fs.writeFileSync(f, JSON.stringify(g));
    const o = path.join(tmp, 'special.js');
    execFileSync('node', [GEN, '--name', 'special', '--graph', f, '--out', o, '--force']);
    const src = fs.readFileSync(o, 'utf8');
    assert.ok(src.includes("handle the $& and $` and $' cases"),
      'the prompt was mangled by special replacement-pattern expansion');
    execFileSync('node', ['--check', o]);
  });

  test('meta.phases lists the approved node ids', () => {
    for (const id of ['Setup', 'Implement', 'Review', 'DoDGate']) {
      assert.ok(emitted.includes(`title: '${id}'`), `meta.phases missing ${id}`);
    }
  });

  test('the interpreter enforces the visit cap', () => {
    assert.ok(/visit cap exceeded/.test(emitted));
  });

  test('the interpreter never falls back to the terminal on an unmatched result', () => {
    // THE defect this test exists for: `edge ? edge.to : graph.terminal` routed straight
    // to the terminal whenever no predicate matched, skipping every remaining gate — with
    // no patch and no adversary, just an agent returning {passed:'true'} or {} or null.
    assert.ok(!/edge \? edge\.to : graph\.terminal/.test(emitted),
      'the silent terminal fallback is back — an unmatched result must throw');
    assert.ok(/no edge matched at/.test(emitted),
      'the interpreter must hard-fail on an unmatched result');
  });

  test('unmatched results are a hard failure, verified by executing the logic', () => {
    // Static greps prove the source shape; this proves the BEHAVIOUR, by running the
    // same pickEdge the emitted interpreter runs against off-shape agent results.
    const G = {
      start: 'Setup', terminal: 'PR',
      nodes: [{ id: 'Setup' }, { id: 'GateA' }, { id: 'GateB' }, { id: 'PR' }],
      edges: [
        { from: 'Setup', to: 'GateA', when: 'always' },
        { from: 'GateA', to: 'GateB', when: { field: 'passed', eq: true } },
        { from: 'GateA', to: 'Setup', when: { field: 'passed', eq: false } },
        { from: 'GateB', to: 'PR', when: { field: 'passed', eq: true } },
        { from: 'GateB', to: 'Setup', when: { field: 'passed', eq: false } },
      ],
    };
    // Every one of these previously routed GateA -> PR, skipping GateB entirely.
    for (const bad of [{ passed: 'true' }, { passed: 1 }, {}, { verdict: true }, null, { ok: true }]) {
      assert.strictEqual(core.pickEdge(G, 'GateA', bad), null,
        `expected no match for ${JSON.stringify(bad)}`);
    }
    // And the well-formed shapes still route correctly.
    assert.strictEqual(core.pickEdge(G, 'GateA', { passed: true }).to, 'GateB');
    assert.strictEqual(core.pickEdge(G, 'GateA', { passed: false }).to, 'Setup');
  });

  test('a rejected patch is logged and does not mutate the graph', () => {
    assert.ok(/patch REJECTED/.test(emitted));
  });

  test('--force is required to overwrite', () => {
    let threw = false;
    try { execFileSync('node', [GEN, '--name', 'demo', '--graph', graphFile, '--out', outFile],
      { stdio: 'pipe' }); } catch (e) { threw = true; }
    assert.ok(threw, 'overwriting without --force must fail');
    execFileSync('node', [GEN, '--name', 'demo', '--graph', graphFile, '--out', outFile, '--force']);
  });

  test('an invalid graph is rejected at generation time', () => {
    const badFile = path.join(tmp, 'bad.json');
    const bad = core.applyPatchTo(LOCKED, { addEdges: [{ from: 'Implement', to: 'PR', when: 'always' }] });
    fs.writeFileSync(badFile, JSON.stringify({ ...bad, name: 'bad' }));
    let threw = false;
    try { execFileSync('node', [GEN, '--name', 'bad', '--graph', badFile,
      '--out', path.join(tmp, 'bad.js')], { stdio: 'pipe' }); } catch (e) { threw = true; }
    assert.ok(threw, 'the generator must refuse a graph that violates its own invariants');
  });

  section('seed graphs');

  for (const profile of ['lite', 'delivery']) {
    const seed = JSON.parse(fs.readFileSync(
      path.join(__dirname, 'seeds', `${profile}.json`), 'utf8'));

    test(`${profile}: validates against itself`, () => {
      assert.deepStrictEqual(core.validateGraph(seed, seed, null), []);
    });

    test(`${profile}: every mustCross gate is locked`, () => {
      for (const g of seed.invariants.mustCross) {
        const n = seed.nodes.find((x) => x.id === g);
        assert.ok(n, `${g} missing from nodes`);
        assert.ok(n.locked, `${g} is a mustCross gate but is not locked`);
      }
    });

    test(`${profile}: each gate's PASSING edge is locked, its FAILURE edge is not`, () => {
      // A gate's passing edge is where the bypass lives: an unlocked pass edge
      // can be rerouted or weakened to 'always', skipping the gate.
      // Failure edges stay unlocked: they are where loom's self-modification lives.
      // If a failure edge is locked, a planner splicing a node into that path adds
      // a parallel edge that validates but is never selected (pickEdge takes the
      // first match). A silent no-op is worse than a rejection.
      for (const g of seed.invariants.mustCross) {
        const passEdges = seed.edges.filter((e) => e.from === g && e.when && e.when.eq === true);
        const failEdges = seed.edges.filter((e) => e.from === g && e.when && e.when.eq === false);
        for (const e of passEdges) {
          assert.ok(e.locked, `gate ${g} pass-edge to ${e.to} must be locked`);
        }
        for (const e of failEdges) {
          assert.ok(!e.locked, `gate ${g} fail-edge to ${e.to} must not be locked`);
        }
      }
    });

    test(`${profile}: a node can be spliced into a gate's failure path and is reachable`, () => {
      // The worked example from the spec: a patch adds a node M between a gate's
      // failure edge target. With the failure edge unlocked, pickEdge actually
      // selects the new node. This test would have caught the round-1 error:
      // I verified patches were accepted but never that they were reachable.
      for (const g of seed.invariants.mustCross) {
        const failEdges = seed.edges.filter((e) => e.from === g && e.when && e.when.eq === false);
        for (const fe of failEdges) {
          // Splice a node M between the gate and the fail-target.
          const splicedGraph = core.applyPatchTo(seed, {
            addNodes: [{ id: 'M', kind: 'work', prompt: 'intermediate' }],
            addEdges: [
              { from: g, to: 'M', when: { field: 'passed', eq: false } },
              { from: 'M', to: fe.to, when: 'always' }
            ],
            removeEdges: [fe]
          });
          // Graph must validate (no locked-edge violation).
          const v = core.validateGraph(splicedGraph, seed, null);
          assert.deepStrictEqual(v, [], `splicing into ${g} -> ${fe.to} caused validation errors: ${JSON.stringify(v)}`);
          // M must be reachable from start (so pickEdge actually selects it).
          const fromStart = core.reachable(splicedGraph, splicedGraph.start, []);
          assert.ok(fromStart.has('M'), `spliced node M is not reachable from start`);
        }
      }
    });

    test(`${profile}: lockedHash is present and correct`, () => {
      assert.strictEqual(seed.invariants.lockedHash, core.lockedFingerprint(seed));
    });

    test(`${profile}: has a failure back-edge into a work node`, () => {
      const back = seed.edges.filter((e) => {
        const to = seed.nodes.find((n) => n.id === e.to);
        return to && to.kind === 'work' && e.when && e.when.eq === false;
      });
      assert.ok(back.length > 0, 'a seed with no back-edge defeats the purpose of loom');
    });

    test(`${profile}: generates a valid conductor`, () => {
      const f = path.join(tmp, `${profile}.json`);
      fs.writeFileSync(f, JSON.stringify({ ...seed, name: profile, goal: 'seed check' }));
      const o = path.join(tmp, `${profile}.js`);
      execFileSync('node', [GEN, '--name', profile, '--graph', f, '--out', o, '--force']);
      execFileSync('node', ['--check', o]);
    });
  }

  test('delivery carries a DoDGate and lite does not require one', () => {
    const d = JSON.parse(fs.readFileSync(path.join(__dirname, 'seeds', 'delivery.json'), 'utf8'));
    assert.ok(d.invariants.mustCross.includes('DoDGate'));
  });

  section('graph server');

  const { spawn } = require('child_process');
  const SERVER = path.join(__dirname, 'graph-server.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-root-'));
  fs.mkdirSync(path.join(root, '.loom', 'state'), { recursive: true });
  const seedGraph = JSON.parse(fs.readFileSync(path.join(__dirname, 'seeds', 'delivery.json'), 'utf8'));
  fs.writeFileSync(path.join(root, '.loom', 'srv.graph.json'), JSON.stringify(seedGraph));
  fs.writeFileSync(path.join(root, '.loom', 'state', 'srv.json'),
    JSON.stringify({ workflow: 'srv', status: 'running', cursor: 'Implement', visits: { Implement: 2 } }));

  const proc = spawn('node', [SERVER, '--name', 'srv', '--root', root, '--port', '0']);
  const port = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start in 5s')), 5000);
    proc.stdout.on('data', (b) => {
      const m = /LOOM_SERVER_PORT=(\d+)/.exec(b.toString());
      if (m) { clearTimeout(t); resolve(Number(m[1])); }
    });
    proc.stderr.on('data', (b) => process.stderr.write(b));
  });
  const base = `http://127.0.0.1:${port}`;
  const get = async (p) => { const r = await fetch(base + p); return { status: r.status, body: await r.json() }; };
  const post = async (p, o) => {
    const r = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(o) });
    return { status: r.status, body: await r.json() };
  };

  const rGraph = await get('/graph');
  test('GET /graph returns the current graph', () => {
    assert.strictEqual(rGraph.status, 200);
    assert.strictEqual(rGraph.body.terminal, 'Done');
  });

  const rState = await get('/state');
  test('GET /state returns run state', () => {
    assert.strictEqual(rState.status, 200);
    assert.strictEqual(rState.body.cursor, 'Implement');
  });

  const rCore = await fetch(base + '/graph-core.mjs');
  test('GET /graph-core.mjs serves the shared validator to the browser', async () => {
    assert.strictEqual(rCore.status, 200);
    assert.ok(/javascript/.test(rCore.headers.get('content-type')));
    assert.ok((await rCore.text()).includes('function validateGraph'),
      'the editor must receive the same validator the conductor inlines');
  });

  test('only the three known paths are served; everything else 404s', async () => {
    // NOTE: `new URL()` normalises ".." BEFORE the router sees it, so a traversal-shaped
    // request arrives as an already-collapsed pathname. `/editor.js/../../../graph-core.mjs`
    // therefore becomes `/graph-core.mjs` — a legitimate route that correctly returns 200.
    // The real guarantee is that the router serves a fixed allow-list and nothing else, so
    // that is what this asserts. (`serveStatic`'s prefix check is defence in depth; the
    // routes only ever hand it two literal strings.)
    for (const p of ['/editor.js/../../package.json', '/../../../etc/passwd',
                     '/graph-server.mjs', '/seeds/delivery.json', '/nope']) {
      const r = await fetch(base + p);
      assert.strictEqual(r.status, 404, `${p} must not be served, got ${r.status}`);
    }
  });

  test('a traversal that collapses onto a real route is still only that route', async () => {
    const r = await fetch(base + '/editor.js/../../../graph-core.mjs');
    assert.strictEqual(r.status, 200);
    assert.ok((await r.text()).includes('function validateGraph'),
      'it resolved to /graph-core.mjs, which is intentionally public to the editor');
  });

  const bypass = core.applyPatchTo(seedGraph, {
    addEdges: [{ from: 'Implement', to: 'Done', when: 'always' }] });
  const rBad = await post('/graph', { baseVersion: seedGraph.version || 0, graph: bypass });
  test('POST /graph rejects a gate bypass with 422 and reasons', () => {
    assert.strictEqual(rBad.status, 422);
    assert.ok(Array.isArray(rBad.body.violations) && rBad.body.violations.length);
    assert.ok(rBad.body.violations.some((m) => /dominates/.test(m)));
  });

  test('a rejected POST does not touch the stored graph', () => {
    const onDisk = JSON.parse(fs.readFileSync(path.join(root, '.loom', 'srv.graph.json'), 'utf8'));
    assert.ok(!onDisk.edges.some((e) => e.from === 'Implement' && e.to === 'Done'));
  });

  const okGraph = core.applyPatchTo(seedGraph, {
    addNodes: [{ id: 'Migrate', kind: 'work', prompt: 'run the migration' }],
    addEdges: [{ from: 'Migrate', to: 'Implement', when: 'always' }] });
  okGraph.edges.unshift({ from: 'Plan', to: 'Migrate', when: 'always' });
  const rOk = await post('/graph', { baseVersion: seedGraph.version || 0, graph: okGraph });
  test('POST /graph accepts a valid graph and bumps the version', () => {
    assert.strictEqual(rOk.status, 200);
    assert.strictEqual(rOk.body.version, (seedGraph.version || 0) + 1);
  });

  const rAction = await post('/action', { action: 'replan', comments: [{ node: 'Implement', text: 'split this' }] });
  test('POST /action writes the action file', () => {
    assert.strictEqual(rAction.status, 200);
    const a = JSON.parse(fs.readFileSync(path.join(root, '.loom', 'srv.action.json'), 'utf8'));
    assert.strictEqual(a.action, 'replan');
    assert.strictEqual(a.comments[0].node, 'Implement');
  });

  test('POST /action rejects an unknown action', async () => {
    const r = await post('/action', { action: 'rm-rf' });
    assert.strictEqual(r.status, 400);
  });

  test('POST /graph rejects a stale baseVersion with 409', async () => {
    // Optimistic concurrency. Without it, two valid concurrent saves both return 200
    // and one is silently discarded — the client is told it succeeded while its work
    // is gone. Measured before the fix: both posts got 200, only the later survived.
    const current = (await get('/graph')).body;
    const edited = JSON.parse(JSON.stringify(current));
    edited.nodes.push({ id: 'Stale', kind: 'work', prompt: 'x' });
    edited.edges.push({ from: 'Implement', to: 'Stale', when: { field: 'k', eq: 1 } });
    edited.edges.push({ from: 'Stale', to: 'Implement', when: 'always' });

    const stale = await post('/graph', { baseVersion: current.version - 1, graph: edited });
    assert.strictEqual(stale.status, 409, 'a stale base version must be rejected');
    assert.strictEqual(stale.body.currentVersion, current.version);

    const fresh = await post('/graph', { baseVersion: current.version, graph: edited });
    assert.strictEqual(fresh.status, 200, 'the correct base version must be accepted');
    assert.strictEqual(fresh.body.version, current.version + 1);
  });

  test('concurrent saves cannot silently lose an edit', async () => {
    const base = (await get('/graph')).body;
    const mk = (id) => {
      const g = JSON.parse(JSON.stringify(base));
      g.nodes.push({ id, kind: 'work', prompt: 'x' });
      g.edges.push({ from: 'Implement', to: id, when: { field: 'k', eq: 1 } });
      g.edges.push({ from: id, to: 'Implement', when: 'always' });
      return { baseVersion: base.version, graph: g };
    };
    const [a, b] = await Promise.all([post('/graph', mk('RaceA')), post('/graph', mk('RaceB'))]);
    const codes = [a.status, b.status].sort();
    assert.deepStrictEqual(codes, [200, 409],
      `exactly one concurrent save may win; got ${JSON.stringify(codes)}`);
    // And the loser must be told, not silently dropped.
    const loser = a.status === 409 ? a : b;
    assert.ok(loser.body.currentVersion !== undefined,
      'the rejected save must report the current version so the client can retry');
  });

  test('POST /graph refuses a bare graph body — no opt-out from the version check', async () => {
    // A bare body used to be accepted "for compatibility", which meant any client could
    // skip the concurrency check entirely. Measured before this was closed: two bare
    // bodies raced, both got 200, and one edit vanished. A guard with a supported
    // bypass is not a guard.
    const current = (await get('/graph')).body;
    const bare = await post('/graph', current);           // the graph, unwrapped
    assert.strictEqual(bare.status, 400, 'a bare graph body must be refused');

    // These shapes each used to slip past the check; all must now be refused.
    for (const bad of [
      { graph: current },                                  // baseVersion missing
      { baseVersion: null, graph: current },
      { baseVersion: String(current.version), graph: current },
      { baseVersion: current.version },                    // graph missing
    ]) {
      const r = await post('/graph', bad);
      assert.strictEqual(r.status, 400,
        `expected 400 for ${JSON.stringify(Object.keys(bad))}, got ${r.status}`);
    }
  });

  test('an oversized body gets a readable 413, not a socket reset', async () => {
    const huge = JSON.stringify({ baseVersion: 0, graph: { pad: 'x'.repeat(5e6) } });
    let status = null, err = null;
    try {
      const r = await fetch(base + '/graph', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: huge });
      status = r.status;
    } catch (e) { err = e; }
    assert.strictEqual(status, 413, `expected a 413 the client can read, got ${status ?? err}`);
    // ...and the server must still be healthy afterwards.
    assert.strictEqual((await get('/graph')).status, 200, 'server must survive an oversized body');
  });

  test('the server binds loopback only', () => {
    const srcText = fs.readFileSync(SERVER, 'utf8');
    assert.ok(/'127\.0\.0\.1'|"127\.0\.0\.1"/.test(srcText),
      'the server must bind 127.0.0.1 explicitly, never 0.0.0.0');
  });

  section('editor');

  const editorHtml = fs.readFileSync(path.join(__dirname, 'editor', 'index.html'), 'utf8');
  const editorJs = fs.readFileSync(path.join(__dirname, 'editor', 'editor.js'), 'utf8');

  test('GET / now serves the editor HTML', async () => {
    // Deferred from Task 6: the route existed, the file did not.
    const r = await fetch(base + '/');
    assert.strictEqual(r.status, 200);
    assert.ok(/text\/html/.test(r.headers.get('content-type')));
  });

  test('loads React Flow from CDN', () => {
    assert.ok(/reactflow/i.test(editorHtml), 'React Flow must be loaded');
  });

  test('every external subresource is pinned with SRI', () => {
    // A CDN that serves different bytes tomorrow would be executing arbitrary code
    // against the repo the editor is about to modify. Pin them.
    const external = [...editorHtml.matchAll(/<(script|link)\b[^>]*>/g)]
      .map((m) => m[0])
      .filter((tag) => /https?:\/\//.test(tag));
    assert.ok(external.length >= 4, 'expected React, ReactDOM, React Flow and its stylesheet');
    for (const tag of external) {
      assert.ok(/integrity="sha384-[A-Za-z0-9+/=]+"/.test(tag),
        `missing SRI integrity: ${tag}`);
      assert.ok(/crossorigin="anonymous"/.test(tag), `missing crossorigin: ${tag}`);
    }
  });

  test('external URLs are version-pinned, never a floating major', () => {
    for (const m of editorHtml.matchAll(/https:\/\/unpkg\.com\/([^"'\s]+)/g)) {
      assert.ok(/@\d+\.\d+\.\d+/.test(m[1]),
        `pin an exact version, got ${m[1]} — SRI on a floating range breaks on every release`);
    }
  });

  test('imports the shared validator rather than reimplementing it', () => {
    assert.ok(/from ['"]\.\/graph-core\.mjs['"]/.test(editorJs),
      'the editor must import graph-core.mjs — no second validator');
    assert.ok(/validateGraph/.test(editorJs));
  });

  test('posts to every server route it needs', () => {
    for (const route of ['/graph', '/state', '/action']) {
      assert.ok(editorJs.includes(route), `editor never calls ${route}`);
    }
  });

  test('renders 422 violations back to the user', () => {
    assert.ok(/422/.test(editorJs) && /violations/.test(editorJs),
      'a rejected save must show its reasons, not fail silently');
  });

  test('refuses to edit locked nodes', () => {
    assert.ok(/locked/.test(editorJs));
  });

  test('polls state for live mode and goes read-only during a run', () => {
    assert.ok(/setInterval/.test(editorJs));
    assert.ok(/readOnly|readonly/.test(editorJs));
  });

  test('the read-only transition re-renders, not just the version change', () => {
    // readOnly gates the Save button at click time, so saves are always refused during a
    // run. But draggable/deletable are computed in toFlow, which only re-runs when `tick`
    // changes — so rerender() must fire on the running/readOnly TRANSITION. Gating it on a
    // graph-version diff alone left the canvas looking editable during a run that hadn't
    // patched the graph yet.
    assert.ok(/if \(running !== readOnly\) \{ readOnly = running; rerender\(\); \}/.test(editorJs),
      'the readOnly transition must call rerender(), or the canvas keeps showing editable nodes');
  });

  test('fromFlow drops edges whose endpoints were deleted', () => {
    // Do not depend on React Flow cascading edge removal when a node is deleted. It
    // documents that it does, but nothing here can execute the UI to confirm it, and a
    // dangling edge would surface to the user as a confusing "edge from unknown node" 422.
    assert.ok(/\.filter\(\(fe\) => keep\.has\(fe\.source\) && keep\.has\(fe\.target\)\)/.test(editorJs),
      'fromFlow must filter edges against the surviving node set itself');
  });

  test('every dynamic value in renderPanel is escaped before innerHTML', () => {
    // Node ids and kinds come from a planner worker's graphPatch — LLM-generated text.
    // Unescaped, an id containing markup executes inside the page that IS the human
    // approval gate, with access to the loopback server. Escaping only `prompt` (an
    // earlier revision) left id and kind raw.
    const panel = editorJs.slice(editorJs.indexOf('function renderPanel'));
    const body = panel.slice(0, panel.indexOf('`;') + 2);
    const raw = [...body.matchAll(/\$\{([^}]+)\}/g)]
      .map((m) => m[1].trim())
      // A ternary emitting only fixed literals is not a dynamic value.
      .filter((e) => !/^locked \?/.test(e))
      .filter((e) => !/^esc\(/.test(e));
    assert.deepStrictEqual(raw, [],
      `unescaped interpolation(s) reaching innerHTML: ${JSON.stringify(raw)}`);
    assert.ok(/const esc = \(v\) =>/.test(editorJs), 'the esc() helper must exist');
    assert.ok(/replace\(\/&\/g, '&amp;'\)/.test(editorJs),
      'esc must escape & first, or the other replacements double-encode');
  });

  test('writes per-node visit caps into invariants, not onto the node', () => {
    assert.ok(/invariants\.visitCaps|visitCaps\[/.test(editorJs),
      'visit caps have exactly one home: invariants.visitCaps');
  });

  proc.kill();

  section('DoD check freezing');

  const FREEZE = path.join(__dirname, 'dod-freeze.mjs');
  const dodDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-dod-'));
  const dodPath = path.join(dodDir, 'dod.json');
  const checksDir = path.join(dodDir, 'checks');
  fs.writeFileSync(dodPath, JSON.stringify({ criteria: [
    { id: 'c1', text: 'callback rejects mismatched state', tier: 'checkable',
      script: '#!/usr/bin/env bash\nset -euo pipefail\nnpx vitest run auth/callback\n' },
    { id: 'c2', text: 'suite still passes', tier: 'checkable', baseline: 'green-ok',
      script: '#!/usr/bin/env bash\nset -euo pipefail\nnpm test\n' },
    { id: 'c3', text: 'error copy reads clearly', tier: 'judged' },
  ] }));
  execFileSync('node', [FREEZE, '--dod', dodPath, '--checks-dir', checksDir]);
  const frozen = JSON.parse(fs.readFileSync(dodPath, 'utf8'));

  test('each checkable criterion becomes a file on disk', () => {
    for (const id of ['c1', 'c2']) {
      assert.ok(fs.existsSync(path.join(checksDir, `${id}.sh`)), `${id}.sh not written`);
    }
  });

  test('check files are executable', () => {
    const mode = fs.statSync(path.join(checksDir, 'c1.sh')).mode;
    assert.ok(mode & 0o111, 'check file must be executable');
  });

  test('checkFile and checkSha replace the inline script', () => {
    const c1 = frozen.criteria.find((c) => c.id === 'c1');
    assert.ok(c1.checkFile.endsWith('c1.sh'));
    assert.ok(/^sha256:[0-9a-f]{64}$/.test(c1.checkSha));
    assert.strictEqual(c1.script, undefined, 'the inline script must be moved, not duplicated');
  });

  test('judged criteria are left alone', () => {
    const c3 = frozen.criteria.find((c) => c.id === 'c3');
    assert.strictEqual(c3.checkFile, undefined);
  });

  test('baseline defaults to "red" and green-ok is preserved', () => {
    assert.strictEqual(frozen.criteria.find((c) => c.id === 'c1').baseline, 'red');
    assert.strictEqual(frozen.criteria.find((c) => c.id === 'c2').baseline, 'green-ok');
  });

  test('a checkable criterion with no script is a hard error', () => {
    const bad = path.join(dodDir, 'bad.json');
    fs.writeFileSync(bad, JSON.stringify({ criteria: [
      { id: 'x', text: 'no script', tier: 'checkable' }] }));
    let threw = false;
    try { execFileSync('node', [FREEZE, '--dod', bad, '--checks-dir', checksDir],
      { stdio: 'pipe' }); } catch { threw = true; }
    assert.ok(threw);
  });

  section('DoD check verification');

  test('verifyChecks passes on untouched files', async () => {
    const m = await import('file://' + FREEZE);
    const r = m.verifyChecks(frozen, dodDir);
    assert.ok(r.every((x) => x.ok), JSON.stringify(r));
  });

  test('verifyChecks catches a weakened check', async () => {
    const m = await import('file://' + FREEZE);
    fs.writeFileSync(path.join(checksDir, 'c1.sh'), '#!/usr/bin/env bash\nexit 0\n');
    const r = m.verifyChecks(frozen, dodDir);
    const c1 = r.find((x) => x.id === 'c1');
    assert.strictEqual(c1.ok, false);
    assert.ok(/sha|hash|modified/i.test(c1.reason));
  });

  test('verifyChecks catches a deleted check', async () => {
    const m = await import('file://' + FREEZE);
    fs.unlinkSync(path.join(checksDir, 'c2.sh'));
    const c2 = m.verifyChecks(frozen, dodDir).find((x) => x.id === 'c2');
    assert.strictEqual(c2.ok, false);
    assert.ok(/missing/i.test(c2.reason));
  });

  section('DoDBaseline discrimination');

  test('the delivery seed hard-fails a baseline-green criterion', () => {
    const d = JSON.parse(fs.readFileSync(path.join(__dirname, 'seeds', 'delivery.json'), 'utf8'));
    const n = d.nodes.find((x) => x.id === 'DoDBaseline');
    assert.ok(/green-ok/.test(n.prompt),
      'the baseline node must know about the green-ok waiver');
    assert.ok(/cannot discriminate|hard failure|fail the run/i.test(n.prompt),
      'a baseline-green criterion without a waiver must be a hard failure, not a note');
  });

  test('the DoDGate prompt demands a hash check before running a check', () => {
    const d = JSON.parse(fs.readFileSync(path.join(__dirname, 'seeds', 'delivery.json'), 'utf8'));
    const n = d.nodes.find((x) => x.id === 'DoDGate');
    assert.ok(/checkSha|sha256/.test(n.prompt));
  });

  test('delivery: a non-discriminating baseline structurally stops the run', () => {
    const d = JSON.parse(fs.readFileSync(path.join(__dirname, 'seeds', 'delivery.json'), 'utf8'));
    const e = d.edges.find((x) => x.from === 'DoDBaseline' && x.to === 'Plan');
    assert.ok(e, 'DoDBaseline -> Plan edge missing');
    assert.deepStrictEqual(e.when, { field: 'discriminates', eq: true },
      'edge must require discriminates=true; unconditional edges leave reporting false consequence-free');
    assert.strictEqual(core.matches(e.when, { discriminates: true }), true);
    assert.strictEqual(core.matches(e.when, { discriminates: false }), false);
    assert.strictEqual(core.matches(e.when, {}), false, 'missing field must not match');
  });

  test('delivery: DoDGate can report TAMPERED distinctly from UNMET', () => {
    const d = JSON.parse(fs.readFileSync(path.join(__dirname, 'seeds', 'delivery.json'), 'utf8'));
    const gate = d.nodes.find((x) => x.id === 'DoDGate');
    const verdictEnum = gate.schema.properties.criteria.items.properties.verdict.enum;
    assert.ok(verdictEnum.includes('TAMPERED'), 'verdict enum must include TAMPERED');
    assert.ok(/TAMPERED/.test(gate.prompt), 'prompt must mention TAMPERED');
    assert.ok(/categorically different|distinguish/.test(gate.prompt),
      'prompt must explain why tampering is distinct from unmet');
    // Verify verdict is purely reporting: nothing routes on it
    for (const e of d.edges.filter((x) => x.from === 'DoDGate')) {
      assert.ok(!e.when || (!e.when.hasOwnProperty('verdict')),
        `no edge must route on verdict — only discriminates and passed`);
    }
    // Verify passed still drives routing
    const toImplement = d.edges.find((x) => x.from === 'DoDGate' && x.when && x.when.eq === false);
    const toPR = d.edges.find((x) => x.from === 'DoDGate' && x.when && x.when.eq === true);
    assert.ok(toImplement && toImplement.when.field === 'passed');
    assert.ok(toPR && toPR.when.field === 'passed');
  });

  section('resume + report');

  const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-run-'));
  fs.mkdirSync(path.join(runRoot, '.loom', 'state'), { recursive: true });
  // A run that went Implement -> Review(fail) -> Implement -> Review(pass) -> DoDGate(fail)
  // -> Implement, applying one accepted patch and rejecting one bypass along the way.
  const patched = core.applyPatchTo(seedGraph, {
    addNodes: [{ id: 'Spike', kind: 'work', prompt: 'investigate' }],
    addEdges: [{ from: 'Spike', to: 'Implement', when: 'always' }] });
  patched.edges.unshift({ from: 'Plan', to: 'Spike', when: 'always' });
  patched.version = 1;
  const runState = {
    workflow: 'demo', status: 'running', startedAt: '2026-07-27T00:00:00Z',
    graphVersion: 1, graph: patched, cursor: 'Implement',
    visits: { Setup: 1, Plan: 1, Spike: 1, Implement: 3, Review: 2, DoDGate: 1 },
    results: { 'Implement#3': { summary: 'third pass' } },
    carry: { Implement: { unmetCriteria: ['c3', 'c5'] } },
    trace: [
      { node: 'Review', visit: 1, verdict: false, to: 'Implement' },
      { node: 'Review', visit: 2, verdict: true, to: 'DoDGate' },
      { node: 'DoDGate', visit: 1, verdict: false, to: 'Implement' },
      { node: 'DoDGate', visit: 1, patch: 'rejected', violations: ['DoDGate no longer dominates Done'] },
      { node: 'Plan', visit: 1, patch: 'accepted', version: 1 },
    ],
    port: 3490,
  };
  fs.writeFileSync(path.join(runRoot, '.loom', 'state', 'demo.json'), JSON.stringify(runState, null, 2));

  const REPORT = path.join(__dirname, 'loom-report.cjs');
  const reportOut = execFileSync('node', [REPORT, 'demo'], { cwd: runRoot }).toString();

  test('report shows the revisit count', () => {
    assert.ok(/Implement.*3/.test(reportOut), 'the report must surface repeat visits');
  });

  test('report surfaces the rejected patch', () => {
    assert.ok(/rejected/i.test(reportOut) && /dominates/.test(reportOut));
  });

  test('report shows gate verdicts in order', () => {
    assert.ok(reportOut.indexOf('Review') < reportOut.indexOf('DoDGate'));
  });

  test('report shows the carried criteria', () => {
    assert.ok(/c3/.test(reportOut) && /c5/.test(reportOut));
  });

  test('resume args carry the PATCHED graph, not the seed', () => {
    // This is the failure the whole design hinges on: a resume that replays the
    // approved topology silently discards every runtime patch.
    const st = JSON.parse(fs.readFileSync(path.join(runRoot, '.loom', 'state', 'demo.json'), 'utf8'));
    assert.ok(st.graph.nodes.some((n) => n.id === 'Spike'),
      'state.graph must be the patched graph');
    assert.strictEqual(st.graph.version, 1);
  });

  test('the resumed cursor and visits round-trip', () => {
    const st = JSON.parse(fs.readFileSync(path.join(runRoot, '.loom', 'state', 'demo.json'), 'utf8'));
    assert.strictEqual(st.cursor, 'Implement');
    assert.strictEqual(st.visits.Implement, 3);
    assert.strictEqual(core.capFor(st.graph, 'Implement'), 4,
      'one visit left before the cap — a resume must not lose that');
  });

  const LIST = path.join(__dirname, 'list-runs.cjs');
  const listOut = execFileSync('node', [LIST], { cwd: runRoot }).toString();

  test('list-runs shows the run, status and cursor', () => {
    assert.ok(/demo/.test(listOut) && /running/.test(listOut) && /Implement/.test(listOut));
  });

  test('list-runs does not cry wolf about a running run\'s port', () => {
    // The fixture's run is `running` with a recorded port — that port is legitimate, not
    // stale. Warning on any port at all would put a "stale server" notice beside every
    // healthy run, and a warning that always fires teaches people to ignore it.
    assert.ok(!/stale editor server/.test(listOut),
      'a running run must not be reported as a stale server');

    // ...and a genuinely stale one must still be surfaced.
    const staleRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-stale-'));
    fs.mkdirSync(path.join(staleRoot, '.loom', 'state'), { recursive: true });
    fs.writeFileSync(path.join(staleRoot, '.loom', 'state', 'dead.json'), JSON.stringify({
      workflow: 'dead', status: 'failed', cursor: 'Implement', visits: { Implement: 1 }, port: 7391,
    }));
    const out = execFileSync('node', [LIST], { cwd: staleRoot }).toString();
    assert.ok(/stale editor server/.test(out) && /dead/.test(out) && /7391/.test(out),
      `a non-running run with a port must be flagged, got: ${out}`);
  });

  test('a corrupt state file reports readably, not as a stack trace', () => {
    // An operator hitting this is mid-incident. Compare against the missing-run path,
    // which already says "no such run: <path>" — a raw JSON parser dump is a regression
    // in usability from a sibling error path in the same script.
    const bad = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-bad-'));
    fs.mkdirSync(path.join(bad, '.loom', 'state'), { recursive: true });
    fs.writeFileSync(path.join(bad, '.loom', 'state', 'broken.json'), '{not json');
    let out = '';
    try { execFileSync('node', [REPORT, 'broken'], { cwd: bad, stdio: 'pipe' }); }
    catch (e) { out = (e.stderr || '').toString(); }
    assert.ok(/not readable JSON/.test(out), `expected a readable message, got: ${out}`);
    assert.ok(/broken/.test(out), 'the message must name the run');
    assert.ok(!/^\s+at /m.test(out), 'must not dump a stack trace at an operator');
  });

  test('list-runs surfaces an unreadable run instead of hiding it', () => {
    // Silently skipping an unparseable state file makes a BROKEN run invisible — the
    // listing reports "no loom runs" while something is in fact damaged. Lying by
    // omission is worse here than showing a row with an honest "UNREADABLE" status.
    const bad = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-bad2-'));
    fs.mkdirSync(path.join(bad, '.loom', 'state'), { recursive: true });
    fs.writeFileSync(path.join(bad, '.loom', 'state', 'broken.json'), '{not json');
    const out = execFileSync('node', [LIST], { cwd: bad }).toString();
    assert.ok(!/no loom runs/.test(out), 'a broken run must not read as "no runs"');
    assert.ok(/broken/.test(out) && /UNREADABLE/.test(out),
      `expected the run listed as UNREADABLE, got: ${out}`);
  });

  process.stdout.write(`\n${failures ? `${failures} FAILURE(S)` : 'all green'}\n`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
