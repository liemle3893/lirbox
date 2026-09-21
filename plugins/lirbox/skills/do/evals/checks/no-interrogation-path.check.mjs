#!/usr/bin/env node
// Frozen check: this skill never interrogates the user itself. A task whose "done" cannot be
// stated as a command plus an expected value is the `scope` route — a handoff to `lirbox-planner`
// — not a set of clarifying questions asked in this skill. Three independent anchors: the flow's
// first step, the hard-rules ban, and the `scope` section naming the handoff instead of questions.
//
// DO_SKILL_OVERRIDE points at the SKILL.md under test (set by prove-checks for mutation-testing).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const skillPath = process.env.DO_SKILL_OVERRIDE || join(here, '..', '..', 'SKILL.md');
const text = readFileSync(skillPath, 'utf8').replace(/\s+/g, ' ');

const failures = [];
const need = (s, why) => { if (!text.includes(s)) failures.push(why); };

need('Ask the user nothing before this.',
  'the flow no longer says to ask the user nothing before running intake');
need('**Never interrogate.**',
  'the hard-rules no longer ban interrogating the user');
need('not five questions to the user',
  'the `scope` section no longer rules out asking the user questions itself, in favor of the planner handoff');

if (failures.length) {
  console.error('RED no-interrogation-path:\n  - ' + failures.join('\n  - '));
  process.exit(1);
}
console.log('GREEN no-interrogation-path');
