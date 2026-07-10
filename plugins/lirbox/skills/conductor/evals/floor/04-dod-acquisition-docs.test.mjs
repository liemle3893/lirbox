// FLOOR (characterization) — PASSES on baseline; pins: conductor's docs must cover the DoD acquisition flow + new flags.
// Promoted from evals/checks/ after whetstone run conductor-20260710-001629 merged (backlog item of the same name).
//
// Concern (feedback/conductor.jsonl → dod-acquisition-docs): after the DoD/panel work lands
// (plan Task 4), conductor's SKILL.md must document the DoD acquisition flow and generator-flags.md
// must document the new flags. On the baseline NEITHER file mentions a DoD, so every assertion
// below is red — that is the discrimination gate the fix turns green.
//
// Passes iff ALL of:
//   SKILL.md            — has the `Acquire the DoD` heading, mentions the plan-check `id="dod"`
//                         block, the `--dod-file` flag, and the >10-ACs `split` proposal.
//   generator-flags.md  — documents `--dod-file`, `--no-dod`, `--review-panel`, and `DoDGate`.
//
// Locked (evals/**): the whetstone fixer may NEVER edit this file.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(HERE, '..', '..');                       // .../skills/conductor
const SKILL_MD = resolve(SKILL_DIR, 'SKILL.md');
const FLAGS_MD = resolve(SKILL_DIR, 'references', 'generator-flags.md');

let skill, flags;
try {
  skill = readFileSync(SKILL_MD, 'utf8');
  flags = readFileSync(FLAGS_MD, 'utf8');
} catch (e) {
  console.error(`check: could not read a docs file: ${e.message}`);
  process.exit(2);   // harness error, not a verdict
}

let failed = 0;
function ok(cond, label) {
  if (cond) {
    console.log(`ok   — ${label}`);
  } else {
    failed++;
    console.error(`FAIL — ${label}`);
  }
}

// SKILL.md — the acquisition step.
ok(skill.includes('Acquire the DoD'), 'SKILL.md has the "Acquire the DoD" heading');
ok(skill.includes('id="dod"'), 'SKILL.md points at the plan-check `id="dod"` block');
ok(skill.includes('--dod-file'), 'SKILL.md mentions the --dod-file flag');
ok(/split/.test(skill), 'SKILL.md mentions the >10-ACs split proposal');

// generator-flags.md — the new flag reference.
ok(flags.includes('--dod-file'), 'generator-flags.md documents --dod-file');
ok(flags.includes('--no-dod'), 'generator-flags.md documents --no-dod');
ok(flags.includes('--review-panel'), 'generator-flags.md documents --review-panel');
ok(flags.includes('DoDGate'), 'generator-flags.md names the DoDGate phase');

if (failed) {
  console.error(`\ncheck RED: ${failed} DoD-docs assertion(s) unmet — the DoD acquisition flow is not documented yet.`);
  process.exit(1);
}
console.log('\ncheck GREEN: conductor docs cover the DoD acquisition flow + new flags.');
process.exit(0);
