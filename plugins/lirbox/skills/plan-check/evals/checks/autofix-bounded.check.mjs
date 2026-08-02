// ACCEPTANCE-CHECK (DOC concern) — FAILS on the unmodified baseline (fail-before / pass-after).
//
// Concern: plan-check adjudicates and stops. A finding whose repair is fully determined by the
// finding itself (an edge the plan states in prose but omits from its dependency block; a
// file:line verified as moved) still has to be re-applied by hand, and a NO-GO verdict arrives
// with no route out of it.
//
// Adding autofix is easy to get DANGEROUSLY wrong, so this check guards the boundary rather than
// the feature. Three ways it goes wrong, one assertion each:
//
//   1. It overwrites the plan it audited — destroying the evidence that justified the edits.
//   2. It "fixes" a REFUTED row, i.e. invents a new approach where the plan's model of reality
//      was wrong, and the plan then READS as verified. That is verdict laundering.
//   3. It edits, then leaves the old report standing — so the verdict improved because the map
//      was redrawn, not because the territory was re-checked.
//
// The invariant: autofix is bounded to mechanically-determined repairs, never mutates the input,
// and no edit is trusted until the touched propositions are re-verified.
//
// RED on baseline: SKILL.md has no autofix step and references/autofix.md does not exist, so all
// four assertions fail. We do NOT edit either doc here.
//
// Locked (evals/**): the fixer may never edit this file.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const SKILL_MD =
  process.env.PLAN_CHECK_SKILL_MD || join(ROOT, 'plugins/lirbox/skills/plan-check/SKILL.md');
const AUTOFIX_MD =
  process.env.PLAN_CHECK_AUTOFIX_MD ||
  join(ROOT, 'plugins/lirbox/skills/plan-check/references/autofix.md');

const read = (p) => {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return '';
  }
};

const skill = read(SKILL_MD);
const autofix = read(AUTOFIX_MD);

if (!skill) {
  console.error(`FAIL check: cannot read ${SKILL_MD}`);
  process.exit(1);
}

// Whole-file token tests false-green here: "autofix" and "verify" recur everywhere once the
// feature exists, so a deleted rule stays satisfied by its neighbours. Assert on BLOCKS — a
// paragraph / bullet / directive — so the concepts must co-occur in one stated rule.
const blocks = (t) => t.split(/\n\s*\n|\n(?=\s*[-*]\s)/);
const someBlock = (t, ...res) => blocks(t).some((b) => res.every((re) => re.test(b)));

const assertions = [
  {
    id: 'skill-offers-autofix',
    where: 'SKILL.md',
    ok: /autofix/i.test(skill) && /offer|opt-in|never automatic|not automatic/i.test(skill),
    want: 'the workflow must offer autofix explicitly, and never run it automatically',
  },
  {
    id: 'input-plan-never-modified',
    where: 'SKILL.md',
    // Must be in SKILL.md, the always-loaded surface — a rule that lives only in a reference is
    // one an agent can act without ever reading. autofix.md restates it; this asserts the copy
    // that is always in context.
    ok: someBlock(skill, /never (be )?modif|not modif|never touch|never overwrit/i, /input|original|sibling/i),
    want: 'SKILL.md itself must state that the input plan is never modified — the repair lands in a sibling artifact',
  },
  {
    id: 'refuted-never-autofixed',
    where: 'references/autofix.md',
    // The bright line: a wrong model of reality is a decision, not a transcription. The REASON
    // must be stated with the exclusion — elsewhere the doc notes REFUTED is "never autofixable"
    // while explaining NO-GO, and an assertion satisfied by that sentence would not notice this
    // rule being deleted (it did not, until prove-checks said so).
    ok: someBlock(autofix, /REFUTED/, /never|not autofix|excluded|must not/i, /design|authorship|transcription/i),
    want: 'REFUTED rows must be excluded from autofix by name, WITH the reason — repairing them is design, not transcription',
  },
  {
    id: 'autofix-forces-reverification',
    where: 'references/autofix.md',
    // Anchored on INVALIDATION, not on the word "re-verify": the doc also says the verdict is
    // "recomputed from re-verified rows", which is a consequence, not the rule. Only the
    // invalidation sentence establishes that an edit re-opens what was already checked.
    ok: someBlock(autofix, /re-?verif|re-?check|re-?run/i, /invalidat/i),
    want:
      'an applied fix must invalidate the report and force re-verification before the verdict is recomputed',
  },
];

const failed = assertions.filter((a) => !a.ok);
if (!failed.length) {
  console.log(
    `PASS check: autofix is bounded, non-destructive and re-verified (${assertions.length}/${assertions.length} assertions).`
  );
  process.exit(0);
}
console.error('FAIL check: plan-check autofix is missing or its safety boundary is not stated.');
for (const a of failed) console.error(`  - [${a.id}] ${a.where}: ${a.want}`);
process.exit(1);
