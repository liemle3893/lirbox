#!/usr/bin/env node
// Frozen check: the skill must route a missing Jev to the Haiku subagent, tell the user the grades are
// Haiku's, and never make a score up. Without these the skill either drops grading or reports a number
// nobody measured.
//
// PI_SKILL_OVERRIDE points at the SKILL.md under test (set by prove-checks for mutation-testing).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const text = readFileSync(process.env.PI_SKILL_OVERRIDE || join(here, '..', '..', 'SKILL.md'), 'utf8').replace(/\s+/g, ' ');

const failures = [];
const need = (s, why) => { if (!text.includes(s)) failures.push(why); };
need('Exit 3 means Jev is not set up', 'the Judge section no longer says what exit 3 means');
need('Dispatch one Agent with `model: "haiku"`', 'the fallback no longer dispatches a Haiku subagent');
need('Say once that grades come from Haiku, not Jev', 'the skill no longer tells the user the grades are Haiku\'s');
need('Never invent a score.', 'the skill no longer forbids making up a score');

if (failures.length) {
  console.error('RED fallback-announced:\n  - ' + failures.join('\n  - '));
  process.exit(1);
}
console.log('GREEN fallback-announced');
