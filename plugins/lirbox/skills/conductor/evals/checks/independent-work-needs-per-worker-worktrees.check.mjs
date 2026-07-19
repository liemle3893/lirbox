// ACCEPTANCE CHECK (RED on baseline) — `--independent` fan-out must give each parallel worker its
// OWN worktree, and merge/integrate the per-worker results before the gate.
//
// Concern (feedback/conductor.jsonl → independent-work-needs-per-worker-worktrees): the
// `--independent` parallel fan-out is unusable for the most common real shape of independent work —
// N independent changes that touch the SAME FILE — because every parallel worker shares ONE
// worktree (they collide on the file and on .git/index.lock). Fix: give `--independent` per-worker
// isolation — each parallel worker gets its OWN worktree/branch off the base, and a merge/integrate
// step (sequential rebase/cherry-pick with conflict-fix loop, or diff-level merge) combines them
// BEFORE the gates verify the combined diff once.
//
// Today (baseline): scaffold-workflow.cjs emits ONE Work phase whose `parallel([...])` fans N
// workers out, but every worker resolves `inWorktree(item)` to the single shared `WORKTREE`
// (`.worktrees/<name>`) and carries the verbatim "…IN PARALLEL in this SAME worktree…" instruction;
// nothing runs between the fan-out and the gate. So:
//   - assertion 3 (distinct worktrees) FAILS  — all N workers name `.worktrees/pindep`
//   - assertion 4 (shared-worktree language gone) FAILS — every worker says "SAME worktree"
//   - assertion 5 (merge/integrate step) FAILS — no combine step after the fan-out
// → exit 1 (RED). After the fix (per-worker worktrees + a merge step) all three hold → exit 0.
//
// HOW distinctness is judged (robustly, not by prose): the emitted Workflow body is EXECUTED with
// stubbed agent()/parallel()/pipeline()/phase()/log(), which resolves each worker's prompt through
// the real `${inWorktree(...)}`/`${WORKTREE}` interpolation. We then read the actual worktree path
// each parallel worker is told to work in. This is agnostic to whether the fix builds per-item
// paths in a helper or inline — it observes the RESOLVED instruction, not the source spelling.
//
// Deterministic only — no network, no LLM. A generator crash / structural surprise on `--independent`
// exits 2 (harness error), NOT 1, so a RED verdict always means "missing per-worker worktrees / merge
// step", never "the generator broke for an unrelated reason".
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

// N independent items. A unique sentinel per item is woven into each prompt so we can identify each
// fan-out worker by its resolved prompt (robust to worker-label changes) and separate the item
// workers from any merge/integrate worker the fix introduces.
const ITEMS = ['FixAlpha', 'FixBravo', 'FixCharlie', 'FixDelta'];
const sentinel = (it) => `WORKITEM_SENTINEL_${it}`;

const TMP = mkdtempSync(join(tmpdir(), 'per-worker-worktrees-'));

const promptsFile = join(TMP, 'prompts.json');
{
  const map = {};
  for (const it of ITEMS) {
    map[it] = `${sentinel(it)}: fix the independent bug ${it}. All items touch the SAME source file, ` +
      `so they cannot safely share a worktree.`;
  }
  writeFileSync(promptsFile, JSON.stringify(map));
}

// Run the generator to a file; return { code, out, file }.
function gen(label, extraArgs) {
  const file = join(TMP, label + '.js');
  try {
    const out = execFileSync('node', [GEN, '--name', 'pindep', '--out', file, '--force',
      '--prompts-file', promptsFile, ...extraArgs], { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out, file };
  } catch (e) {
    return { code: typeof e.status === 'number' ? e.status : 1, out: (e.stdout || '') + (e.stderr || ''), file };
  }
}
function nodeCheck(file) {
  try { execFileSync('node', ['--check', file], { stdio: 'ignore' }); return true; }
  catch { return false; }
}

// Strip the `export const meta = { ... }` module wrapper by brace-matching, leaving the Workflow
// body (which ends in a top-level `return`), so it can run inside an async function.
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

// Execute the emitted body with stubbed runtime; capture every agent() call in order, with its
// phase, label, and FULLY-RESOLVED prompt (template interpolation evaluated). Throws → harness error.
function runBody(src) {
  const calls = [];
  let curPhase = null;
  // Broadly-permissive worker result so any gate/merge `check:` the fix adds does not throw here.
  const result = () => ({
    summary: '', ready: true, written: true, path: 'x', green: true, gatePassed: true, closed: true,
    red: true, merged: true, integrated: true, ok: true, success: true, conflicts: [], failing: [],
    regressions: [], uncovered: 0, tested: 0, justified: 0, critical: 0, high: 0, buildExit: 0,
    baselines: [], tests: [],
  });
  const agent = async (prompt, opts) => {
    calls.push({ prompt: String(prompt), opts: opts || {}, phase: (opts && opts.phase) || curPhase });
    return result();
  };
  const parallel = async (fns) => { const out = []; for (const f of fns) out.push(await f()); return out; };
  const pipeline = async (fns) => { let last; for (const f of fns) last = await f(); return last; };
  const phase = (t) => { curPhase = t; };
  const log = () => {};
  const runner = new Function('agent', 'parallel', 'pipeline', 'phase', 'log', 'args',
    `return (async () => { ${bodyOf(src)} })()`);
  return runner(agent, parallel, pipeline, phase, log, {}).then(() => calls);
}

const results = [];
function ok(pass, label) { results.push({ pass, label }); console.log(`${pass ? 'PASS' : 'FAIL'}: ${label}`); }
function bail(code, msg) { console.error(msg); rmSync(TMP, { recursive: true, force: true }); process.exit(code); }

// ---------- preconditions (failure here is a harness error → exit 2, never a RED verdict) ----------

// 0. plain multi-phase generation (no independence signal) works today.
const ctl = gen('ctl', ['--phases', ITEMS.join(',')]);
if (ctl.code !== 0 || !nodeCheck(ctl.file)) {
  bail(2, `PRECONDITION FAILED: plain multi-phase generation exits ${ctl.code} or does not parse — `
    + `unrelated generator breakage, not this concern.\n${ctl.out}`);
}
console.log('PASS: 0. precondition — plain multi-phase generation exits 0 and parses');

// 1. `--independent` generation exits 0 and parses.
const ind = gen('indep', ['--phases', ITEMS.join(','), '--independent']);
if (ind.code !== 0 || !nodeCheck(ind.file)) {
  bail(2, `PRECONDITION FAILED: \`--independent\` generation exits ${ind.code} or does not parse.\n${ind.out}`);
}
console.log('PASS: 1. precondition — `--independent` generation exits 0 and parses');

// Execute the emitted body and resolve worker prompts.
let calls;
try {
  calls = await runBody(readFileSync(ind.file, 'utf8'));
} catch (e) {
  bail(2, `PRECONDITION FAILED: could not execute the emitted --independent body to resolve worker `
    + `prompts (structure changed unexpectedly): ${e && (e.stack || e.message)}`);
}

const isCheckpoint = (c) => String(c.opts.label || '').startsWith('checkpoint');
// The fan-out item workers: Work-phase, non-checkpoint, one per item (matched by its sentinel).
const workWorkers = calls.filter((c) => c.phase === 'Work' && !isCheckpoint(c));
const itemWorkers = ITEMS.map((it) => workWorkers.find((c) => c.prompt.includes(sentinel(it))));
if (itemWorkers.some((w) => !w) || new Set(itemWorkers).size !== ITEMS.length) {
  bail(2, `PRECONDITION FAILED: could not locate one distinct fan-out worker per item in the Work phase `
    + `(found ${itemWorkers.filter(Boolean).length}/${ITEMS.length}) — structure changed unexpectedly.`);
}
console.log('PASS: 2. precondition — one fan-out worker resolved per independent item');

// ---------- the three RED assertions ----------

// Worktree path(s) each worker is told to work in. `.worktrees/<...>` is the established convention
// (the WORKTREE const, the .gitignore un-ignore). A worker's "own" worktree set = the distinct
// `.worktrees/*` tokens in its resolved prompt.
const WT = /\.worktrees\/[A-Za-z0-9._@/-]*[A-Za-z0-9_@/-]/g;
const wtSetKey = (w) => [...new Set((w.prompt.match(WT) || []))].sort().join('|');
const keys = itemWorkers.map(wtSetKey);
const everyWorkerHasWorktree = keys.every((k) => k.length > 0);
const distinctCount = new Set(keys).size;

// 3. each parallel worker is instructed to work in a DISTINCT worktree (not the one shared tree).
ok(everyWorkerHasWorktree && distinctCount === ITEMS.length,
  `3. each of the ${ITEMS.length} parallel workers gets its OWN worktree `
  + `[distinct worktree path-sets across workers = ${distinctCount}/${ITEMS.length}; `
  + `resolved: ${keys.map((k) => k || '(none)').join(' , ')}]`);

// 4. the shared-worktree instruction ("…IN PARALLEL in this SAME worktree…") is gone — a per-worker
//    fix cannot both isolate workers and tell them they share one tree.
const sharedLang = itemWorkers.filter((w) => /SAME worktree/i.test(w.prompt)).length;
ok(sharedLang === 0,
  `4. no worker still carries the shared-worktree instruction "SAME worktree" `
  + `(${sharedLang}/${ITEMS.length} workers still do)`);

// 5. a merge/integrate step runs AFTER the fan-out (combining the per-worker branches) and BEFORE the
//    gate. In this bare config nothing but the Work checkpoint follows the fan-out today.
const lastItemIdx = Math.max(...itemWorkers.map((w) => calls.indexOf(w)));
const MERGE = /\b(merg\w*|integrat\w*|combin\w*|cherry[- ]?pick\w*|rebas\w*|assembl\w*)\b/i;
const MERGE_CTX = /\b(worktree|worktrees|branch\w*|per[- ]?item|per[- ]?worker|parallel|each item|the items|combined|conflict\w*)\b/i;
const mergeStep = calls.some((c, i) => i > lastItemIdx && !isCheckpoint(c)
  && MERGE.test(c.prompt) && MERGE_CTX.test(c.prompt));
ok(mergeStep,
  `5. a merge/integrate step combines the per-worker worktrees/branches AFTER the fan-out and before `
  + `the gate (found=${mergeStep})`);

rmSync(TMP, { recursive: true, force: true });

const failed = results.filter((r) => !r.pass);
if (failed.length) {
  console.error(`\ncheck RED: ${failed.length}/${results.length} assertion(s) failed — \`--independent\` still `
    + `runs every parallel worker in ONE shared worktree with no merge step. Independent changes that touch `
    + `the same file collide (on the file and on .git/index.lock). Expected: each worker gets its OWN `
    + `worktree/branch off the base, merged/integrated before the gate verifies the combined diff once.`);
  process.exit(1);
}
console.log(`\ncheck GREEN: all ${results.length} assertions passed — \`--independent\` isolates each worker `
  + `in its own worktree and merges before the gate.`);
process.exit(0);
