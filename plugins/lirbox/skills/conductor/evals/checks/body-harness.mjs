// Shared execution harness for conductor acceptance-checks that need to RUN the emitted conductor
// body rather than pattern-match its source. Deliberately NOT named `*.check.mjs`: both
// checks-manifest-guard and floor/06-checks-manifest.test.mjs enumerate `*.check.mjs`, so this file
// is invisible to them and needs no manifest entry.
//
// Why execution beats a regex here. The concerns this serves are about what the conductor DOES with
// a worker's answer — a null result, a short `merged_branches` list, a level that already ran. A
// source scan can only see that some string is present; only running the body with a stubbed
// agent()/parallel() can prove the control flow actually reacts. Every stub is pure JS, so the
// harness inherits the conductor layer's own restriction and needs no filesystem or git.
//
// Locked (evals/**): the whetstone fixer may NEVER edit this file.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Generate a conductor into `tmp` and return { code, out, file }.
export function generate({ gen, repo, tmp, name, argv }) {
  const file = join(tmp, name + '.js');
  try {
    const out = execFileSync('node', [gen, '--name', name, '--out', file, '--force', ...argv],
      { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out, file };
  } catch (e) {
    return { code: typeof e.status === 'number' ? e.status : 1, out: (e.stdout || '') + (e.stderr || ''), file };
  }
}

// Compile as the async function BODY the Workflow runtime wraps the script in. NOT `node --check`,
// which is vacuous here: it stops validating after the first ESM statement, and every emitted script
// opens with `export const meta`, so a syntax error in the executing body would pass cleanly.
export function parses(file) {
  try {
    const s = readFileSync(file, 'utf8').replace(/^export const meta/m, 'const meta');
    const AF = Object.getPrototypeOf(async function () {}).constructor;
    new AF('args', 'log', 'phase', 'agent', 'parallel', 'pipeline', 'budget', 'workflow', s);
    return true;
  } catch { return false; }
}

// Strip the `export const meta = {...}` wrapper by brace-matching, leaving the runnable body.
export function bodyOf(src) {
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

// The permissive worker answer: every boolean a gate might read is true, every list empty. A check
// makes exactly ONE thing go wrong via `answer`, so anything it does not override cannot be the
// cause of the verdict.
export const permissive = () => ({
  summary: '', ready: true, written: true, path: 'x', green: true, gatePassed: true, closed: true,
  red: true, merged: true, integrated: true, ok: true, success: true, conflicts: [], failing: [],
  regressions: [], uncovered: 0, tested: 0, justified: 0, critical: 0, high: 0, buildExit: 0,
  baselines: [], tests: [], items: [], criteria: [], goals: [], plan: '', steps: [],
});

// The checkpoint worker ships durable state as JSON inside a heredoc in its prompt. Pull it back out
// so a check can assert on what would actually be PERSISTED, not merely on what the conductor holds
// in memory.
export function checkpointPayload(prompt) {
  const s = String(prompt);
  const open = s.indexOf("<<'DURABLE_JSON'");
  if (open === -1) return null;
  const start = s.indexOf('\n', open);
  const end = s.indexOf('\nDURABLE_JSON', start);
  if (start === -1 || end === -1) return null;
  try { return JSON.parse(s.slice(start + 1, end)); } catch { return null; }
}

// Execute the emitted body with stubs.
//
// `answer(ctx)` is called for every agent() dispatch with { prompt, opts, label, phase, base, calls }
// and may return a result object to override the permissive default (return undefined/null to keep
// it). Returning the literal string 'DEAD' resolves that call to null — what the real parallel()
// does for a worker that died after retries, which is the input several of these concerns hinge on.
//
// Returns { calls, checkpoints, error }. `error` is the thrown value if the body aborted — for these
// concerns an abort is often the CORRECT behaviour, so it is data, not a harness failure.
// `args` is handed to the body verbatim, so a check can replay a RESUME by passing the
// `{ phasesDone, results }` it recovered from a prior run's checkpoint payload.
export async function runBody(src, answer = () => undefined, args = {}) {
  const calls = [];
  const checkpoints = [];
  const dispatchedByLevel = {};      // level -> { worktrees, branches }
  let curPhase = null;
  let batchId = null;
  let batchSeq = 0;

  const agent = async (prompt, opts) => {
    const o = opts || {};
    const label = String(o.label || '');
    const rec = { prompt: String(prompt), opts: o, label, phase: o.phase || curPhase, batch: batchId, idx: calls.length };
    calls.push(rec);
    if (label.startsWith('checkpoint') || label.endsWith(':escalate')) {
      const payload = checkpointPayload(prompt);
      if (payload) checkpoints.push({ label, payload, idx: rec.idx });
    }
    const base = permissive();

    // Keep `permissive` permissive as the conductor gets STRICTER. A fan-out setup/integrate worker
    // is asked for the SET it acted on, not just a boolean, so a base that omitted those lists would
    // start failing a correct implementation's cross-check — turning an unrelated check's
    // precondition into spurious harness rot. The dispatched set is recovered from the conductor's
    // OWN setup prompt (`setup_item "<worktree>" "<branch>"`, unambiguous) and replayed to the
    // matching integrate. A check that wants a SHORT list overrides these explicitly.
    const setupAt = label.match(/:setup-l(\d+)$/);
    if (setupAt) {
      const worktrees = [], branches = [];
      for (const m of rec.prompt.matchAll(/setup_item\s+"([^"]+)"\s+"([^"]+)"/g)) { worktrees.push(m[1]); branches.push(m[2]); }
      dispatchedByLevel[setupAt[1]] = { worktrees, branches };
      base.created = worktrees;
    }
    const integrateAt = label.match(/:integrate-l(\d+)$/);
    if (integrateAt) {
      const d = dispatchedByLevel[integrateAt[1]] || { worktrees: [], branches: [] };
      base.merged_branches = d.branches;
      base.removed_worktrees = d.worktrees;
    }
    const given = answer({ prompt: rec.prompt, opts: o, label, phase: rec.phase, base, calls });
    if (given === 'DEAD') return null;
    return given == null ? base : given;
  };

  // Batch-aware and null-preserving: every thunk dispatched in one parallel() shares a batch id, and
  // a thunk that throws resolves to null exactly as the real runtime does.
  const parallel = async (fns) => {
    const mine = `b${batchSeq++}`;
    const prev = batchId;
    batchId = mine;
    const out = [];
    try {
      for (const f of fns) {
        try { out.push(await f()); } catch { out.push(null); }
      }
    } finally { batchId = prev; }
    return out;
  };
  const pipeline = async (fns) => { let last; for (const f of fns) last = await f(); return last; };
  const phase = (t) => { curPhase = t; };
  const log = () => {};

  // new Function on generated source is the point of this harness, and the same pattern
  // dynamic-fanout-within-phase.check.mjs already uses: `src` is output from THIS repo's own
  // scaffold-workflow.cjs, produced seconds earlier by the caller, executed locally with pure-JS
  // stubs and no filesystem/network/git reachable from the body. It is not untrusted input. Static
  // scanners flag this line — do not "fix" it by parsing the conductor instead; a parser cannot
  // observe control flow, which is the only thing these checks are asking about.
  const runner = new Function('agent', 'parallel', 'pipeline', 'phase', 'log', 'args', 'budget', 'workflow',
    `return (async () => { ${bodyOf(src)} })()`);
  let error = null;
  try {
    await runner(agent, parallel, pipeline, phase, log, args, { total: null, spent: () => 0, remaining: () => Infinity }, async () => ({}));
  } catch (e) { error = e; }
  return { calls, checkpoints, error };
}
