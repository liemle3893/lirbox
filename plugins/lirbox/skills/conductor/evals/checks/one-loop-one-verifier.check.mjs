#!/usr/bin/env node
// Frozen check: the work happens in ONE session loop, and the only subagent is a verifier that
// never sees the build history.
//
// This is the whole rebuild. The old conductor lost every measured head-to-head on wall-clock
// because each phase was its own worker paying spin-up and a lossy hand-off. The one split the
// evidence supports is context-isolated verification: the artifact and the criteria, not the
// transcript. Re-adding phase workers, or handing the verifier your notes, reverts the rebuild.
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

need('No phase workers:',
  'the work step no longer forbids phase workers');
need('spawn ONE `lirbox-verifier`',
  'the verify step no longer limits verification to one verifier subagent');
need('not your notes, not this conversation',
  'the verifier is no longer kept away from the build history');
need('**You never write a verdict.**',
  'the hard-rules no longer forbid the implementor writing its own verdicts');

if (failures.length) {
  console.error('RED one-loop-one-verifier:\n  - ' + failures.join('\n  - '));
  process.exit(1);
}
console.log('GREEN one-loop-one-verifier');
