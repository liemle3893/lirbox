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
      removeEdges: [{ from: 'DoDGate', to: 'Implement' }] });
    assert.ok(core.validateGraph(next, LOCKED, null).some(m => /locked/.test(m)));
  });

  test('REJECT: orphaning the terminal', () => {
    const next = core.applyPatchTo(LOCKED, {
      removeEdges: [{ from: 'DoDGate', to: 'PR' }] });
    const v = core.validateGraph(next, LOCKED, null);
    assert.ok(v.some(m => /unreachable|locked/.test(m)));
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

  const { execFileSync } = require('child_process');
  const fs = require('fs');
  const os = require('os');
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

    test(`${profile}: every out-edge of every mustCross gate is locked`, () => {
      for (const g of seed.invariants.mustCross) {
        const outEdges = seed.edges.filter((e) => e.from === g);
        for (const e of outEdges) {
          assert.ok(e.locked, `gate ${g} has an unlocked out-edge to ${e.to}`);
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

  process.stdout.write(`\n${failures ? `${failures} FAILURE(S)` : 'all green'}\n`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
