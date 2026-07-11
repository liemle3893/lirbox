// ACCEPTANCE CHECK (RED on baseline) — scaffold-workflow.cjs must gain `--frontend web|mobile|both`
// emitting a FrontendGate phase.
//
// Concern (feedback/conductor.jsonl → frontend-gate-phase): the generator must accept
// `--frontend web` and emit a phase('FrontendGate') into the conductor, ordered:
//   - after phase('ReVerify') and before phase('Writeup')  (delivery profile, --no-dod), and
//   - after phase('ReVerify') and before phase('DoDGate')  (delivery profile, --dod-file).
//
// Assertions:
//   0. PRECONDITION controls — the SAME commands minus `--frontend web` exit 0 today.
//      If a control fails, the generator is broken for a reason unrelated to this concern →
//      exit 2 (harness error, NOT a red verdict on this concern).
//   1. gen 1 (`--phases Implement --frontend web --profile delivery --no-dod`) exits 0
//   2. fg1.js orders phase('ReVerify') < phase('FrontendGate') < phase('Writeup') (all present)
//   3. fg1.js passes `node --check`
//   4. gen 2 (same, but `--dod-file <single-criterion dod.json>` instead of --no-dod) exits 0
//   5. fg2.js orders phase('ReVerify') < phase('FrontendGate') < phase('DoDGate') (all present)
//   6. fg2.js passes `node --check`
//
// Baseline: today `--frontend` is either rejected (assertions 1/4 fail) or silently ignored with
// no FrontendGate emitted (assertions 2/5 fail) — RED either way. After the fix: all six hold →
// exit 0 (GREEN).
//
// Locked (evals/**): the whetstone fixer may NEVER edit this file.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(HERE, '..', '..');                       // .../skills/conductor
const REPO = resolve(SKILL_DIR, '..', '..', '..', '..');           // repo root
const GEN = resolve(SKILL_DIR, 'scripts', 'scaffold-workflow.cjs');

const TMP = mkdtempSync(join(tmpdir(), 'frontend-gate-check-'));

// --- fixture the check writes itself: minimal valid single-criterion DoD ---
const dodFile = join(TMP, 'dod.json');
writeFileSync(dodFile, JSON.stringify({ criteria: [
  { id: 'c1', text: 'placeholder', tier: 'checkable', check: 'true' },
] }));

// Run the generator; return { code, out }. code 0 = success, non-zero = rejection/error.
function gen(extraArgs) {
  try {
    const out = execFileSync('node', [GEN, ...extraArgs],
      { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out };
  } catch (e) {
    return { code: typeof e.status === 'number' ? e.status : 1, out: (e.stdout || '') + (e.stderr || '') };
  }
}

// Ordered list of phase names as emitted ('' source → []).
function phaseOrder(src) {
  return (src.match(/phase\('([^']*)'\)/g) || []).map((m) => m.slice(7, -2));
}

// node --check on an emitted file → true iff it parses.
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

const BASE_NODOD = ['--name', 'fgcheck', '--phases', 'Implement', '--profile', 'delivery', '--no-dod'];
const BASE_DOD = ['--name', 'fgcheck', '--phases', 'Implement', '--profile', 'delivery', '--dod-file', dodFile];

// Runs all assertions; returns the process exit code (0 GREEN, 1 RED, 2 harness/precondition).
function main() {
  // --- 0. PRECONDITION controls: same commands WITHOUT --frontend must exit 0 today. ---
  const ctl1 = gen([...BASE_NODOD, '--out', join(TMP, 'ctl1.js'), '--force']);
  const ctl2 = gen([...BASE_DOD, '--out', join(TMP, 'ctl2.js'), '--force']);
  if (ctl1.code !== 0 || ctl2.code !== 0) {
    console.error('PRECONDITION FAILED: control generation WITHOUT --frontend exits non-zero — '
      + 'unrelated generator breakage, not this concern.');
    console.error(`  control --no-dod   exit ${ctl1.code}\n${ctl1.out}`);
    console.error(`  control --dod-file exit ${ctl2.code}\n${ctl2.out}`);
    return 2;
  }
  console.log('PASS: 0. precondition — both control generations (no --frontend) exit 0');

  // --- generation 1: --frontend web, --no-dod → FrontendGate between ReVerify and Writeup ---
  const fg1File = join(TMP, 'fg1.js');
  const r1 = gen([...BASE_NODOD, '--frontend', 'web', '--out', fg1File, '--force']);
  ok(r1.code === 0,
    `1. \`--frontend web --no-dod\` generation exits 0 (got ${r1.code}: ${r1.out.trim().split('\n')[0] || 'no output'})`);

  const o1 = phaseOrder(r1.code === 0 ? readOrEmpty(fg1File) : '');
  ok(o1.indexOf('ReVerify') !== -1 && o1.indexOf('FrontendGate') !== -1 && o1.indexOf('Writeup') !== -1
     && o1.indexOf('ReVerify') < o1.indexOf('FrontendGate') && o1.indexOf('FrontendGate') < o1.indexOf('Writeup'),
    "2. fg1.js orders phase('ReVerify') < phase('FrontendGate') < phase('Writeup')"
    + ` (emitted: ${o1.join(' → ') || 'none'})`);

  ok(r1.code === 0 && nodeCheck(fg1File),
    '3. fg1.js passes `node --check`');

  // --- generation 2: --frontend web, --dod-file → FrontendGate between ReVerify and DoDGate ---
  const fg2File = join(TMP, 'fg2.js');
  const r2 = gen([...BASE_DOD, '--frontend', 'web', '--out', fg2File, '--force']);
  ok(r2.code === 0,
    `4. \`--frontend web --dod-file\` generation exits 0 (got ${r2.code}: ${r2.out.trim().split('\n')[0] || 'no output'})`);

  const o2 = phaseOrder(r2.code === 0 ? readOrEmpty(fg2File) : '');
  ok(o2.indexOf('ReVerify') !== -1 && o2.indexOf('FrontendGate') !== -1 && o2.indexOf('DoDGate') !== -1
     && o2.indexOf('ReVerify') < o2.indexOf('FrontendGate') && o2.indexOf('FrontendGate') < o2.indexOf('DoDGate'),
    "5. fg2.js orders phase('ReVerify') < phase('FrontendGate') < phase('DoDGate')"
    + ` (emitted: ${o2.join(' → ') || 'none'})`);

  ok(r2.code === 0 && nodeCheck(fg2File),
    '6. fg2.js passes `node --check`');

  const failed = results.filter((r) => !r.pass);
  if (failed.length) {
    console.error(`\ncheck RED: ${failed.length}/${results.length} assertion(s) failed — --frontend does not emit a FrontendGate phase.`);
    return 1;
  }
  console.log(`\ncheck GREEN: all ${results.length} FrontendGate assertions passed.`);
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
