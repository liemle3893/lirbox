#!/usr/bin/env node
// Frozen check: the `reject` route must STOP, and the skill must say — twice, independently,
// in the routes table and in the hard-rules — that a rejected task is never turned into a
// smaller one that slips through. Softening a rejection defeats the only route here whose
// answer can be "no".
//
// DO_SKILL_OVERRIDE points at the SKILL.md under test (set by prove-checks for mutation-testing).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const skillPath = process.env.DO_SKILL_OVERRIDE || join(here, '..', '..', 'SKILL.md');
const text = readFileSync(skillPath, 'utf8').replace(/\s+/g, ' ');

const need = (s, why) => { if (!text.includes(s)) fail(why); };
const failures = [];
const fail = (why) => failures.push(why);

need('**STOP.** Do not implement, do not offer a smaller version.',
  'the reject row no longer says STOP and refuses a smaller version');
need('no smaller version offered.',
  'the hard-rules bullet no longer rules out a softened re-scope');
need('not a retry of this one with the scope shaved down.',
  'the reject section no longer forbids retrying a rejected task at smaller scope');

if (failures.length) {
  console.error('RED reject-not-softened:\n  - ' + failures.join('\n  - '));
  process.exit(1);
}
console.log('GREEN reject-not-softened');
