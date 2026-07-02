// ACCEPTANCE CHECK (RED on baseline) — conductor must clear skill-lint's ● "book" flag.
//
// Concern (feedback/conductor.jsonl → book-under-flag): the conductor SKILL.md reads like a book
// (2410 words > the 1200-word ● flag threshold). The fix is to RELOCATE prose into references/
// (progressive disclosure) until the body clears the flag — NOT to delete meaning (the floor's
// content-anchor test fences that).
//
// Passes iff skill-lint reports NO finding with severity "flag" + check "book" for conductor.
//   - baseline (2410 w)        → flag present  → exit 1  (RED — the discrimination gate wants this)
//   - after extraction (≤1200) → flag absent   → exit 0  (GREEN)
//
// Locked (evals/**): the whetstone fixer may NEVER edit this file.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(HERE, '..', '..');                       // .../skills/conductor
const REPO = resolve(SKILL_DIR, '..', '..', '..', '..');           // repo root
const ANALYZE = resolve(REPO, 'plugins/lirbox/skills/skill-lint/scripts/analyze.cjs');

let out;
try {
  out = execFileSync('node', [ANALYZE, '--json', SKILL_DIR], { cwd: REPO, encoding: 'utf8' });
} catch (e) {
  console.error(`check: skill-lint analyze failed to run: ${e.message}`);
  process.exit(2);   // harness error, not a verdict
}

let report;
try { report = JSON.parse(out); } catch (e) {
  console.error(`check: could not parse skill-lint --json output: ${e.message}`);
  process.exit(2);
}

const conductor = report.find((s) => s.name === 'conductor');
if (!conductor) { console.error('check: skill-lint returned no entry for conductor'); process.exit(2); }

const bookFlag = (conductor.findings || []).find(
  (f) => f.severity === 'flag' && f.check === 'book',
);

if (bookFlag) {
  console.error(`check RED: conductor still trips the ● book flag — ${bookFlag.msg}`);
  console.error(`words=${conductor.metrics.words} (flag threshold 1200). Relocate prose into references/.`);
  process.exit(1);
}

console.log(`check GREEN: conductor cleared the ● book flag (words=${conductor.metrics.words} ≤ 1200).`);
process.exit(0);
