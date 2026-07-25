// FLOOR (characterization) — the frozen acceptance-checks match evals/checks-manifest.json.
//
// whetstone runs ONLY the current run's items, so a previously-kept fix decays with nothing
// watching. Both decay modes were found by hand on 2026-07-25, neither by automation:
//   - ROT: effort-think passed `--profile delivery` with no DoD, which a later run made a hard
//     error — it threw instead of asserting, failing for the wrong reason for weeks.
//   - REGRESSION: book-under-flag was fixed, verified GREEN, merged — then SKILL.md re-accreted
//     past the flag threshold across seven runs, silently un-fixing it.
//
// Because this runs in the FLOOR, it executes on the whetstone baseline and after every kept item,
// so a candidate that regresses a past fix is reverted like any other floor break.
//
// Rules:
//   expect 'green' → the check MUST exit 0.
//   expect 'red'   → the check MUST exit 0 or 1; >=2 is harness rot (it failed to RUN).
//                    Turning green is fine and never fails — the floor gates the whetstone loop, so
//                    demanding an exact 1 would revert the very fix that resolves the concern. A
//                    promote-me notice is printed instead.
//   The manifest and evals/checks/ must be in sync BOTH ways — an unlisted check is unguarded.
//
// Locked (evals/**): the whetstone fixer may NEVER edit this file.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, basename } from 'node:path';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));   // .../evals/floor
const EVALS = resolve(HERE, '..');                      // .../evals
const CHECKS_DIR = join(EVALS, 'checks');
const MANIFEST = join(EVALS, 'checks-manifest.json');

if (!existsSync(MANIFEST)) {
  console.error(`06-checks-manifest: FAIL — ${MANIFEST} is missing; the frozen checks are unguarded.`);
  process.exit(1);
}

let manifest;
try { manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')); }
catch (e) { console.error(`06-checks-manifest: FAIL — checks-manifest.json is not valid JSON: ${e.message}`); process.exit(1); }

const entries = (manifest && manifest.checks) || {};
const onDisk = readdirSync(CHECKS_DIR).filter((f) => f.endsWith('.check.mjs'))
  .map((f) => basename(f, '.check.mjs')).sort();
const listed = Object.keys(entries).sort();

let failed = 0;

// Sync, both directions — a check absent from the manifest is a check nothing guards.
const unlisted = onDisk.filter((c) => !listed.includes(c));
const phantom = listed.filter((c) => !onDisk.includes(c));
if (unlisted.length) { console.error(`  FAIL  not in the manifest (unguarded): ${unlisted.join(', ')}`); failed++; }
if (phantom.length) { console.error(`  FAIL  in the manifest but no such check file: ${phantom.join(', ')}`); failed++; }

// Run each check and compare against its expectation.
const promote = [];
for (const name of onDisk) {
  const spec = entries[name];
  if (!spec) continue;                                   // already reported as unlisted
  const expect = spec.expect;
  if (!['green', 'red'].includes(expect)) {
    console.error(`  FAIL  ${name}: expect must be "green" or "red" (got ${JSON.stringify(expect)})`);
    failed++;
    continue;
  }
  let code = 0;
  // LIRBOX_FLOOR_NESTED breaks the cycle: checks-manifest-guard asserts that the floor passes, and
  // the floor runs every check — including that guard. The sentinel tells a nested check to skip
  // its own floor invocation instead of recursing forever.
  try {
    execFileSync('node', [join(CHECKS_DIR, name + '.check.mjs')],
      { stdio: 'pipe', env: { ...process.env, LIRBOX_FLOOR_NESTED: '1' } });
  } catch (e) { code = typeof e.status === 'number' ? e.status : 1; }

  if (expect === 'green') {
    if (code === 0) { console.log(`  ok    ${name} (green)`); }
    else {
      console.error(`  FAIL  ${name}: expected GREEN, exited ${code}`
        + (code >= 2 ? ' — harness rot: the check failed to RUN' : ' — REGRESSION: a past fix came undone'));
      failed++;
    }
  } else {
    if (code >= 2) {
      console.error(`  FAIL  ${name}: known-red check exited ${code} — harness rot: it failed to RUN, `
        + `which hides whether the concern is still open`);
      failed++;
    } else if (code === 0) {
      promote.push(name);
      console.log(`  ok    ${name} (red → now GREEN; promote it to "green" in checks-manifest.json)`);
    } else {
      console.log(`  ok    ${name} (red, still open${spec.note ? ': ' + spec.note.slice(0, 60) + '…' : ''})`);
    }
  }
}

if (promote.length) {
  console.log(`\n  NOTE: ${promote.length} check(s) now pass and should be promoted to "green": ${promote.join(', ')}`);
}

if (failed) {
  console.error(`\n06-checks-manifest: FAIL — ${failed} manifest violation(s).`);
  process.exit(1);
}
console.log(`\ncheck GREEN: all ${onDisk.length} frozen acceptance-checks match the manifest.`);
