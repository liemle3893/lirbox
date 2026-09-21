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
    id: 'authorship-never-autofixed',
    where: 'references/autofix.md',
    // The bright line, stated on the axis that actually carries it: the FIX CLASS. It was written
    // as a ban on the REFUTED *status*, which is a different axis — the doc's own mechanical list
    // holds refutations (a moved symbol, a command form proven not to work), so it forbade the
    // repairs it had just authorised, and made "REFUTED + mechanical" inexpressible downstream.
    // The REASON must travel with the exclusion: an assertion matching only "needs-decision" would
    // not notice the rule collapsing back into a status ban.
    // Anchored to the enumerated exclusion LIST, not to the section prose. The section opens with
    // a paragraph stating the fix-class rule, and an assertion scanning the whole section stayed
    // green when the bullet was deleted (prove-checks caught exactly that false-green) — the
    // paragraph covered for the missing item. The bullets are what an agent reads to decide a
    // specific row, so the bullets are what this asserts on.
    ok: (() => {
      const section = (autofix.split(/^## What needs a decision[^\n]*$/m)[1] || '').split(/^## /m)[0];
      const bullets = section.split(/^- /m).slice(1);
      return bullets.some(
        (b) => /must not touch|never autofix|not autofixed|excluded/i.test(b) &&
               /design|authorship|not (say|establish)|new approach/i.test(b)
      );
    })(),
    want: 'the exclusion list must carry a BULLET excluding authorship-class repair WITH the reason — a section paragraph must not be able to cover for a deleted item',
  },
  {
    id: 'status-is-not-the-gate',
    where: 'references/autofix.md',
    // Guards the re-axing itself. Without this, restoring "REFUTED is never autofixed" alongside
    // the new prose would leave every other assertion green while the contradiction returned.
    ok: /REFUTED/.test(autofix) && /not the (line|gate)|never the status|not the status|fix class, never/i.test(autofix),
    want: 'the doc must say explicitly that REFUTED is NOT the line — otherwise the status ban can creep back in beside the fix-class rule',
  },
  {
    id: 'verdict-improves-only-on-re-verification',
    where: 'references/autofix.md',
    // The invariant the old status ban was a blunt proxy for, now carrying the weight alone: a
    // verdict may move because a row was re-checked, never because the text was edited.
    ok: someBlock(autofix, /verdict/i, /only|never/i, /re-?verif|re-?check/i),
    want: 'the verdict must be stated as improvable ONLY by re-verification, never by the edit — this is what replaces the blanket ban',
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
