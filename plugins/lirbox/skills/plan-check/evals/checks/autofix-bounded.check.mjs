// ACCEPTANCE-CHECK (DOC concern) — guards the autofix boundary, not the feature.
//
// Autofix turns rows whose repair is SETTLED into edits to the plan: settled by the evidence
// (`fix: mechanical`) or by a decision the human stated (`fix: needs-decision`, answered). Ways it
// goes wrong, one assertion each:
//
//   1. It runs unasked.
//   2. It writes a sibling copy instead of editing the plan — two plans, one stale, and the
//      reader has to diff them by hand. Git is the record; the edit goes in place.
//   3. It CHOOSES a repair that needs a decision — invents a new approach where the plan's model
//      of reality was wrong, and the plan then READS as verified.
//   4. The gate collapses back onto the REFUTED *status*, forbidding the mechanical refutations
//      (a moved symbol, a Makefile target that does not exist) the doc itself lists.
//   5. The verdict is frozen — "a NO-GO never moves" — so a plan whose blockers were decided and
//      applied still reads NO-GO. The verdict must follow the rows, whatever it was.
//
// History: 2026-08-03 added with a sibling `<plan>.autofix.md` and a re-run of steps 3–6 per
// fix; 2026-10-26 replaced both — edit in place, re-adjudicate each fixed row against the
// evidence that settled it, verdict re-derived by validate.mjs.
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

if (!skill || !autofix) {
  console.error(`FAIL check: cannot read ${!skill ? SKILL_MD : AUTOFIX_MD}`);
  process.exit(1);
}

// Assert on BLOCKS — a paragraph / bullet — so the concepts must co-occur in one stated rule.
// Whole-file token tests false-green: "autofix" and "verdict" recur everywhere.
const blocks = (t) => t.split(/\n\s*\n|\n(?=\s*[-*]\s)/);
const someBlock = (t, ...res) => blocks(t).some((b) => res.every((re) => re.test(b)));
const autofixStep = skill.split(/\n(?=\s*\d+\.\s+\*\*)/).find((s) => /^\s*\d+\.\s+\*\*Offer autofix/.test(s)) || '';

const assertions = [
  {
    id: 'skill-offers-autofix',
    where: 'SKILL.md',
    ok: /never automatic|not automatic|opt-in/i.test(autofixStep),
    want: 'the autofix step must be offered, never run automatically',
  },
  {
    id: 'edits-plan-in-place',
    where: 'SKILL.md autofix step',
    ok: /in place/i.test(autofixStep),
    want: 'SKILL.md must say the plan file is edited in place — the always-loaded surface, not only the reference',
  },
  {
    id: 'no-sibling-copy',
    where: 'SKILL.md + references/autofix.md',
    ok: !/\.autofix\.md|sibling/i.test(skill) && !/\.autofix\.md|sibling/i.test(autofix),
    want: 'no sibling `<plan>.autofix.md` — a second copy of the plan is the thing this replaced',
  },
  {
    id: 'decision-never-chosen',
    where: 'references/autofix.md',
    // Anchored to the exclusion BULLETS, not the section prose: a section paragraph must not be
    // able to cover for a deleted item.
    ok: (() => {
      const section = (autofix.split(/^## What needs a decision[^\n]*$/m)[1] || '').split(/^## /m)[0];
      return section.split(/^- /m).slice(1).some(
        (b) => /must not (choose|touch)|never (choose|pick)/i.test(b) && /design|new approach/i.test(b)
      );
    })(),
    want: 'the needs-decision list must carry a bullet saying autofix never chooses a new approach, with the reason',
  },
  {
    id: 'status-is-not-the-gate',
    where: 'references/autofix.md',
    ok: /REFUTED/.test(autofix) && /fix class\*{0,2}, never the status|not the status|status is not the gate/i.test(autofix),
    want: 'the doc must say explicitly that the fix class, not the REFUTED status, is the gate',
  },
  {
    id: 'verdict-follows-rows',
    where: 'references/autofix.md + SKILL.md',
    ok:
      someBlock(autofix, /re-?adjudicat/i, /validate\.mjs/i, /verdict is whatever the rows/i) &&
      /verdict is whatever the rows now derive/i.test(autofixStep) &&
      !/(does|must) not (move|be made to)|never moves? (after|once)|cannot move/i.test(skill + autofix),
    want:
      'after a fix the row is re-adjudicated, validate.mjs re-run, and the verdict is whatever the rows derive — ' +
      'no rule freezing a NO-GO',
  },
];

const failed = assertions.filter((a) => !a.ok);
if (!failed.length) {
  console.log(`PASS check: autofix edits in place, never chooses a decision, and the verdict follows the rows (${assertions.length}/${assertions.length}).`);
  process.exit(0);
}
console.error('FAIL check: plan-check autofix boundary is not stated.');
for (const a of failed) console.error(`  - [${a.id}] ${a.where}: ${a.want}`);
process.exit(1);
