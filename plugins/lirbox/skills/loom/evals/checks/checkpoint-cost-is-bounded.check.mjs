// CHECK — the run's state file costs what the GRAPH costs, not what the WORKERS produced.
//
// The defect this exists to prevent. `checkpoint()` used to serialise the entire run state —
// including `results`, every worker's full return value — into a fresh subagent prompt after
// every node. That is O(n^2) in tokens: each node re-sends everything every earlier node
// returned. On one observed 17-node run the checkpoints alone were ~2.15M of 5.7M tokens —
// 38% of the whole run — spent on the session model to write a single JSON file.
//
// The fix is not "checkpoint less often": that trades kill-resume granularity, which is the
// feature. It is to persist by OWNER. `results[key]` belongs to the worker that produced it,
// and that worker already holds the value and already has a Write tool, so writing its own
// entry costs no new input tokens. What the conductor still owns — topology, cursor, visit
// counters, carry, trace — is bounded by the SHAPE of the graph and does not grow with how
// much work the nodes did.
//
// So this check has to hold BOTH halves at once. Asserting only that `results` is absent from
// the checkpoint payload would go green on a pure regression that deleted persistence
// altogether and made every resume replay the run from the start. Assertion 4 is what makes
// this a proof of a MOVE rather than a proof of a deletion, and assertion 5 is what proves the
// moved data still lands in the one place resume reads it from.
//
// Like its siblings this does not grep the generator: it EXECUTES the emitted conductor with
// stub agent/parallel and reads the prompts that were actually built.
// Locked (evals/**): improvement loops may NEVER edit this file.
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));

// Mutation hatches for scripts/prove-checks.mjs: it copies the skill tree, mutates ONE file in
// the copy, and points the named variable at that file. Both hatches below resolve back to the
// COPY's scripts/ directory — which matters, because the generator reads its prompt templates
// relative to its own location, so pointing at the copied generator is also what makes the
// copied (possibly mutated) prompt templates the ones under test.
const genOverride = process.env.LOOM_SCAFFOLD_OVERRIDE;
const promptOverride = process.env.LOOM_NODE_LEAD_OVERRIDE;
const SCRIPTS = genOverride ? dirname(genOverride)
  : promptOverride ? resolve(dirname(promptOverride), '..')
    : resolve(HERE, '..', '..', 'scripts');
const genFile = join(SCRIPTS, 'scaffold-loom.cjs');

let bad = 0;
const ok = (c, m) => { if (c) { console.log(`PASS ${m}`); } else { console.error(`FAIL ${m}`); bad++; } };

// A plain chain. No gate and no mustCross, so the graph needs no lockedHash — this check is
// about what crosses the checkpoint boundary, and a freeze would only add noise to that.
const GRAPH = {
  name: 'ckptcost', goal: 'checkpoint cost check',
  start: 'Plan', terminal: 'Done',
  nodes: [
    { id: 'Plan', kind: 'plan' },
    { id: 'Build', kind: 'work' },
    { id: 'Test', kind: 'work' },
    { id: 'Doc', kind: 'work' },
    { id: 'Ship', kind: 'work' },
    { id: 'Done', kind: 'terminal' },
  ],
  edges: [
    { from: 'Plan', to: 'Build', when: 'always' },
    { from: 'Build', to: 'Test', when: 'always' },
    { from: 'Test', to: 'Doc', when: 'always' },
    { from: 'Doc', to: 'Ship', when: 'always' },
    { from: 'Ship', to: 'Done', when: 'always' },
  ],
  invariants: {},
};

const tmp = mkdtempSync(join(tmpdir(), 'ckpt-cost-'));
let emitted;
try {
  const gf = join(tmp, 'graph.json');
  const of = join(tmp, 'out.js');
  writeFileSync(gf, JSON.stringify(GRAPH));
  execFileSync('node', [genFile, '--name', 'ckptcost', '--graph', gf, '--out', of], { stdio: 'pipe' });
  emitted = readFileSync(of, 'utf8');
} catch (e) {
  console.error(`FAIL could not generate a conductor: ${e.message}`);
  rmSync(tmp, { recursive: true, force: true });
  process.exit(1);
}
rmSync(tmp, { recursive: true, force: true });

const cut = emitted.indexOf('\n}\n');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
let run;
try {
  run = new AsyncFunction('agent', 'parallel', 'log', 'phase', 'args', emitted.slice(cut + 3));
} catch (e) {
  console.error(`FAIL emitted conductor body is not executable: ${e.message}`);
  process.exit(1);
}

// Each worker returns something LARGE and uniquely traceable. If any of it reaches a
// checkpoint prompt, the O(n^2) is back and the marker will say so exactly.
const MARK = 'WORKEROUTPUT' + 'y'.repeat(20000);
const parallel = (thunks) => Promise.all(thunks.map((t) => {
  try { return Promise.resolve(t()).catch(() => null); } catch { return Promise.resolve(null); }
}));

async function exercise(resumeArgs) {
  const calls = [];
  const agent = async (prompt, opts) => {
    const o = opts || {};
    calls.push({ prompt, opts: o, label: String(o.label || '') });
    if (String(o.label || '').startsWith('checkpoint:')) return {};
    const id = String(o.label || '').split('#')[0];
    return { note: id, payload: MARK + '::' + id };
  };
  const out = await run(agent, parallel, () => {}, () => {}, resumeArgs);
  return {
    out,
    ckpts: calls.filter((c) => c.label.startsWith('checkpoint:')),
    workers: calls.filter((c) => !c.label.startsWith('checkpoint:')),
  };
}

let r;
try { r = await exercise(undefined); }
catch (e) { console.error(`FAIL the conductor must run to completion (threw: ${e.message})`); process.exit(1); }

ok(r.ckpts.length >= 4, `the run still checkpoints at every node (got ${r.ckpts.length})`);
ok(r.workers.length >= 5, `every node still ran a worker (got ${r.workers.length})`);

// ---- 1. worker output never crosses the checkpoint boundary -------------------------
const leaked = r.ckpts.filter((c) => c.prompt.includes('WORKEROUTPUT'));
ok(leaked.length === 0,
  `no checkpoint prompt carries worker output (${leaked.length} of ${r.ckpts.length} do: `
  + `${JSON.stringify(leaked.map((c) => c.label))})`);

// ---- 2. the payload is bounded by graph SHAPE, not by how much work was done ---------
// Trace and carry do grow a little per node — that is the graph's own shape accumulating,
// and it is bounded. What must NOT happen is growth that tracks worker output.
const lens = r.ckpts.map((c) => c.prompt.length);
const growth = Math.max(...lens) - Math.min(...lens);
const produced = MARK.length * r.workers.length;
ok(growth < 4000,
  `checkpoint size is bounded by the graph, not the results (grew ${growth} chars across `
  + `${r.ckpts.length} checkpoints while workers produced ${produced} chars)`);

// ---- 3. a file write does not run on the session model ------------------------------
// Anchored to "pins a model" rather than to a particular tier: inheriting is the defect,
// and which cheap tier is chosen is a tuning decision that may legitimately change.
ok(r.ckpts.every((c) => typeof c.opts.model === 'string' && c.opts.model.length > 0),
  'every checkpoint PINS a model instead of inheriting the session model');
ok(r.ckpts.every((c) => c.opts.model !== 'opus'),
  'the checkpoint does not write a JSON file on the most expensive tier');

// ---- 4. the results were MOVED, not dropped -----------------------------------------
// Without this, deleting persistence outright would satisfy assertions 1-3 perfectly, and
// every resume would replay the whole run from its start node.
const build = r.workers.find((c) => c.label === 'Build#1');
ok(!!build, 'the Build worker ran (so its prompt can be inspected)');
if (build) {
  ok(/\.loom\/state\//.test(build.prompt),
    'the worker is told to persist its own result under .loom/state/');
  ok(build.prompt.includes('Build#1'),
    'the worker is told the exact result KEY to persist it under — the key resume looks up');
  ok(!/\.worktrees\/[^\s]*\.loom\/state/.test(build.prompt),
    'the result is persisted in the MAIN checkout, not inside the disposable worktree');
}

// ---- 5. the persisted result is what resume consumes --------------------------------
// The whole point of moving the write is that the file still feeds `args.results`. If a
// cached key does not suppress the worker, the persistence has no consumer.
let resumed;
try { resumed = await exercise({ cursor: 'Build', results: { 'Build#1': { note: 'Build' } } }); }
catch (e) { ok(false, `a resume carrying persisted results must run (threw: ${e.message})`); }
if (resumed) {
  ok(!resumed.workers.some((c) => c.label === 'Build#1'),
    'a result restored from the state file suppresses its worker — resume does not redo it');
  ok(resumed.workers.some((c) => c.label === 'Test#1'),
    'and the run still advances past the cached node');
}

if (bad) { console.error(`\ncheckpoint-cost-is-bounded: ${bad} failed`); process.exit(1); }
console.log('checkpoint-cost-is-bounded: ok');
