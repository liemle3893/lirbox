// ACCEPTANCE CHECK (RED on baseline, GREEN after the fix) — whetstone item:
// headless-driver-still-ends-turn.
//
// Concern (feedback/conductor.jsonl → headless-driver-still-ends-turn): even with SKILL.md already
// pinning `run_in_background: false` + a do-not-end-turn line, a headless opus driver STILL ended its
// -p run with the workflow unfinished — final message "I'm holding my turn open until the workflow
// finishes... Waiting for completion", then the process exited with only the setup harness committed.
// Saying "I'm waiting" does not make it so. The reliable -p pattern is that the FOREGROUND Workflow
// TOOL CALL ITSELF BLOCKS until completion, so there is no waiting to narrate; and after the tool
// returns the driver must RE-VERIFY the run actually finished by reading the state file's `status`
// (`.workflows/state/<name>.json`) — not still `running` — BEFORE finalizing.
//
// This check demands what the existing single line ("run_in_background: false — and do NOT end your
// turn while the workflow is still running") does NOT yet say. That line alone stays RED here:
// it never states the call BLOCKS, and it never tells the driver to re-verify the state-file status
// after the tool returns.
//
// Assertions (all must hold for GREEN):
//   1. SKILL.md pins the literal option `run_in_background: false` (flexible whitespace).
//   2. Within ±12 lines of that option, SKILL.md states the foreground Workflow call itself BLOCKS
//      until completion (semantic marker "block…" bound to until/complete/finish/return/done) — i.e.
//      the tool call is the wait, not something the driver narrates.
//   3. Somewhere in SKILL.md a directive tells the driver to VERIFY the workflow's state-file status
//      after the tool returns: a verification verb (verify/confirm/inspect/re-read/re-check/check)
//      co-located (±6 lines) with a `.workflows/state` / `state.json` reference, the token `status`,
//      and a run-state word (running/complete/finished/done).
//
// Baseline: no "block…until" phrasing near the option (assertion 2 RED) and no verification verb near
// the state-file+status directive (assertion 3 RED). After the fix all three appear → exit 0 (GREEN).
//
// Standalone: `node plugins/lirbox/skills/conductor/evals/checks/headless-driver-still-ends-turn.check.mjs`
// Lives under evals/checks/ (NOT evals/floor/), so the floor runner does not auto-pick it up; the
// whetstone loop runs it one-at-a-time.
//
// Locked (evals/**): the whetstone fixer may NEVER edit this file.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_MD = resolve(HERE, '..', '..', 'SKILL.md');

let src;
try {
  src = readFileSync(SKILL_MD, 'utf8');
} catch (e) {
  console.error(`check: harness error — cannot read ${SKILL_MD}: ${e.message}`);
  process.exit(2);
}

const lines = src.split('\n');

// --- assertion 1: literal `run_in_background: false` option (flexible whitespace) ---
const OPTION_RE = /run_in_background\s*:\s*false/i;
const optionLine = lines.findIndex((l) => OPTION_RE.test(l));
const hasOption = optionLine !== -1;

// --- assertion 2: the foreground call itself BLOCKS until completion (±12 lines of the option) ---
// Semantic marker: "block(s)" bound to a completion word, so it reads as "the call blocks until the
// workflow finishes" — not merely "wait for it to return".
const BLOCK_RE = /\bblocks?\b/i;
const COMPLETION_RE = /(until|complet|finish|return|done)/i;
let hasBlockLang = false;
if (hasOption) {
  const lo = Math.max(0, optionLine - 12);
  const hi = Math.min(lines.length, optionLine + 13);
  const window = lines.slice(lo, hi).join('\n');
  hasBlockLang = BLOCK_RE.test(window) && COMPLETION_RE.test(window);
}

// --- assertion 3: re-verify the state-file status AFTER the tool returns, BEFORE finalizing ---
// A verification verb co-located (±6 lines) with a state-file reference, the token `status`, and a
// run-state word. `\bcheck\b` deliberately does NOT match "checkpoint(s)"; bare "read" is excluded
// (so `readFileSync` in code snippets never trips it) — only "re-read"/"re-check" count.
const STATEFILE_RE = /\.workflows\/state|state\.json|state file|state\/<name>/i;
const VERB_RE = /\b(verif(?:y|ies|ied)?|confirm(?:s|ed|ing)?|inspect(?:s|ed|ing)?|re-?read|re-?check(?:s|ed|ing)?|check(?:s|ed|ing)?)\b/i;
const STATUS_RE = /\bstatus\b/i;
const RUNSTATE_RE = /(running|complete|finished|\bdone\b)/i;

let hasVerify = false;
let verifyLine = -1;
for (let i = 0; i < lines.length; i++) {
  if (!STATEFILE_RE.test(lines[i])) continue;
  const lo = Math.max(0, i - 6);
  const hi = Math.min(lines.length, i + 7);
  const window = lines.slice(lo, hi).join('\n');
  if (VERB_RE.test(window) && STATUS_RE.test(window) && RUNSTATE_RE.test(window)) {
    hasVerify = true;
    verifyLine = i + 1;
    break;
  }
}

const results = [
  { pass: hasOption, label: '1. SKILL.md pins `run_in_background: false` (literal option, flexible whitespace)' },
  { pass: hasOption && hasBlockLang, label: '2. within ±12 lines of the option, the foreground Workflow call is stated to BLOCK until completion' },
  { pass: hasVerify, label: '3. a directive to VERIFY the state-file `status` after the tool returns (verb + .workflows/state + status + run-state, ±6 lines)' },
];
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}: ${r.label}`);

const allPass = hasOption && hasBlockLang && hasVerify;
if (!allPass) {
  console.error('\ncheck RED — headless-driver-still-ends-turn is unfixed. Missing from SKILL.md:');
  if (!hasOption) {
    console.error('  - the literal option `run_in_background: false`.');
  }
  if (hasOption && !hasBlockLang) {
    console.error(`  - a statement (±12 lines of SKILL.md:${optionLine + 1}) that the FOREGROUND Workflow`
      + ' tool call ITSELF BLOCKS until the workflow completes — so the driver does NOT launch it'
      + ' backgrounded and narrate "waiting for completion"; the blocking tool call IS the wait.');
  }
  if (!hasVerify) {
    console.error('  - a directive to RE-VERIFY the run after the tool returns and BEFORE finalizing:'
      + ' read `.workflows/state/<name>.json` and confirm `status` is no longer `running`'
      + ' (a verification verb co-located with the state-file path, `status`, and a run-state word).');
  }
  process.exit(1);
}

console.log('\ncheck GREEN: SKILL.md states the foreground Workflow call blocks and requires state-file'
  + ' re-verification after it returns before finalizing.');
process.exit(0);
