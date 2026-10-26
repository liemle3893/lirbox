#!/usr/bin/env node
// Frozen check: the frontmatter limits from Anthropic's skill-authoring guide and the
// agentskills.io spec are flagged — name ≤64 chars of lowercase letters/numbers/hyphens, no
// leading/trailing/double hyphen, matching its directory, no reserved word ("anthropic",
// "claude"); description ≤1024 chars with no XML tags; compatibility ≤500 chars. A valid
// frontmatter stays clean.
//
// SKILL_LINT_OVERRIDE points at the analyze.cjs under test (set by prove-checks).
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { analyzeSkill } = createRequire(import.meta.url)(
  process.env.SKILL_LINT_OVERRIDE || join(here, '..', '..', 'scripts', 'analyze.cjs'));

const D = 'Use when testing. Triggers on meta.';
const flags = (name, desc = D, dir = name, extra = '') => analyzeSkill({ name: dir, src: `---\nname: ${name}\ndescription: ${desc}\n${extra}---\nbody\n` })
  .findings.filter((f) => f.check === 'desc' && f.severity === 'flag');

const failures = [];
const expectFlag = (why, ...a) => { if (!flags(...a).length) failures.push(why); };
expectFlag('a 65-char name was not flagged', 'a'.repeat(65));
expectFlag('a name with uppercase/underscore was not flagged', 'Bad_Name');
expectFlag('a name with a reserved word was not flagged', 'claude-tools');
expectFlag('a 1025-char description was not flagged', 'ok', 'Use when ' + 'x'.repeat(1016));
expectFlag('a description with an XML tag was not flagged', 'ok', 'Use when asked about <topic>.');
expectFlag('a name starting with a hyphen was not flagged', '-pdf');
expectFlag('a name with a double hyphen was not flagged', 'pdf--processing');
expectFlag('a name that does not match its directory was not flagged', 'ok', D, 'other');
expectFlag('a 501-char compatibility was not flagged', 'ok', D, 'ok', `compatibility: ${'c'.repeat(501)}\n`);
if (flags('a'.repeat(64), 'Use when ' + 'x'.repeat(1015), 'a'.repeat(64), `compatibility: ${'c'.repeat(500)}\n`).length) {
  failures.push('a 64-char name / 1024-char description / 500-char compatibility was flagged');
}

if (failures.length) { console.error('RED frontmatter-limits:\n  - ' + failures.join('\n  - ')); process.exit(1); }
console.log('GREEN frontmatter-limits');
