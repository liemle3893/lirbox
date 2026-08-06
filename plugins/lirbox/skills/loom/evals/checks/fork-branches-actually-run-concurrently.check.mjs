// CHECK — the emitted conductor must actually RUN a fork's branches at the same time.
//
// validateGraph accepting a fork region proves the shape is safe. It says nothing about
// whether the interpreter honours it: a walk that awaits each branch in turn produces an
// identical trace, an identical result and identical visit counts, and is simply slower —
// the exact failure that would make the whole feature decorative while every structural
// check stayed green.
//
// So this check does not grep the generated source for `parallel(`. It GENERATES a
// conductor from a two-branch graph, executes it with stub `agent`/`parallel`/`log`/`phase`
// implementations, and measures how many workers were in flight at once. That is the
// overlapping-start/end observation the feature was asked for, taken from a real run of the
// real generated code.
//
// It also pins the two things concurrency puts at risk and that no shape check can see:
// visit accounting really is per-branch, and a branch that DIES aborts the run instead of
// letting the join be crossed with a partial region (parallel() resolves a failed thunk to
// null rather than rejecting, so "skip it" is the default that must be overridden).
// Locked (evals/**): improvement loops may NEVER edit this file.
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = resolve(HERE, '..', '..', 'scripts');

// Mutation hatch for scripts/prove-checks.mjs — see fork-regions-are-provably-safe.
const genFile = process.env.LOOM_SCAFFOLD_OVERRIDE || join(SCRIPTS, 'scaffold-loom.cjs');

let bad = 0;
const ok = (c, m) => { if (c) { console.log(`PASS ${m}`); } else { console.error(`FAIL ${m}`); bad++; } };

// A GENUINE DAG REGION, not two parallel lanes — this is the shape the old model could
// not express at all:
//
//   Plan -> Fan =>{ ApiWork , UiWork } ; Contract needs BOTH ; UiPolish needs UiWork ONLY
//                 -> Integrate -> Review -> Done
//
// UiPolish must NOT wait for ApiWork, and Contract must wait for both. A scheduler that
// only understands lanes either serialises them or runs Contract too early.
const GRAPH = {
  name: 'forkcheck', goal: 'fork concurrency check',
  start: 'Plan', terminal: 'Done',
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
    // Contract is the DAG join-within-the-region: two arrows in, two things waited on.
    { from: 'ApiWork', to: 'Contract', when: 'always', carry: ['note'] },
    { from: 'UiWork', to: 'Contract', when: 'always', carry: ['note'] },
    // ...while UiPolish depends on UiWork alone and must not be held up by ApiWork.
    { from: 'UiWork', to: 'UiPolish', when: 'always', carry: ['note'] },
    { from: 'Contract', to: 'Integrate', when: 'always', carry: ['note'] },
    { from: 'UiPolish', to: 'Integrate', when: 'always', carry: ['note'] },
    { from: 'Integrate', to: 'Review', when: 'always' },
    { from: 'Review', to: 'Done', when: { field: 'passed', eq: true } },
    { from: 'Review', to: 'Integrate', when: { field: 'passed', eq: false } },
  ],
  invariants: {},
};

const tmp = mkdtempSync(join(tmpdir(), 'fork-concurrency-'));
let emitted;
try {
  const gf = join(tmp, 'graph.json');
  const of = join(tmp, 'out.js');
  writeFileSync(gf, JSON.stringify(GRAPH));
  execFileSync('node', [genFile, '--name', 'forkcheck', '--graph', gf, '--out', of],
    { stdio: 'pipe' });
  emitted = readFileSync(of, 'utf8');
} catch (e) {
  console.error(`FAIL could not generate a fork conductor: ${e.message}`);
  rmSync(tmp, { recursive: true, force: true });
  process.exit(1);
}
rmSync(tmp, { recursive: true, force: true });

// The emitted file is a module: `export const meta = {...}` then a top-level-await body.
// Strip the export and run the body as an async function with the runtime injected.
const cut = emitted.indexOf('\n}\n');
ok(/^export const meta = \{/m.test(emitted) && cut > 0, 'emitted conductor has the meta header');
const body = emitted.slice(cut + 3);

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
let run;
try {
  run = new AsyncFunction('agent', 'parallel', 'log', 'phase', 'args', body);
} catch (e) {
  console.error(`FAIL emitted conductor body is not executable: ${e.message}`);
  process.exit(1);
}

// `parallel` exactly as the Workflow runtime behaves: concurrent, and a thunk that throws
// resolves to null instead of rejecting.
const parallel = (thunks) => Promise.all(thunks.map((t) => {
  try { return Promise.resolve(t()).catch(() => null); } catch { return Promise.resolve(null); }
}));

// ApiWork is deliberately the SLOW node. UiPolish depends only on UiWork, so if the
// scheduler understands dependencies it starts long before ApiWork finishes; if it only
// understands lanes, or runs in waves, it does not.
const DELAY = { ApiWork: 40 };

async function exercise({ failNode } = {}) {
  let maxLive = 0, clock = 0;
  const live = new Set();
  const overlapped = new Set();
  const started = {}, ended = {};
  const agent = async (_prompt, opts) => {
    const label = String((opts && opts.label) || '');
    const node = label.split('#')[0];
    if (label.startsWith('checkpoint:')) return {};
    started[node] = clock++;
    live.add(node);
    if (live.size > maxLive) maxLive = live.size;
    // Record EVERY node live during an overlap, not just the one that arrived into it —
    // the arriving node alone would name the second worker and never the first.
    if (live.size > 1) for (const n of live) overlapped.add(n);
    await new Promise((r) => setTimeout(r, DELAY[node] || 4));
    live.delete(node);
    ended[node] = clock++;
    if (failNode && node === failNode) throw new Error('region worker died: ' + node);
    return node === 'Review' ? { passed: true, note: node } : { note: node };
  };
  const out = await run(agent, parallel, () => {}, () => {}, undefined);
  return { out, maxLive, overlapped, started, ended };
}

// ---- 1. concurrency, observed ------------------------------------------------------
let normal = null;
try { normal = await exercise(); }
catch (e) { ok(false, `a valid fork graph must run to completion (threw: ${e.message})`); }

if (normal) {
  const { started, ended } = normal;
  ok(normal.maxLive >= 2,
    `two region workers were in flight at the same time (max concurrent = ${normal.maxLive})`);
  ok(normal.overlapped.has('ApiWork') && normal.overlapped.has('UiWork'),
    `both region entries overlapped, not just one (overlapped: ${[...normal.overlapped].join(', ') || 'none'})`);

  // ---- 2. IT IS A DAG, not two lanes ------------------------------------------------
  // Contract declares two dependencies and must wait for BOTH...
  ok(started.Contract > ended.ApiWork && started.Contract > ended.UiWork,
    `Contract waited for BOTH its dependencies (start ${started.Contract} vs ends `
    + `ApiWork ${ended.ApiWork}, UiWork ${ended.UiWork})`);
  // ...while UiPolish declares only one and must NOT be held up by the other.
  ok(started.UiPolish < ended.ApiWork,
    `UiPolish depends only on UiWork and did NOT wait for the slow ApiWork `
    + `(start ${started.UiPolish} vs ApiWork end ${ended.ApiWork}) — a lane scheduler or a `
    + `wave scheduler would have blocked it`);

  // ---- 3. per-region visit accounting, merged exactly -------------------------------
  const visits = (normal.out && normal.out.visits) || {};
  ok(visits.ApiWork === 1 && visits.UiWork === 1 && visits.Contract === 1
    && visits.UiPolish === 1,
    `every region node ran exactly once (got ${JSON.stringify(visits)})`);
  ok(visits.Integrate === 1,
    `the join ran ONCE for the whole region, not once per path (got ${visits.Integrate})`);

  // ---- 4. carry is keyed by predecessor, at every DAG join --------------------------
  const carry = (normal.out && normal.out.carry) || {};
  const atJoin = (carry.Integrate || {}).from;
  ok(!!atJoin, `the join's carry is keyed by predecessor (got ${JSON.stringify(carry.Integrate)})`);
  if (atJoin) {
    ok(Object.keys(atJoin).sort().join(',') === 'Contract,UiPolish',
      `every sink reported into the join, keyed by node (got ${Object.keys(atJoin).sort().join(',')})`);
  }
  // The in-region DAG join gets the same treatment — flat-merging would have let one
  // dependency's `note` silently overwrite the other's.
  const atContract = (carry.Contract || {}).from;
  ok(!!atContract && Object.keys(atContract).sort().join(',') === 'ApiWork,UiWork',
    `a node with two dependencies sees BOTH, attributed (got ${JSON.stringify(carry.Contract)})`);
  if (atContract && atContract.ApiWork && atContract.UiWork) {
    ok(atContract.ApiWork.note !== atContract.UiWork.note,
      'each dependency keeps its own values — no silent last-writer-wins overwrite');
  }

  // ---- 5. the trace records the region, so a report can describe what ran -----------
  const trace = (normal.out && normal.out.trace) || [];
  ok(trace.some((t) => Array.isArray(t.fork) && t.fork.length === 4),
    'the trace records the region and its nodes');
  ok(trace.some((t) => Array.isArray(t.joined)),
    'the trace records the join, so a report can show where the region closed');
}

// ---- 6. a dead region node must ABORT, never be skipped -----------------------------
let aborted = false;
try { await exercise({ failNode: 'UiWork' }); }
catch { aborted = true; }
ok(aborted,
  'a region node that dies aborts the run — the join is never crossed with a partial region');

if (bad) { console.error(`\nfork-branches-actually-run-concurrently: ${bad} failed`); process.exit(1); }
console.log('fork-branches-actually-run-concurrently: ok');
