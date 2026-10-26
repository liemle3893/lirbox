#!/usr/bin/env node
// Frozen check: SKILL.md size is judged in BODY LINES with a hard cap of 100 — not in words.
//
// Anthropic's skill-authoring guide states one size rule: "Keep the SKILL.md body under 500
// lines". This linter used to warn at 500 WORDS, a number the guide never gives; the owner set
// the cap at 100 lines. Exactly 100 passes, 101 is flagged, and a wordy one-line skill is not
// judged on words at all.
//
// SKILL_LINT_OVERRIDE points at the analyze.cjs under test (set by prove-checks).
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { analyzeSkill } = createRequire(import.meta.url)(
  process.env.SKILL_LINT_OVERRIDE || join(here, '..', '..', 'scripts', 'analyze.cjs'));

const fm = '---\nname: edge\ndescription: Use when testing. Triggers on edge.\n---\n';
const lines = (n) => fm + Array.from({ length: n }, (_, i) => `- line ${i}`).join('\n') + '\n';
const book = (src) => analyzeSkill({ name: 'edge', src }).findings.filter((f) => f.check === 'book');

const failures = [];
if (book(lines(100)).length) failures.push('a 100-line body was flagged — 100 is within budget');
if (!book(lines(101)).some((f) => f.severity === 'flag')) failures.push('a 101-line body was not flagged');
if (book(fm + `- ${Array.from({ length: 700 }, (_, i) => `w${i}`).join(' ')}\n`).length) {
  failures.push('a 700-word, one-line body was judged on words');
}

if (failures.length) { console.error('RED line-budget:\n  - ' + failures.join('\n  - ')); process.exit(1); }
console.log('GREEN line-budget');
