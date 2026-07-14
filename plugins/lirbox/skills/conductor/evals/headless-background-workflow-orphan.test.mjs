// ACCEPTANCE CHECK (RED on baseline, GREEN after the fix) — whetstone item:
// headless-background-workflow-orphan.
//
// Concern (feedback/conductor.jsonl → headless-background-workflow-orphan): in headless mode
// (`claude -p`), a conductor driver can launch the generated Workflow as a BACKGROUND task and then
// end its turn — but ending the turn exits the -p process, killing the orphaned workflow. Observed
// live: driver said "the run will notify me when it completes", ended turn, wf/ branch left with
// ZERO commits. SKILL.md must pin the invocation: run the Workflow with `run_in_background: false`
// (and/or explicitly forbid ending the turn while the workflow is still running) in a non-interactive
// session.
//
// Assertions (both must hold for GREEN):
//   1. SKILL.md contains the literal option `run_in_background: false` (flexible whitespace around
//      the colon).
//   2. Within the SAME paragraph / adjacent line block (±10 lines of that option), SKILL.md carries
//      a do-not-end-turn / foreground-wait directive (tolerant on wording: "do not end (your) turn",
//      "must not end ... turn", "never end ... turn", "don't end ... turn", or a foreground-wait
//      phrasing).
//
// Baseline: SKILL.md has neither the `run_in_background: false` option nor a do-not-end-turn
// directive near it → RED. After the fix both appear together → exit 0 (GREEN).
//
// Standalone: `node plugins/lirbox/skills/conductor/evals/headless-background-workflow-orphan.test.mjs`
// This file lives directly under evals/ (NOT evals/floor/), so the floor runner (run.mjs, which only
// globs evals/floor/*.test.mjs) does NOT auto-pick it up. The whetstone loop runs it one-at-a-time.
//
// Locked (evals/**): the whetstone fixer may NEVER edit this file.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_MD = resolve(HERE, '..', 'SKILL.md');

let src;
try {
  src = readFileSync(SKILL_MD, 'utf8');
} catch (e) {
  console.error(`check: harness error — cannot read ${SKILL_MD}: ${e.message}`);
  process.exit(2);
}

const lines = src.split('\n');

// --- assertion 1: literal `run_in_background: false` (flexible whitespace around the colon) ---
const OPTION_RE = /run_in_background\s*:\s*false/i;
const optionLine = lines.findIndex((l) => OPTION_RE.test(l));
const hasOption = optionLine !== -1;

// --- assertion 2: a do-not-end-turn / foreground-wait directive within ±10 lines of the option ---
// Tolerant on wording, strict on substance: forbids ending the turn (any of do not / don't / must
// not / never + "end" + "turn"), or an explicit foreground-wait instruction.
const END_TURN_RE = /(do not|do\s*n['’]?t|don['’]?t|must not|may not|never)\s+end(?:ing)?\s+(your\s+|the\s+)?turn/i;
const FOREGROUND_WAIT_RE = /foreground[\s-]*wait|wait\b[^\n]{0,40}\b(workflow|it)\b[^\n]{0,40}\b(finish|complete|return|done)/i;

let hasDirective = false;
if (hasOption) {
  const lo = Math.max(0, optionLine - 10);
  const hi = Math.min(lines.length, optionLine + 11);
  const window = lines.slice(lo, hi).join('\n');
  hasDirective = END_TURN_RE.test(window) || FOREGROUND_WAIT_RE.test(window);
}

const results = [
  { pass: hasOption, label: '1. SKILL.md pins `run_in_background: false` (literal option, flexible whitespace)' },
  { pass: hasOption && hasDirective, label: '2. a do-not-end-turn / foreground-wait directive sits within ±10 lines of that option' },
];
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}: ${r.label}`);

if (!hasOption || !hasDirective) {
  console.error('\ncheck RED — headless-background-workflow-orphan is unfixed. Missing from SKILL.md:');
  if (!hasOption) {
    console.error('  - the literal invocation option `run_in_background: false` '
      + '(so a non-interactive/headless driver runs the generated Workflow in the FOREGROUND).');
  }
  if (hasOption && !hasDirective) {
    console.error('  - a do-not-end-turn / foreground-wait directive near that option '
      + `(±10 lines of SKILL.md:${optionLine + 1}) forbidding the driver from ending its turn `
      + 'while the workflow is still running.');
  } else if (!hasOption) {
    console.error('  - (consequently) any nearby do-not-end-turn / foreground-wait directive.');
  }
  process.exit(1);
}

console.log('\ncheck GREEN: SKILL.md pins foreground Workflow invocation for non-interactive sessions.');
process.exit(0);
