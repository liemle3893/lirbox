#!/usr/bin/env node
// Frozen check: `inline` must execute immediately. Two positive anchors (the hard-rule and the
// routes-table row) must say there is no confirmation step, and the `### inline` prose itself
// must never contain an actual permission-seeking imperative ("ask the user", "wait for
// approval", ...) — asking permission already given is the latency this route removes.
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

need('No confirmation step; the route already is the approval.',
  'the hard-rules bullet no longer says inline skips confirmation');
need('No plan step, no "should I proceed?", no approval round-trip.',
  'the routes-table row for `inline` no longer rules out an approval round-trip');

// Isolate the `### inline` prose so a legitimate mention of "ask" elsewhere (e.g. describing what
// NOT to do) can never trip this — only an actual imperative aimed at the user, inside inline's
// own section, counts.
const section = text.match(/### inline([\s\S]*?)(### |<\/routes>)/);
if (!section) failures.push('no "### inline" section found to check');
else {
  const askImperative = /\bask(?:ing)? (the )?user\b|\bask for (permission|approval|confirmation)\b|\bwait for (approval|confirmation)\b/i;
  if (askImperative.test(section[1])) {
    failures.push(`the "### inline" section asks the user for permission: matched ${JSON.stringify(section[1].match(askImperative)[0])}`);
  }
}

if (failures.length) {
  console.error('RED inline-no-permission-ask:\n  - ' + failures.join('\n  - '));
  process.exit(1);
}
console.log('GREEN inline-no-permission-ask');
