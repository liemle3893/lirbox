#!/usr/bin/env node
// Frozen check: the skill treats the gate's exit 0 as the only "done", and exit 3 as a STOP —
// never a fourth round, never "nearly done". The budget is enforced by dod-gate.mjs; this guards
// the half the script cannot: what the session says and does with the exit code.
//
// CONDUCTOR_SKILL_OVERRIDE points at the SKILL.md under test (set by prove-checks).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const skillPath = process.env.CONDUCTOR_SKILL_OVERRIDE || join(here, '..', '..', 'SKILL.md');
const text = readFileSync(skillPath, 'utf8').replace(/\s+/g, ' ');

const failures = [];
const need = (s, why) => { if (!text.includes(s)) failures.push(why); };

need('**Only gate exit 0 is done.**',
  'the hard-rules no longer make the gate the only definition of done');
need('Exit 3 is reported as escalated, never as nearly done.',
  'the hard-rules no longer forbid softening an escalated run into a near-success');
need('**STOP.** Report the unmet rows verbatim; do not start round 4',
  'the exit-3 row no longer stops the run at the budget');

if (failures.length) {
  console.error('RED gate-is-the-only-done:\n  - ' + failures.join('\n  - '));
  process.exit(1);
}
console.log('GREEN gate-is-the-only-done');
