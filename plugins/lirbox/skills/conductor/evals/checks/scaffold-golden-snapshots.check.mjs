// ACCEPTANCE CHECK (RED on baseline) — scaffold-workflow.cjs must be pinned by golden snapshots.
//
// Concern (feedback/conductor.jsonl → scaffold-golden-snapshots): test-scaffold.cjs defends the
// 799-line generator only with sampled structural asserts, so a refactor can silently alter
// emitted output and stay green. Output is byte-deterministic for fixed args (re-verified:
// cwd-independent, time-stable, input-path-independent). The fix must:
//   - commit snapshot fixtures under  scripts/snapshots/<label>.js  for the canonical combo set,
//   - commit the pinned input fixtures under  scripts/snapshots/inputs/  (prompts.json, dod.json
//     — the lite/delivery combos require --dod-file and inputs are baked into output verbatim),
//   - make test-scaffold.cjs regenerate each combo and byte-compare against its fixture, with a
//     snapshot-dir override (SNAPSHOT_DIR env var OR --snapshot-dir flag) for regen/tamper runs.
//
// PINNED CONTRACT — six labels and arg vectors. Every run uses
//   node scaffold-workflow.cjs --name snap --out <tmp>/<label>.js --force <args>
// with cwd = repo root and inputs resolved from scripts/snapshots/inputs/:
//   1. default     --phases Work --prompts-file <inputs>/prompts.json
//   2. lite        --phases Work --profile lite --dod-file <inputs>/dod.json --prompts-file <inputs>/prompts.json
//   3. delivery    --phases Implement --profile delivery --dod-file <inputs>/dod.json --prompts-file <inputs>/prompts.json
//   4. cycle       --phases Implement --cycle --prompts-file <inputs>/prompts.json
//   5. panel       --phases Work --enforce-code --review-panel --prompts-file <inputs>/prompts.json
//   6. model-auto  --phases Work --model-mode auto --prompts-file <inputs>/prompts.json
//
// Assertions:
//   1. scripts/snapshots/inputs/prompts.json AND dod.json exist
//   2.<label> scripts/snapshots/<label>.js exists (x6)
//   3.<label> regenerating with the pinned args byte-equals the committed snapshot (x6)
//   4. negative control — copy snapshots+inputs to a tmp dir, flip ONE byte in one snapshot
//      copy, run test-scaffold.cjs's snapshot comparison against the tampered copy via the
//      snapshot-dir override, and assert non-zero exit. Either override mechanism is accepted:
//      try `SNAPSHOT_DIR=<tmp> node test-scaffold.cjs`; if that exits 0, try
//      `node test-scaffold.cjs --snapshot-dir <tmp>`. Passes iff at least one exits non-zero.
//      (Proves the comparison is live, not decorative.)
//   5. regression guard — plain `node test-scaffold.cjs` exits 0 (must pass today AND after).
//
// Assertions 3–4 degrade to plain FAILs (not harness errors) while the fixtures don't exist.
//   - baseline (no snapshots, no byte-compare) → assertions 1–4 fail, 5 passes → exit 1 (RED)
//   - after the fix                            → all pass                      → exit 0 (GREEN)
//
// Locked (evals/**): the whetstone fixer may NEVER edit this file.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(HERE, '..', '..');                       // .../skills/conductor
const REPO = resolve(SKILL_DIR, '..', '..', '..', '..');           // repo root
const SCAFFOLD = resolve(SKILL_DIR, 'scripts', 'scaffold-workflow.cjs');
const HARNESS = resolve(SKILL_DIR, 'scripts', 'test-scaffold.cjs');
const SNAP_DIR = resolve(SKILL_DIR, 'scripts', 'snapshots');
const INPUTS = join(SNAP_DIR, 'inputs');
const PROMPTS = join(INPUTS, 'prompts.json');
const DOD = join(INPUTS, 'dod.json');

const TMP = mkdtempSync(join(tmpdir(), 'golden-snap-'));

let failures = 0;
function ok(cond, msg) {
  if (cond) { console.log(`  ok   ${msg}`); }
  else { failures++; console.error(`  FAIL ${msg}`); }
}

// The pinned canonical combo set (label → generator args). Input paths are the COMMITTED
// fixtures — the whole point is that regeneration from the committed inputs reproduces the
// committed snapshots byte-for-byte.
const COMBOS = [
  ['default',    ['--phases', 'Work', '--prompts-file', PROMPTS]],
  ['lite',       ['--phases', 'Work', '--profile', 'lite', '--dod-file', DOD, '--prompts-file', PROMPTS]],
  ['delivery',   ['--phases', 'Implement', '--profile', 'delivery', '--dod-file', DOD, '--prompts-file', PROMPTS]],
  ['cycle',      ['--phases', 'Implement', '--cycle', '--prompts-file', PROMPTS]],
  ['panel',      ['--phases', 'Work', '--enforce-code', '--review-panel', '--prompts-file', PROMPTS]],
  ['model-auto', ['--phases', 'Work', '--model-mode', 'auto', '--prompts-file', PROMPTS]],
];

// Run test-scaffold.cjs; return its exit code (0 = clean, non-zero = failed). Any throw with a
// numeric status is that status; a throw without one (spawn failure/timeout) counts as 1.
function runHarness(extraArgs, extraEnv) {
  try {
    execFileSync('node', [HARNESS, ...extraArgs], {
      cwd: REPO, encoding: 'utf8', stdio: 'pipe', timeout: 300000,
      env: { ...process.env, ...extraEnv },
    });
    return 0;
  } catch (e) {
    return typeof e.status === 'number' && e.status !== 0 ? e.status : 1;
  }
}

try {
  // 1. Pinned input fixtures are committed.
  const inputsExist = existsSync(PROMPTS) && existsSync(DOD);
  ok(inputsExist, '1. committed input fixtures exist (scripts/snapshots/inputs/prompts.json + dod.json)');

  // 2. A committed snapshot exists per canonical label.
  for (const [label] of COMBOS) {
    ok(existsSync(join(SNAP_DIR, `${label}.js`)),
      `2.${label} committed snapshot exists (scripts/snapshots/${label}.js)`);
  }

  // 3. Regenerating each combo from the committed inputs byte-equals its committed snapshot.
  for (const [label, args] of COMBOS) {
    const snapPath = join(SNAP_DIR, `${label}.js`);
    if (!inputsExist || !existsSync(snapPath)) {
      ok(false, `3.${label} regenerated output byte-equals snapshot (skipped: fixture missing)`);
      continue;
    }
    const outPath = join(TMP, `${label}.js`);
    try {
      execFileSync('node', [SCAFFOLD, '--name', 'snap', '--out', outPath, '--force', ...args],
        { cwd: REPO, encoding: 'utf8', stdio: 'pipe' });
      ok(readFileSync(outPath).equals(readFileSync(snapPath)),
        `3.${label} regenerated output byte-equals scripts/snapshots/${label}.js`);
    } catch (e) {
      ok(false, `3.${label} regenerated output byte-equals snapshot (generator failed: ${e.message.split('\n')[0]})`);
    }
  }

  // 4. Negative control: a tampered snapshot copy must make the harness comparison fail.
  if (!inputsExist || !existsSync(join(SNAP_DIR, 'default.js'))) {
    ok(false, '4. tampered snapshot copy fails test-scaffold.cjs via snapshot-dir override (skipped: fixture missing)');
  } else {
    const tampered = join(TMP, 'tampered-snapshots');
    cpSync(SNAP_DIR, tampered, { recursive: true });
    const victim = join(tampered, 'default.js');
    const buf = readFileSync(victim);
    buf[Math.floor(buf.length / 2)] ^= 0xff;              // flip one byte, deterministically
    writeFileSync(victim, buf);
    let live = runHarness([], { SNAPSHOT_DIR: tampered }) !== 0;   // mechanism A: env var
    if (!live) live = runHarness(['--snapshot-dir', tampered]) !== 0; // mechanism B: flag
    ok(live, '4. tampered snapshot copy makes test-scaffold.cjs exit non-zero (SNAPSHOT_DIR env or --snapshot-dir flag)');
  }

  // 5. Regression guard: the plain harness stays green (must pass on baseline AND after the fix).
  ok(runHarness([]) === 0, '5. plain `node test-scaffold.cjs` exits 0');
} catch (e) {
  console.error(`check: harness error: ${e.stack || e.message}`);
  rmSync(TMP, { recursive: true, force: true });
  process.exit(2);
}

rmSync(TMP, { recursive: true, force: true });

if (failures) {
  console.error(`\ncheck RED: ${failures} assertion(s) failed — scaffold output is not yet snapshot-pinned.`);
  process.exit(1);
}
console.log('\ncheck GREEN: scaffold-workflow.cjs output is pinned by live golden snapshots.');
process.exit(0);
