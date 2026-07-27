# loom — Graph Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `loom`, a new lirbox skill whose conductor interprets a node/edge **graph** instead of a fixed phase list — so a gate failure is an edge back to `Implement`, the graph can rewrite itself under invariants that keep every gate un-bypassable, and a human shapes it in a React Flow editor before launch.

**Architecture:** One pure-JS module (`graph-core.mjs`) holds all graph math — reachability, dominance, edge selection, patch validation. It is **imported** by the server and browser editor, and **inlined as source** into the generated conductor (which forbids `require`/`import`). A generator (`scaffold-loom.cjs`) emits a conductor that is a ~60-line interpreter loop over a graph spliced in as DATA. A zero-dep loopback HTTP server serves the editor and mediates the pre-flight comment→replan→approve loop.

**Tech Stack:** Node ≥18 (ESM + CJS, zero runtime deps), the Workflow tool, React Flow via CDN in the editor only.

**Spec:** `docs/specs/2026-07-27-loom-graph-runtime-design.md`

## Global Constraints

- **The generated conductor is a restricted layer: NO `fs`, `git`, `require(`, `import`, `Date.now()`, `Math.random()`, `crypto`.** Every side effect lives in an `agent()` worker prompt. `test-loom.cjs` enforces this with a string scan copied from `plugins/lirbox/skills/conductor/scripts/test-scaffold.cjs:109`.
- **Never hand-edit a generated loop script.** All changes go through `scaffold-loom.cjs` and are regenerated with `--force`.
- **`graph-core.mjs` is the single source of graph math.** The generator inlines it; the test net asserts the inlined copy is byte-identical to the module minus its final `export {...}` line. No second implementation may exist.
- **Zero runtime npm dependencies.** Node built-ins only (`http`, `fs`, `path`, `crypto` — the last only in server/worker code, never in the conductor).
- Runtime artifacts live in `.loom/` and are **gitignored**. Delivery artifacts under `docs/changes/**` remain the only committed exception.
- `graph.invariants.lockedHash` uses pure-JS FNV-1a — a **drift detector**, not a cryptographic guarantee. DoD `checkSha` uses real `sha256` computed by a worker.
- Every task ends with a green `node plugins/lirbox/skills/loom/scripts/test-loom.cjs`.

---

## File Structure

```
plugins/lirbox/skills/loom/
  SKILL.md                       Task 9   skill entry: triage, DoD, pre-flight, resume, finalize
  scripts/
    graph-core.mjs               Tasks 1-3  ALL graph math; inlined into the conductor
    scaffold-loom.cjs            Task 4   generator: graph JSON + inlined core -> .loom/<name>.js
    seeds/lite.json              Task 5   seed graph for the lite profile
    seeds/delivery.json          Task 5   seed graph for the delivery profile
    graph-server.mjs             Task 6   loopback HTTP: /graph /state /action
    editor/index.html            Task 7   React Flow editor shell
    editor/editor.js             Task 7   editor logic; imports graph-core.mjs
    prompts/*.txt                Task 4/8 worker prompt templates (data, never code)
    test-loom.cjs                Tasks 1-10  the regression net; grows every task
  references/
    graph-spec.md                Task 9   graph.json field reference
    invariants.md                Task 9   the dominance argument, written out
```

**Responsibility boundaries.** `graph-core.mjs` is pure and dependency-free so it can run in three hosts. `scaffold-loom.cjs` only emits text. `graph-server.mjs` only reads/writes files and validates. The editor only renders and posts. No file reaches into another's job.

---

### Task 1: Graph reachability and dominance

The safety heart of the design. Everything else depends on these two functions being right.

**Files:**
- Create: `plugins/lirbox/skills/loom/scripts/graph-core.mjs`
- Create: `plugins/lirbox/skills/loom/scripts/test-loom.cjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `outEdges(graph, from) -> Edge[]` — edges leaving `from`, in declaration order
  - `reachable(graph, from, skip) -> Set<string>` — node ids reachable from `from`, treating every id in the `skip` array as deleted
  - `dominates(graph, gate, target, from) -> boolean` — true when every path `from → target` crosses `gate`

- [ ] **Step 1: Write the failing tests**

Create `plugins/lirbox/skills/loom/scripts/test-loom.cjs`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node plugins/lirbox/skills/loom/scripts/test-loom.cjs
```

Expected: FAIL — `Cannot find module .../graph-core.mjs`.

- [ ] **Step 3: Write the minimal implementation**

Create `plugins/lirbox/skills/loom/scripts/graph-core.mjs`:

```js
/*
 * loom graph math — the SINGLE source of truth, with THREE consumers:
 *   1. the generated conductor  (INLINED as source: that layer forbids require/import)
 *   2. graph-server.mjs         (import)
 *   3. the browser editor       (import)
 *
 * Therefore this file must stay pure: no imports, no Node built-ins, no Date.now(),
 * no Math.random(), no crypto. Only function declarations, then a single trailing
 * `export { ... }` line — the generator strips exactly that last line when inlining,
 * and test-loom.cjs asserts the inlined copy matches byte-for-byte.
 */

function outEdges(graph, from) {
  const out = [];
  for (const e of graph.edges) if (e.from === from) out.push(e);
  return out;
}

// Node ids reachable from `from`, treating every id in `skip` as deleted.
// Iterative + visited-set, so cycles terminate rather than recurse forever.
function reachable(graph, from, skip) {
  const skipSet = new Set(skip || []);
  const seen = new Set();
  if (skipSet.has(from)) return seen;
  const stack = [from];
  while (stack.length) {
    const cur = stack.pop();
    if (seen.has(cur) || skipSet.has(cur)) continue;
    seen.add(cur);
    for (const e of outEdges(graph, cur)) if (!skipSet.has(e.to)) stack.push(e.to);
  }
  return seen;
}

// True when EVERY path from `from` to `target` crosses `gate`.
// Proof by deletion: remove the gate; if the target is still reachable, some path
// avoided it. O(V+E) per gate.
//
// This is the WHOLE definition. Do not add heuristics on top of it — in particular,
// do not restrict it to immediate predecessors of `target`: a gate two hops from the
// terminal (Review -> DoDGate -> PR) dominates just as strongly as one hop, and such
// a restriction makes every multi-hop gate report a false violation.
// Dominance is a property of the GRAPH, never of execution history. "This gate was
// already passed" is expressed by leaving it out of `unsatisfiedGates` at the call
// site (see validateGraph in Task 3) — never by weakening this function.
function dominates(graph, gate, target, from) {
  if (gate === target) return true;
  return !reachable(graph, from, [gate]).has(target);
}

export { outEdges, reachable, dominates };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node plugins/lirbox/skills/loom/scripts/test-loom.cjs
```

Expected: PASS — `all green` and exit 0. (For reference the suite has 13 tests at this point: 4 under `reachable`, 9 under `dominates` — but the exit code is the gate, not the count.)

- [ ] **Step 5: Commit**

```bash
git add plugins/lirbox/skills/loom/scripts/graph-core.mjs \
        plugins/lirbox/skills/loom/scripts/test-loom.cjs
git commit -m "feat(loom): graph reachability and gate dominance"
```

---

### Task 2: Edge selection, visit caps, carry

Turns a node's result into the next node. Pure data predicates — never `eval`.

**Files:**
- Modify: `plugins/lirbox/skills/loom/scripts/graph-core.mjs`
- Modify: `plugins/lirbox/skills/loom/scripts/test-loom.cjs`

**Interfaces:**
- Consumes: `outEdges` (Task 1).
- Produces:
  - `matches(pred, result) -> boolean` — evaluates one declarative edge predicate
  - `pickEdge(graph, from, result) -> Edge|null` — first matching out-edge, declaration order
  - `capFor(graph, id) -> number` — visit cap: per-node override, else `"*"`, else `3`
  - `carryFor(edge, result) -> object` — the `carry` fields lifted out of a result

- [ ] **Step 1: Write the failing tests**

Insert into `test-loom.cjs`, immediately before the `process.stdout.write(\`\n${failures ...` line:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node plugins/lirbox/skills/loom/scripts/test-loom.cjs
```

Expected: FAIL — `core.matches is not a function`.

- [ ] **Step 3: Write the minimal implementation**

In `graph-core.mjs`, add above the `export` line:

```js
// Declarative edge predicates. NEVER code strings — these travel through JSON,
// are edited in the browser, and are evaluated inside the restricted conductor
// layer, so `eval`/`new Function` are out of the question.
// Unknown shapes fail CLOSED: an unrecognised operator must not silently open a path.
function matches(pred, result) {
  if (pred === 'always' || pred === undefined || pred === null) return true;
  if (typeof pred !== 'object') return false;
  const v = result ? result[pred.field] : undefined;
  if ('eq' in pred) return v === pred.eq;
  if ('neq' in pred) return v !== pred.neq;
  if ('gt' in pred) return typeof v === 'number' && v > pred.gt;
  if ('lt' in pred) return typeof v === 'number' && v < pred.lt;
  if ('exists' in pred) return (v !== undefined && v !== null) === pred.exists;
  return false;
}

// First matching out-edge wins; declaration order IS the priority order.
function pickEdge(graph, from, result) {
  for (const e of outEdges(graph, from)) if (matches(e.when, result)) return e;
  return null;
}

// Visit caps live ONLY in invariants.visitCaps so the validator has one source
// to check. Per-node override, else the "*" default, else 3.
function capFor(graph, id) {
  const caps = (graph.invariants && graph.invariants.visitCaps) || {};
  if (Object.prototype.hasOwnProperty.call(caps, id)) return caps[id];
  if (Object.prototype.hasOwnProperty.call(caps, '*')) return caps['*'];
  return 3;
}

// Lift exactly the fields an edge declares — a back-edge feeds the failing gate's
// findings forward so the retry CONVERGES instead of restarting blind.
function carryFor(edge, result) {
  const out = {};
  for (const k of (edge && edge.carry) || []) {
    if (result && result[k] !== undefined) out[k] = result[k];
  }
  return out;
}
```

Replace the export line with:

```js
export { outEdges, reachable, dominates, matches, pickEdge, capFor, carryFor };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node plugins/lirbox/skills/loom/scripts/test-loom.cjs
```

Expected: PASS — every Task 1 test still green, plus the 15 new `matches`/`pickEdge`/`capFor`/`carryFor` tests. The gate is the final `all green` line and a zero exit code, not a specific total.

- [ ] **Step 5: Commit**

```bash
git add plugins/lirbox/skills/loom/scripts/graph-core.mjs \
        plugins/lirbox/skills/loom/scripts/test-loom.cjs
git commit -m "feat(loom): declarative edge predicates, visit caps, carry"
```

---

### Task 3: Patch application and validation

The rule that makes self-rewrite safe. A patch that would let the run reach the terminal without crossing a gate must be rejected.

**Files:**
- Modify: `plugins/lirbox/skills/loom/scripts/graph-core.mjs`
- Modify: `plugins/lirbox/skills/loom/scripts/test-loom.cjs`

**Interfaces:**
- Consumes: `reachable`, `dominates`, `capFor` (Tasks 1–2).
- Produces:
  - `stableStringify(value) -> string` — key-sorted JSON, so hashing is order-independent
  - `fnv1a(str) -> string` — 8-hex-char pure-JS digest
  - `lockedFingerprint(graph) -> string` — `"fnv1a:xxxxxxxx"` over the locked subgraph
  - `applyPatchTo(graph, patch) -> Graph` — pure; returns a NEW graph, never mutates
  - `validateGraph(next, prev, cursor) -> string[]` — violation messages; `[]` means valid

Patch shape: `{ addNodes?, removeNodes?, updateNodes?, addEdges?, removeEdges? }`.
Cursor shape: `{ node: string, unsatisfiedGates: string[] }` or `null` for pre-flight.

- [ ] **Step 1: Write the failing tests**

Insert into `test-loom.cjs` before the final `process.stdout.write` line:

```js
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
    // MIRROR THE SEEDS: only a gate's PASSING edge is locked. Locking failure edges here
    // too would make this fixture over-locked relative to reality, so a test asserting the
    // non-passing-edge rule could pass on a LOCK violation instead — staying green even if
    // that rule regressed. The fixture must have the same shape as what ships.
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
    // Target the PASSING edge — that is the locked one. Deleting the FAILURE edge is also
    // rejected, but by the non-passing-edge rule, which is a different test. Pointing this
    // one at the failure edge would let it pass even if the lock check regressed.
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
      // A MINTED pass edge must not earn the exemption. Testing `eq === true` alone
      // checks the predicate's VALUE and never its FIELD, so both of these would slip
      // through — including the one reusing the real field name. Only the edge LOCKED
      // at approval may lead onward.
      ['minted pass edge on an unrelated field', {
        addEdges: [{ from: 'DoDGate', to: 'PR', when: { field: 'anythingAtAll', eq: true } }],
      }],
      ['minted pass edge reusing the real field', {
        addEdges: [{ from: 'DoDGate', to: 'PR', when: { field: 'passed', eq: true } }],
      }],
    ]) {
      const v = core.validateGraph(core.applyPatchTo(LOCKED, patch), LOCKED, null);
      assert.ok(v.some((m) => /non-passing edge/.test(m)),
        `${label}: expected a non-passing-edge violation, got ${JSON.stringify(v)}`);
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
      assert.ok(!core.validateGraph(next, LOCKED, null).some((m) => /failure edge/.test(m)),
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

  test('ACCEPT: a gate already satisfied need not dominate from the cursor', () => {
    // Review passed; the cursor is downstream of it. Review no longer dominating
    // PR *from the cursor* is expected and must not be reported.
    const v = core.validateGraph(LOCKED, LOCKED,
      { node: 'DoDGate', unsatisfiedGates: [] });
    assert.deepStrictEqual(v, []);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node plugins/lirbox/skills/loom/scripts/test-loom.cjs
```

Expected: FAIL — `core.stableStringify is not a function`.

- [ ] **Step 3: Write the minimal implementation**

In `graph-core.mjs`, add above the `export` line:

```js
// Key-sorted JSON so a fingerprint depends on CONTENT, not on property order.
function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  return '{' + Object.keys(v).sort()
    .map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}

// FNV-1a, 32-bit. Pure JS because the conductor layer has no `crypto`.
// This is a DRIFT DETECTOR, not a security boundary: it catches a replanner
// quietly rewriting a locked gate, not an adversary hunting collisions.
// (DoD check files use real sha256 — computed by a worker, which has full tools.)
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return ('00000000' + h.toString(16)).slice(-8);
}

function lockedFingerprint(graph) {
  const nodes = graph.nodes.filter((n) => n.locked)
    .slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const edges = graph.edges.filter((e) => e.locked).slice()
    .sort((a, b) => {
      const x = stableStringify(a), y = stableStringify(b);
      return x < y ? -1 : x > y ? 1 : 0;
    });
  return 'fnv1a:' + fnv1a(stableStringify({ nodes, edges }));
}

// PURE: deep-clones, applies, returns a new graph. Order matters —
// removals first, then updates, then additions, so a patch can replace a node
// id in one step without colliding with itself.
function applyPatchTo(graph, patch) {
  const g = JSON.parse(JSON.stringify(graph));
  const p = patch || {};

  // Patch fields arrive as JSON produced by a worker or a browser. A non-array here (a
  // bare string, say) would be iterated character-by-character by for...of, manufacturing
  // garbage entries. Anything that isn't an array becomes empty.
  const arr = (x) => (Array.isArray(x) ? x : []);
  // Every value taken FROM the patch is deep-cloned on the way in. A shallow merge leaves
  // the returned graph aliasing the caller's patch object, so a caller that later reuses
  // or mutates that object would silently mutate an already-approved graph without it
  // ever passing back through validateGraph.
  const clone = (x) => JSON.parse(JSON.stringify(x));

  const rmN = new Set(arr(p.removeNodes));
  if (rmN.size) {
    g.nodes = g.nodes.filter((n) => !rmN.has(n.id));
    g.edges = g.edges.filter((e) => !rmN.has(e.from) && !rmN.has(e.to));
  }
  const rmE = new Set(arr(p.removeEdges).map((e) => e.from + ' ' + e.to));
  if (rmE.size) g.edges = g.edges.filter((e) => !rmE.has(e.from + ' ' + e.to));

  for (const u of arr(p.updateNodes)) {
    const i = g.nodes.findIndex((n) => n.id === u.id);
    if (i >= 0) g.nodes[i] = Object.assign({}, g.nodes[i], clone(u));
  }
  for (const n of arr(p.addNodes)) g.nodes.push(clone(n));
  for (const e of arr(p.addEdges)) g.edges.push(clone(e));
  return g;
}

// Returns violation messages; [] means the graph is acceptable.
// `prev` supplies the frozen lockedHash (null pre-approval).
// `cursor` = { node, unsatisfiedGates } during a run, null pre-flight.
function validateGraph(next, prev, cursor) {
  const v = [];
  const ids = next.nodes.map((n) => n.id);
  const idSet = new Set(ids);

  const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dup.length) v.push('duplicate node id: ' + [...new Set(dup)].join(', '));

  for (const e of next.edges) {
    if (!idSet.has(e.from)) v.push('edge from unknown node: ' + e.from);
    if (!idSet.has(e.to)) v.push('edge to unknown node: ' + e.to);
  }

  if (!idSet.has(next.start)) v.push('start node missing: ' + next.start);
  if (!idSet.has(next.terminal)) v.push('terminal node missing: ' + next.terminal);

  // INVARIANTS ARE THE APPROVED CONTRACT — they are read from `prev`, never from the
  // graph being validated. Reading them from `next` is a full bypass: a caller submits
  // a graph declaring `mustCross: []` plus an unlocked Implement -> terminal edge, the
  // locked fingerprint is untouched (that edge isn't locked), zero dominance checks run,
  // and validation returns []. The run then walks straight past every gate.
  // `next.invariants` governs ONLY pre-approval, when there is no prior graph yet.
  const inv = (prev && prev.invariants) ? prev.invariants : (next.invariants || {});

  // And say so out loud, so a UI that drifts them gets a readable error rather than
  // silently having its edits ignored.
  if (prev && prev.invariants
      && stableStringify(next.invariants || {}) !== stableStringify(prev.invariants)) {
    v.push('invariants were modified — they are frozen at approval');
  }

  if (inv.nodeBudget && ids.length > inv.nodeBudget) {
    v.push('node budget exceeded: ' + ids.length + ' > ' + inv.nodeBudget);
  }

  const lockedHash = prev && prev.invariants && prev.invariants.lockedHash;
  if (lockedHash && lockedFingerprint(next) !== lockedHash) {
    v.push('locked nodes/edges were modified or removed');
  }

  // Everything below needs a well-formed skeleton; bail out rather than
  // pile confusing secondary errors onto a graph that is already broken.
  if (!idSet.has(next.start) || !idSet.has(next.terminal)) return v;

  const live = reachable(next, next.start, []);
  if (!live.has(next.terminal)) {
    v.push('terminal ' + next.terminal + ' unreachable from ' + next.start);
  }
  const orphans = ids.filter((id) => !live.has(id));
  if (orphans.length) v.push('orphaned node(s): ' + orphans.join(', '));

  // A reachable non-terminal node with no outgoing edge is a dead end — the interpreter
  // would arrive there with nowhere legal to go and (correctly) throw at runtime. Catch
  // it here instead, before a run ever starts.
  const deadEnds = ids.filter((id) => id !== next.terminal && live.has(id)
    && outEdges(next, id).length === 0);
  if (deadEnds.length) {
    v.push('dead-end node(s) with no outgoing edge: ' + deadEnds.join(', '));
  }

  // Structural dominance — from `start`, over EVERY declared gate. Position-independent,
  // so it holds for the whole run and cannot be invalidated by later progress.
  for (const gate of inv.mustCross || []) {
    if (!idSet.has(gate)) { v.push('mustCross node missing: ' + gate); continue; }
    if (!dominates(next, gate, next.terminal, next.start)) {
      v.push(gate + ' no longer dominates ' + next.terminal);
    }
  }

  // Positional dominance — from the CURSOR, over gates not yet satisfied.
  // Required because a back-edge admits start -> DoDGate -> Implement -> terminal:
  // structurally dominated, yet the remaining path never re-crosses the failed gate.
  // ONLY a gate's PASSING edge may lead onward. Every other edge out of a gate must
  // return through that gate.
  //
  // Structural dominance proves every path VISITS a gate. It does NOT prove a gate was
  // SATISFIED: `DoDGate --fail--> Done` puts DoDGate on every path and still reaches the
  // terminal with the gate failing. In `lite` this made the verdict fully inert —
  // pickEdge returned `Done` for BOTH {passed:true} and {passed:false}.
  //
  // The rule must cover EVERY non-passing edge, not just `eq:false` ones. An appended
  // `when:"always"` edge is the same bypass wearing a different predicate: pickEdge takes
  // the first match, so pass/fail still route correctly, but every OFF-SHAPE result
  // ({passed:'yes'}, {}, null) falls through to it — which also defeats Task 4's
  // hard-fail, because an edge did match and pickEdge never returns null.
  //
  // Permits all legitimate reshaping (splice a Spike in, loop back to Plan, self-loop
  // bounded by visitCaps); forbids exactly the shape where not-passing leads forward.
  //
  // This is a VALIDATION rule, not a locking rule. Locking these edges instead would
  // silently shadow spliced nodes — applyPatchTo appends and pickEdge takes the first
  // match, so a parallel edge validates and is never selected.
  for (const gate of inv.mustCross || []) {
    if (!idSet.has(gate)) continue;
    for (const e of next.edges) {
      if (e.from !== gate) continue;
      // ONLY THE LOCKED passing edge is exempt. Testing `eq === true` alone is not
      // enough: it checks the VALUE of the predicate and never which FIELD it reads, so
      // a patch could mint `{field:'anythingAtAll', eq:true}` — or even reuse the real
      // field name — and have it exempted. Requiring `locked` ties the exemption to the
      // edge frozen at approval: a minted edge cannot carry `locked: true`, because
      // adding one changes lockedFingerprint and the lock check rejects it.
      if (e.locked && e.when && e.when.eq === true) continue;
      if (!idSet.has(e.to)) continue;
      if (!dominates(next, gate, next.terminal, e.to)) {
        v.push(gate + ' non-passing edge -> ' + e.to + ' can reach ' + next.terminal
          + ' without re-crossing ' + gate);
      }
    }
  }

  if (cursor && cursor.node) {
    // FAIL CLOSED. A cursor node missing from `next` is not "nothing to check" — it is the
    // patch erasing the very identity this check needs. Rename the node the run is standing
    // on (same shape, same reachability, nothing locked touched) and a permissive guard
    // skips positional dominance entirely, letting the run's real position reach the
    // terminal without recrossing the gate that just failed. Structural dominance does NOT
    // catch it, because renaming a mid-graph node leaves every path from `start` intact.
    if (!idSet.has(cursor.node)) {
      v.push('cursor node ' + cursor.node + ' was removed by this patch — a run may not '
        + 'delete or rename the node it is currently executing');
    } else {
      for (const gate of cursor.unsatisfiedGates || []) {
        if (!idSet.has(gate)) continue;
        if (!dominates(next, gate, next.terminal, cursor.node)) {
          v.push(gate + ' is unsatisfied but no longer dominates ' + next.terminal
            + ' from ' + cursor.node);
        }
      }
    }
  }
  return v;
}
```

Replace the export line with:

```js
export { outEdges, reachable, dominates, matches, pickEdge, capFor, carryFor, stableStringify, fnv1a, lockedFingerprint, applyPatchTo, validateGraph };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node plugins/lirbox/skills/loom/scripts/test-loom.cjs
```

Expected: PASS — `all green`, zero exit. Every malicious-patch fixture rejected and both ACCEPT fixtures clean; those are the assertions that matter, not the running total.

- [ ] **Step 5: Commit**

```bash
git add plugins/lirbox/skills/loom/scripts/graph-core.mjs \
        plugins/lirbox/skills/loom/scripts/test-loom.cjs
git commit -m "feat(loom): patch application and invariant validation"
```

---

### Task 4: The generator and the interpreter

Emits `.loom/<name>.js` — a Workflow script that is a graph interpreter with `graph-core` inlined.

**Files:**
- Create: `plugins/lirbox/skills/loom/scripts/scaffold-loom.cjs`
- Create: `plugins/lirbox/skills/loom/scripts/prompts/checkpoint.txt`
- Create: `plugins/lirbox/skills/loom/scripts/prompts/node-lead.txt`
- Modify: `plugins/lirbox/skills/loom/scripts/test-loom.cjs`

**Interfaces:**
- Consumes: `graph-core.mjs` (read as text and inlined; not imported).
- Produces:
  - CLI: `node scaffold-loom.cjs --name <n> --graph <graph.json> [--out <path>] [--force]`
  - `inlineCore(srcText) -> string` — strips the trailing `export {...}` line
  - Emitted file at `.loom/<name>.js`

- [ ] **Step 1: Write the failing tests**

Insert into `test-loom.cjs` before the final `process.stdout.write` line:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node plugins/lirbox/skills/loom/scripts/test-loom.cjs
```

Expected: FAIL — `Cannot find module .../scaffold-loom.cjs`.

- [ ] **Step 3: Write the minimal implementation**

Create `plugins/lirbox/skills/loom/scripts/prompts/node-lead.txt`:

```
You are working inside the shared worktree ${WORKTREE} on branch ${BRANCH}.
Do every edit there. Never touch the main checkout.

NODE: ${nodeId}   (visit ${visit} of at most ${cap})
${carryText}

${nodePrompt}

If — and only if — the work you just did proves this graph's shape is wrong, you MAY
return a "graphPatch" alongside your result:
  { addNodes, removeNodes, updateNodes, addEdges, removeEdges }
Locked nodes and edges cannot be changed, and no patch may let any path reach
${terminal} without crossing every gate. An invalid patch is rejected and logged;
it does not fail the run. Do not propose one merely to skip work you find hard.
```

Create `plugins/lirbox/skills/loom/scripts/prompts/checkpoint.txt`:

```
Persist loom run state so a future session can resume this run exactly.

Write this JSON to .loom/state/${name}.json in the MAIN repo checkout (not the
worktree), creating directories as needed. MERGE with any existing file, preserving
"startedAt". Write the whole object — the "graph" field is the PATCHED graph, and a
resume that replays the original topology is the worst failure this system has.

${payload}
```

Create `plugins/lirbox/skills/loom/scripts/scaffold-loom.cjs`:

```js
#!/usr/bin/env node
/*
 * Generator for loom conductors.
 *
 *   node scaffold-loom.cjs --name <name> --graph <graph.json> [--out <path>] [--force]
 *
 * Emits a Workflow script that is a GRAPH INTERPRETER: the graph travels as DATA and
 * graph-core.mjs is INLINED as source, because the generated conductor is a restricted
 * layer with no module loader and no fs/git/crypto/clock. Never hand-edit the output —
 * change this generator and regenerate with --force.
 */
const fs = require('fs');
const path = require('path');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return dflt;
  const next = process.argv[i + 1];
  return (next === undefined || next.startsWith('--')) ? true : next;
}
function die(msg) { console.error('ERROR: ' + msg); process.exit(1); }

const name = arg('name', '');
const graphPath = arg('graph', '');
const force = arg('force', false) === true;
if (!name || name === true) die('--name is required');
if (!graphPath || graphPath === true) die('--graph <graph.json> is required');
const outPath = arg('out', path.join('.loom', name + '.js'));

let graph;
try { graph = JSON.parse(fs.readFileSync(graphPath, 'utf8')); }
catch (e) { die('--graph not readable or not valid JSON: ' + e.message); }

// Strip the single trailing `export { ... };` line. The test net asserts the
// remainder appears verbatim in the emitted file, so there is exactly one
// implementation of the graph math in the repo.
function inlineCore(srcText) {
  return srcText.replace(/^export \{[^}]*\};?\s*$/m, '').trimEnd();
}
const corePath = path.join(__dirname, 'graph-core.mjs');
const coreSrc = inlineCore(fs.readFileSync(corePath, 'utf8'));

// Validate the graph with the same code the conductor will use, so a graph that
// violates its own invariants can never reach a run.
(async () => {
  const core = await import('file://' + corePath);
  const violations = core.validateGraph(graph, graph, null);
  if (violations.length) {
    die('graph violates its own invariants:\n  - ' + violations.join('\n  - '));
  }

  if (fs.existsSync(outPath) && !force) {
    die(outPath + ' exists — pass --force to overwrite (never hand-edit generated scripts)');
  }

  const tpl = (f) => fs.readFileSync(path.join(__dirname, 'prompts', f), 'utf8');
  // Escape a prompt template for embedding in an emitted template literal.
  // Escaping the dollar-brace sequence is NOT optional. Prompt templates contain literal
  // placeholder markers that are substituted at RUNTIME. Left unescaped they become real
  // interpolations in the generated script — which still PARSES, so `node --check` passes
  // and the restricted-layer scan passes, and then the conductor throws
  // "ReferenceError: nodeId is not defined" the first time a workflow actually runs.
  const esc = (s) => s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');

  // NOTE: the matching `sub()` helper is emitted INTO the conductor (see the generated
  // source below), because substitution happens at conductor runtime with runtime values.

  // meta MUST be a pure literal. It lists the APPROVED nodes; nodes added by a
  // runtime patch simply get their own progress group from the Workflow engine.
  const phaseLines = graph.nodes
    .filter((n) => n.id !== graph.terminal)
    .map((n) => `    { title: '${n.id}', detail: '${(n.kind || 'work')} node' },`)
    .join('\n');

  const src = `export const meta = {
  name: ${JSON.stringify('loom-' + name)},
  description: ${JSON.stringify((graph.goal || name).slice(0, 160))},
  phases: [
${phaseLines}
  ],
}

// ============================ graph-core (INLINED) ============================
// Source of truth: plugins/lirbox/skills/loom/scripts/graph-core.mjs
// Inlined because this layer has no module loader. test-loom.cjs asserts this
// block matches the module byte-for-byte — edit the module, regenerate, never
// patch it here.
${coreSrc}
// ========================== end graph-core (INLINED) ==========================

const NAME = ${JSON.stringify(name)}
const WORKTREE = ${JSON.stringify('.worktrees/' + name)}
const BRANCH = ${JSON.stringify('wf/' + name)}
const GRAPH_V0 = ${JSON.stringify(graph, null, 2).replace(/\n/g, '\n')}

// Resume restores STRUCTURE (the patched graph), not just progress.
let graph   = (args && args.graph)   ? args.graph   : GRAPH_V0
let visits  = (args && args.visits)  ? args.visits  : {}
let results = (args && args.results) ? args.results : {}
let carry   = (args && args.carry)   ? args.carry   : {}
let trace   = (args && args.trace)   ? args.trace   : []
let node    = (args && args.cursor)  ? args.cursor  : graph.start

// Substitute placeholder markers in a prompt template.
// split/join, NOT String.replace: replace() with a string pattern swaps only the FIRST
// occurrence, and expands special replacement patterns (dollar-ampersand, dollar-backtick,
// dollar-quote, dollar-digit) found in the REPLACEMENT — so a node prompt or a JSON
// payload containing one would be silently corrupted or splice in unrelated text.
function sub(text, vars) {
  let out = text
  for (const k of Object.keys(vars)) {
    const v = vars[k] === undefined || vars[k] === null ? '' : String(vars[k])
    out = out.split('\${' + k + '}').join(v)
  }
  return out
}

// A gate is "satisfied" once its most recent visit returned passed === true.
function unsatisfiedGates() {
  const out = []
  for (const g of (graph.invariants && graph.invariants.mustCross) || []) {
    let last = null
    for (const t of trace) if (t.node === g && t.verdict !== undefined) last = t.verdict
    if (last !== true) out.push(g)
  }
  return out
}

async function checkpoint(cursor) {
  const payload = JSON.stringify({
    workflow: NAME, status: 'running', graphVersion: graph.version || 0,
    graph, cursor, visits, results, carry, trace,
  }, null, 2)
  await agent(
    sub(\`${esc(tpl('checkpoint.txt'))}\`, { name: NAME, payload }),
    { label: 'checkpoint:' + cursor, phase: 'Checkpoint' },
  )
}

while (node && node !== graph.terminal) {
  const n = graph.nodes.find((x) => x.id === node)
  if (!n) throw new Error('unknown node: ' + node)

  const visit = (visits[node] || 0) + 1
  const cap = capFor(graph, node)
  if (visit > cap) {
    throw new Error('visit cap exceeded at ' + node + ' (' + visit + ' > ' + cap + ')')
  }
  visits[node] = visit

  phase(node)
  const key = node + '#' + visit
  let r
  if (results[key] !== undefined) {
    log(key + ' already complete (resumed)')
    r = results[key]
  } else {
    const carryIn = carry[node] || {}
    const carryText = Object.keys(carryIn).length
      ? 'CARRIED FORWARD from the edge that sent you here:\\n' + JSON.stringify(carryIn, null, 2)
      : ''
    const prompt = sub(\`${esc(tpl('node-lead.txt'))}\`, {
      WORKTREE, BRANCH, nodeId: node, visit: String(visit), cap: String(cap),
      carryText, nodePrompt: n.prompt || '', terminal: graph.terminal })
    r = await agent(prompt, {
      label: key, phase: node,
      ...(n.agentType ? { agentType: n.agentType } : {}),
      ...(n.model ? { model: n.model } : {}),
      ...(n.schema ? { schema: n.schema } : {}),
    })
    results[key] = r
  }

  if (r && r.graphPatch) {
    const next = applyPatchTo(graph, r.graphPatch)
    const viol = validateGraph(next, graph, { node, unsatisfiedGates: unsatisfiedGates() })
    if (viol.length) {
      log('patch REJECTED at ' + node + ': ' + viol.join('; '))
      trace.push({ node, visit, patch: 'rejected', violations: viol })
    } else {
      graph = next
      graph.version = (graph.version || 0) + 1
      log('patch accepted at ' + node + ' -> graph v' + graph.version)
      trace.push({ node, visit, patch: 'accepted', version: graph.version })
    }
  }

  // NO SILENT FALLBACK TO THE TERMINAL. pickEdge returns null when no declared
  // predicate matches the result, and predicates compare with ===. Routing to
  // graph.terminal in that case skips EVERY remaining gate — no patch and no
  // adversary required, just an agent returning {passed:'true'} instead of
  // {passed:true}, or omitting the field, or returning null. Six of eight
  // plausible off-shape results reached the terminal this way. The graph is
  // un-bypassable by construction (Task 3); the walk of it must be too.
  const edge = pickEdge(graph, node, r)
  if (!edge) {
    throw new Error('no edge matched at ' + node + ' for result '
      + JSON.stringify(r) + ' — refusing to advance. Routing onward from an '
      + 'unmatched result would skip every remaining gate. Fix the node schema '
      + 'or add an explicit fallthrough edge (when: "always") to this node.')
  }
  const nextNode = edge.to
  carry[nextNode] = carryFor(edge, r)
  trace.push({ node, visit, verdict: r ? r.passed : undefined, to: nextNode })

  await checkpoint(nextNode)
  node = nextNode
}

return { graph, visits, results, carry, trace, cursor: graph.terminal }
`;

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, src);
  process.stdout.write(`Wrote ${outPath}\n`);
  process.stdout.write(`Nodes: ${graph.nodes.map((n) => n.id).join(' -> ')}\n`);
})();
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node plugins/lirbox/skills/loom/scripts/test-loom.cjs
```

Expected: PASS — all prior tests plus 14 generator tests, `all green`. In particular `node --check` succeeds and every `FORBIDDEN` pattern is absent.

- [ ] **Step 5: Commit**

```bash
git add plugins/lirbox/skills/loom/scripts/scaffold-loom.cjs \
        plugins/lirbox/skills/loom/scripts/prompts/ \
        plugins/lirbox/skills/loom/scripts/test-loom.cjs
git commit -m "feat(loom): generator emitting a graph interpreter with inlined core"
```

---

### Task 5: Seed graphs for the lite and delivery profiles

What the human sees before the bootstrap planner has touched anything.

**Files:**
- Create: `plugins/lirbox/skills/loom/scripts/seeds/lite.json`
- Create: `plugins/lirbox/skills/loom/scripts/seeds/delivery.json`
- Modify: `plugins/lirbox/skills/loom/scripts/test-loom.cjs`

**Interfaces:**
- Consumes: the graph schema (Task 3), `validateGraph`.
- Produces: two seed graphs, each valid against `validateGraph(seed, seed, null)`.

- [ ] **Step 1: Write the failing tests**

Insert into `test-loom.cjs` before the final `process.stdout.write` line:

```js
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
      // The rule, and why it is asymmetric:
      //
      // The PASSING edge is what carries the run onward past the gate. Tampering with it
      // — rerouting it at the terminal, or loosening its predicate to "always" — is the
      // actual bypass. It must be locked.
      //
      // The FAILURE edge must stay UNLOCKED, because reshaping where a failing gate sends
      // the run is the self-modification loom exists for. The spec's own worked example
      // splices a Spike node into the failure path. Locking that edge does not merely
      // forbid the splice — `applyPatchTo` appends, and `pickEdge` takes the FIRST match,
      // so a parallel fail-edge added alongside a locked one VALIDATES and is then
      // silently shadowed. A patch that appears to succeed and does nothing is worse than
      // one that is rejected.
      //
      // Rerouting a failure edge is bounded anyway: dominance still forces every path to
      // cross the gate, and visit caps bound the looping.
      for (const gate of seed.invariants.mustCross) {
        const out = seed.edges.filter((e) => e.from === gate);
        assert.ok(out.length > 0, `${gate} has no out-edges`);
        const pass = out.filter((e) => e.when && e.when.eq === true);
        const fail = out.filter((e) => e.when && e.when.eq === false);
        assert.ok(pass.length > 0, `${gate} has no passing edge`);
        for (const e of pass) {
          assert.ok(e.locked, `${gate} -> ${e.to} is the PASSING edge and must be locked`);
        }
        for (const e of fail) {
          assert.ok(!e.locked,
            `${gate} -> ${e.to} is the FAILURE edge and must stay unlocked so the failure ` +
            'path can be reshaped; locking it silently shadows any spliced node');
        }
      }
    });

    test(`${profile}: a node can be spliced into a gate's failure path AND is reachable`, () => {
      // The spec's worked example. Validating is not enough — the spliced node must
      // actually be selected on failure, or the patch is an accepted no-op.
      const gate = seed.invariants.mustCross[seed.invariants.mustCross.length - 1];
      const failEdge = seed.edges.find((e) => e.from === gate && e.when && e.when.eq === false);
      const spliced = core.applyPatchTo(seed, {
        removeEdges: [{ from: gate, to: failEdge.to }],
        addNodes: [{ id: 'Spike', kind: 'work', prompt: 'investigate' }],
        addEdges: [{ from: gate, to: 'Spike', when: { field: 'passed', eq: false },
                     carry: failEdge.carry || [] },
                   { from: 'Spike', to: failEdge.to, when: 'always' }],
      });
      assert.deepStrictEqual(core.validateGraph(spliced, seed, null), [],
        'splicing a node into the failure path must be accepted');
      const chosen = core.pickEdge(spliced, gate, { passed: false });
      assert.strictEqual(chosen && chosen.to, 'Spike',
        'the spliced node must actually be reached on failure, not shadowed');
      assert.ok(core.dominates(spliced, gate, spliced.terminal, spliced.start),
        'the gate must still dominate the terminal after the splice');
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

  test('delivery: DoDGate can report TAMPERED distinctly from UNMET', () => {
    // A tampered check and an unimplemented criterion produced the IDENTICAL signal
    // (passed:false -> retry), yet they need opposite operator responses: a retry is
    // exactly right for unmet work and can never fix a check someone edited. This does
    // not change routing — nothing routes on `verdict` — it makes the distinction
    // visible in the trace instead of hiding it among ordinary failures.
    const seed = JSON.parse(fs.readFileSync(
      path.join(__dirname, 'seeds', 'delivery.json'), 'utf8'));
    const gate = seed.nodes.find((n) => n.id === 'DoDGate');
    const verdicts = gate.schema.properties.criteria.items.properties.verdict.enum;
    assert.ok(verdicts.includes('TAMPERED'),
      `DoDGate must be able to report TAMPERED, got ${JSON.stringify(verdicts)}`);
    assert.ok(/TAMPERED/.test(gate.prompt),
      'the prompt must tell the worker when to use it');

    // Adding an enum value must not have changed how the gate routes.
    const fields = new Set(seed.edges.filter((e) => e.when && e.when.field)
      .map((e) => e.when.field));
    assert.ok(!fields.has('verdict'),
      'verdict must stay a reporting field, never a routing one');
    assert.strictEqual(core.pickEdge(seed, 'DoDGate', { passed: true }).to, 'PR');
    assert.strictEqual(core.pickEdge(seed, 'DoDGate', { passed: false }).to, 'Implement');
  });

  test('delivery: a non-discriminating baseline structurally stops the run', () => {
    // The DoDBaseline prompt tells a worker that a baseline-red criterion already MET
    // cannot discriminate this run. That instruction needs a mechanism: with an
    // unconditional out-edge, a worker honestly reporting discriminates:false routed
    // straight to Plan and the run continued. Gating the edge means a false result
    // matches NO edge, which the interpreter treats as a hard failure (Task 4).
    // Prose is not enforcement; the graph is.
    const seed = JSON.parse(fs.readFileSync(
      path.join(__dirname, 'seeds', 'delivery.json'), 'utf8'));
    const out = seed.edges.filter((e) => e.from === 'DoDBaseline');
    assert.strictEqual(out.length, 1, 'DoDBaseline should have exactly one out-edge');
    assert.deepStrictEqual(out[0].when, { field: 'discriminates', eq: true },
      'DoDBaseline must only advance when the baseline actually discriminates');

    assert.strictEqual(core.pickEdge(seed, 'DoDBaseline', { discriminates: true }).to, 'Plan');
    assert.strictEqual(core.pickEdge(seed, 'DoDBaseline', { discriminates: false }), null,
      'discriminates:false must match no edge so the interpreter hard-fails');
    assert.strictEqual(core.pickEdge(seed, 'DoDBaseline', { baselines: [] }), null,
      'a result omitting discriminates must not advance either');
  });

  test('delivery carries a DoDGate and lite does not require one', () => {
    const d = JSON.parse(fs.readFileSync(path.join(__dirname, 'seeds', 'delivery.json'), 'utf8'));
    assert.ok(d.invariants.mustCross.includes('DoDGate'));
  });
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node plugins/lirbox/skills/loom/scripts/test-loom.cjs
```

Expected: FAIL — `ENOENT: .../seeds/lite.json`.

- [ ] **Step 3: Write the seeds**

Create `plugins/lirbox/skills/loom/scripts/seeds/lite.json`:

```json
{
  "version": 0,
  "start": "Setup",
  "terminal": "Done",
  "nodes": [
    { "id": "Setup", "kind": "work",
      "prompt": "Create or reuse the git worktree and branch for this run. Report the paths.",
      "model": "haiku",
      "schema": { "type": "object", "additionalProperties": false,
        "required": ["worktree", "branch"],
        "properties": { "worktree": { "type": "string" }, "branch": { "type": "string" } } } },

    { "id": "Plan", "kind": "plan",
      "prompt": "Read the repository and decide this run's decomposition. Return a graphPatch that adds the work nodes you need between Plan and Review, with their dependency edges.",
      "schema": { "type": "object", "required": ["summary"],
        "properties": { "summary": { "type": "string" }, "graphPatch": { "type": "object" } } } },

    { "id": "Implement", "kind": "work",
      "prompt": "Implement the goal in the worktree. Commit your work on the branch.",
      "schema": { "type": "object", "additionalProperties": false,
        "required": ["summary"], "properties": { "summary": { "type": "string" },
          "files": { "type": "array", "items": { "type": "string" } } } } },

    { "id": "Review", "kind": "gate", "locked": true,
      "prompt": "Review the diff on this branch for correctness, security and convention violations. Fix every Critical and High finding, keep the build green, and commit. Report passed=true only when nothing Critical or High is left UNRESOLVED, and only after actually running the build.",
      "schema": { "type": "object", "additionalProperties": false,
        "required": ["passed", "buildExit"],
        "properties": { "passed": { "type": "boolean" }, "buildExit": { "type": "number" },
          "findings": { "type": "array", "items": { "type": "string" } } } } },

    { "id": "Done", "kind": "terminal" }
  ],
  "edges": [
    { "from": "Setup", "to": "Plan", "when": "always" },
    { "from": "Plan", "to": "Implement", "when": "always" },
    { "from": "Implement", "to": "Review", "when": "always" },
    { "from": "Review", "to": "Implement", "when": { "field": "passed", "eq": false },
      "carry": ["findings"] },
    { "from": "Review", "to": "Done", "when": { "field": "passed", "eq": true },
      "locked": true }
  ],
  "invariants": {
    "mustCross": ["Review"],
    "visitCaps": { "*": 3, "Implement": 4 },
    "nodeBudget": 20,
    "lockedHash": "REPLACE_ME"
  }
}
```

Create `plugins/lirbox/skills/loom/scripts/seeds/delivery.json` — the same shape plus DoD and PR:

```json
{
  "version": 0,
  "start": "Setup",
  "terminal": "Done",
  "nodes": [
    { "id": "Setup", "kind": "work",
      "prompt": "Create or reuse the git worktree and branch for this run. Report the paths.",
      "model": "haiku",
      "schema": { "type": "object", "additionalProperties": false,
        "required": ["worktree", "branch"],
        "properties": { "worktree": { "type": "string" }, "branch": { "type": "string" } } } },

    { "id": "DoDBaseline", "kind": "work",
      "prompt": "Run every checkable DoD criterion's check FILE against the worktree BEFORE any work, and record met/unmet/error per criterion. Measure only — fix nothing.",
      "model": "haiku",
      "schema": { "type": "object", "additionalProperties": false, "required": ["baselines"],
        "properties": { "baselines": { "type": "array", "items": { "type": "object",
          "additionalProperties": false, "required": ["id", "status"],
          "properties": { "id": { "type": "string" },
            "status": { "type": "string", "enum": ["met", "unmet", "error"] } } } } } } },

    { "id": "Plan", "kind": "plan",
      "prompt": "Read the repository and decide this run's decomposition. Return a graphPatch that adds the work nodes you need between Plan and Review, with their dependency edges.",
      "schema": { "type": "object", "required": ["summary"],
        "properties": { "summary": { "type": "string" }, "graphPatch": { "type": "object" } } } },

    { "id": "Implement", "kind": "work",
      "prompt": "Implement the goal in the worktree. Commit your work on the branch.",
      "schema": { "type": "object", "additionalProperties": false, "required": ["summary"],
        "properties": { "summary": { "type": "string" },
          "files": { "type": "array", "items": { "type": "string" } } } } },

    { "id": "Review", "kind": "gate", "locked": true,
      "prompt": "Review the diff on this branch for correctness, security and convention violations. Fix every Critical and High finding, keep the build green, and commit. Report passed=true only when nothing Critical or High is left UNRESOLVED, and only after actually running the build.",
      "schema": { "type": "object", "additionalProperties": false,
        "required": ["passed", "buildExit"],
        "properties": { "passed": { "type": "boolean" }, "buildExit": { "type": "number" },
          "findings": { "type": "array", "items": { "type": "string" } } } } },

    { "id": "DoDGate", "kind": "gate", "locked": true,
      "prompt": "Adjudicate EVERY definition-of-done criterion against the work on this branch. MEASURE ONLY — do not fix. For tier checkable: verify the check file's sha256 matches the frozen checkSha, then run it; exit 0 is MET, non-zero UNMET, a hash mismatch means the frozen check FILE was altered — record that criterion's verdict as TAMPERED (not merely UNMET) and set passed=false. TAMPERED and UNMET are categorically different: an unmet criterion is work still to do, which a retry can fix; a tampered check is evidence someone edited the thing doing the measuring, which no amount of retrying can fix. Using the distinct verdict makes that visible in the trace instead of hiding it among ordinary failures. For tier judged: cite artifact evidence (file:line, command output, test result) from the actual diff; worker reports are untrusted claims and can never satisfy a criterion alone. A deferral without a recorded human decision is UNMET.",
      "schema": { "type": "object", "additionalProperties": false,
        "required": ["passed", "criteria"],
        "properties": { "passed": { "type": "boolean" },
          "unmetCriteria": { "type": "array", "items": { "type": "string" } },
          "criteria": { "type": "array", "items": { "type": "object",
            "additionalProperties": false, "required": ["id", "verdict"],
            "properties": { "id": { "type": "string" },
              "verdict": { "type": "string", "enum": ["MET", "UNMET", "PARTIAL", "TAMPERED"] },
              "evidence": { "type": "string" } } } } } } },

    { "id": "PR", "kind": "work",
      "prompt": "Push the branch and open a pull request with the GitHub CLI. Never merge. If a PR already exists for this branch, return its URL.",
      "schema": { "type": "object", "additionalProperties": false, "required": ["prUrl"],
        "properties": { "prUrl": { "type": "string" } } } },

    { "id": "Done", "kind": "terminal" }
  ],
  "edges": [
    { "from": "Setup", "to": "DoDBaseline", "when": "always" },
    { "from": "DoDBaseline", "to": "Plan", "when": { "field": "discriminates", "eq": true } },
    { "from": "Plan", "to": "Implement", "when": "always" },
    { "from": "Implement", "to": "Review", "when": "always" },
    { "from": "Review", "to": "Implement", "when": { "field": "passed", "eq": false },
      "carry": ["findings"] },
    { "from": "Review", "to": "DoDGate", "when": { "field": "passed", "eq": true },
      "locked": true },
    { "from": "DoDGate", "to": "Implement", "when": { "field": "passed", "eq": false },
      "carry": ["unmetCriteria"] },
    { "from": "DoDGate", "to": "PR", "when": { "field": "passed", "eq": true },
      "locked": true },
    { "from": "PR", "to": "Done", "when": "always" }
  ],
  "invariants": {
    "mustCross": ["Review", "DoDGate"],
    "visitCaps": { "*": 3, "Implement": 4 },
    "nodeBudget": 40,
    "lockedHash": "REPLACE_ME"
  }
}
```

- [ ] **Step 4: Stamp the real lockedHash into both seeds**

The `REPLACE_ME` placeholders must be replaced with the computed fingerprint. Run:

```bash
cd plugins/lirbox/skills/loom/scripts && node -e "
const fs=require('fs');
(async()=>{
  const core=await import('./graph-core.mjs');
  for (const p of ['seeds/lite.json','seeds/delivery.json']) {
    const g=JSON.parse(fs.readFileSync(p,'utf8'));
    g.invariants.lockedHash=core.lockedFingerprint(g);
    fs.writeFileSync(p, JSON.stringify(g,null,2)+'\n');
    console.log(p, g.invariants.lockedHash);
  }
})()"
```

Expected: two lines printing `fnv1a:` hashes. No `REPLACE_ME` remains:

```bash
grep -r REPLACE_ME plugins/lirbox/skills/loom/scripts/seeds/ ; echo "exit=$?"
```

Expected: no output, `exit=1`.

- [ ] **Step 5: Run tests to verify they pass**

```bash
node plugins/lirbox/skills/loom/scripts/test-loom.cjs
```

Expected: PASS — 11 new seed tests, `all green`.

- [ ] **Step 6: Commit**

```bash
git add plugins/lirbox/skills/loom/scripts/seeds/ \
        plugins/lirbox/skills/loom/scripts/test-loom.cjs
git commit -m "feat(loom): lite and delivery seed graphs with locked gates"
```

---

### Task 6: The loopback graph server

**Files:**
- Create: `plugins/lirbox/skills/loom/scripts/graph-server.mjs`
- Modify: `plugins/lirbox/skills/loom/scripts/test-loom.cjs`

**Interfaces:**
- Consumes: `graph-core.mjs` (`validateGraph`, `lockedFingerprint`).
- Produces:
  - CLI: `node graph-server.mjs --name <n> --root <repoRoot> [--port 0]`
  - prints `LOOM_SERVER_PORT=<port>` on stdout once listening
  - routes: `GET /`, `GET /graph`, `POST /graph`, `GET /state`, `POST /action`

- [ ] **Step 1: Write the failing tests**

Insert into `test-loom.cjs` before the final `process.stdout.write` line. Note these are `async` and use `await`, which `main()` already permits:

```js
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
  const rBad = await post('/graph', bypass);
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
  const rOk = await post('/graph', okGraph);
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

  proc.kill();
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node plugins/lirbox/skills/loom/scripts/test-loom.cjs
```

Expected: FAIL — `server did not start in 5s` (the script does not exist).

- [ ] **Step 3: Write the implementation**

Create `plugins/lirbox/skills/loom/scripts/graph-server.mjs`:

```js
#!/usr/bin/env node
/*
 * loom's pre-flight + live-view server.
 *
 *   node graph-server.mjs --name <name> --root <repoRoot> [--port 0]
 *
 * Binds 127.0.0.1 ONLY. It has no authentication because it is never reachable off
 * the loopback interface; do not change the bind address to add convenience.
 *
 * It cannot spawn agents — agents exist only inside the Claude session. "Replan" and
 * "approve" are therefore a handoff: this server writes <name>.action.json and the
 * skill, polling in the main session, picks it up.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateGraph } from './graph-core.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv;
const arg = (n, d) => {
  const i = argv.indexOf('--' + n);
  if (i < 0) return d;
  const v = argv[i + 1];
  return (v === undefined || v.startsWith('--')) ? true : v;
};

const NAME = arg('name', '');
const ROOT = arg('root', process.cwd());
const PORT = Number(arg('port', 0));
if (!NAME || NAME === true) { console.error('ERROR: --name is required'); process.exit(1); }

const graphPath = path.join(ROOT, '.loom', `${NAME}.graph.json`);
const statePath = path.join(ROOT, '.loom', 'state', `${NAME}.json`);
const actionPath = path.join(ROOT, '.loom', `${NAME}.action.json`);

const readJson = (p, dflt) => {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return dflt; }
};
const send = (res, code, obj) => {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
  res.end(body);
};
// Reject an oversized body with a real 413 the client can read. Destroying the socket
// immediately (as an earlier version did) tears it down before any response can be
// written, so the caller sees a bare ECONNRESET instead of the error the code intended
// to send. Stop accumulating, answer, THEN destroy.
const readBody = (req, res) => new Promise((resolve, reject) => {
  let d = '';
  let over = false;
  req.on('data', (c) => {
    if (over) return;
    d += c;
    if (d.length > 4e6) {
      over = true;
      send(res, 413, { error: 'body too large', limit: 4e6 });
      req.destroy();
      reject(new Error('body too large'));
    }
  });
  req.on('end', () => {
    if (over) return;
    try { resolve(JSON.parse(d || '{}')); } catch (e) { reject(e); }
  });
});

// Static assets are limited to the editor directory and resolved through a prefix
// check, so a crafted path cannot escape into the rest of the repo.
function serveStatic(res, rel) {
  const dir = path.join(HERE, 'editor');
  const file = path.resolve(dir, '.' + rel);
  if (!file.startsWith(dir + path.sep) && file !== path.join(dir, 'index.html')) {
    return send(res, 403, { error: 'forbidden' });
  }
  if (!fs.existsSync(file)) return send(res, 404, { error: 'not found' });
  const type = file.endsWith('.html') ? 'text/html; charset=utf-8'
    : file.endsWith('.mjs') || file.endsWith('.js') ? 'text/javascript; charset=utf-8'
    : file.endsWith('.css') ? 'text/css; charset=utf-8' : 'application/octet-stream';
  res.writeHead(200, { 'content-type': type });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const p = url.pathname;
  try {
    if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
      return serveStatic(res, '/index.html');
    }
    if (req.method === 'GET' && p === '/editor.js') return serveStatic(res, '/editor.js');
    // The editor imports the SAME validator the conductor inlines.
    if (req.method === 'GET' && p === '/graph-core.mjs') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      return fs.createReadStream(path.join(HERE, 'graph-core.mjs')).pipe(res);
    }
    if (req.method === 'GET' && p === '/graph') {
      return send(res, 200, readJson(graphPath, { error: 'no graph yet' }));
    }
    if (req.method === 'GET' && p === '/state') {
      return send(res, 200, readJson(statePath, { status: 'not started' }));
    }
    if (req.method === 'POST' && p === '/graph') {
      const body = await readBody(req, res);
      const prev = readJson(graphPath, null);
      const prevVersion = (prev && prev.version) || 0;

      // OPTIMISTIC CONCURRENCY. Without this, two concurrent valid saves both return
      // 200 with sequential versions and one edit is silently discarded — the client
      // is told it succeeded while its work is gone. Measured: two Promise.all posts
      // adding different nodes both got 200, and only the later node survived.
      // The client must declare which version it edited from; a stale base is 409.
      // `baseVersion` travels alongside the graph rather than inside it, so it can
      // never be confused with the server-owned `version` field.
      //
      // THE WRAPPER IS MANDATORY. An earlier revision accepted a bare graph body for
      // "compatibility" — which was simply a documented way to opt out of this check.
      // Measured: two bare bodies raced, both returned 200, and one edit vanished.
      // A guard with a supported bypass is not a guard. There is exactly one client
      // (the editor in Task 7) and we control it, so requiring the wrapper costs
      // nothing. Note `typeof baseVersion === 'number'` also rejects a missing key,
      // `null`, and a numeric string, each of which would otherwise skip the check.
      if (!body || typeof body !== 'object' || !body.graph
          || typeof body.baseVersion !== 'number') {
        return send(res, 400, {
          error: 'POST /graph requires { baseVersion: <number>, graph: { ... } }',
          hint: 'GET /graph first and send its `version` back as baseVersion',
        });
      }
      const { baseVersion, graph: next } = body;
      if (baseVersion !== prevVersion) {
        return send(res, 409, {
          error: 'stale base version',
          yourBaseVersion: baseVersion,
          currentVersion: prevVersion,
          hint: 'GET /graph, re-apply your edit on the current graph, and POST again',
        });
      }

      // Re-validate server-side ALWAYS. The editor's lock badges are a courtesy;
      // this is the enforcement.
      const violations = validateGraph(next, prev, null);
      if (violations.length) return send(res, 422, { violations });

      // The server owns `version` — a client-submitted value is always ignored.
      next.version = prevVersion + 1;
      fs.writeFileSync(graphPath, JSON.stringify(next, null, 2) + '\n');
      return send(res, 200, { ok: true, version: next.version });
    }
    if (req.method === 'POST' && p === '/action') {
      const body = await readBody(req, res);
      if (body.action !== 'replan' && body.action !== 'approve') {
        return send(res, 400, { error: 'action must be "replan" or "approve"' });
      }
      fs.writeFileSync(actionPath, JSON.stringify({
        action: body.action, comments: body.comments || [],
      }, null, 2) + '\n');
      return send(res, 200, { ok: true, action: body.action });
    }
    return send(res, 404, { error: 'not found' });
  } catch (e) {
    // readBody already answered (413) and destroyed the socket for an oversized body;
    // writing again would throw on a dead response.
    if (res.headersSent || res.writableEnded) return;
    return send(res, 400, { error: String(e && e.message) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`LOOM_SERVER_PORT=${server.address().port}\n`);
});
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node plugins/lirbox/skills/loom/scripts/test-loom.cjs
```

Expected: PASS — 11 new server tests, `all green`.

Note: this task deliberately does **not** create `editor/index.html`. `GET /` returns 404 until Task 7 writes the real editor, and no test here asserts otherwise — a throwaway placeholder file written only to satisfy a test is exactly the kind of thing the review rubric should reject.

- [ ] **Step 5: Commit**

```bash
git add plugins/lirbox/skills/loom/scripts/graph-server.mjs \
        plugins/lirbox/skills/loom/scripts/test-loom.cjs
git commit -m "feat(loom): loopback graph server with server-side validation"
```

---

### Task 7: The React Flow editor

**Files:**
- Create/replace: `plugins/lirbox/skills/loom/scripts/editor/index.html`
- Create: `plugins/lirbox/skills/loom/scripts/editor/editor.js`
- Modify: `plugins/lirbox/skills/loom/scripts/test-loom.cjs`

**Interfaces:**
- Consumes: `GET /graph`, `POST /graph`, `GET /state`, `POST /action` (Task 6); `graph-core.mjs` served at `/graph-core.mjs`.
- Produces: a browser UI. Assertions here are structural (the DOM/JS contract), since there is no headless browser in this net.

- [ ] **Step 1: Write the failing tests**

The server spawned in Task 6's section is still needed here, so **first move the `proc.kill();` line out of the server section and down to the very end of this editor section.** Then insert the following before the final `process.stdout.write` line:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node plugins/lirbox/skills/loom/scripts/test-loom.cjs
```

Expected: FAIL — `ENOENT: .../editor/editor.js`.

- [ ] **Step 3: Write the implementation**

Replace `plugins/lirbox/skills/loom/scripts/editor/index.html`:

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>loom — graph editor</title>
<!-- Exact versions + SRI. This page is served next to a repo it is about to edit;
     a CDN serving different bytes tomorrow would be arbitrary code execution.
     Regenerate these four tags with the command in Step 3b after any version bump. -->
<script src="https://unpkg.com/react@18.3.1/umd/react.production.min.js"
        integrity="REPLACE_WITH_SRI" crossorigin="anonymous"></script>
<script src="https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js"
        integrity="REPLACE_WITH_SRI" crossorigin="anonymous"></script>
<script src="https://unpkg.com/reactflow@11.11.4/dist/umd/index.js"
        integrity="REPLACE_WITH_SRI" crossorigin="anonymous"></script>
<link rel="stylesheet" href="https://unpkg.com/reactflow@11.11.4/dist/style.css"
      integrity="REPLACE_WITH_SRI" crossorigin="anonymous">
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; font: 14px/1.5 ui-sans-serif, system-ui, sans-serif; }
  #app { display: flex; height: 100vh; }
  #canvas { flex: 1; }
  #panel { width: 320px; border-left: 1px solid #8884; padding: 12px; overflow-y: auto; }
  #bar { position: absolute; z-index: 10; top: 12px; left: 12px; display: flex; gap: 8px; }
  button { padding: 6px 12px; border-radius: 6px; border: 1px solid #8886; background: #8881; cursor: pointer; }
  button:disabled { opacity: .5; cursor: not-allowed; }
  #violations { color: #c33; white-space: pre-wrap; margin-top: 8px; }
  #violations:empty { display: none; }
  textarea { width: 100%; min-height: 120px; font: 12px ui-monospace, monospace; }
  .node-gate { border-color: #c93 !important; }
  .node-work { border-color: #39c !important; }
  .locked::after { content: " 🔒"; }
</style>
</head>
<body>
<div id="app">
  <div id="canvas"><div id="bar">
    <button id="save">Save</button>
    <button id="replan">Replan from comments</button>
    <button id="approve">Approve &amp; run</button>
    <span id="status"></span>
  </div></div>
  <div id="panel">
    <div id="detail">Select a node.</div>
    <div id="violations"></div>
  </div>
</div>
<script type="module" src="./editor.js"></script>
</body>
</html>
```

Create `plugins/lirbox/skills/loom/scripts/editor/editor.js`:

```js
// loom graph editor.
//
// Validation here is a COURTESY — the server re-validates every POST and its answer
// is final. Importing the same graph-core the conductor inlines guarantees the
// message you see in the browser is the message the run would produce.
import { validateGraph, capFor } from './graph-core.mjs';

const { useState, useEffect, useCallback, createElement: h } = React;
const RF = window.ReactFlow;

let graph = null;
let readOnly = false;
let selected = null;
const comments = [];

const $ = (id) => document.getElementById(id);
const setStatus = (t) => { $('status').textContent = t; };
const showViolations = (list) => {
  $('violations').textContent = list && list.length
    ? 'Rejected:\n  - ' + list.join('\n  - ') : '';
};

// ---- graph <-> React Flow ------------------------------------------------

function toFlow(g) {
  const nodes = g.nodes.map((n, i) => ({
    id: n.id,
    position: n.pos || { x: 60, y: 40 + i * 90 },
    data: { label: n.id + (n.locked ? ' 🔒' : '') },
    className: (n.kind === 'gate' ? 'node-gate' : 'node-work') + (n.locked ? ' locked' : ''),
    draggable: !readOnly,
    deletable: !readOnly && !n.locked,
  }));
  const edges = g.edges.map((e, i) => ({
    id: `e${i}:${e.from}->${e.to}`,
    source: e.from, target: e.to,
    label: e.when === 'always' ? '' : `${e.when.field}=${JSON.stringify(e.when.eq ?? e.when.neq)}`,
    animated: !!e.carry,
    deletable: !readOnly && !e.locked,
  }));
  return { nodes, edges };
}

function fromFlow(flowNodes, flowEdges) {
  const next = JSON.parse(JSON.stringify(graph));
  // Persist layout so the graph reopens the way you left it.
  for (const fn of flowNodes) {
    const n = next.nodes.find((x) => x.id === fn.id);
    if (n) n.pos = fn.position;
  }
  const keep = new Set(flowNodes.map((n) => n.id));
  next.nodes = next.nodes.filter((n) => keep.has(n.id));
  next.edges = flowEdges
    // Drop edges whose endpoints no longer exist, rather than trusting React Flow to have
    // cascaded the removal when a node was deleted. It documents that it does — but nothing
    // in this environment can execute the UI to confirm it fires in this exact setup, and
    // relying on unverifiable library behaviour for a correctness property is the wrong
    // trade when the guard is one filter. Without it a dangling edge reaches validateGraph
    // and the user gets a confusing "edge from unknown node" 422 instead of a clean save.
    .filter((fe) => keep.has(fe.source) && keep.has(fe.target))
    .map((fe) => {
      const prior = graph.edges.find((e) => e.from === fe.source && e.to === fe.target);
      return prior || { from: fe.source, to: fe.target, when: 'always' };
    });
  return next;
}

// ---- server I/O ---------------------------------------------------------

async function loadGraph() {
  graph = await (await fetch('/graph')).json();
  return graph;
}

async function save(next) {
  // Local pre-check first: identical rules, instant feedback, no round trip.
  const local = validateGraph(next, graph, null);
  if (local.length) { showViolations(local); return false; }

  // Send the version this edit was based on. Without it two saves close together —
  // two tabs, or an auto-save racing a manual one — both return 200 and one edit is
  // silently discarded.
  const res = await fetch('/graph', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ baseVersion: graph.version, graph: next }),
  });
  if (res.status === 422) {
    const { violations } = await res.json();
    showViolations(violations);
    return false;
  }
  if (res.status === 409) {
    const { currentVersion } = await res.json();
    showViolations([
      `This graph changed underneath you (you edited v${graph.version}, current is v${currentVersion}).`,
      'Your edit was NOT saved. Reload to get the current graph, then re-apply it.',
    ]);
    return false;
  }
  if (res.status === 413) {
    showViolations(['Graph too large to save (over 4 MB).']);
    return false;
  }
  const body = await res.json();
  showViolations([]);
  graph = next;
  graph.version = body.version;
  setStatus(`saved v${body.version}`);
  return true;
}

async function action(kind) {
  const res = await fetch('/action', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: kind, comments }),
  });
  setStatus(res.ok ? `${kind} requested — return to the terminal` : `${kind} failed`);
}

// ---- live mode ----------------------------------------------------------

// The run is unattended by design: once it starts the editor is a viewer.
// Comments typed during a run are filed to the whetstone backlog, not applied here.
function startPolling(rerender) {
  setInterval(async () => {
    const st = await (await fetch('/state')).json();
    const running = st.status === 'running';
    // Re-render on the TRANSITION, not only when the graph version moves. `readOnly`
    // gates the Save button at click time, so saves are refused immediately either way —
    // but the per-node draggable/deletable props are computed in toFlow, which only re-runs
    // when `tick` changes. Gating rerender() on a version diff alone meant a run that
    // starts without an immediate graph patch left the canvas looking editable: nodes still
    // dragged and deleted locally while the code's own comment claims "once it starts the
    // editor is a viewer". Nothing persisted, but the UI lied about being locked.
    if (running !== readOnly) { readOnly = running; rerender(); }
    if (running) {
      setStatus(`running — at ${st.cursor} · visits ${JSON.stringify(st.visits || {})}`);
      const live = await (await fetch('/graph')).json();
      if (live.version !== (graph && graph.version)) { graph = live; rerender(); }
    }
  }, 2000);
}

// ---- app ----------------------------------------------------------------

function App() {
  const [flow, setFlow] = useState({ nodes: [], edges: [] });
  const [tick, setTick] = useState(0);

  // DELIBERATE TRADEOFF, not an accident: this refetches and overwrites the canvas
  // whenever `tick` bumps, which includes the read-only transition when a run starts.
  // Any UNSAVED local sketch in this tab is discarded at that moment, without warning.
  //
  // Nothing persisted is ever at risk — only an in-browser draft. In the primary flow it
  // cannot bite, because "Approve & run" saves first and only fires the action if that
  // save succeeded, so the running graph already matches the screen. The exposure is a
  // SECOND tab (or another person — this is loopback with no auth) approving a run while
  // this tab holds an unsaved edit.
  //
  // Accepted because once a run starts the run owns the graph, and showing a stale
  // editable canvas over a live run is worse than dropping a draft. If this ever needs
  // softening, the fix is to prompt before discarding — not to skip the refetch, which
  // would leave the canvas lying about a graph the run is actively patching.
  useEffect(() => { loadGraph().then((g) => setFlow(toFlow(g))); }, [tick]);
  useEffect(() => { startPolling(() => setTick((t) => t + 1)); }, []);

  const onSelect = useCallback((_, node) => {
    selected = graph.nodes.find((n) => n.id === node.id);
    renderPanel();
  }, []);

  useEffect(() => {
    $('save').onclick = async () => {
      if (readOnly) return setStatus('run in progress — editor is read-only');
      await save(fromFlow(flow.nodes, flow.edges));
    };
    $('replan').onclick = () => action('replan');
    $('approve').onclick = async () => {
      if (await save(fromFlow(flow.nodes, flow.edges))) action('approve');
    };
  }, [flow]);

  return h(RF.ReactFlow, {
    nodes: flow.nodes, edges: flow.edges,
    onNodesChange: (c) => setFlow((f) => ({ ...f, nodes: RF.applyNodeChanges(c, f.nodes) })),
    onEdgesChange: (c) => setFlow((f) => ({ ...f, edges: RF.applyEdgeChanges(c, f.edges) })),
    onConnect: (p) => setFlow((f) => ({ ...f, edges: RF.addEdge(p, f.edges) })),
    onNodeClick: onSelect,
    fitView: true,
  }, h(RF.Background, null), h(RF.Controls, null));
}

// Escape EVERY dynamic value before it reaches innerHTML.
//
// Node ids and kinds are not trusted input. They arrive from a planner worker's
// graphPatch — LLM-generated text — so an id like
//   <img src=x onerror="fetch('/action',{method:'POST',body:'{\"action\":\"approve\"}'})">
// would execute inside the page that IS the human approval gate, with access to the
// loopback server. That converts a weird or prompt-injected planner output into
// "approve the graph without a human", defeating the control point the whole design
// rests on. Escaping only `prompt` (as an earlier revision did) is not enough.
const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function renderPanel() {
  if (!selected) return;
  const n = selected;
  const cap = capFor(graph, n.id);
  const locked = !!n.locked;
  $('detail').innerHTML = `
    <h3>${esc(n.id)} <small>${esc(n.kind || 'work')}${locked ? ' 🔒 locked' : ''}</small></h3>
    <label>Visit cap<br><input id="cap" type="number" min="0" value="${esc(cap)}"
      ${locked ? 'disabled' : ''}></label>
    <label>Prompt<br><textarea id="prompt" ${locked ? 'disabled' : ''}>${
      esc(n.prompt)}</textarea></label>
    <label>Comment for the replanner<br><textarea id="comment"
      placeholder="e.g. this needs a schema migration before it runs"></textarea></label>
    <button id="addComment">Add comment</button>
    ${locked ? '<p><em>Locked at approval — gates cannot be edited or removed.</em></p>' : ''}`;

  if (!locked) {
    $('cap').onchange = (e) => {
      // Visit caps have exactly ONE home so the validator has a single source.
      graph.invariants = graph.invariants || {};
      graph.invariants.visitCaps = graph.invariants.visitCaps || {};
      graph.invariants.visitCaps[n.id] = Number(e.target.value);
    };
    $('prompt').onchange = (e) => { n.prompt = e.target.value; };
  }
  $('addComment').onclick = () => {
    const text = $('comment').value.trim();
    if (!text) return;
    comments.push({ node: n.id, text });
    $('comment').value = '';
    setStatus(`${comments.length} comment(s) queued — press Replan`);
  };
}

ReactDOM.createRoot($('canvas')).render(h(App));
```

- [ ] **Step 3b: Compute the real SRI hashes**

The four `REPLACE_WITH_SRI` values must become real digests. Fetch each pinned URL and hash it:

```bash
cd plugins/lirbox/skills/loom/scripts/editor && for u in \
  "https://unpkg.com/react@18.3.1/umd/react.production.min.js" \
  "https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js" \
  "https://unpkg.com/reactflow@11.11.4/dist/umd/index.js" \
  "https://unpkg.com/reactflow@11.11.4/dist/style.css" ; do
  h=$(curl -fsSL "$u" | openssl dgst -sha384 -binary | openssl base64 -A)
  echo "$u  sha384-$h"
done
```

Paste each `sha384-…` into the matching tag's `integrity` attribute, replacing `REPLACE_WITH_SRI`. Verify none remain:

```bash
grep -c REPLACE_WITH_SRI plugins/lirbox/skills/loom/scripts/editor/index.html
```

Expected: `0`.

**If the CDN is unreachable or you want the editor to work offline**, take the spec's documented fallback instead: `curl` the four files into `editor/vendor/`, commit them, and point the tags at `./vendor/…` with no `integrity`/`crossorigin` attributes (same-origin needs neither). Update the two SRI tests above to skip when no external URL is present. Vendoring is strictly safer; it costs ~500 KB of committed third-party code.

- [ ] **Step 4: Run tests to verify they pass**

```bash
node plugins/lirbox/skills/loom/scripts/test-loom.cjs
```

Expected: PASS — 10 new editor tests, `all green`. Confirm `proc.kill();` now sits at the end of the editor section, not the server section.

- [ ] **Step 5: Manual smoke test**

```bash
mkdir -p /tmp/loom-smoke/.loom/state
cp plugins/lirbox/skills/loom/scripts/seeds/delivery.json /tmp/loom-smoke/.loom/smoke.graph.json
node plugins/lirbox/skills/loom/scripts/graph-server.mjs --name smoke --root /tmp/loom-smoke --port 7391
```

Open `http://127.0.0.1:7391`. Confirm: the delivery graph renders; `DoDGate` and `Review` show 🔒 and refuse edits; drawing `Implement → Done` and pressing Save shows *"DoDGate no longer dominates Done"*; deleting that edge and saving succeeds with a version bump. Then `Ctrl-C`.

- [ ] **Step 6: Commit**

```bash
git add plugins/lirbox/skills/loom/scripts/editor/ \
        plugins/lirbox/skills/loom/scripts/test-loom.cjs
git commit -m "feat(loom): React Flow editor with shared validation and live mode"
```

---

### Task 8: DoD checks as hash-locked files

**Files:**
- Create: `plugins/lirbox/skills/loom/scripts/dod-freeze.mjs`
- Modify: `plugins/lirbox/skills/loom/scripts/seeds/delivery.json` (DoDBaseline prompt)
- Modify: `plugins/lirbox/skills/loom/scripts/test-loom.cjs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - CLI: `node dod-freeze.mjs --dod <dod.json> --checks-dir <dir>` — writes each `checkable` criterion's script to `<dir>/<id>.sh`, computes `sha256`, rewrites `dod.json` with `checkFile`/`checkSha`
  - `sha256File(p) -> string` — `"sha256:<hex>"`
  - `verifyChecks(dod, root) -> {id, ok, reason}[]`

- [ ] **Step 1: Write the failing tests**

Insert into `test-loom.cjs` before the final `process.stdout.write` line:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node plugins/lirbox/skills/loom/scripts/test-loom.cjs
```

Expected: FAIL — `Cannot find module .../dod-freeze.mjs`.

- [ ] **Step 3: Write the implementation**

Create `plugins/lirbox/skills/loom/scripts/dod-freeze.mjs`:

```js
#!/usr/bin/env node
/*
 * Freeze a definition of done into hash-locked check FILES.
 *
 *   node dod-freeze.mjs --dod <dod.json> --checks-dir <dir>
 *
 * Why files rather than a `check` string in JSON:
 *   - they ride the PR, so a reviewer can read the check
 *   - the human can re-run them after merge
 *   - multi-line scripts survive without shell/JSON quoting mangling
 *   - the sha256 lock makes a weakened check DETECTED rather than rewarded —
 *     today, editing the test a check runs is the cheapest route to a green gate
 *
 * Real sha256 here (not the conductor's FNV-1a): this runs with full Node, and
 * this lock is guarding against tampering, not merely drift.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function sha256File(p) {
  return 'sha256:' + crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

// Returns one row per checkable criterion: { id, ok, reason }.
// `root` is the directory the criteria's relative checkFile paths resolve against.
export function verifyChecks(dod, root) {
  const out = [];
  for (const c of dod.criteria || []) {
    if (c.tier !== 'checkable') continue;
    const p = path.resolve(root, c.checkFile);
    if (!fs.existsSync(p)) { out.push({ id: c.id, ok: false, reason: 'check file missing: ' + c.checkFile }); continue; }
    const actual = sha256File(p);
    if (actual !== c.checkSha) {
      out.push({ id: c.id, ok: false, reason: `check file modified — sha mismatch (frozen ${c.checkSha}, found ${actual})` });
      continue;
    }
    out.push({ id: c.id, ok: true, reason: 'sha matches frozen value' });
  }
  return out;
}

function main() {
  const argv = process.argv;
  const arg = (n, d) => {
    const i = argv.indexOf('--' + n);
    if (i < 0) return d;
    const v = argv[i + 1];
    return (v === undefined || v.startsWith('--')) ? true : v;
  };
  const dodPath = arg('dod', '');
  const checksDir = arg('checks-dir', '');
  if (!dodPath || dodPath === true) { console.error('ERROR: --dod is required'); process.exit(1); }
  if (!checksDir || checksDir === true) { console.error('ERROR: --checks-dir is required'); process.exit(1); }

  const dod = JSON.parse(fs.readFileSync(dodPath, 'utf8'));
  fs.mkdirSync(checksDir, { recursive: true });
  const root = path.dirname(path.resolve(dodPath));

  for (const c of dod.criteria || []) {
    if (c.tier !== 'checkable') continue;
    if (typeof c.script !== 'string' || !c.script.trim()) {
      console.error(`ERROR: checkable criterion '${c.id}' has no "script" to freeze`);
      process.exit(1);
    }
    const file = path.join(checksDir, `${c.id}.sh`);
    fs.writeFileSync(file, c.script.endsWith('\n') ? c.script : c.script + '\n', { mode: 0o755 });
    fs.chmodSync(file, 0o755);
    c.checkFile = path.relative(root, file);
    c.checkSha = sha256File(file);
    // A criterion already met at baseline cannot discriminate this run's work.
    // "red" is the default; "green-ok" is a deliberate, human-confirmed waiver
    // for genuine regression guards.
    c.baseline = c.baseline === 'green-ok' ? 'green-ok' : 'red';
    delete c.script;
  }

  fs.writeFileSync(dodPath, JSON.stringify(dod, null, 2) + '\n');
  const n = (dod.criteria || []).filter((c) => c.tier === 'checkable').length;
  process.stdout.write(`Froze ${n} check file(s) into ${checksDir}\n`);
}

if (process.argv[1] && process.argv[1].endsWith('dod-freeze.mjs')) main();
```

- [ ] **Step 4: Update the DoDBaseline prompt in the delivery seed**

In `plugins/lirbox/skills/loom/scripts/seeds/delivery.json`, replace the `DoDBaseline` node's `prompt` with:

```
Run every checkable DoD criterion's check FILE against the worktree BEFORE any work. For each: verify the file's sha256 matches its frozen checkSha, then run it and record met (exit 0) / unmet (non-zero) / error (could not run). Measure only — fix nothing. A criterion whose baseline is "red" but which is already MET cannot discriminate this run's work: report discriminates=false, because a check that was green before the work began proves nothing about the work. You do not need to do anything else to stop the run — this node's only outgoing edge requires discriminates=true, so reporting false matches no edge and the interpreter hard-fails with "no edge matched at DoDBaseline". Report honestly; the graph enforces the consequence. Criteria explicitly marked baseline "green-ok" are regression guards and are expected to be MET — they never fail the run. A sha mismatch is a hard failure.
```

Add `"discriminates"` to the node's schema properties as `{ "type": "boolean" }` and to `required`.

**Also change `DoDBaseline`'s out-edge** from `"when": "always"` to `"when": { "field": "discriminates", "eq": true }`. Without this the prompt's instruction has nothing to act on: the edge matches unconditionally, so a worker honestly reporting `discriminates: false` routes to `Plan` and the run continues as if nothing happened. Gating the edge makes a false result match NO edge, which the interpreter already treats as a hard failure (Task 4). The guarantee moves from prose into the graph, which is how every other gate in this system works.

Because the seed changed, re-stamp its `lockedHash`. **Expect the value to be unchanged** — the fingerprint covers only locked nodes and edges, and `DoDBaseline` is not locked, so editing its prompt cannot move it. The re-stamp is defensive; printing the same hash back means it worked, not that it failed:

```bash
cd plugins/lirbox/skills/loom/scripts && node -e "
const fs=require('fs');
(async()=>{
  const core=await import('./graph-core.mjs');
  const p='seeds/delivery.json';
  const g=JSON.parse(fs.readFileSync(p,'utf8'));
  g.invariants.lockedHash=core.lockedFingerprint(g);
  fs.writeFileSync(p, JSON.stringify(g,null,2)+'\n');
  console.log(g.invariants.lockedHash);
})()"
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
node plugins/lirbox/skills/loom/scripts/test-loom.cjs
```

Expected: PASS — 11 new DoD tests plus the still-green seed tests, `all green`.

- [ ] **Step 6: Commit**

```bash
git add plugins/lirbox/skills/loom/scripts/dod-freeze.mjs \
        plugins/lirbox/skills/loom/scripts/seeds/delivery.json \
        plugins/lirbox/skills/loom/scripts/test-loom.cjs
git commit -m "feat(loom): DoD checks as sha256-locked files with baseline-RED enforced"
```

---

### Task 9: Resume protocol and the run report

**Files:**
- Create: `plugins/lirbox/skills/loom/scripts/loom-report.cjs`
- Create: `plugins/lirbox/skills/loom/scripts/list-runs.cjs`
- Modify: `plugins/lirbox/skills/loom/scripts/test-loom.cjs`

**Interfaces:**
- Consumes: `state.json` written by the checkpoint worker (Task 4).
- Produces:
  - `node loom-report.cjs <name>` — prints the traversal, revisits, rejected patches, gate verdicts
  - `node list-runs.cjs [--all]` — table of runs with status, cursor, stale server ports

- [ ] **Step 1: Write the failing tests**

Insert into `test-loom.cjs` before the final `process.stdout.write` line:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node plugins/lirbox/skills/loom/scripts/test-loom.cjs
```

Expected: FAIL — `Cannot find module .../loom-report.cjs`.

- [ ] **Step 3: Write the implementation**

Create `plugins/lirbox/skills/loom/scripts/loom-report.cjs`:

```js
#!/usr/bin/env node
/*
 * Render a loom run from its durable state.
 *
 *   node loom-report.cjs <name>
 *
 * The trace is the point: it shows the PATH actually taken, including revisits and
 * every patch the validator rejected. A linear phase list cannot show either.
 */
const fs = require('fs');
const path = require('path');

const name = process.argv[2];
if (!name) { console.error('usage: loom-report.cjs <name>'); process.exit(1); }

const p = path.join(process.cwd(), '.loom', 'state', `${name}.json`);
if (!fs.existsSync(p)) { console.error(`no such run: ${p}`); process.exit(1); }
const st = JSON.parse(fs.readFileSync(p, 'utf8'));

const out = [];
out.push(`loom run: ${st.workflow}`);
out.push(`status:   ${st.status}${st.finishedAt ? ` (finished ${st.finishedAt})` : ''}`);
out.push(`started:  ${st.startedAt || 'unknown'}`);
out.push(`cursor:   ${st.cursor}`);
out.push(`graph:    v${st.graphVersion || 0}, ${(st.graph && st.graph.nodes || []).length} nodes`);
out.push('');

out.push('VISITS');
for (const [node, n] of Object.entries(st.visits || {})) {
  const cap = ((st.graph && st.graph.invariants && st.graph.invariants.visitCaps) || {})[node]
    ?? ((st.graph && st.graph.invariants && st.graph.invariants.visitCaps) || {})['*'] ?? 3;
  out.push(`  ${node.padEnd(16)} ${n}/${cap}${n > 1 ? '   <- revisited' : ''}`);
}
out.push('');

out.push('PATH');
for (const t of st.trace || []) {
  if (t.patch === 'rejected') {
    out.push(`  ${t.node}#${t.visit}  PATCH REJECTED: ${(t.violations || []).join('; ')}`);
  } else if (t.patch === 'accepted') {
    out.push(`  ${t.node}#${t.visit}  patch accepted -> graph v${t.version}`);
  } else {
    const v = t.verdict === true ? 'pass' : t.verdict === false ? 'FAIL' : '-';
    out.push(`  ${t.node}#${t.visit}  ${v.padEnd(5)} -> ${t.to}`);
  }
}
out.push('');

const carry = st.carry || {};
if (Object.keys(carry).length) {
  out.push('CARRIED FORWARD');
  for (const [node, c] of Object.entries(carry)) {
    if (Object.keys(c || {}).length) out.push(`  ${node}: ${JSON.stringify(c)}`);
  }
  out.push('');
}

out.push('RESUME');
out.push(`  Workflow({ scriptPath: ".loom/${name}.js", args: <the graph/visits/results/carry/trace/cursor`);
out.push(`             fields of .loom/state/${name}.json — the PATCHED graph, not the seed> })`);

process.stdout.write(out.join('\n') + '\n');
```

Create `plugins/lirbox/skills/loom/scripts/list-runs.cjs`:

```js
#!/usr/bin/env node
/*
 * Table of loom runs.
 *
 *   node list-runs.cjs [--all]
 *
 * Also surfaces the recorded server port so a session that died without stopping
 * its editor server leaves a visible, killable trace rather than an orphan.
 */
const fs = require('fs');
const path = require('path');

const all = process.argv.includes('--all');
const dir = path.join(process.cwd(), '.loom', 'state');
if (!fs.existsSync(dir)) { process.stdout.write('no loom runs\n'); process.exit(0); }

const rows = [];
for (const f of fs.readdirSync(dir)) {
  if (!f.endsWith('.json')) continue;
  let st;
  try { st = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
  if (!all && st.status === 'complete') continue;
  rows.push({
    name: st.workflow || f.replace(/\.json$/, ''),
    status: st.status || '?',
    cursor: st.cursor || '-',
    visits: Object.values(st.visits || {}).reduce((a, b) => a + b, 0),
    port: st.port || '-',
  });
}

if (!rows.length) { process.stdout.write('no loom runs\n'); process.exit(0); }
const pad = (s, n) => String(s).padEnd(n);
process.stdout.write(
  `${pad('NAME', 24)}${pad('STATUS', 20)}${pad('CURSOR', 16)}${pad('STEPS', 7)}PORT\n`);
for (const r of rows) {
  process.stdout.write(
    `${pad(r.name, 24)}${pad(r.status, 20)}${pad(r.cursor, 16)}${pad(r.visits, 7)}${r.port}\n`);
}
if (rows.some((r) => r.port !== '-')) {
  process.stdout.write('\nA PORT on a non-running row is a stale editor server: kill it with\n');
  process.stdout.write('  lsof -ti tcp:<port> | xargs kill\n');
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node plugins/lirbox/skills/loom/scripts/test-loom.cjs
```

Expected: PASS — 7 new report/resume tests, `all green`.

- [ ] **Step 5: Commit**

```bash
git add plugins/lirbox/skills/loom/scripts/loom-report.cjs \
        plugins/lirbox/skills/loom/scripts/list-runs.cjs \
        plugins/lirbox/skills/loom/scripts/test-loom.cjs
git commit -m "feat(loom): run report and listing with revisits and rejected patches"
```

---

### Task 10: SKILL.md, references, and marketplace wiring

**Files:**
- Create: `plugins/lirbox/skills/loom/SKILL.md`
- Create: `plugins/lirbox/skills/loom/references/graph-spec.md`
- Create: `plugins/lirbox/skills/loom/references/invariants.md`
- Modify: `.gitignore`
- Modify: `README.md`
- Modify: `plugins/lirbox/skills/loom/scripts/test-loom.cjs`

**Interfaces:**
- Consumes: every script from Tasks 1–9.
- Produces: the skill entry point Claude invokes as `lirbox:loom`.

- [ ] **Step 1: Write the failing tests**

Insert into `test-loom.cjs` before the final `process.stdout.write` line:

```js
  section('skill packaging');

  const skillPath = path.join(__dirname, '..', 'SKILL.md');
  const skill = fs.readFileSync(skillPath, 'utf8');

  test('frontmatter has name and a trigger description', () => {
    assert.ok(/^---\n[\s\S]*?\nname: loom\n/.test(skill));
    assert.ok(/\ndescription: /.test(skill));
    const desc = /\ndescription: ["']?([^\n]+)/.exec(skill)[1];
    assert.ok(desc.length > 120, 'the description is the TRIGGER — make it specific');
  });

  test('declares the tools it actually uses', () => {
    for (const t of ['Read', 'Write', 'Bash', 'Workflow', 'AskUserQuestion']) {
      assert.ok(new RegExp(`- ${t}\\b`).test(skill), `allowed-tools missing ${t}`);
    }
  });

  test('documents the resume-restores-structure rule', () => {
    assert.ok(/patched graph/i.test(skill),
      'SKILL.md must state that resume restores the patched graph');
  });

  test('states the never-auto-merge rule', () => {
    assert.ok(/never auto-?merge/i.test(skill));
  });

  test('references exist and are linked', () => {
    for (const f of ['graph-spec.md', 'invariants.md']) {
      assert.ok(fs.existsSync(path.join(__dirname, '..', 'references', f)), `${f} missing`);
      assert.ok(skill.includes(f), `SKILL.md never links ${f}`);
    }
  });

  test('.loom/ is gitignored', () => {
    const gi = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', '..', '.gitignore'), 'utf8');
    assert.ok(/^\.loom\/?$/m.test(gi), '.loom/ must be gitignored — it is runtime scratch');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node plugins/lirbox/skills/loom/scripts/test-loom.cjs
```

Expected: FAIL — `ENOENT: .../loom/SKILL.md`.

- [ ] **Step 3: Write SKILL.md**

Create `plugins/lirbox/skills/loom/SKILL.md`:

```markdown
---
name: loom
argument-hint: "[ <goal to start> | <name to resume> | list ]"
description: "This skill should be used to run a multi-subagent delivery workflow whose SHAPE can change — where a gate failure must send the run back to an earlier stage rather than into a local retry, where the run should be able to add stages once it has read the code, and where a human wants to review and edit that shape in a browser before launch. It drives the Workflow tool with a node/edge graph the conductor interprets, validates every runtime graph patch so no path can reach the terminal without crossing every gate, and persists the patched graph so a resume restores structure, not just progress. Do NOT use for a fixed linear pipeline (use conductor) or a quick one-shot (call Workflow directly)."
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Workflow
  - AskUserQuestion
---

$ARGUMENTS

# loom

<purpose>
`conductor` executes a fixed phase list, so every gate hand-rolls its own retry and a
failure can only be patched locally. loom makes the **graph** the execution spec: a gate
failure is an **edge** back to an earlier node, and the graph can rewrite itself at runtime
under invariants that keep every gate un-bypassable.
</purpose>

<when-to-use>
All of: multi-step with subagents; a gate failure should re-enter real work rather than a
narrow fix worker; the decomposition is not knowable up front. Otherwise use `conductor`
(fixed pipeline) or call `Workflow` directly (one-shot).
</when-to-use>

<core-model>
Three layers — confusing them causes every bug in this system:
- **Graph** (`.loom/<name>.graph.json`) — nodes, conditional edges, invariants. DATA.
- **Conductor** (the generated `.js`) — a ~60-line interpreter. **Pure JS: no `fs`, `git`,
  `require`, `import`, `Date.now()`, `Math.random()`, `crypto`.** `graph-core.mjs` is
  **inlined** into it, never imported.
- **Workers** — the subagents it spawns. Full tools. Every side effect.

**One shared worktree** `.worktrees/<name>` on `wf/<name>` holds every edit; `state.json`
stays in the main repo.

Spec → [`references/graph-spec.md`](references/graph-spec.md).
The dominance argument → [`references/invariants.md`](references/invariants.md).
</core-model>

<procedure>

### 1. Resolve `$ARGUMENTS`

| `$ARGUMENTS` | do |
|---|---|
| empty or `list` | `node <skill-dir>/scripts/list-runs.cjs`, show the table, stop |
| a state file, `running`/`failed` | **resume** → step 5 |
| a state file, `awaiting-approval` | restart the server, reopen the editor → step 3 |
| a state file, `complete` | say so; offer `loom-report.cjs <name>` |
| anything else — a goal | fresh run → step 2 |

### 2. Triage, DoD, seed

Same triage tiers as conductor — **bias down, and decline is a hard STOP.** A fixed linear
pipeline is conductor's job, not loom's; loom earns its cost only when the shape can change.

Acquire the DoD (3–7 criteria, ticket ACs verbatim), then write each `checkable` criterion's
**script** into the DoD file and freeze it:

```
node <skill-dir>/scripts/dod-freeze.mjs --dod .loom/<name>.dod.json \
  --checks-dir .loom/<name>.checks
```

Every check becomes an executable file with a frozen `sha256`. A criterion defaults to
`baseline: "red"` — **it must FAIL before the work starts**, or it cannot discriminate this
run and DoDBaseline fails the run. Use `"green-ok"` only for genuine regression guards, and
confirm that waiver in the same one-shot `AskUserQuestion` as the criteria.

Copy the seed: `scripts/seeds/lite.json` or `scripts/seeds/delivery.json` →
`.loom/<name>.graph.json`, setting `name` and `goal`.

### 3. Pre-flight — plan, review, approve

Run Setup + the bootstrap planner first, so the human reviews a graph grounded in the
**actual repo** rather than a guess. Then serve the editor:

```
node <skill-dir>/scripts/graph-server.mjs --name <name> --root . --port 0
```

Read `LOOM_SERVER_PORT=<port>` from stdout, record it in `state.json`, and give the user
`http://127.0.0.1:<port>`. Set `status: "awaiting-approval"`.

Then poll `.loom/<name>.action.json`:
- `replan` → run a replan worker over `(graph, comments)`, write the new graph, keep polling
- `approve` → freeze: set `locked: true` on every `invariants.mustCross` node and its edges,
  stamp `invariants.lockedHash`, set `approved: true`

### 4. Generate and launch

```
node <skill-dir>/scripts/scaffold-loom.cjs --name <name> \
  --graph .loom/<name>.graph.json --force
Workflow({ scriptPath: ".loom/<name>.js" })
```

**Never hand-edit the generated script** — change the generator and regenerate.

**Headless (`claude -p`): launch in the FOREGROUND (`run_in_background: false`) and do not
end your turn while it runs.** The blocking call IS the wait. Afterwards re-read
`state.json` and confirm `status` is no longer `running`.

### 5. Resume

```
Workflow({ scriptPath: ".loom/<name>.js", args: {
  graph, visits, results, carry, trace, cursor } })
```

taken from `state.json`. **`args.graph` MUST be the persisted patched graph, not the seed.**
Resume restores *structure*, not just progress — replaying the approved topology silently
discards every runtime patch, and nothing will tell you it happened.

### 6. Finalize

Stamp `status` + `finishedAt` (the conductor cannot), `failed` if it threw. Kill the editor
server. Run `loom-report.cjs <name>` and hand over the report, the branch and the worktree.
**Never auto-merge and never auto-remove the worktree** — that is the human's call.
</procedure>

<gotchas>
- Nodes are **at-least-once** and must be **idempotent**; a re-run may return a different
  verdict and take a different edge. That is accepted.
- A rejected patch is **logged, not fatal** — check `trace` for `patch: 'rejected'`.
- `invariants.lockedHash` is FNV-1a: a **drift detector**, not a cryptographic guarantee.
  DoD `checkSha` is real sha256.
- Visit caps live only in `invariants.visitCaps`. Never add a `visitCap` field to a node.
- A dead session orphans the editor server; `list-runs.cjs` shows the stale port.
</gotchas>

<resources>
- `scripts/` — `graph-core.mjs` (all graph math; **the one source**) · `scaffold-loom.cjs`
  (step 4) · `graph-server.mjs` + `editor/` (step 3) · `dod-freeze.mjs` (step 2) ·
  `loom-report.cjs` / `list-runs.cjs` (steps 1, 6) · `test-loom.cjs` (regression net).
- `references/` — `graph-spec.md` (field reference) · `invariants.md` (why gates cannot be
  bypassed).
</resources>
```

- [ ] **Step 4: Write the references**

Create `plugins/lirbox/skills/loom/references/graph-spec.md` documenting every field of `graph.json`: `start`, `terminal`, `version`, `approved`; node fields `id`, `kind`, `prompt`, `schema`, `model`, `agentType`, `locked`, `pos`; edge fields `from`, `to`, `when`, `carry`, `locked`; the predicate operators `eq`/`neq`/`gt`/`lt`/`exists` and the `"always"` shorthand with the fail-closed rule; and `invariants` (`mustCross`, `lockedHash`, `visitCaps`, `nodeBudget`). Include the full `delivery.json` seed as the worked example.

Create `plugins/lirbox/skills/loom/references/invariants.md` containing the dominance argument in prose: what dominance means, why deletion-reachability computes it, why the structural check from `start` is insufficient alone once back-edges exist, the worked `start → DoDGate → Implement → terminal` counter-example, and the accept/reject table from Task 3's fixtures.

- [ ] **Step 5: Wire the marketplace and gitignore**

Append to `.gitignore`, next to the other runtime-artifact entries:

```
# Build-time scratch left by loom (graph, state, checks, editor action files)
.loom/
```

Add loom to the skill catalog table in `README.md`, in the orchestration/loop family alongside `conductor`, `prospector`, `whetstone` and `arena`, described as: *graph-shaped delivery — gate failures loop back, the graph rewrites itself under invariants, previewed and edited in the browser before launch.*

- [ ] **Step 6: Run the full net and validate the plugin**

```bash
node plugins/lirbox/skills/loom/scripts/test-loom.cjs
claude plugin validate .
```

Expected: `all green`, and the plugin validates.

- [ ] **Step 7: Confirm the other skills are untouched**

```bash
node plugins/lirbox/skills/conductor/scripts/test-scaffold.cjs
node plugins/lirbox/skills/prospector/scripts/test-optimize.cjs
node plugins/lirbox/skills/whetstone/scripts/test-improve.cjs
node plugins/lirbox/skills/arena/scripts/test-arena.cjs
```

Expected: all four green. loom is a parallel skill; if any of these changed, something was edited that should not have been.

- [ ] **Step 8: Commit**

```bash
git add plugins/lirbox/skills/loom/ .gitignore README.md
git commit -m "feat(loom): skill entry point, references, and marketplace wiring"
```

---

### Task 11: Tier 2 evals — floor, checks, manifest

The repo requires Tier 2 to ship a skill: `evals/floor/`, `evals/checks/`, `evals/checks-manifest.json`, green under `node scripts/evals-all.mjs --fast`. The **floor** is characterization ("this must not break"); the **checks** are frozen acceptance fences for past fixes. This task freezes the five Critical defects found while building loom, so none can silently return.

**Files:**
- Create: `plugins/lirbox/skills/loom/evals/floor/00-structure.test.mjs`
- Create: `plugins/lirbox/skills/loom/evals/floor/01-net.test.mjs`
- Create: `plugins/lirbox/skills/loom/evals/checks/gate-dominance-not-bypassable.check.mjs`
- Create: `plugins/lirbox/skills/loom/evals/checks/cursor-rename-fails-closed.check.mjs`
- Create: `plugins/lirbox/skills/loom/evals/checks/interpreter-no-terminal-fallback.check.mjs`
- Create: `plugins/lirbox/skills/loom/evals/checks/purity-scan-has-teeth.check.mjs`
- Create: `plugins/lirbox/skills/loom/evals/checks/dod-check-hash-lock.check.mjs`
- Create: `plugins/lirbox/skills/loom/evals/checks/gate-failure-edges-return.check.mjs`
- Create: `plugins/lirbox/skills/loom/evals/checks/baseline-discrimination-structural.check.mjs`
- Create: `plugins/lirbox/skills/loom/evals/checks/server-no-lost-update.check.mjs`
- Create: `plugins/lirbox/skills/loom/evals/checks/editor-escapes-approval-gate.check.mjs`
- Create: `plugins/lirbox/skills/loom/evals/checks-manifest.json`

**Interfaces:**
- Consumes: everything from Tasks 1–10.
- Produces: a suite green under `node scripts/evals-all.mjs --fast`.

**`evals/**` is LOCKED** — improvement loops may never edit it. Every file says so in its header, matching `prospector`'s convention. That lock is the point: a loop that could edit its own fence could escape it.

- [ ] **Step 0: Rebase onto main FIRST**

The three-tier release policy (and the Harbor tooling Task 12 needs) lands on `main` separately from this branch. Pick it up before writing any evals, so this task is built against the real policy rather than a snapshot of it:

```bash
git fetch origin
git rebase origin/main
node plugins/lirbox/skills/loom/scripts/test-loom.cjs   # must still exit 0 after the rebase
grep -n "Tier 2" CLAUDE.md                              # confirm the policy is now present
ls scripts/evals-all.mjs scripts/harbor-port.mjs 2>&1   # confirm the tooling arrived
```

If the rebase conflicts, resolve in favour of `main` for `CLAUDE.md` and repo-level `scripts/`, and in favour of this branch for everything under `plugins/lirbox/skills/loom/`. Re-run the net before continuing. If `harbor-port.mjs` is now present, **Task 12 is unblocked** — it was deferred only because that tooling did not exist on this branch.

- [ ] **Step 1: Write the floor tests**

`evals/floor/00-structure.test.mjs`:

```js
// FLOOR (characterization) — SKILL.md is structurally a valid skill.
// Locked (evals/**): improvement loops may NEVER edit this file.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(HERE, '..', '..');
const dir = basename(SKILL_DIR);
const fm = (readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8').match(/^---\n([\s\S]*?)\n---/) || [, ''])[1];

let bad = 0;
const ok = (c, m) => { if (c) { console.log(`PASS floor: ${m}`); } else { console.error(`FAIL floor: ${m}`); bad++; } };

ok(!!fm, 'SKILL.md opens with a frontmatter block');
ok(/^name:\s*\S/m.test(fm), 'frontmatter declares name');
ok(/^description:\s*\S/m.test(fm), 'frontmatter declares a non-empty description');
const nameMatch = fm.match(/^name:\s*"?([A-Za-z0-9_-]+)"?/m);
ok(!!nameMatch && nameMatch[1] === dir, `name matches the skill directory (${dir})`);

for (const f of ['graph-core.mjs', 'scaffold-loom.cjs', 'graph-server.mjs',
                 'dod-freeze.mjs', 'loom-report.cjs', 'list-runs.cjs', 'test-loom.cjs']) {
  ok(existsSync(join(SKILL_DIR, 'scripts', f)), `scripts/${f} exists`);
}
for (const f of ['graph-spec.md', 'invariants.md']) {
  ok(existsSync(join(SKILL_DIR, 'references', f)), `references/${f} exists`);
}
for (const f of ['lite.json', 'delivery.json']) {
  ok(existsSync(join(SKILL_DIR, 'scripts', 'seeds', f)), `scripts/seeds/${f} exists`);
}

if (bad) { console.error(`\n00-structure: ${bad} assertion(s) failed`); process.exit(1); }
console.log('00-structure: ok');
```

`evals/floor/01-net.test.mjs`:

```js
// FLOOR (characterization) — the regression net is GREEN.
// Runs scripts/test-loom.cjs, which pins all graph math, the generator, the emitted
// interpreter's shape, the server routes, the DoD freezing, and the report scripts.
// PASSES on baseline.
// Locked (evals/**): improvement loops may NEVER edit this file.
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const NET = resolve(HERE, '..', '..', 'scripts', 'test-loom.cjs');

try {
  execFileSync('node', [NET], { stdio: 'inherit' });
  console.log('01-net: ok (test-loom.cjs green)');
} catch {
  console.error('01-net: FAIL — scripts/test-loom.cjs did not pass');
  process.exit(1);
}
```

- [ ] **Step 2: Run the floor and confirm it passes**

```bash
node plugins/lirbox/skills/loom/evals/floor/00-structure.test.mjs
node plugins/lirbox/skills/loom/evals/floor/01-net.test.mjs
```

Expected: both print `ok`, exit 0.

- [ ] **Step 3: Write the five frozen checks**

Each check reproduces one Critical found during this build and asserts it stays fixed. Each is standalone: exit 0 = green, exit 1 = the defect is back.

`evals/checks/gate-dominance-not-bypassable.check.mjs`:

```js
// CHECK — validateGraph must read invariants from the APPROVED graph, never from the
// graph under validation. Reading them from `next` was a full bypass: submit
// mustCross: [] plus an unlocked bypass edge and validation returned [] while the
// terminal was reachable crossing no gate.
// Locked (evals/**): improvement loops may NEVER edit this file.
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const core = await import(resolve(HERE, '..', '..', 'scripts', 'graph-core.mjs'));

const APPROVED = {
  start: 'Setup', terminal: 'Done',
  nodes: [{ id: 'Setup' }, { id: 'Implement' }, { id: 'Review', locked: true },
          { id: 'DoDGate', locked: true }, { id: 'PR' }, { id: 'Done' }],
  edges: [
    { from: 'Setup', to: 'Implement', when: 'always' },
    { from: 'Implement', to: 'Review', when: 'always' },
    { from: 'Review', to: 'Implement', when: { field: 'passed', eq: false } },
    { from: 'Review', to: 'DoDGate', when: { field: 'passed', eq: true } },
    { from: 'DoDGate', to: 'Implement', when: { field: 'passed', eq: false }, locked: true },
    { from: 'DoDGate', to: 'PR', when: { field: 'passed', eq: true }, locked: true },
    { from: 'PR', to: 'Done', when: 'always' },
  ],
  invariants: { mustCross: ['Review', 'DoDGate'], visitCaps: { '*': 3 }, nodeBudget: 40 },
};
APPROVED.invariants.lockedHash = core.lockedFingerprint(APPROVED);

let bad = 0;
const ok = (c, m) => { if (c) { console.log(`PASS ${m}`); } else { console.error(`FAIL ${m}`); bad++; } };

ok(core.validateGraph(APPROVED, APPROVED, null).length === 0, 'approved graph validates clean');

const attack = JSON.parse(JSON.stringify(APPROVED));
attack.invariants.mustCross = [];
attack.edges.push({ from: 'Implement', to: 'Done', when: 'always' });
const v = core.validateGraph(attack, APPROVED, null);
ok(v.length > 0, 'emptying mustCross + unlocked bypass edge is REJECTED');
ok(v.some((m) => /dominates/.test(m)), "prev's mustCross still governs");
ok(core.reachable(attack, 'Setup', ['DoDGate']).has('Done'),
  'fixture is only meaningful if the bypass really reaches the terminal');

const budget = JSON.parse(JSON.stringify(APPROVED));
budget.invariants.nodeBudget = 9999;
for (let i = 0; i < 60; i++) {
  budget.nodes.push({ id: `P${i}` });
  budget.edges.push({ from: 'Implement', to: `P${i}`, when: 'always' });
}
ok(core.validateGraph(budget, APPROVED, null).some((m) => /budget/.test(m)),
  "prev's nodeBudget governs, not the submitted one");

if (bad) { console.error(`\ngate-dominance-not-bypassable: ${bad} failed`); process.exit(1); }
console.log('gate-dominance-not-bypassable: ok');
```

`evals/checks/cursor-rename-fails-closed.check.mjs`:

```js
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
```

`evals/checks/interpreter-no-terminal-fallback.check.mjs`:

```js
// CHECK — the emitted interpreter must HARD-FAIL on an unmatched result, never route to
// the terminal. `edge ? edge.to : graph.terminal` skipped every remaining gate on any
// off-shape agent result: 6 of 8 plausible shapes reached the terminal, no patch needed.
// Locked (evals/**): improvement loops may NEVER edit this file.
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = resolve(HERE, '..', '..', 'scripts');
const core = await import(join(SCRIPTS, 'graph-core.mjs'));

let bad = 0;
const ok = (c, m) => { if (c) { console.log(`PASS ${m}`); } else { console.error(`FAIL ${m}`); bad++; } };

// 1. The generated conductor must not contain the fallback, and must contain the throw.
const g = {
  name: 'c', goal: 'c', start: 'S', terminal: 'D',
  nodes: [{ id: 'S', kind: 'work', prompt: 'go' },
          { id: 'G', kind: 'gate', locked: true, prompt: 'judge' }, { id: 'D', kind: 'terminal' }],
  edges: [{ from: 'S', to: 'G', when: 'always' },
          { from: 'G', to: 'D', when: { field: 'passed', eq: true }, locked: true },
          { from: 'G', to: 'S', when: { field: 'passed', eq: false }, locked: true }],
  invariants: { mustCross: ['G'], visitCaps: { '*': 3 }, nodeBudget: 20 },
};
g.invariants.lockedHash = core.lockedFingerprint(g);
const tmp = mkdtempSync(join(tmpdir(), 'loom-check-'));
const gf = join(tmp, 'g.json'), out = join(tmp, 'c.js');
writeFileSync(gf, JSON.stringify(g));
execFileSync('node', [join(SCRIPTS, 'scaffold-loom.cjs'), '--name', 'c',
  '--graph', gf, '--out', out, '--force'], { stdio: 'pipe' });
const src = readFileSync(out, 'utf8');
ok(!/edge \? edge\.to : graph\.terminal/.test(src), 'no silent terminal fallback in the conductor');
ok(/no edge matched at/.test(src), 'conductor hard-fails on an unmatched result');

// 2. The behaviour: off-shape results must match NO edge, so the interpreter throws.
const P = {
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
for (const r of [{ passed: 'true' }, { passed: 1 }, {}, { verdict: true }, null, { ok: true }]) {
  ok(core.pickEdge(P, 'GateA', r) === null, `off-shape result matches no edge: ${JSON.stringify(r)}`);
}
ok(core.pickEdge(P, 'GateA', { passed: true }).to === 'GateB', 'well-formed pass still routes');
ok(core.pickEdge(P, 'GateA', { passed: false }).to === 'Setup', 'well-formed fail still routes');

// 3. Dead ends are rejected at validation, before a run can start.
const dead = core.applyPatchTo(g, { addNodes: [{ id: 'Dead' }],
  addEdges: [{ from: 'S', to: 'Dead', when: { field: 'q', eq: 1 } }] });
ok(core.validateGraph(dead, g, null).some((m) => /dead-end/.test(m)), 'dead-end node rejected');

if (bad) { console.error(`\ninterpreter-no-terminal-fallback: ${bad} failed`); process.exit(1); }
console.log('interpreter-no-terminal-fallback: ok');
```

`evals/checks/purity-scan-has-teeth.check.mjs`:

```js
// CHECK — the restricted-layer scan must stay scoped AND keep its teeth, and the emitted
// conductor must contain no LIVE template-literal interpolation (the invariant that
// licenses blanking template literals whole).
// Locked (evals/**): improvement loops may NEVER edit this file.
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = resolve(HERE, '..', '..', 'scripts');
const core = await import(join(SCRIPTS, 'graph-core.mjs'));

// ONE tokenizer — must stay identical to the one in scripts/test-loom.cjs.
// Three earlier approaches failed: blank-whole hid interpolations; regex-extract
// could not tell escaped from live and died on nested braces; whole-blanking plus a
// separate comment-blind character walk let TWO parsers disagree, so one unpaired
// backtick in a comment hid a real Date.now() from both.
const conductorBody = (src) => {
  let out = '';
  let i = 0;
  const n = src.length;
  const stack = [{ mode: 'code', depth: 0, interp: false }];
  while (i < n) {
    const top = stack[stack.length - 1];
    const c = src[i], c2 = src[i + 1];
    if (top.mode === 'tmpl') {
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { stack.pop(); out += '""'; i++; continue; }
      if (c === '$' && c2 === '{') {
        stack.push({ mode: 'code', depth: 0, interp: true });
        out += ' '; i += 2; continue;
      }
      i++; continue;
    }
    if (c === '/' && c2 === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && c2 === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2; continue;
    }
    if (c === "'" || c === '"') {
      const q = c; i++;
      while (i < n && src[i] !== q) { if (src[i] === '\\') i++; i++; }
      i++; out += '""'; continue;
    }
    if (c === '`') { stack.push({ mode: 'tmpl' }); i++; continue; }
    if (top.interp) {
      if (c === '{') { top.depth++; out += c; i++; continue; }
      if (c === '}') {
        if (top.depth === 0) { stack.pop(); out += ' '; i++; continue; }
        top.depth--; out += c; i++; continue;
      }
    }
    out += c; i++;
  }
  return out;
};

const FORBIDDEN = [
  ['require(', /\brequire\s*\(/], ['Date.now', /\bDate\.now\s*\(/],
  ['new Date', /\bnew Date\b/], ['Math.random', /\bMath\.random\s*\(/],
  ['crypto', /\bcrypto\b/], ['fs.', /\bfs\s*\./],
];

let bad = 0;
const ok = (c, m) => { if (c) { console.log(`PASS ${m}`); } else { console.error(`FAIL ${m}`); bad++; } };

// Node prompts deliberately name forbidden primitives as PROSE — must not false-positive.
const g = {
  name: 's', goal: 's', start: 'S', terminal: 'D',
  nodes: [{ id: 'S', kind: 'work', prompt: 'Do not use fs. or Date.now() or crypto here.' },
          { id: 'G', kind: 'gate', locked: true, prompt: 'Judge. Math.random() in prose.' },
          { id: 'D', kind: 'terminal' }],
  edges: [{ from: 'S', to: 'G', when: 'always' },
          { from: 'G', to: 'D', when: { field: 'passed', eq: true }, locked: true },
          { from: 'G', to: 'S', when: { field: 'passed', eq: false }, locked: true }],
  invariants: { mustCross: ['G'], visitCaps: { '*': 3 }, nodeBudget: 20 },
};
g.invariants.lockedHash = core.lockedFingerprint(g);
const tmp = mkdtempSync(join(tmpdir(), 'loom-scan-'));
const gf = join(tmp, 'g.json'), out = join(tmp, 's.js');
writeFileSync(gf, JSON.stringify(g));
execFileSync('node', [join(SCRIPTS, 'scaffold-loom.cjs'), '--name', 's',
  '--graph', gf, '--out', out, '--force'], { stdio: 'pipe' });
const src = readFileSync(out, 'utf8');

ok(!FORBIDDEN.some(([, re]) => re.test(conductorBody(src))),
  'no false positive on prose in comments and node prompts');
ok(FORBIDDEN.every(([, re]) => !re.test(conductorBody(
  '// see the `unclosed markdown code span\nconst bad = `real: ${1}`'))),
  'a stray backtick in a comment does not shift template parity (control: no forbidden code)');

for (const [label, code] of [
  ['Date.now', 'const t = Date.now()'], ['Math.random', 'const r = Math.random()'],
  ['require', 'const x = require("fs")'], ['fs.', 'fs.writeFileSync(a, b)'],
  ['new Date', 'const d = new Date()'], ['crypto', 'const h = crypto.createHash("sha256")'],
]) {
  const tampered = conductorBody(src.replace('const NAME =', code + '\nconst NAME ='));
  ok(FORBIDDEN.some(([, re]) => re.test(tampered)), `scan still catches injected ${label}`);
}

// The three shapes that defeated earlier approaches must all be CAUGHT.
ok(FORBIDDEN.some(([, re]) => re.test(conductorBody('const x = `${f({a: Date.now()})}`'))),
  'nested-brace interpolation is scanned');
ok(FORBIDDEN.some(([, re]) => re.test(conductorBody(
  '// stray ` tick\nconst bad = `real: ${Date.now()}`'))),
  'stray backtick in a comment cannot hide a live interpolation');
// And an escaped placeholder named crypto must NOT false-positive.
ok(!FORBIDDEN.some(([, re]) => re.test(conductorBody('const p = `\\${crypto}`'))),
  'escaped placeholder named crypto stays clean');

if (bad) { console.error(`\npurity-scan-has-teeth: ${bad} failed`); process.exit(1); }
console.log('purity-scan-has-teeth: ok');
```

`evals/checks/dod-check-hash-lock.check.mjs`:

```js
// CHECK — DoD check files must be sha256-locked, so weakening the thing a check runs is
// DETECTED rather than rewarded. Also: baseline defaults to "red" (a criterion already
// met before the work cannot discriminate it).
// Locked (evals/**): improvement loops may NEVER edit this file.
import { mkdtempSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const FREEZE = resolve(HERE, '..', '..', 'scripts', 'dod-freeze.mjs');
const m = await import(FREEZE);

const tmp = mkdtempSync(join(tmpdir(), 'loom-dod-'));
const dodPath = join(tmp, 'dod.json');
const checksDir = join(tmp, 'checks');
writeFileSync(dodPath, JSON.stringify({ criteria: [
  { id: 'c1', text: 'behaviour holds', tier: 'checkable',
    script: '#!/usr/bin/env bash\nexit 1\n' },
  { id: 'c2', text: 'suite still passes', tier: 'checkable', baseline: 'green-ok',
    script: '#!/usr/bin/env bash\nexit 0\n' },
] }));
execFileSync('node', [FREEZE, '--dod', dodPath, '--checks-dir', checksDir], { stdio: 'pipe' });
const frozen = JSON.parse(readFileSync(dodPath, 'utf8'));

let bad = 0;
const ok = (c, msg) => { if (c) { console.log(`PASS ${msg}`); } else { console.error(`FAIL ${msg}`); bad++; } };

const c1 = frozen.criteria.find((c) => c.id === 'c1');
ok(/^sha256:[0-9a-f]{64}$/.test(c1.checkSha), 'check file carries a sha256 lock');
ok(c1.script === undefined, 'inline script was moved to a file, not duplicated');
ok(c1.baseline === 'red', 'baseline defaults to red');
ok(frozen.criteria.find((c) => c.id === 'c2').baseline === 'green-ok', 'green-ok waiver preserved');
ok(m.verifyChecks(frozen, tmp).every((r) => r.ok), 'untouched checks verify');

writeFileSync(join(checksDir, 'c1.sh'), '#!/usr/bin/env bash\nexit 0\n');
const weakened = m.verifyChecks(frozen, tmp).find((r) => r.id === 'c1');
ok(weakened.ok === false && /sha|hash|modified/i.test(weakened.reason),
  'a WEAKENED check file is detected');

unlinkSync(join(checksDir, 'c2.sh'));
const deleted = m.verifyChecks(frozen, tmp).find((r) => r.id === 'c2');
ok(deleted.ok === false && /missing/i.test(deleted.reason), 'a DELETED check file is detected');

if (bad) { console.error(`\ndod-check-hash-lock: ${bad} failed`); process.exit(1); }
console.log('dod-check-hash-lock: ok');
```

- [ ] **Step 3b: Write the four later-Critical checks**

The five checks above freeze the Criticals found in Tasks 1–5. Four more were found afterwards, in Tasks 5–8, and they need fences too — a suite that freezes half a run's findings implies the other half is covered.

`evals/checks/gate-failure-edges-return.check.mjs`:

```js
// CHECK — only a gate's LOCKED PASSING edge may lead onward. Dominance proves a gate is
// VISITED, not that it PASSED: `DoDGate --fail--> Done` left the gate on every path and
// still ended the run with it unsatisfied. In lite, pickEdge returned the SAME
// destination for {passed:true} and {passed:false} — the verdict was inert.
// Locked (evals/**): improvement loops may NEVER edit this file.
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { readFileSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = resolve(HERE, '..', '..', 'scripts');
const core = await import(join(SCRIPTS, 'graph-core.mjs'));

let bad = 0;
const ok = (c, m) => { if (c) { console.log(`PASS ${m}`); } else { console.error(`FAIL ${m}`); bad++; } };

for (const profile of ['lite', 'delivery']) {
  const seed = JSON.parse(readFileSync(join(SCRIPTS, 'seeds', `${profile}.json`), 'utf8'));
  const gate = seed.invariants.mustCross[seed.invariants.mustCross.length - 1];
  const fail = seed.edges.find((e) => e.from === gate && e.when && e.when.eq === false);

  ok(core.validateGraph(seed, seed, null).length === 0, `${profile}: baseline validates`);

  // Every shape that lets a not-passing gate lead onward must be rejected.
  const reroute = core.applyPatchTo(seed, {
    removeEdges: [{ from: gate, to: fail.to }],
    addEdges: [{ from: gate, to: seed.terminal, when: fail.when }] });
  ok(core.validateGraph(reroute, seed, null).length > 0, `${profile}: failure edge -> terminal rejected`);

  const always = core.applyPatchTo(seed, {
    addEdges: [{ from: gate, to: seed.terminal, when: 'always' }] });
  ok(core.validateGraph(always, seed, null).length > 0, `${profile}: appended always-edge rejected`);

  for (const field of ['passed', 'anythingAtAll']) {
    const mint = core.applyPatchTo(seed, {
      addEdges: [{ from: gate, to: seed.terminal, when: { field, eq: true } }] });
    ok(core.validateGraph(mint, seed, null).length > 0,
      `${profile}: minted pass edge on '${field}' rejected`);
  }

  // ...and legitimate reshaping of the failure path must still be accepted AND reachable.
  const spliced = core.applyPatchTo(seed, {
    removeEdges: [{ from: gate, to: fail.to }],
    addNodes: [{ id: 'Spike', kind: 'work' }],
    addEdges: [{ from: gate, to: 'Spike', when: { field: 'passed', eq: false } },
               { from: 'Spike', to: fail.to, when: 'always' }] });
  ok(core.validateGraph(spliced, seed, null).length === 0, `${profile}: spike splice accepted`);
  ok((core.pickEdge(spliced, gate, { passed: false }) || {}).to === 'Spike',
    `${profile}: spliced node is REACHABLE, not shadowed`);
}

if (bad) { console.error(`\ngate-failure-edges-return: ${bad} failed`); process.exit(1); }
console.log('gate-failure-edges-return: ok');
```

`evals/checks/baseline-discrimination-structural.check.mjs`:

```js
// CHECK — DoDBaseline's "a non-discriminating baseline stops the run" must be enforced by the
// GRAPH, not by prompt prose. Its out-edge was once when:"always", so a worker honestly
// reporting discriminates:false routed onward and the run continued. Worse than enforced by
// prose — enforced by nothing.
// Locked (evals/**): improvement loops may NEVER edit this file.
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { readFileSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = resolve(HERE, '..', '..', 'scripts');
const core = await import(join(SCRIPTS, 'graph-core.mjs'));
const seed = JSON.parse(readFileSync(join(SCRIPTS, 'seeds', 'delivery.json'), 'utf8'));

let bad = 0;
const ok = (c, m) => { if (c) { console.log(`PASS ${m}`); } else { console.error(`FAIL ${m}`); bad++; } };

const out = seed.edges.filter((e) => e.from === 'DoDBaseline');
ok(out.length === 1, 'DoDBaseline has exactly one out-edge');
ok(out[0].when && out[0].when.field === 'discriminates' && out[0].when.eq === true,
  'that edge requires discriminates === true');

ok((core.pickEdge(seed, 'DoDBaseline', { discriminates: true }) || {}).to === 'Plan',
  'a discriminating baseline advances');
for (const r of [{ discriminates: false }, { baselines: [] }, { discriminates: 1 },
                 { discriminates: 'true' }, null]) {
  ok(core.pickEdge(seed, 'DoDBaseline', r) === null,
    `no edge matches ${JSON.stringify(r)} — interpreter hard-fails`);
}

// The tamper signal must stay reportable and distinct from an ordinary failure.
const gate = seed.nodes.find((n) => n.id === 'DoDGate');
ok(gate.schema.properties.criteria.items.properties.verdict.enum.includes('TAMPERED'),
  'DoDGate can report TAMPERED distinctly from UNMET');

if (bad) { console.error(`\nbaseline-discrimination-structural: ${bad} failed`); process.exit(1); }
console.log('baseline-discrimination-structural: ok');
```

`evals/checks/server-no-lost-update.check.mjs`:

```js
// CHECK — POST /graph must not silently discard a concurrent save. Two valid saves once both
// returned 200 with sequential versions and one edit vanished, the client told it succeeded.
// The wrapper is mandatory: a bare body, or a wrapper with baseVersion omitted, were both
// supported ways to opt out of the check entirely.
// Locked (evals/**): improvement loops may NEVER edit this file.
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = resolve(HERE, '..', '..', 'scripts');

const root = mkdtempSync(join(tmpdir(), 'loom-eval-'));
mkdirSync(join(root, '.loom', 'state'), { recursive: true });
writeFileSync(join(root, '.loom', 'e.graph.json'),
  readFileSync(join(SCRIPTS, 'seeds', 'delivery.json'), 'utf8'));

const srv = spawn('node', [join(SCRIPTS, 'graph-server.mjs'), '--name', 'e', '--root', root, '--port', '0']);
const port = await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('server did not start')), 8000);
  srv.stdout.on('data', (b) => {
    const m = /LOOM_SERVER_PORT=(\d+)/.exec(b.toString());
    if (m) { clearTimeout(t); res(Number(m[1])); }
  });
});
const base = `http://127.0.0.1:${port}`;
const post = (b) => fetch(`${base}/graph`, { method: 'POST',
  headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.status);

let bad = 0;
const ok = (c, m) => { if (c) { console.log(`PASS ${m}`); } else { console.error(`FAIL ${m}`); bad++; } };
try {
  const g = await (await fetch(`${base}/graph`)).json();
  const mk = (id) => {
    const c = JSON.parse(JSON.stringify(g));
    c.nodes.push({ id, kind: 'work', prompt: 'x' });
    c.edges.push({ from: 'Implement', to: id, when: { field: 'k', eq: 1 } });
    c.edges.push({ from: id, to: 'Implement', when: 'always' });
    return c;
  };

  ok(await post(mk('Bare')) === 400, 'a bare graph body is refused');
  ok(await post({ graph: mk('NoBase') }) === 400, 'a wrapper without baseVersion is refused');

  const [a, b] = await Promise.all([
    post({ baseVersion: g.version, graph: mk('RaceA') }),
    post({ baseVersion: g.version, graph: mk('RaceB') })]);
  ok([a, b].sort().join(',') === '200,409',
    `exactly one concurrent save wins and the loser is told (got ${a},${b})`);
} finally { srv.kill(); }

if (bad) { console.error(`\nserver-no-lost-update: ${bad} failed`); process.exit(1); }
console.log('server-no-lost-update: ok');
```

`evals/checks/editor-escapes-approval-gate.check.mjs`:

```js
// CHECK — every dynamic value in the editor's panel must be escaped before innerHTML.
// Node ids arrive from planner graphPatches (LLM text), and the panel is the page that IS
// the human approval gate, with access to the loopback server. Escaping only `prompt` left
// id and kind raw.
// Locked (evals/**): improvement loops may NEVER edit this file.
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { readFileSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const EDITOR = resolve(HERE, '..', '..', 'scripts', 'editor');
const js = readFileSync(join(EDITOR, 'editor.js'), 'utf8');
const html = readFileSync(join(EDITOR, 'index.html'), 'utf8');

let bad = 0;
const ok = (c, m) => { if (c) { console.log(`PASS ${m}`); } else { console.error(`FAIL ${m}`); bad++; } };

const panel = js.slice(js.indexOf('function renderPanel'));
const body = panel.slice(0, panel.indexOf('`;') + 2);
const raw = [...body.matchAll(/\$\{([^}]+)\}/g)].map((m) => m[1].trim())
  .filter((e) => !/^locked \?/.test(e)).filter((e) => !/^esc\(/.test(e));
ok(raw.length === 0, `no unescaped interpolation reaches innerHTML (found ${JSON.stringify(raw)})`);
ok(/replace\(\/&\/g, '&amp;'\)/.test(js), 'esc escapes & first, avoiding double-encoding');
ok(/from ['"]\.\/graph-core\.mjs['"]/.test(js), 'validateGraph is imported, not reimplemented');
ok(/baseVersion: graph\.version, graph: next/.test(js), 'saves send the concurrency wrapper');

const external = [...html.matchAll(/<(script|link)\b[^>]*>/g)].map((m) => m[0])
  .filter((t) => /https?:\/\//.test(t));
ok(external.length >= 4, 'four external subresources are present');
for (const tag of external) {
  ok(/integrity="sha384-[A-Za-z0-9+/=]+"/.test(tag) && /crossorigin="anonymous"/.test(tag),
    `SRI + crossorigin present on ${tag.slice(0, 48)}...`);
}
ok(!/REPLACE_WITH_SRI/.test(html), 'no SRI placeholder remains');

if (bad) { console.error(`\neditor-escapes-approval-gate: ${bad} failed`); process.exit(1); }
console.log('editor-escapes-approval-gate: ok');
```

- [ ] **Step 4: Write the manifest**

`evals/checks-manifest.json` — a check missing from this file fails the gate, because an unlisted check is an unguarded check:

```json
{
  "_comment": [
    "Expectation manifest for loom's frozen acceptance-checks.",
    "Enforced repo-wide by scripts/evals-all.mjs on every push and PR.",
    "",
    "expect \"green\" = a past fix that must not regress. MUST exit 0.",
    "expect \"red\"   = a known-failing check (open concern). MUST exit 0 or 1.",
    "",
    "A check file missing from this manifest FAILS the gate.",
    "LOCKED (evals/**): improvement loops may never edit this file."
  ],
  "checks": {
    "gate-dominance-not-bypassable": { "expect": "green" },
    "cursor-rename-fails-closed": { "expect": "green" },
    "interpreter-no-terminal-fallback": { "expect": "green" },
    "purity-scan-has-teeth": { "expect": "green" },
    "dod-check-hash-lock": { "expect": "green" },
    "gate-failure-edges-return": { "expect": "green" },
    "baseline-discrimination-structural": { "expect": "green" },
    "server-no-lost-update": { "expect": "green" },
    "editor-escapes-approval-gate": { "expect": "green" }
  }
}
```

- [ ] **Step 5: Run every check individually, then the repo gate**

```bash
for f in plugins/lirbox/skills/loom/evals/checks/*.check.mjs; do
  echo "--- $f"; node "$f" || echo "RED: $f"
done
node scripts/evals-all.mjs --fast
```

Expected: all five print `ok` and exit 0; the repo gate is green.

- [ ] **Step 6: Prove each check can actually fail**

A check that cannot go red is not a fence. For each, temporarily break the thing it guards and confirm the check exits 1, then restore. Do this in a scratch copy — **never** commit a broken source file:

```bash
cp plugins/lirbox/skills/loom/scripts/graph-core.mjs /tmp/graph-core.bak
# invariants bypass: read invariants from `next` again
sed -i '' 's|const inv = (prev \&\& prev.invariants) ? prev.invariants : (next.invariants || {});|const inv = next.invariants || {};|' \
  plugins/lirbox/skills/loom/scripts/graph-core.mjs
node plugins/lirbox/skills/loom/evals/checks/gate-dominance-not-bypassable.check.mjs; echo "exit=$? (want 1)"
cp /tmp/graph-core.bak plugins/lirbox/skills/loom/scripts/graph-core.mjs
node plugins/lirbox/skills/loom/evals/checks/gate-dominance-not-bypassable.check.mjs; echo "exit=$? (want 0)"
```

Repeat the same pattern for the other four (restore the silent terminal fallback in `scaffold-loom.cjs`; restore the permissive `idSet.has(cursor.node)` guard; blank template literals in a way that hides an injected primitive; drop the sha comparison in `dod-freeze.mjs`). Record the observed exit codes in your report. Confirm `git status` is clean afterwards.

- [ ] **Step 7: Commit**

```bash
git add plugins/lirbox/skills/loom/evals/
git commit -m "test(loom): tier-2 evals — floor plus five frozen Critical fences

Freezes every Critical found while building loom: the invariants bypass, the
cursor-rename bypass, the interpreter's terminal fallback, the purity scan's
teeth, and the DoD check hash lock. Each was a real defect that shipped green
under the previous test suite."
```

---

## Post-Plan: End-to-End Acceptance

Run these against a real repository after Task 10. They are the spec's §10 run-level criteria and none of them is covered by the unit net.

- [ ] **A1 — the back-edge fires.** Start a delivery run whose DoD contains a criterion the first implementation will miss. Confirm `trace` shows `DoDGate#1 FAIL -> Implement`, that `carry.Implement.unmetCriteria` holds the unmet ids, that `Implement` runs a second time, and that the run then reaches PR.
- [ ] **A2 — resume restores structure.** Kill the session after `trace` records `patch: 'accepted'`. Resume per SKILL.md step 5. Confirm the resumed run's graph still contains the patch-added node and does not re-run completed `<node>#<visit>` keys.
- [ ] **A3 — the gate cannot be deleted.** Seed a run whose DoDGate fails repeatedly. Confirm at least one `patch: 'rejected'` entry appears in `trace` if a worker attempts removal, and that the run ends by hitting the visit cap rather than by opening a PR.
- [ ] **A4 — a tampered check is caught.** Mid-run, edit a frozen check file. Confirm DoDGate hard-fails with a sha mismatch rather than reporting the criterion MET.
- [ ] **A5 — a non-discriminating check is caught.** Freeze a criterion whose check already passes, without `green-ok`. Confirm DoDBaseline fails the run.
- [ ] **A6 — the editor round-trips.** Pre-flight a run, drag a node, add a comment, press Replan, confirm the graph version bumps and the comment shaped the result; then draw a gate-bypass edge and confirm Save is rejected with a readable reason.

---

## Self-Review Notes

Checked against `docs/specs/2026-07-27-loom-graph-runtime-design.md`:

- **Spec coverage:** §3 graph spec → Task 5 + references. §4 interpreter → Task 4. §5 invariants → Task 3. §6 pre-flight → Tasks 6, 10. §7 server/editor → Tasks 6, 7. §8 state/resume → Tasks 4, 9. §9 DoD checks → Task 8. §10 verification → every task's net plus the acceptance block. §11 out-of-scope respected — no task touches prospector/whetstone/arena, and Task 10 step 7 proves it.
- **Two spec refinements, both forced by the codebase and both recorded in Global Constraints:** the validator is *inlined*, not imported, because `require(` is banned in the generated conductor (`test-scaffold.cjs:109`); and `lockedHash` uses pure-JS FNV-1a because the conductor has no `crypto`, so it is labeled a drift detector while the DoD `checkSha` uses real sha256 in a worker.
- **Type consistency:** `validateGraph(next, prev, cursor)`, `applyPatchTo(graph, patch)`, `capFor(graph, id)`, `carryFor(edge, result)` and `lockedFingerprint(graph)` keep the same signatures in Tasks 3, 4, 6 and 7. `passed` is the gate verdict field everywhere; `unmetCriteria` is the DoDGate carry field everywhere.
- **Known ordering dependency:** Task 6's `GET /` test needs `editor/index.html` to exist, so Task 6 step 4 creates a placeholder that Task 7 replaces. Called out inline.
