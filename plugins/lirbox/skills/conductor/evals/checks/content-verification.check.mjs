// ACCEPTANCE CHECK (RED on baseline) — conductor must ship a deterministic prose linter.
//
// Concern (feedback/conductor.jsonl → content-verification, deterministic-anchor half): conductor
// produces committed prose (docs/changes/**, writeups, summaries) with no mechanical gate, so
// broken headings, dead local links, unbalanced code fences, leftover placeholders, and malformed
// frontmatter can ride a PR unnoticed. The fix must add a ZERO-DEP Node ESM linter at
//   plugins/lirbox/skills/conductor/scripts/prose-lint.mjs
// CLI:  node prose-lint.mjs <path> [--anchors] [--flesch <min>] [--dupe-words] [--frontmatter-keys …]
// It scans *.md under <path>, exits 0 when clean, non-zero with a report on a violation. The five
// DEFAULT checks (opt-in flags OFF):
//   (1) heading levels do not skip (h1 -> h3 with no h2)
//   (2) local relative file-link targets resolve on disk
//   (3) fenced code blocks are balanced (triple-backtick pairs even)
//   (4) no placeholder markers (TODO, TBD, FIXME, 'lorem ipsum', empty links [text]())
//   (5) frontmatter parses as valid YAML when present
//
// This check runs prose-lint.mjs with DEFAULT flags (no opt-ins) against committed fixtures:
//   - ONE GREEN fixture dir (green/) that is clean on all five checks  -> MUST exit 0
//   - FIVE RED fixture dirs, each isolating exactly ONE default defect -> each MUST exit non-zero
// Because every RED dir carries exactly one defect and is otherwise clean, a partial implementation
// that catches only some defects leaves the other RED dirs exiting 0, so the check stays RED until
// all five defaults are enforced. The GREEN dir provably contains .md files (anti-trivial-green
// guard), so exit 0 there means "scanned and found nothing wrong", not "scanned nothing".
//
//   - baseline: prose-lint.mjs does not exist -> every invocation errors non-zero -> the GREEN
//     assertion (expects exit 0) fails -> exit 1 (RED, for the right reason).
//   - after the fix: GREEN exits 0 and all five RED dirs exit non-zero -> exit 0 (GREEN).
//
// Locked (evals/**): the whetstone fixer may NEVER edit this file.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { existsSync, readdirSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(HERE, '..', '..');                         // .../skills/conductor
const PROSE_LINT = resolve(SKILL_DIR, 'scripts', 'prose-lint.mjs');
const FIXTURES = resolve(HERE, '..', 'fixtures', 'prose');

let failures = 0;
function ok(cond, msg) {
  if (cond) { console.log(`  ok   ${msg}`); }
  else { failures++; console.error(`  FAIL ${msg}`); }
}

// Run prose-lint.mjs (default flags only) against a fixture dir. Returns its exit code:
// 0 = clean, non-zero = violation reported. A spawn failure (e.g. prose-lint.mjs missing ->
// "Cannot find module") also surfaces as a non-zero status, which is correct: on the baseline the
// tool cannot run, so nothing can exit 0, and the GREEN assertion fails -> the check is RED.
function runLint(dir) {
  try {
    execFileSync('node', [PROSE_LINT, dir], { encoding: 'utf8', stdio: 'pipe', timeout: 60000 });
    return 0;
  } catch (e) {
    return typeof e.status === 'number' && e.status !== 0 ? e.status : 1;
  }
}

// Count *.md files actually present in a fixture dir (non-recursive is enough here).
function countMd(dir) {
  try { return readdirSync(dir).filter((f) => f.endsWith('.md')).length; }
  catch { return 0; }
}

const GREEN = join(FIXTURES, 'green');
const RED_DIRS = [
  ['red-heading',     'a. skipped heading (h1 -> h3, no h2)'],
  ['red-deadlink',    'b. dead local link ([x](./does-not-exist.md))'],
  ['red-fence',       'c. unbalanced code fence (one triple-backtick, never closed)'],
  ['red-placeholder', "d. placeholder marker ('TODO:')"],
  ['red-frontmatter', 'e. malformed frontmatter (--- block that is not valid YAML)'],
];

// 0. The tool under test must exist (clean RED evidence when it does not).
ok(existsSync(PROSE_LINT),
  '0. prose-lint.mjs exists at scripts/prose-lint.mjs');

// Anti-trivial-green guard: the GREEN dir provably holds .md files to scan.
const greenMd = countMd(GREEN);
ok(greenMd > 0,
  `   GREEN fixture dir contains ${greenMd} .md file(s) to scan (anti-trivial-green)`);

// 1. GREEN fixture is clean on all five default checks -> exit 0.
ok(runLint(GREEN) === 0,
  '1. GREEN fixture (green/) passes all 5 default checks -> exit 0');

// 2. Each RED fixture isolates one default defect -> non-zero exit.
for (const [dir, label] of RED_DIRS) {
  const full = join(FIXTURES, dir);
  ok(countMd(full) > 0, `   RED fixture dir ${dir}/ contains a .md file`);
  ok(runLint(full) !== 0, `2.${label} -> non-zero exit`);
}

if (failures) {
  console.error(`\ncheck RED: ${failures} assertion(s) failed — prose-lint.mjs does not yet enforce all five default checks.`);
  process.exit(1);
}
console.log('\ncheck GREEN: prose-lint.mjs passes the clean doc and flags all five default defects.');
process.exit(0);
