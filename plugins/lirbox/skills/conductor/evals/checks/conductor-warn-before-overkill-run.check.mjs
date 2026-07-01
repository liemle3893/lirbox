// ACCEPTANCE-CHECK (whetstone item: conductor-warn-before-overkill-run) — RED on baseline, GREEN after the fix.
//
// Concern: when triage (SKILL.md step 1b) would classify a new goal as decline-tier (trivial /
// one-shot / single-file), the cost/overkill caveat + inline-execution offer must fire even when
// conductor was invoked EXPLICITLY (e.g. `/lirbox:conductor <goal>` directly) — step 1b today has
// no branch that ties "explicit invocation" to "decline-tier caveat still fires before scaffold/
// launch", so an explicit invocation could appear to license skipping the warning.
//
// Locked (evals/**): the whetstone fixer may NEVER edit this file.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_MD = resolve(HERE, '..', '..', 'SKILL.md');

const src = readFileSync(SKILL_MD, 'utf8');

// Isolate the "1b. Triage a new run" section: from its heading to the next `### ` heading (or EOF).
const startMatch = src.match(/^###\s*1b\.\s*Triage a new run[^\n]*\n/m);
if (!startMatch) {
  console.error('FAIL: could not locate the "### 1b. Triage a new run" heading in SKILL.md');
  process.exit(1);
}
const startIdx = startMatch.index + startMatch[0].length;
const rest = src.slice(startIdx);
const nextHeadingMatch = rest.match(/^###\s/m);
const section = nextHeadingMatch ? rest.slice(0, nextHeadingMatch.index) : rest;

// The section must explicitly address the case where conductor was invoked EXPLICITLY/DIRECTLY
// (by name / slash command) on a decline-tier goal.
const mentionsExplicitInvocation =
  /\bexplicit(?:ly)?\b[^.]*\b(invok|call|run|us(?:e|ing)|request)/i.test(section) ||
  /\bdirect(?:ly)?\b[^.]*\binvok/i.test(section) ||
  /`\/lirbox:conductor/i.test(section);

// That mention must be tied to the decline/overkill caveat still firing "regardless" / "even when" /
// "still" — i.e. it can't just say "if invoked explicitly, skip triage" (the wrong direction).
const tiesExplicitToStillDecline =
  /\beven (?:if|when)\b[^.]*\bexplicit/i.test(section) ||
  /\bexplicit[^.]*\b(?:still|regardless|even (?:if|when))\b/i.test(section) ||
  /\bregardless of\b[^.]*\bexplicit/i.test(section);

// And the caveat must offer inline execution BEFORE any scaffold/launch.
const offersInlineBeforeLaunch =
  /\binline\b/i.test(section) && /\b(scaffold|generat|launch)\b/i.test(section);

const missing = [];
if (!mentionsExplicitInvocation) missing.push('no mention of explicit/direct invocation (e.g. "/lirbox:conductor <goal>") in the 1b section');
if (!tiesExplicitToStillDecline) missing.push('no phrasing ties explicit invocation to the decline/overkill caveat still firing ("even if/when explicit…", "explicit… regardless", etc.)');
if (!offersInlineBeforeLaunch) missing.push('no offer of inline execution before scaffold/launch in the 1b section');

if (missing.length) {
  console.error('FAIL: SKILL.md step 1b does not have an explicit branch for "explicitly invoked but still decline/overkill tier":\n  - ' + missing.join('\n  - '));
  process.exit(1);
}
console.log('PASS: SKILL.md step 1b explicitly requires the overkill caveat + inline offer even under explicit invocation');
