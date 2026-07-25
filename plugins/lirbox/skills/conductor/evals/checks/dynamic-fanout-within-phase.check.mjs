// ACCEPTANCE CHECK (RED on baseline) — a work phase must fan out over a plan its own PLANNER
// worker produced at runtime, not run as a single serial worker.
//
// Concern (feedback/conductor.jsonl → dynamic-fanout-within-phase): the PHASE is conductor's unit
// of concurrency and a phase is exactly ONE worker. In a full delivery run only 2 of 16 agent()
// sites are parallel, and both fan out over a COMPILE-TIME constant (the CodeGate DIMENSIONS
// array). Nothing ever fans out over a list a worker DISCOVERED. So a phase with six independent
// files gets one worker doing them one after another, and no flag changes that — `--independent`
// fans out phases, not work within a phase.
//
// Frozen contract (see the backlog item text):
//   1. For each work phase P, the conductor first runs a PLANNER agent labelled `plan:<P>` whose
//      result is { items: [{ id, title, prompt, dependsOn: [ids] }] }.
//   2. It then fans out those items BY DEPENDENCY LEVEL: every item with an empty dependsOn runs
//      together in ONE parallel() batch; an item runs only after all of its dependsOn resolved.
//   3. Each item worker resolves to its OWN worktree (the per-worker isolation from #34).
//   4. The plan is persisted for resume — the phase's checkpoint worker sees the item ids.
//   5. `--no-plan-fanout` opts out: no planner, exactly one work worker (today's behavior).
//
// Baseline (RED): the Work phase emits ONE `await agent(...)`. There is no planner, one worker runs
// regardless of any plan, so assertions 3/4/5/6/7 all fail. After the fix they hold.
//
// HOW this is judged (behaviorally, not by prose): the emitted Workflow body is EXECUTED with
// stubbed agent()/parallel()/pipeline()/phase()/log(). The stub answers the planner call with a
// fixed 3-item plan (w1, w2 independent; w3 depends on both) and records which calls were
// dispatched inside the same parallel() batch. We then observe how many workers ran, how they were
// batched, and which worktree each resolved to — agnostic to how the fix spells any of it.
//
// Deterministic only — no network, no LLM. Generation/structure surprises exit 2 (harness error),
// never 1, so a RED verdict always means "no dynamic fan-out", not "the generator broke".
//
// Locked (evals/**): the whetstone fixer may NEVER edit this file.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(HERE, '..', '..');                     // .../skills/conductor
const REPO = resolve(SKILL_DIR, '..', '..', '..', '..');         // repo root
const GEN = resolve(SKILL_DIR, 'scripts', 'scaffold-workflow.cjs');

const PHASE = 'Implement';
const TMP = mkdtempSync(join(tmpdir(), 'dyn-fanout-'));

// The plan the stubbed planner returns. w1/w2 are independent; w3 depends on both.
const PLAN_ITEMS = [
  { id: 'w1', title: 'migrate users handler', prompt: 'SENTINEL_W1: migrate the /users handler', dependsOn: [] },
  { id: 'w2', title: 'migrate orders handler', prompt: 'SENTINEL_W2: migrate the /orders handler', dependsOn: [] },
  { id: 'w3', title: 'delete legacy adapter', prompt: 'SENTINEL_W3: delete the legacy adapter', dependsOn: ['w1', 'w2'] },
];
const sentinelOf = (id) => `SENTINEL_${id.toUpperCase()}`;

const promptsFile = join(TMP, 'prompts.json');
writeFileSync(promptsFile, JSON.stringify({
  [PHASE]: 'Port every legacy HTTP handler to the new router. The handlers are independent of one '
    + 'another; the legacy adapter can only be deleted once they are all ported.',
}));

function gen(label, extraArgs) {
  const file = join(TMP, label + '.js');
  try {
    const out = execFileSync('node', [GEN, '--name', 'dynfan', '--out', file, '--force',
      '--phases', PHASE, '--prompts-file', promptsFile, ...extraArgs],
      { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out, file };
  } catch (e) {
    return { code: typeof e.status === 'number' ? e.status : 1, out: (e.stdout || '') + (e.stderr || ''), file };
  }
}
function nodeCheck(file) {
  try { execFileSync('node', ['--check', file], { stdio: 'ignore' }); return true; }
  catch { return false; }
}

// Strip the `export const meta = {...}` wrapper by brace-matching, leaving the runnable body.
function bodyOf(src) {
  const at = src.indexOf('export const meta');
  if (at === -1) return src;
  const open = src.indexOf('{', at);
  let depth = 0, i = open;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(i);
}

// Execute the emitted body with stubs. Records every agent() call in dispatch order with its
// resolved prompt, plus the parallel() batch it belonged to (null = not inside one).
function runBody(src) {
  const calls = [];
  let curPhase = null;
  let batchId = null;
  let batchSeq = 0;
  const base = () => ({
    summary: '', ready: true, written: true, path: 'x', green: true, gatePassed: true, closed: true,
    red: true, merged: true, integrated: true, ok: true, success: true, conflicts: [], failing: [],
    regressions: [], uncovered: 0, tested: 0, justified: 0, critical: 0, high: 0, buildExit: 0,
    baselines: [], tests: [], items: [],
  });
  const agent = async (prompt, opts) => {
    const o = opts || {};
    calls.push({ prompt: String(prompt), opts: o, phase: o.phase || curPhase, batch: batchId, idx: calls.length });
    // Answer the planner with the fixed plan; everything else gets the permissive result.
    if (String(o.label || '') === `plan:${PHASE}`) return { ...base(), items: PLAN_ITEMS, plan: PLAN_ITEMS };
    return base();
  };
  // Batch-aware: every fn dispatched in one parallel() call shares a batch id.
  const parallel = async (fns) => {
    const mine = `b${batchSeq++}`;
    const prev = batchId;
    batchId = mine;
    const out = [];
    try { for (const f of fns) out.push(await f()); }
    finally { batchId = prev; }
    return out;
  };
  const pipeline = async (fns) => { let last; for (const f of fns) last = await f(); return last; };
  const phase = (t) => { curPhase = t; };
  const log = () => {};
  const runner = new Function('agent', 'parallel', 'pipeline', 'phase', 'log', 'args',
    `return (async () => { ${bodyOf(src)} })()`);
  return runner(agent, parallel, pipeline, phase, log, {}).then(() => calls);
}

const results = [];
const ok = (pass, label) => { results.push({ pass, label }); console.log(`${pass ? 'PASS' : 'FAIL'}: ${label}`); };
const bail = (code, msg) => { console.error(msg); rmSync(TMP, { recursive: true, force: true }); process.exit(code); };

// ---------- preconditions (failure here = harness error → exit 2, never a RED verdict) ----------

const run = gen('default', []);
if (run.code !== 0 || !nodeCheck(run.file)) {
  bail(2, `PRECONDITION FAILED: generation exits ${run.code} or does not parse — unrelated generator `
    + `breakage, not this concern.\n${run.out}`);
}
console.log('PASS: 0. precondition — generation exits 0 and parses');

let calls;
try {
  calls = await runBody(readFileSync(run.file, 'utf8'));
} catch (e) {
  bail(2, `PRECONDITION FAILED: could not execute the emitted body: ${e && (e.stack || e.message)}`);
}

const isCheckpoint = (c) => String(c.opts.label || '').startsWith('checkpoint');
const phaseCalls = calls.filter((c) => c.phase === PHASE);
if (phaseCalls.length === 0) {
  bail(2, `PRECONDITION FAILED: no agent() call landed in phase '${PHASE}' — structure changed unexpectedly.`);
}
console.log(`PASS: 1. precondition — ${phaseCalls.length} agent call(s) resolved in phase '${PHASE}'`);

// ---------- the RED assertions ----------

// 2. a planner worker labelled plan:<P> runs in the phase.
const planner = phaseCalls.find((c) => String(c.opts.label || '') === `plan:${PHASE}`);
ok(!!planner, `2. phase '${PHASE}' runs a planner worker labelled 'plan:${PHASE}'`);

// 3. one worker per PLANNED item — i.e. the fan-out is over the RUNTIME list, not a constant.
//    This is the core discriminator: today exactly one work worker runs, whatever any plan says.
const workers = phaseCalls.filter((c) => !isCheckpoint(c) && c !== planner);
const byItem = PLAN_ITEMS.map((it) => workers.find((c) => c.prompt.includes(sentinelOf(it.id))));
const foundCount = byItem.filter(Boolean).length;
ok(foundCount === PLAN_ITEMS.length && new Set(byItem).size === PLAN_ITEMS.length,
  `3. one worker dispatched per planned item [${foundCount}/${PLAN_ITEMS.length} located by sentinel]`);

if (foundCount === PLAN_ITEMS.length) {
  const [w1, w2, w3] = byItem;

  // 4. the two independent items share ONE parallel() batch.
  ok(w1.batch !== null && w1.batch === w2.batch,
    `4. the independent items (w1, w2) are dispatched in the SAME parallel() batch `
    + `[batches: w1=${w1.batch}, w2=${w2.batch}]`);

  // 5. the dependent item runs only after both of its dependencies — later, and not in their batch.
  ok(w3.idx > w1.idx && w3.idx > w2.idx && w3.batch !== w1.batch,
    `5. the dependent item (w3) runs after its dependsOn and outside their batch `
    + `[idx w1=${w1.idx}, w2=${w2.idx}, w3=${w3.idx}; w3 batch=${w3.batch}]`);

  // 6. each item worker gets its OWN worktree (per-worker isolation, as for --independent).
  const WT = /\.worktrees\/[A-Za-z0-9._@/-]*[A-Za-z0-9_@/-]/g;
  const keys = byItem.map((w) => [...new Set(w.prompt.match(WT) || [])].sort().join('|'));
  ok(keys.every((k) => k.length > 0) && new Set(keys).size === PLAN_ITEMS.length,
    `6. each item worker resolves to its OWN worktree `
    + `[distinct: ${new Set(keys).size}/${PLAN_ITEMS.length}; ${keys.map((k) => k || '(none)').join(' , ')}]`);

  // 7. the plan is persisted for resume — the phase checkpoint sees the item ids.
  const ckpt = calls.filter((c) => isCheckpoint(c) && c.phase === PHASE);
  ok(ckpt.some((c) => PLAN_ITEMS.every((it) => c.prompt.includes(it.id))),
    `7. the phase checkpoint carries the plan item ids (resume reuses the plan, never re-plans) `
    + `[${ckpt.length} checkpoint call(s) in phase]`);
} else {
  ok(false, '4. the independent items (w1, w2) are dispatched in the SAME parallel() batch [skipped — no fan-out]');
  ok(false, '5. the dependent item (w3) runs after its dependsOn and outside their batch [skipped — no fan-out]');
  ok(false, '6. each item worker resolves to its OWN worktree [skipped — no fan-out]');
  ok(false, '7. the phase checkpoint carries the plan item ids [skipped — no fan-out]');
}

// 8. the opt-out still yields today's single serial worker (no planner, one work worker).
const optOut = gen('optout', ['--no-plan-fanout']);
if (optOut.code !== 0 || !nodeCheck(optOut.file)) {
  ok(false, `8. --no-plan-fanout generates a single-worker phase [generation exited ${optOut.code}]`);
} else {
  let oCalls;
  try { oCalls = await runBody(readFileSync(optOut.file, 'utf8')); }
  catch (e) { bail(2, `PRECONDITION FAILED: could not execute the --no-plan-fanout body: ${e && e.message}`); }
  const oPhase = oCalls.filter((c) => c.phase === PHASE && !isCheckpoint(c));
  ok(oPhase.length === 1 && !oPhase.some((c) => String(c.opts.label || '').startsWith('plan:')),
    `8. --no-plan-fanout opts out: no planner, exactly one work worker [${oPhase.length} worker(s)]`);
}

const failed = results.filter((r) => !r.pass);
rmSync(TMP, { recursive: true, force: true });
if (failed.length) {
  console.error(`\nRED: ${failed.length}/${results.length} assertion(s) failed — a work phase still runs as one serial worker.`);
  process.exit(1);
}
console.log(`\nGREEN: all ${results.length} assertions hold — work phases fan out over a runtime plan by dependency level.`);
