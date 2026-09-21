#!/usr/bin/env node
// Frozen check: an UNMEASURED route must be announced as unmeasured.
//
// `decideRoute` returns `decided_by: 'fallback'` in two cases — an answer that came back
// unusable, and a jev that died — and both write `route: 'inline'`, because intake's job is to
// never wedge a human. That is the right default and the wrong thing to report silently: a dead
// API key and a confident go-ahead produce the identical route string, so without this the skill
// announces "inline" with equal authority in both cases.
//
// This guards the SKILL.md half only. The `route.json` field it names is asserted by the sibling
// check reject-outranks-capability's import of the real router, and by intake-selfcheck c1/c2.
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

need('**Read `decided_by` and say which it is.**',
  'the announce step no longer tells the caller to read decided_by, so an unmeasured route reports as a measured one');
need('a dead API key and a confident go-ahead are the same word on the same line unless you say so',
  'the announce step no longer states WHY decided_by matters, leaving the instruction as an unexplained ritual to be dropped in the next edit');
need('`decided_by: fallback` is not a verdict',
  'the hard-rules bullet no longer denies that a fallback route is a judgment, so only the flow step carries the rule');

if (failures.length) {
  console.error('RED fallback-is-announced:\n  - ' + failures.join('\n  - '));
  process.exit(1);
}
console.log('GREEN fallback-is-announced');
