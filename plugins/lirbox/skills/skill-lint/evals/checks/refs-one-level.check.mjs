#!/usr/bin/env node
// Frozen check: references stay one level deep from SKILL.md, and a reference over 100 lines
// opens with a table of contents — both from Anthropic's skill-authoring guide ("Claude might
// partially read files when they're referenced from other referenced files", and "for reference
// files longer than 100 lines, include a table of contents at the top"). Size alone is NOT a
// finding: the guide says a bundled reference costs nothing until it is read.
//
// SKILL_LINT_OVERRIDE points at the analyze.cjs under test (set by prove-checks).
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { analyzeSkill } = createRequire(import.meta.url)(
  process.env.SKILL_LINT_OVERRIDE || join(here, '..', '..', 'scripts', 'analyze.cjs'));

const src = '---\nname: r\ndescription: Use when testing. Triggers on refs.\n---\nSee [a](references/a.md).\n';
const refs = (name, body) => analyzeSkill({ name: 'r', src, refFiles: [{ name, src: body, lines: body.split('\n').length }] })
  .findings.filter((f) => f.check === 'refs');
const long = (head) => head + Array.from({ length: 800 }, (_, i) => `line ${i}`).join('\n');

const failures = [];
if (!refs('a.md', 'Details: see [b](b.md).\n').length) failures.push('a reference linking to another .md was not warned');
if (!refs('big.md', long('# Big\n')).length) failures.push('an 800-line reference with no table of contents was not warned');
if (refs('big.md', long('# Big\n\n## Contents\n- a\n- b\n\n')).length) failures.push('an 800-line reference WITH a table of contents was warned — size alone is not a finding');

if (failures.length) { console.error('RED refs-one-level:\n  - ' + failures.join('\n  - ')); process.exit(1); }
console.log('GREEN refs-one-level');
