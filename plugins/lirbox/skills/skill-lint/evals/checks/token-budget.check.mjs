#!/usr/bin/env node
// Frozen check: a SKILL.md body over ~5000 tokens (estimated as chars/4) is flagged even when it is
// under the 100-line cap. The agentskills.io spec: "Instructions (< 5000 tokens recommended)".
// A line cap alone is dodged by long lines, and tokens are the actual cost. Exactly 20,000 chars
// (~5000 tokens) passes; 20,004 in 51 lines is flagged on tokens alone.
//
// SKILL_LINT_OVERRIDE points at the analyze.cjs under test (set by prove-checks).
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { analyzeSkill } = createRequire(import.meta.url)(
  process.env.SKILL_LINT_OVERRIDE || join(here, '..', '..', 'scripts', 'analyze.cjs'));

const fm = '---\nname: wide\ndescription: Use when testing. Triggers on wide.\n---\n';
const body = (n, w) => fm + Array.from({ length: n }, () => 'x'.repeat(w)).join('\n') + '\n';
const book = (src) => analyzeSkill({ name: 'wide', src }).findings.filter((f) => f.check === 'book' && f.severity === 'flag');

const failures = [];
if (book(body(50, 400)).length) failures.push('a ~5000-token body was flagged — 5000 is within budget');
if (!book(body(50, 400) + 'xxxx\n').length) failures.push('a ~5001-token, 51-line body was not flagged — long lines dodged the cap');
if (!book(body(40, 600)).length) failures.push('a 40-line, ~6000-token body was not flagged');

if (failures.length) { console.error('RED token-budget:\n  - ' + failures.join('\n  - ')); process.exit(1); }
console.log('GREEN token-budget');
