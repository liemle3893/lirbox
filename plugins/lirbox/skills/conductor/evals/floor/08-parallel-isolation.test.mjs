// FLOOR (characterization) — PASSES on baseline; pins conductor's PARALLEL FAN-OUT and ISOLATION by
// EXECUTING the generated conductor, not by reading it.
//
// WHY. "Independent work items run in their own worktrees, in dependency order, and a degraded run
// is legible rather than silent" is conductor's second-strongest claim after resume, and like resume
// it is deterministic — so it belongs in a free floor test, not a paid graded suite. Sibling file
// 07-resume-protocol.test.mjs does the same for resume and documents the executor pattern.
//
// The load-bearing signal is the same one as in 07: agent LABELS and the WORKTREE PATHS inside each
// worker's prompt. A phase() call proves nothing (it fires whether or not the work happened), and
// grepping the emitted script is how this repo has shipped false greens.
//
// PINS
//   ISOLATION
//     1. N independent items -> N workers, each named its OWN worktree and branch.
//     2. No item worker's prompt names a sibling's worktree — the isolation is per-item, not shared.
//   DEPENDENCY ORDER
//     3. Items with satisfied dependsOn ship in ONE parallel() batch.
//     4. An item that dependsOn another ships in a STRICTLY LATER batch.
//   ANTI-LYING GUARDS — a worker that claims success it did not deliver must fail the run LOUDLY.
//     5. level setup ready:false                              -> throws
//     6. level setup ready:true with the WRONG created set     -> throws (setupGap)
//     7. integrate merged:true with the WRONG merged_branches  -> throws (mergeGap)
//        7 is the one that matters most: without it the run's branch would silently NOT hold the
//        whole level, and every downstream gate would verify an incomplete delivery.
//   LEGIBLE DEGRADATION — every hole in delivered scope leaves a coverage note, never silence.
//     8. an item with no prompt is dropped AND recorded (dropped-plan-item).
//     9. a duplicate item id is dropped AND recorded (dropped-plan-item).
//    10. a dependency cycle collapses into one level AND is recorded (dependency-cycle) — the run
//        stays alive but the parallel dispatch of items the planner said were ordered is a real
//        coverage hole, not a log line.
//
// Determinism: no network, no models, no filesystem beyond a temp dir. Every agent() is stubbed.
// Locked (evals/**): the whetstone fixer may NEVER edit this file.
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL = resolve(HERE, '..', '..');
const GEN = process.env.GEN_OVERRIDE || join(SKILL, 'scripts', 'scaffold-workflow.cjs');
const NAME = 'fan-probe';

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) failures++; };

const tmp = mkdtempSync(join(tmpdir(), 'conductor-fanout-'));
const out = join(tmp, 'fan.js');
// Plan fan-out is the DEFAULT; --no-plan-fanout would disable the very thing under test.
execFileSync('node', [GEN, '--name', NAME, '--phases', 'Work', '--out', out, '--force'], { stdio: 'pipe' });
const src = readFileSync(out, 'utf8').replace(/^export const meta/m, 'const meta');

// NOTE: these names appear inside prose, so a trailing sentence period must NOT be captured — a
// `.` in the character class swallows it and the echoed set then mismatches the dispatched set,
// which surfaces as the conductor's own "missing X; unexpected X." guard firing on identical
// strings. Allow interior dots, never a trailing one.
const NAMEPART = '[A-Za-z0-9_-]+(?:\\.[A-Za-z0-9_-]+)*';
const WT_RE = new RegExp(`\\.worktrees/${NAME}--${NAMEPART}`, 'g');
const BR_RE = new RegExp(`wf/${NAME}--${NAMEPART}`, 'g');

let seq = 0;
// opts.setup / opts.integrate let a case make a worker LIE (claim success it did not deliver).
async function runFan(items, opts = {}) {
  const calls = [];
  const batches = [];
  globalThis.agent = async (prompt, o) => {
    const label = (o && o.label) || '(unlabelled)';
    const wts = [...new Set(prompt.match(WT_RE) || [])];
    const brs = [...new Set(prompt.match(BR_RE) || [])];
    calls.push({ label, wts, brs });
    if (/^plan:/.test(label)) return { items, summary: '' };
    if (/setup-l/.test(label)) return opts.setup ? opts.setup(wts) : { ready: true, created: wts, summary: '' };
    if (/integrate-l/.test(label)) return opts.integrate ? opts.integrate(brs) : { merged: true, merged_branches: brs, conflicts: [], summary: '' };
    return { ok: true, ready: true, passed: true, verdict: 'PASS', summary: '', items: [], findings: [] };
  };
  globalThis.parallel = async (thunks) => {
    const before = calls.length;
    const r = await Promise.all(thunks.map((f) => f()));
    batches.push(calls.slice(before).map((c) => c.label));
    return r;
  };
  globalThis.pipeline = async (items2) => items2;
  globalThis.phase = () => {};
  globalThis.log = () => {};
  globalThis.workflow = async () => ({});
  globalThis.args = undefined;
  globalThis.budget = { total: null, spent: () => 0, remaining: () => Infinity };

  const mod = join(tmp, `fan-${seq++}.mjs`);
  writeFileSync(mod, `export default await (async () => {\n${src}\n})();\n`);
  try {
    const m = await import(pathToFileURL(mod).href);
    return { calls, batches, result: m.default, error: null };
  } catch (e) {
    return { calls, batches, result: null, error: e.message };
  }
}

const itemWorkers = (calls) => calls.filter((c) => /^work:[a-z0-9-]+$/i.test(c.label) && !/^work:(setup|integrate)-/.test(c.label));
const coverageReasons = (res) => ((res && res.coverage) || []).map((c) => (typeof c === 'string' ? c : c.reason || c.kind || JSON.stringify(c)));

// ---- 1-4: isolation + dependency order ------------------------------------------------
const three = [
  { id: 'a', title: 'A', prompt: 'do a', dependsOn: [] },
  { id: 'b', title: 'B', prompt: 'do b', dependsOn: [] },
  { id: 'c', title: 'C', prompt: 'do c', dependsOn: ['a'] },
];
const run1 = await runFan(three);
ok(!run1.error, `0. a 3-item plan runs to completion (${run1.error || 'no error'})`);

const workers = itemWorkers(run1.calls);
ok(workers.length === 3, `1. three items dispatch three item workers (got ${workers.length}: ${workers.map((w) => w.label).join(', ')})`);
const perItemWts = workers.map((w) => w.wts.join('|'));
ok(new Set(perItemWts).size === 3 && perItemWts.every(Boolean),
  `1b. each item worker names its OWN worktree (${perItemWts.join(' , ')})`);
ok(workers.every((w) => w.brs.length >= 1), '1c. each item worker names its own per-item branch');
ok(workers.every((w) => w.wts.length === 1),
  '2. no item worker names a sibling worktree — isolation is per-item, not shared');

const batchOf = (label) => run1.batches.findIndex((b) => b.includes(label));
const [ia, ib, ic] = ['work:a', 'work:b', 'work:c'].map(batchOf);
ok(ia >= 0 && ia === ib, `3. independent items a,b ship in ONE parallel batch (batches ${ia}, ${ib})`);
ok(ic > ia, `4. c dependsOn a, so it ships in a strictly LATER batch (a=batch ${ia}, c=batch ${ic})`);

// ---- 5-7: anti-lying guards -----------------------------------------------------------
const notReady = await runFan(three, { setup: () => ({ ready: false, created: [], summary: 'disk full' }) });
ok(!!notReady.error && /worktrees not ready/i.test(notReady.error), '5. level setup ready:false aborts the run');

const lyingSetup = await runFan(three, { setup: () => ({ ready: true, created: ['.worktrees/fan-probe--wrong'], summary: '' }) });
ok(!!lyingSetup.error && /not the set that was dispatched/i.test(lyingSetup.error),
  '6. setup claiming ready:true with the WRONG worktrees aborts (setupGap)');

const lyingMerge = await runFan(three, { integrate: () => ({ merged: true, merged_branches: [], conflicts: [], summary: '' }) });
ok(!!lyingMerge.error && /does NOT hold the whole level/i.test(lyingMerge.error),
  '7. integrate claiming merged:true without merging the dispatched branches aborts (mergeGap)');

// ---- 8-10: degradation is legible -----------------------------------------------------
const noPrompt = await runFan([
  { id: 'a', title: 'A', prompt: 'do a', dependsOn: [] },
  { id: 'ghost', title: 'Ghost', prompt: '', dependsOn: [] },
]);
ok(coverageReasons(noPrompt.result).some((r) => /dropped-plan-item/.test(r)),
  `8. an item with no prompt is dropped AND recorded (coverage: ${coverageReasons(noPrompt.result).join(', ') || 'none'})`);

const dupe = await runFan([
  { id: 'a', title: 'A', prompt: 'do a', dependsOn: [] },
  { id: 'a', title: 'A again', prompt: 'do a twice', dependsOn: [] },
]);
ok(coverageReasons(dupe.result).some((r) => /dropped-plan-item/.test(r)),
  `9. a duplicate item id is dropped AND recorded (coverage: ${coverageReasons(dupe.result).join(', ') || 'none'})`);

const cycle = await runFan([
  { id: 'x', title: 'X', prompt: 'do x', dependsOn: ['y'] },
  { id: 'y', title: 'Y', prompt: 'do y', dependsOn: ['x'] },
]);
ok(!cycle.error, '10. a dependency cycle does not stall the run');
ok(coverageReasons(cycle.result).some((r) => /dependency-cycle/.test(r)),
  `10b. the collapsed cycle is RECORDED as a coverage hole (coverage: ${coverageReasons(cycle.result).join(', ') || 'none'})`);

rmSync(tmp, { recursive: true, force: true });

if (failures) {
  console.error(`\n${failures} assertion(s) FAILED — parallel fan-out or its isolation is broken. Items may share a worktree, run out of dependency order, or a worker may claim success it never delivered while the run continues and the downstream gates verify an incomplete branch. See references/workflow-runtime.md §3b.`);
  process.exit(1);
}
console.log('\nparallel fan-out + isolation: ok (executed, not scanned)');
