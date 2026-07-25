// ACCEPTANCE-CHECK (whetstone item: independent-fanout-never-chosen) — RED on baseline, GREEN after.
//
// Concern: --independent is now mechanically sound (per-worker worktrees + integrate step) but
// drivers almost never pass it — ~100% of generated workflows come out strictly linear. That is a
// DECISION gap: no step in SKILL.md ever enumerates the work items or their dependency edges, so
// --independent survives only as a passive aside in the generate step and sequential stays the
// path of least resistance.
//
// Fix contract: a REQUIRED decompose step, positioned BEFORE the generate step, in which the
// driver emits a per-item "depends on: <ids | none>" declaration, plus a MUST rule binding every
// no-dependency item into ONE --independent fan-out; the generate step then reads the flag choice
// off that artifact instead of restating a soft heuristic.
//
// This is a structural proxy for a behavioral outcome (which flag a live driver picks). The real
// proof is an arena A/B across skill versions, blocked on arena's missing --plugin-dir axis.
//
// Locked (evals/**): the whetstone fixer may NEVER edit this file.
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL = resolve(HERE, '..', '..', 'SKILL.md');
const md = readFileSync(SKILL, 'utf8');

let ok = true;
const fail = (m) => { console.error('FAIL: ' + m); ok = false; };

// The generate step is the anchor: the decompose step must come BEFORE it.
const genStep = md.match(/^###\s*2\.\s*Generate the conductor.*$/m);
if (!genStep) {
  console.error('FAIL: could not locate the "### 2. Generate the conductor" step heading in SKILL.md');
  process.exit(1);
}
const genIdx = md.indexOf(genStep[0]);
const before = md.slice(0, genIdx);

// 1. A decompose/dependency step exists among the step-1 headings (i.e. before generation).
const decompose = [...before.matchAll(/^###\s*1[a-z]?\.\s*(.*)$/gm)]
  .filter((m) => /decompos|dependenc/i.test(m[1]));
if (decompose.length === 0) {
  fail('no step-1 heading before "Generate the conductor" names decomposition or dependencies');
} else {
  // 2. Its body must carry the per-item dependency declaration AND the MUST rule.
  const start = before.indexOf(decompose[decompose.length - 1][0]);
  const body = md.slice(start, genIdx);
  if (!/depends on/i.test(body)) {
    fail('the decompose step does not require a per-item "depends on" declaration');
  }
  if (!/\bMUST\b/.test(body) || !/--independent/.test(body)) {
    fail('the decompose step does not state a MUST rule binding items to a single --independent fan-out');
  }
  // The rule has to bind the NO-dependency items specifically, not just mention independence.
  if (!/\bnone\b|no (declared )?dependenc/i.test(body)) {
    fail('the decompose step\'s rule does not identify the no-dependency items it binds');
  }
}

// 3. The generate step's --independent paragraph must read off that artifact, not re-judge it.
const nextHeading = md.slice(genIdx + genStep[0].length).search(/^###\s/m);
const step2 = md.slice(genIdx, nextHeading === -1 ? md.length : genIdx + genStep[0].length + nextHeading);
if (!/--independent/.test(step2)) {
  fail('the generate step no longer mentions --independent at all');
} else if (!/decompos|dependenc|step 1[a-z]/i.test(step2)) {
  fail('the generate step\'s --independent guidance does not cross-reference the decompose step');
}

if (!ok) process.exit(1);
console.log('PASS: SKILL.md requires a pre-generation decompose step with a dependency declaration and a MUST fan-out rule');
