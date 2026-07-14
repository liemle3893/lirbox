// ACCEPTANCE CHECK (RED on baseline, GREEN after the fix) — whetstone item:
// parallelize-independent-work-items.
//
// Concern (feedback/conductor.jsonl → parallelize-independent-work-items): conductor loses to a
// RAW single session on wide, decomposable tasks because its generated plan runs INDEPENDENT work
// items as SEQUENTIAL phases. Measured: six independent bugs → conductor emitted Report1..Report6 as
// serial phases, each paying worker spin-up + ~5-min full-suite verification, and it timed out; a
// raw session finished in 53 min. When the work items are declared independent, the scaffold should
// fan the per-item workers out CONCURRENTLY (Workflow parallel()/pipeline()), verifying once at the
// gate — reserving sequential phases for genuinely dependent steps.
//
// This check drives the generator with N=4 work items declared INDEPENDENT (via a `--independent`
// signal) and asserts the emitted loop dispatches them through a concurrency primitive rather than
// as N strictly-sequential awaited phase() blocks. It is deliberately tolerant: it fails ONLY when
// the independent items are each emitted as their own sequential phase AND no parallel()/pipeline()
// wraps them (the current, unfixed shape). Any implementation that fans the independent items out
// concurrently passes — it does NOT pin variable names, formatting, or the exact spelling of the
// "independent" signal (a generator that makes independent work the default still emits a
// concurrency primitive here and passes).
//
// Assertions:
//   0. PRECONDITION control — the plain multi-phase command (no independence signal) exits 0 and
//      parses today. If it fails, the generator is broken for a reason unrelated to this concern →
//      exit 2 (harness error, NOT a red verdict).
//   1. `--phases <4 items> --independent` generation exits 0 and the emitted script parses.
//   2. The independent work items are NOT emitted as N strictly-sequential phase() blocks with no
//      concurrency primitive over them — i.e. a parallel()/pipeline() fans them out (and no work
//      item is dropped).
//
// Baseline: the generator has no concept of independence — `--independent` is ignored and the 4
// items become 4 serial phase() blocks with no parallel()/pipeline() → RED. After the fix the
// independent items are dispatched concurrently → exit 0 (GREEN).
//
// Standalone: `node plugins/lirbox/skills/conductor/evals/parallelize-independent-work-items.test.mjs`
// This file lives directly under evals/ (NOT evals/floor/), so the floor runner does NOT auto-pick
// it up. The whetstone loop runs it one-at-a-time.
//
// Locked (evals/**): the whetstone fixer may NEVER edit this file.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(HERE, '..');                     // .../skills/conductor
const REPO = resolve(SKILL_DIR, '..', '..', '..', '..');   // repo root
const GEN = resolve(SKILL_DIR, 'scripts', 'scaffold-workflow.cjs');

const ITEMS = ['FixAlpha', 'FixBravo', 'FixCharlie', 'FixDelta']; // N=4 independent work items

const TMP = mkdtempSync(join(tmpdir(), 'parallelize-independent-'));

// Prompts for each item (data-in, as the generator expects). Independence is stated in the prose
// too, so an implementation that infers independence from the prompt text can also key off this.
const promptsFile = join(TMP, 'prompts.json');
{
  const map = {};
  for (const it of ITEMS) map[it] = `Fix the independent bug ${it}. It shares no files or state with the other items.`;
  writeFileSync(promptsFile, JSON.stringify(map));
}

// Run the generator; return { code, out }. code 0 = success.
function gen(extraArgs) {
  try {
    const out = execFileSync('node', [GEN, ...extraArgs],
      { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out };
  } catch (e) {
    return { code: typeof e.status === 'number' ? e.status : 1, out: (e.stdout || '') + (e.stderr || '') };
  }
}

function nodeCheck(file) {
  try { execFileSync('node', ['--check', file], { stdio: 'ignore' }); return true; }
  catch { return false; }
}
function readOrEmpty(file) {
  try { return readFileSync(file, 'utf8'); } catch { return ''; }
}

const results = [];
function ok(pass, label) {
  results.push({ pass, label });
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${label}`);
}

const BASE = ['--name', 'pindep', '--phases', ITEMS.join(','), '--prompts-file', promptsFile];

// Slice to the core/work region: everything between the Setup checkpoint and the final return. In
// this bare config the ONLY phases in that region are the work items (no gates), so any
// parallel()/pipeline() there necessarily fans out the independent work.
function workRegion(src) {
  const start = src.indexOf("await checkpoint('Setup')");
  const end = src.indexOf('return { workflow: NAME, status: ');
  if (start === -1 || end === -1 || end <= start) return null;
  return src.slice(start, end);
}

function main() {
  // --- 0. PRECONDITION control: plain multi-phase generation (no independence signal) works today.
  const ctlFile = join(TMP, 'ctl.js');
  const ctl = gen([...BASE, '--out', ctlFile, '--force']);
  if (ctl.code !== 0 || !nodeCheck(ctlFile)) {
    console.error('PRECONDITION FAILED: plain multi-phase generation (no --independent) exits non-zero '
      + 'or does not parse — unrelated generator breakage, not this concern.');
    console.error(`  exit ${ctl.code}\n${ctl.out}`);
    return 2;
  }
  console.log('PASS: 0. precondition — plain 4-phase generation exits 0 and parses');

  // --- 1. generate with the items declared INDEPENDENT ---
  const outFile = join(TMP, 'wf.js');
  const r = gen([...BASE, '--independent', '--out', outFile, '--force']);
  ok(r.code === 0,
    `1a. \`--phases <4 items> --independent\` generation exits 0 (got ${r.code}: ${r.out.trim().split('\n')[0] || 'no output'})`);
  const src = r.code === 0 ? readOrEmpty(outFile) : '';
  ok(r.code === 0 && nodeCheck(outFile), '1b. emitted script passes `node --check`');

  // --- 2. the independent items must be fanned out concurrently, not run as N serial phases ---
  const region = workRegion(src);
  if (region === null) {
    ok(false, '2. could not locate the work region (Setup checkpoint → final return) in the emitted script');
  } else {
    const hasConcurrency = /\b(?:parallel|pipeline)\s*\(/.test(region);
    const eachItemOwnPhase = ITEMS.every((it) => region.includes(`phase('${it}')`));
    const seqAgentCalls = (region.match(/await\s+agent\s*\(/g) || []).length;
    const allItemsPresent = ITEMS.every((it) => src.includes(it));

    // The unfixed shape: every independent item is its own sequential phase() with an individually
    // awaited worker, and no concurrency primitive fans them out.
    const strictlySequential = eachItemOwnPhase && !hasConcurrency;
    // GREEN: a concurrency primitive fans the items out, AND no work item was dropped in the rewrite.
    const fannedOut = hasConcurrency && allItemsPresent;

    ok(fannedOut && !strictlySequential,
      `2. the ${ITEMS.length} independent work items are fanned out via parallel()/pipeline() rather than `
      + `run as ${ITEMS.length} strictly-sequential phase() blocks `
      + `[concurrency-primitive=${hasConcurrency}, per-item-sequential-phases=${eachItemOwnPhase}, `
      + `awaited-agent-calls-in-work-region=${seqAgentCalls}, all-items-present=${allItemsPresent}]`);
  }

  const failed = results.filter((x) => !x.pass);
  if (failed.length) {
    console.error(`\ncheck RED: ${failed.length}/${results.length} assertion(s) failed.`);
    console.error('The scaffold has no concept of independent work: it serializes decomposable work items '
      + 'into one phase() per item, paying worker spin-up + per-item verification for each. '
      + 'Expected: independent items fanned out via Workflow parallel()/pipeline(), verified once at the gate.');
    return 1;
  }
  console.log(`\ncheck GREEN: all ${results.length} assertions passed — independent work items run concurrently.`);
  return 0;
}

let code;
try {
  code = main();
} catch (e) {
  console.error(`check: harness error: ${e.stack || e.message}`);
  code = 2;
} finally {
  rmSync(TMP, { recursive: true, force: true });
}
process.exit(code);
