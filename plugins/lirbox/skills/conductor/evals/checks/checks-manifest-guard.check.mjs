// ACCEPTANCE CHECK (RED on baseline) — the frozen acceptance-checks must be regression-guarded by
// a manifest the FLOOR enforces.
//
// Concern (feedback/conductor.jsonl → checks-manifest-guard): whetstone runs ONLY the current run's
// items, so every previously-kept fix decays invisibly. Both failure modes were found by hand on
// 2026-07-25, neither by any automation:
//   - ROT: effort-think invoked `--profile delivery` with no DoD, which a later run made a hard
//     error — the check threw a stack trace instead of asserting, failing for the wrong reason.
//   - REGRESSION: book-under-flag was fixed, verified GREEN and merged, then SKILL.md re-accreted
//     from 1479 to 2469 words across seven consecutive runs, silently un-fixing it.
//
// Frozen contract:
//   1. `evals/checks-manifest.json` records an expectation for EVERY check, shape:
//        { "checks": { "<check-basename>": { "expect": "green"|"red", "note"?: "..." } } }
//      Basenames exclude the `.check.mjs` suffix. Manifest and directory must be in sync in BOTH
//      directions — an unlisted check file, or an entry with no file, is a failure (that sync is
//      what stops a new check being quietly dropped from the guard).
//   2. A floor test under `evals/floor/` enforces it: `expect: "green"` checks MUST exit 0;
//      `expect: "red"` checks MUST exit 0 or 1 — never >=2, which is harness rot.
//   3. CRITICAL — a `red` check that turns GREEN must NOT fail the floor. The whetstone loop reverts
//      any candidate that breaks the floor, so an exact-match rule ("red must exit 1") would revert
//      the very fix that resolves an open concern. `red` means "known-failing, tracked" — a ceiling
//      on rot, not a requirement to stay broken.
//   4. The manifest lives under evals/** and is therefore LOCKED to the whetstone fixer. That is
//      the point: without the lock the loop could flip a regressing check from green to red and
//      escape its own fence.
//   5. book-under-flag must be present and recorded (currently `red`) — the open regression is
//      tracked in the open, not hidden by omission.
//
// Baseline (RED): there is no manifest and no floor test enforcing one.
//
// Deterministic only — no network, no LLM. Structural/IO surprises exit 2 (harness error).
//
// Locked (evals/**): the whetstone fixer may NEVER edit this file.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, basename } from 'node:path';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));          // .../evals/checks
const EVALS = resolve(HERE, '..');                             // .../evals
const CHECKS_DIR = HERE;
const FLOOR_DIR = join(EVALS, 'floor');
const MANIFEST = join(EVALS, 'checks-manifest.json');
const SELF = 'checks-manifest-guard';

const results = [];
const ok = (pass, label) => { results.push({ pass, label }); console.log(`${pass ? 'PASS' : 'FAIL'}: ${label}`); };
const bail = (code, msg) => { console.error(msg); process.exit(code); };

// ---------- precondition ----------
let checkFiles;
try {
  checkFiles = readdirSync(CHECKS_DIR).filter((f) => f.endsWith('.check.mjs')).map((f) => basename(f, '.check.mjs')).sort();
} catch (e) {
  bail(2, `PRECONDITION FAILED: cannot read ${CHECKS_DIR}: ${e.message}`);
}
if (checkFiles.length === 0) bail(2, `PRECONDITION FAILED: no *.check.mjs under ${CHECKS_DIR}`);
console.log(`PASS: 0. precondition — ${checkFiles.length} check file(s) on disk`);

// ---------- 1. the manifest exists and parses ----------
if (!existsSync(MANIFEST)) {
  ok(false, `1. evals/checks-manifest.json exists [missing — nothing guards the frozen checks]`);
  // Everything downstream depends on it; report the rest as failed rather than crashing.
  for (const l of ['2. manifest lists every check (both directions)',
                   '3. every expectation is "green" or "red"',
                   '4. book-under-flag is tracked in the manifest',
                   '5. a floor test enforces the manifest',
                   '6. the floor runner passes with the guard in place']) ok(false, `${l} [skipped — no manifest]`);
} else {
  let manifest;
  try { manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')); }
  catch (e) { bail(2, `PRECONDITION FAILED: checks-manifest.json is not valid JSON: ${e.message}`); }
  ok(true, '1. evals/checks-manifest.json exists and parses');

  const entries = (manifest && manifest.checks) || {};
  const listed = Object.keys(entries).sort();

  // 2. in sync BOTH ways — an unlisted check is an unguarded check.
  const missing = checkFiles.filter((c) => !listed.includes(c));
  const phantom = listed.filter((c) => !checkFiles.includes(c));
  ok(missing.length === 0 && phantom.length === 0,
    `2. manifest lists every check (both directions) `
    + `[unlisted: ${missing.join(', ') || 'none'}; no-such-file: ${phantom.join(', ') || 'none'}]`);

  // 3. expectations are well-formed.
  const bad = listed.filter((k) => !['green', 'red'].includes(entries[k] && entries[k].expect));
  ok(bad.length === 0, `3. every expectation is "green" or "red" [malformed: ${bad.join(', ') || 'none'}]`);

  // 4. the known open regression is tracked, not omitted.
  ok(Object.prototype.hasOwnProperty.call(entries, 'book-under-flag'),
    '4. book-under-flag is tracked in the manifest (the open regression is recorded, not hidden)');

  // 5. a floor test consumes the manifest and spawns the checks.
  let floorFiles = [];
  try { floorFiles = readdirSync(FLOOR_DIR).filter((f) => f.endsWith('.test.mjs')); } catch { /* reported below */ }
  const enforcing = floorFiles.filter((f) => {
    const src = readFileSync(join(FLOOR_DIR, f), 'utf8');
    return /checks-manifest\.json/.test(src) && /check\.mjs/.test(src) && /exec|spawn/.test(src);
  });
  ok(enforcing.length > 0,
    `5. a floor test enforces the manifest [found: ${enforcing.join(', ') || 'none'}]`);

  // 6. the floor as a whole still passes with the guard wired in — the integration assertion, and
  //    transitively the proof that every `green` entry really is green right now.
  //    The floor test runs EVERY check, this one included, so invoking the floor from here would
  //    recurse. LIRBOX_FLOOR_NESTED (set by the floor test when it spawns a check) marks that case;
  //    the outer, standalone invocation is the one that actually asserts it.
  if (process.env.LIRBOX_FLOOR_NESTED === '1') {
    ok(true, '6. the floor runner passes with the guard in place [skipped — nested inside the floor]');
  } else {
    let floorExit = 0;
    try { execFileSync('node', [join(EVALS, 'run.mjs')], { stdio: 'pipe' }); }
    catch (e) { floorExit = typeof e.status === 'number' ? e.status : 1; }
    ok(floorExit === 0, `6. the floor runner passes with the guard in place [exit ${floorExit}]`);
  }
}

// Self must never be required green while it is the in-flight item (documents the no-deadlock rule).
console.log(`note: '${SELF}' is the in-flight item; the manifest should record it 'red' until this run lands.`);

const failed = results.filter((r) => !r.pass);
if (failed.length) {
  console.error(`\nRED: ${failed.length}/${results.length} assertion(s) failed — frozen checks are not regression-guarded.`);
  process.exit(1);
}
console.log(`\nGREEN: all ${results.length} assertions hold — the floor enforces a manifest over every frozen check.`);
