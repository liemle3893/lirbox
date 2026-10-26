#!/usr/bin/env node
// Frozen check: `lane` is the one route that must ALWAYS ask before acting, in three independent
// places — the routes-table row, the hard-rules bullet, and the `### lane` prose — because a
// lane is the one route whose cost (a worktree, a subagent running for hours) is not cheaply
// undone. Printing the spawn is not the same as asking to run it.
//
// CONDUCTOR_SKILL_OVERRIDE points at the SKILL.md under test (set by prove-checks for mutation-testing).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const skillPath = process.env.CONDUCTOR_SKILL_OVERRIDE || join(here, '..', '..', 'SKILL.md');
const text = readFileSync(skillPath, 'utf8').replace(/\s+/g, ' ');

const failures = [];
const need = (s, why) => { if (!text.includes(s)) failures.push(why); };

need('**ask before running it.**',
  'the routes-table row for `lane` no longer says to ask before spawning the lane');
need("**`lane` always asks**, even though the spawn was already printed",
  'the hard-rules bullet no longer says lane always asks');
need('filled in, then ask.',
  'the `### lane` prose no longer instructs asking after printing the spawn');

if (failures.length) {
  console.error('RED lane-always-asks:\n  - ' + failures.join('\n  - '));
  process.exit(1);
}
console.log('GREEN lane-always-asks');
