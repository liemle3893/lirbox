// CHECK — a worker is told what the run is FOR, and where its predecessors recorded things.
//
// The defect this exists to prevent. Every loom worker is a fresh context. Before the brief,
// the conductor handed it the node's own prompt and nothing else — so `delivery.json`'s
// Implement node, whose entire instruction is "Implement the goal in the worktree", arrived at
// a worker that had never been told what the goal was. Each worker therefore opened by
// rediscovering the run's purpose, the DoD, and the shape of the repository from scratch, and
// the next worker did it again. On an observed 17-node run the workers burned ~3.55M tokens
// against roughly 2k per node of actual conductor instruction.
//
// The fix is an INDEX, not a payload. The conductor already knows the goal (graph.goal) and
// every path is derivable from the run NAME, so the brief costs O(1) per prompt and points at
// files the worker opens only if its own task needs them.
//
// Why assertion 3 exists. This skill has just finished deleting an O(n^2) prompt cost — the
// checkpoint re-sending every worker's output into every later prompt. A brief is the same
// shape of idea pointed the other way, and it decays into the same defect the moment it stops
// being bounded: paste a 200KB spec into graph.goal and an untruncated brief re-sends it once
// per node. Asserting only "the goal appears in the prompt" would go green on exactly that
// regression, so the bound is asserted directly, against a deliberately pathological goal.
//
// Assertion 4 guards the other direction: the brief must stay an index of PATHS and never
// start inlining what those paths contain, which is how it would grow back into the payload.
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

// Mutation hatches for scripts/prove-checks.mjs. Both resolve back to the COPY's scripts/
// directory, because the generator reads its prompt templates relative to its own location —
// so pointing at the copied generator is also what puts the copied templates under test.
const genOverride = process.env.LOOM_SCAFFOLD_OVERRIDE;
const promptOverride = process.env.LOOM_NODE_LEAD_OVERRIDE;
const SCRIPTS = genOverride ? dirname(genOverride)
  : promptOverride ? resolve(dirname(promptOverride), '..')
    : resolve(HERE, '..', '..', 'scripts');
const genFile = join(SCRIPTS, 'scaffold-loom.cjs');

let bad = 0;
const ok = (c, m) => { if (c) { console.log(`PASS ${m}`); } else { console.error(`FAIL ${m}`); bad++; } };

const GOAL = 'ship the widget exporter so finance stops hand-rolling CSVs';
const RUN = 'briefrun';

// A plain chain: no gate and no mustCross, so no lockedHash is needed. This check is about
// what reaches a WORKER, and a freeze would only add noise to that.
const graphWith = (goal) => ({
  name: RUN, goal,
  start: 'Plan', terminal: 'Done',
  nodes: [
    { id: 'Plan', kind: 'plan' },
    { id: 'Build', kind: 'work' },
    { id: 'Test', kind: 'work' },
    { id: 'Ship', kind: 'work' },
    { id: 'Done', kind: 'terminal' },
  ],
  edges: [
    { from: 'Plan', to: 'Build', when: 'always' },
    { from: 'Build', to: 'Test', when: 'always' },
    { from: 'Test', to: 'Ship', when: 'always' },
    { from: 'Ship', to: 'Done', when: 'always' },
  ],
  invariants: {},
});

function emit(graph) {
  const tmp = mkdtempSync(join(tmpdir(), 'brief-'));
  try {
    const gf = join(tmp, 'graph.json');
    const of = join(tmp, 'out.js');
    writeFileSync(gf, JSON.stringify(graph));
    execFileSync('node', [genFile, '--name', RUN, '--graph', gf, '--out', of], { stdio: 'pipe' });
    return readFileSync(of, 'utf8');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const parallel = (thunks) => Promise.all(thunks.map((t) => {
  try { return Promise.resolve(t()).catch(() => null); } catch { return Promise.resolve(null); }
}));

// Each worker returns something large and uniquely traceable, so assertion 4 can tell an
// index-of-paths apart from a brief that began inlining predecessors' actual output.
const MARK = 'PRIORRESULT' + 'z'.repeat(20000);

async function workerPrompts(graph) {
  let emitted;
  try { emitted = emit(graph); }
  catch (e) { console.error(`FAIL could not generate a conductor: ${e.message}`); process.exit(1); }

  const cut = emitted.indexOf('\n}\n');
  let run;
  try {
    run = new AsyncFunction('agent', 'parallel', 'log', 'phase', 'args', emitted.slice(cut + 3));
  } catch (e) {
    console.error(`FAIL emitted conductor body is not executable: ${e.message}`);
    process.exit(1);
  }
  const calls = [];
  const agent = async (prompt, opts) => {
    const o = opts || {};
    calls.push({ prompt, label: String(o.label || '') });
    if (String(o.label || '').startsWith('checkpoint:')) return {};
    return { note: String(o.label || ''), payload: MARK };
  };
  try { await run(agent, parallel, () => {}, () => {}, undefined); }
  catch (e) { console.error(`FAIL the conductor must run to completion (threw: ${e.message})`); process.exit(1); }
  return calls.filter((c) => !c.label.startsWith('checkpoint:'));
}

const workers = await workerPrompts(graphWith(GOAL));
ok(workers.length >= 4, `every node still ran a worker (got ${workers.length})`);

// ---- 1. the goal reaches EVERY worker ------------------------------------------------
// Every, not some: a brief that only the plan node receives leaves exactly the node the
// defect was found on — Implement, whose own prompt names a goal it is never given — blind.
const withoutGoal = workers.filter((c) => !c.prompt.includes(GOAL));
ok(withoutGoal.length === 0,
  `every worker prompt states the run's goal (${withoutGoal.length} of ${workers.length} do `
  + `not: ${JSON.stringify(withoutGoal.map((c) => c.label))})`);

// An unsubstituted placeholder means the template still asks for a value the conductor never
// passes — the prompt would ship the literal text "${goal}" to the model.
const unsubbed = workers.filter((c) => c.prompt.includes('${goal}'));
ok(unsubbed.length === 0,
  `the goal placeholder is actually substituted (${unsubbed.length} prompts still carry it raw)`);

// ---- 2. the worker is told where predecessors recorded their results ------------------
// This is the half that ends cross-node blindness: results are persisted per worker, and a
// worker that is not told the directory cannot read what any earlier node established.
// Deliberately NOT satisfied by the persist instruction. Since #73 every worker is already
// told the path it must WRITE its own result to, and a naive "mentions .loom/state/" test goes
// green on that alone — guarding the previous change's invariant while proving nothing about
// this one. Strip the node's own path first: what remains must STILL point at the results
// directory, which is the difference between knowing where to write yours and knowing where
// to read everyone else's.
const noIndex = workers.filter((c) => {
  const own = `.loom/state/${RUN}/results/${c.label}.json`;
  return !/\.loom\/state\/[^\s]*results\//.test(c.prompt.split(own).join(''));
});
ok(noIndex.length === 0,
  `every worker is told where EARLIER nodes' results live, not only where to write its own `
  + `(${noIndex.length} of ${workers.length} are not)`);
const noDod = workers.filter((c) => !/\.loom\/[^\s]*\.dod\.json/.test(c.prompt));
ok(noDod.length === 0,
  `every worker is told where this run's definition of done lives (${noDod.length} are not)`);

// ---- 3. the brief is BOUNDED ---------------------------------------------------------
// The regression that matters: an unbounded goal spliced into every prompt is the O(n^2) the
// checkpoint change just removed, re-created on the worker side.
const HUGE = 'X'.repeat(200000);
const huge = await workerPrompts(graphWith(HUGE));
ok(huge.length >= 4, 'the pathological-goal graph still runs every node');
const base = Math.max(...workers.map((c) => c.prompt.length));
const blown = Math.max(...huge.map((c) => c.prompt.length));
ok(blown - base < 1000,
  `a 200000-char goal cannot inflate a worker prompt without bound (grew ${blown - base} chars)`);
ok(!huge.some((c) => c.prompt.includes(HUGE)),
  'the full pathological goal is never spliced into a worker prompt verbatim');
// Not vacuous: SOMETHING of the goal has to survive truncation, or the bound was achieved by
// dropping the brief altogether — which passes every assertion above for the wrong reason.
ok(huge.every((c) => c.prompt.includes('XXXXXXXXXXXXXXXX')),
  'the goal is TRUNCATED rather than discarded — a bound that drops it is not a brief');

// ---- 4. the brief stays an INDEX, never a payload -------------------------------------
// Paths, not contents. If predecessors' actual output starts arriving in later prompts, the
// deleted O(n^2) is back with a different name.
const carrying = workers.filter((c) => c.prompt.includes('PRIORRESULT'));
ok(carrying.length === 0,
  `no worker prompt inlines an earlier worker's output (${carrying.length} do: `
  + `${JSON.stringify(carrying.map((c) => c.label))})`);
const lens = workers.map((c) => c.prompt.length);
ok(Math.max(...lens) - Math.min(...lens) < 4000,
  `worker prompt size does not grow with how much earlier nodes produced (spread `
  + `${Math.max(...lens) - Math.min(...lens)} chars while workers produced `
  + `${MARK.length * workers.length})`);

// ---- 5. a graph with no goal still runs ------------------------------------------------
// The brief must degrade, not throw: `goal` is set by the skill when it copies a seed, and a
// hand-authored graph may simply not have one.
const noGoal = await workerPrompts(graphWith(undefined));
ok(noGoal.length >= 4, 'a graph with no goal still runs every node rather than crashing');

if (bad) { console.error(`\nworker-prompt-carries-the-run-brief: ${bad} failed`); process.exit(1); }
console.log('worker-prompt-carries-the-run-brief: ok');
