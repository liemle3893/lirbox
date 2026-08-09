// CHECK — loom knows what a graph will cost in WALL-CLOCK before it runs one.
//
// The defect this exists to prevent. loom's cost in time is its CRITICAL PATH — the longest chain
// of workers that must run in sequence — and nothing computed it. `nodeBudget` bounds how much
// work a graph may do; nothing bounded how much of it must happen one-after-another. So a graph
// with 30 nodes in a line and a graph with 30 nodes behind two forks both validated, both looked
// correct, and one took four times as long. Both shipped seeds score parallelism 1.00: every
// worker waits for the one before it.
//
// Assertion 5 is why this check is worth more than the arithmetic ones above it. Anything can
// define a number and then assert its own definition. This EXECUTES the emitted conductor with a
// stubbed agent that sleeps a fixed slice per node, and requires the measured wall-clock to match
// `criticalPath * slice`. That is what makes the metric a prediction about the running system
// rather than a property of itself — and it is what would catch a "correct" formula that happens
// not to describe how the interpreter actually schedules.
//
// Locked (evals/**): improvement loops may NEVER edit this file.
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const coreOverride = process.env.LOOM_GRAPH_CORE_OVERRIDE;
const genOverride = process.env.LOOM_SCAFFOLD_OVERRIDE;
const SCRIPTS = coreOverride ? dirname(coreOverride)
  : genOverride ? dirname(genOverride)
    : resolve(HERE, '..', '..', 'scripts');
const core = await import(join(SCRIPTS, 'graph-core.mjs'));
const genFile = join(SCRIPTS, 'scaffold-loom.cjs');

let bad = 0;
const ok = (c, m) => { if (c) { console.log(`PASS ${m}`); } else { console.error(`FAIL ${m}`); bad++; } };

const linear = (n) => {
  const nodes = [{ id: 'S', kind: 'work' }];
  for (let i = 1; i <= n; i++) nodes.push({ id: 'W' + i, kind: 'work' });
  nodes.push({ id: 'D', kind: 'terminal' });
  const edges = [{ from: 'S', to: 'W1', when: 'always' }];
  for (let i = 1; i < n; i++) edges.push({ from: 'W' + i, to: 'W' + (i + 1), when: 'always' });
  edges.push({ from: 'W' + n, to: 'D', when: 'always' });
  return { name: 'lin', goal: 'g', start: 'S', terminal: 'D', nodes, edges, invariants: {} };
};

const forked = (n) => {
  const nodes = [{ id: 'S', kind: 'fork', join: 'J' }];
  for (let i = 1; i <= n; i++) nodes.push({ id: 'W' + i, kind: 'work' });
  nodes.push({ id: 'J', kind: 'work' }, { id: 'D', kind: 'terminal' });
  const edges = [];
  for (let i = 1; i <= n; i++) {
    edges.push({ from: 'S', to: 'W' + i, when: 'always' });
    edges.push({ from: 'W' + i, to: 'J', when: 'always' });
  }
  edges.push({ from: 'J', to: 'D', when: 'always' });
  return { name: 'frk', goal: 'g', start: 'S', terminal: 'D', nodes, edges, invariants: {} };
};

// ---- 1. a sequence costs its length ---------------------------------------------------
for (const n of [2, 5, 8]) {
  ok(core.criticalPath(linear(n)) === n + 1,
    `a chain of ${n + 1} workers has critical path ${n + 1} `
    + `(got ${core.criticalPath(linear(n))})`);
}

// ---- 2. a fork region costs its LONGEST BRANCH, not its width --------------------------
// The number must not grow with how much work the region holds — that is the whole claim.
const forkedCps = [2, 5, 8].map((n) => core.criticalPath(forked(n)));
ok(forkedCps.every((c) => c === forkedCps[0]),
  `a fork region's critical path is independent of its width (got ${JSON.stringify(forkedCps)})`);
ok(forkedCps[0] === 2,
  `one concurrent node plus the join is 2 node-times (got ${forkedCps[0]})`);

// ---- 2b. an ASYMMETRIC region costs its SLOW branch --------------------------------------
// Symmetric fixtures cannot see either of the two ways this goes wrong, because every branch has
// the same length: min and max agree, and a shared visited-set costs the same as a per-path one.
// Both mutations survived a symmetric-only check. This is the fixture that separates them:
//
//   S(fork) ──▶ A ─────────────▶ J ──▶ D        A is one node
//        └────▶ B1 ─▶ B2 ─▶ B3 ─┘               B is a chain of three
//
// The run takes the B chain (3) plus the join (1) = 4. Taking the SHORTEST branch reports 2.
// Sharing one visited-set across siblings lets whichever branch is walked first claim the join,
// leaving the other short — reporting 3.
const asym = {
  name: 'asym', goal: 'g', start: 'S', terminal: 'D',
  nodes: [
    { id: 'S', kind: 'fork', join: 'J' },
    { id: 'A', kind: 'work' },
    { id: 'B1', kind: 'work' }, { id: 'B2', kind: 'work' }, { id: 'B3', kind: 'work' },
    { id: 'J', kind: 'work' }, { id: 'D', kind: 'terminal' },
  ],
  edges: [
    { from: 'S', to: 'A', when: 'always' },
    { from: 'S', to: 'B1', when: 'always' },
    { from: 'B1', to: 'B2', when: 'always' },
    { from: 'B2', to: 'B3', when: 'always' },
    { from: 'A', to: 'J', when: 'always' },
    { from: 'B3', to: 'J', when: 'always' },
    { from: 'J', to: 'D', when: 'always' },
  ],
  invariants: {},
};
ok(core.criticalPath(asym) === 4,
  `an asymmetric region costs its SLOW branch plus the join, 4 node-times `
  + `(got ${core.criticalPath(asym)}; 2 means it took the fast branch, 3 means sibling branches `
  + 'shared a visited-set and one lost the join)');

// ---- 3. only nodes that SPAWN A WORKER count -------------------------------------------
// A fork spawns none (the generator emits no phase for it) and the terminal is never executed —
// the interpreter's loop exits on reaching it. Counting either inflates every estimate.
ok(core.criticalPath({ start: 'D', terminal: 'D', nodes: [{ id: 'D', kind: 'terminal' }], edges: [] }) === 0,
  'a terminal-only graph costs 0 node-times');
ok(core.parallelism(linear(7)) === 1,
  `a pure sequence has parallelism exactly 1.00 (got ${core.parallelism(linear(7))})`);
ok(core.parallelism(forked(8)) > 4,
  `a wide region reports the overlap it achieves (got ${core.parallelism(forked(8)).toFixed(2)})`);

// ---- 4. a back-edge does not hang, and is counted once ---------------------------------
// Cycles are loom's POINT — a gate's failing edge routes backwards. Traversing one forever is a
// hang; refusing to traverse it is also wrong. One pass is the answer.
const withBackEdge = linear(3);
withBackEdge.edges.push({ from: 'W3', to: 'W1', when: { field: 'passed', eq: false } });
const cyc = core.criticalPath(withBackEdge);
ok(Number.isFinite(cyc) && cyc >= 4 && cyc <= 5,
  `a graph with a back-edge terminates and costs one pass (got ${cyc})`);

// ---- 5. THE METRIC PREDICTS THE RUN -----------------------------------------------------
// Execute the real emitted conductor with a stubbed agent that sleeps a fixed slice per worker.
// If criticalPath is a true statement about scheduling, measured wall-clock tracks it.
const SLICE = 60;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function measure(graph, name) {
  const tmp = mkdtempSync(join(tmpdir(), 'cp-'));
  let emitted;
  try {
    const gf = join(tmp, 'g.json'); const of = join(tmp, 'o.js');
    writeFileSync(gf, JSON.stringify(graph));
    execFileSync('node', [genFile, '--name', name, '--graph', gf, '--out', of], { stdio: 'pipe' });
    emitted = readFileSync(of, 'utf8');
  } finally { rmSync(tmp, { recursive: true, force: true }); }

  const cut = emitted.indexOf('\n}\n');
  const fn = new AsyncFunction('agent', 'parallel', 'log', 'phase', 'args', emitted.slice(cut + 3));
  const agent = async (prompt, opts) => {
    if (String((opts || {}).label || '').startsWith('checkpoint:')) return {};
    await sleep(SLICE);
    return { ok: true };
  };
  const parallel = (thunks) => Promise.all(thunks.map((t) => {
    try { return Promise.resolve(t()).catch(() => null); } catch { return Promise.resolve(null); }
  }));
  const t0 = process.hrtime.bigint();
  await fn(agent, parallel, () => {}, () => {}, undefined);
  return Number(process.hrtime.bigint() - t0) / 1e6;
}

for (const [label, graph] of [['linear(6)', linear(6)], ['forked(6)', forked(6)], ['asym', asym]]) {
  const cp = core.criticalPath(graph);
  const predicted = cp * SLICE;
  const measured = await measure(graph, 'cp');
  // Generous band: this asserts the metric DESCRIBES the schedule, not that a timer is precise.
  // A formula that ignored the fork would predict 7 slices where 2 are observed — 250% out, far
  // outside anything host jitter produces.
  const err = Math.abs(measured - predicted) / predicted;
  ok(err < 0.45,
    `${label}: criticalPath ${cp} predicts wall-clock ${predicted}ms, measured `
    + `${measured.toFixed(0)}ms (${(err * 100).toFixed(0)}% out)`);
}

// ---- 6. the invariant is enforced, and is OPT-IN ----------------------------------------
const bounded = linear(8);
bounded.invariants = { maxCriticalPath: 4 };
const viol = core.validateGraph(bounded, null, {});
ok(viol.some((v) => v.code === 'critical-path-exceeded'),
  `a graph over its maxCriticalPath is refused (codes: ${JSON.stringify(viol.map((v) => v.code))})`);

const atBound = linear(3);           // 4 workers, critical path 4
atBound.invariants = { maxCriticalPath: 4 };
ok(!core.validateGraph(atBound, null, {}).some((v) => v.code === 'critical-path-exceeded'),
  'a graph exactly AT its maxCriticalPath is allowed — the bound is a maximum, not a target');

const unbounded = linear(30);
ok(!core.validateGraph(unbounded, null, {}).some((v) => v.code === 'critical-path-exceeded'),
  'a graph that sets no maxCriticalPath is never judged on it — plenty of work is genuinely '
  + 'sequential and refusing to run it would be wrong');

if (bad) { console.error(`\ncritical-path-is-measured: ${bad} failed`); process.exit(1); }
console.log('critical-path-is-measured: ok');
