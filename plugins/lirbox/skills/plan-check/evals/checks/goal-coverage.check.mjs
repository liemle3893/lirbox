// ACCEPTANCE-CHECK (DOC + CONTRACT concern) — FAILS on the unmodified baseline.
//
// Concern: plan-check has NO concept of the plan's goal. Measured on 9c86ced — the only match for
// /goal/i across SKILL.md, template.html and both references is incidental prose in blind-spot.md
// describing the checklist's purpose. The report carries {{PLAN_TITLE}}, a verdict, conditions,
// blind spots, a DoD and a claim ledger; nowhere does it say what the plan is trying to ACHIEVE.
//
// It fell out of the skill's own framing: step 2 decomposes into "atomic checkable propositions"
// and step 6 adjudicates each VERIFIED/REFUTED. A goal has no truth value, so it never survives
// decomposition. What that costs:
//
//   * the DoD is unanchored — every criterion can be perfectly checkable and still not achieve the
//     objective (green tests, wrong feature), and the report cannot see it;
//   * GO means "the claims hold", NOT "this plan achieves its goal";
//   * lirbox:conductor seeds its DoDGate from the #dod block, so it verifies faithfully toward a
//     target nobody validated.
//
// The invariant: the report states the plan's goal, AND the ledger carries ONE adjudicated
// proposition on whether meeting every DoD criterion actually achieves that goal. The goal line
// alone is decoration — the adjudication is the part that can catch a plan solving the wrong
// problem, so both halves are required or this check is guarding a cosmetic change.
//
// Locked (evals/**): the fixer may never edit this file.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const D = join(ROOT, 'plugins/lirbox/skills/plan-check');
const SKILL_MD = process.env.PLAN_CHECK_SKILL_MD || join(D, 'SKILL.md');
const TEMPLATE = process.env.PLAN_CHECK_TEMPLATE || join(D, 'assets/template.html');
const VALIDATE = process.env.PLAN_CHECK_VALIDATE || join(D, 'assets/validate.mjs');

const read = (p) => {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return '';
  }
};

const skill = read(SKILL_MD);
const tpl = read(TEMPLATE);
const val = read(VALIDATE);

if (!skill || !tpl || !val) {
  console.error('FAIL check: cannot read SKILL.md / template.html / validate.mjs');
  process.exit(1);
}

// Block-scoped matching: "goal" will recur once the feature lands, so a whole-file token test
// would stay green after the load-bearing rule was deleted. Each assertion needs its concepts
// to co-occur in ONE paragraph / bullet / directive.
const blocks = (t) => t.split(/\n\s*\n|\n(?=\s*[-*]\s)|\n(?=\s*\d+\.\s)/);
const someBlock = (t, ...res) => blocks(t).some((b) => res.every((re) => re.test(b)));

// The validator assertions EXECUTE validate.mjs rather than grepping it. Grepping for
// `data-goal-coverage` stayed green when the enforcement was replaced by `const goalRows = [null]`
// — the token survived in the error message and the comment (a FALSE-GREEN caught by
// prove-checks.mjs). Running it cannot be fooled that way: if the rule is gone, the bad report
// passes and this check fails.
const TMP = mkdtempSync(join(tmpdir(), 'plan-check-goal-'));
const GOAL_EL = '<p id="goal"><strong>Goal:</strong> keep the service available during the upgrade</p>';
const GOAL_ROW =
  '<tr class="claim" data-goal-coverage="true" data-quadrant="known-known" data-status="VERIFIED"><td>DoD met achieves the goal</td></tr>';
const DOD =
  '<script type="application/json" id="dod">{"criteria":[{"id":"a","text":"t","tier":"judged"}]}</script>';

const report = ({ goal = GOAL_EL, goalRow = GOAL_ROW } = {}) =>
  `<!DOCTYPE html><html><head><meta charset="utf-8"><title>t</title></head><body>
<div class="verdict" data-verdict="GO"><span class="badge">GO</span></div>
${goal}
<table><tbody>
  <tr class="claim" data-quadrant="known-known" data-status="VERIFIED"><td>a claim</td></tr>
  ${goalRow}
</tbody></table>
${DOD}
</body></html>`;

const validates = (name, html) => {
  const f = join(TMP, `${name}.html`);
  writeFileSync(f, html);
  try {
    execFileSync('node', [VALIDATE, f], { stdio: 'pipe' });
    return 0;
  } catch (e) {
    return typeof e.status === 'number' ? e.status : 1;
  }
};

const assertions = [
  {
    id: 'template-carries-goal',
    where: 'assets/template.html',
    ok: /id="goal"/.test(tpl),
    want: 'the report template must have a slot for the plan\'s goal (id="goal")',
  },
  {
    id: 'validator-accepts-well-formed',
    where: 'assets/validate.mjs',
    // Guards the other two: a validator that rejects everything would "enforce" both rules
    // vacuously and tell us nothing.
    ok: validates('ok', report()) === 0,
    want: 'validate.mjs must ACCEPT a report that states its goal and carries the coverage row',
  },
  {
    id: 'validator-requires-goal',
    where: 'assets/validate.mjs',
    ok: validates('nogoal', report({ goal: '' })) === 1,
    want: 'validate.mjs must REJECT a report with no stated goal — an optional field is one that gets skipped',
  },
  {
    id: 'validator-requires-goal-coverage-row',
    where: 'assets/validate.mjs',
    ok: validates('norow', report({ goalRow: '' })) === 1,
    want:
      'validate.mjs must REJECT a report with no adjudicated goal-coverage row — the goal line ' +
      'without it is decoration',
  },
  {
    id: 'skill-adjudicates-dod-against-goal',
    where: 'SKILL.md',
    // The invariant is the CONDITIONAL — "DoD fully met => goal achieved?" — not the two nouns
    // appearing near each other, which they do all over this section.
    ok: someBlock(skill, /goal/i, /\bDoD\b|success criteria/i, /if every|were met|fully met|would the/i),
    want:
      'SKILL.md must require the ledger to adjudicate whether meeting every DoD criterion ' +
      'actually achieves the stated goal — as a conditional, not a mention',
  },
];

const failed = assertions.filter((a) => !a.ok);
if (!failed.length) {
  console.log(
    `PASS check: the report states the goal and adjudicates the DoD against it (${assertions.length}/${assertions.length}).`
  );
  process.exit(0);
}
console.error('FAIL check: plan-check does not carry the plan\'s goal into the report.');
for (const a of failed) console.error(`  - [${a.id}] ${a.where}: ${a.want}`);
process.exit(1);
