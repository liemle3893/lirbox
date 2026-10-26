// ACCEPTANCE-CHECK — the verdict is derived from the fix CLASS of refuted rows, not their count.
//
// Concern (2026-10-26): SKILL.md said "NO-GO if any REFUTED on a critical path" while validate.mjs
// forced NO-GO on ANY refutation — so a plan naming `make test-all` where the Makefile has `test`
// was blocked outright, and a whole re-verification ritual existed only to walk that typo back.
// UNSTATED-ASSUMPTION, meanwhile, was not open at all: an assumption nobody checked never stood
// between a plan and GO, while any generic blind spot did.
//
// The invariant:
//   REFUTED + fix: needs-decision  -> NO-GO
//   REFUTED + fix: mechanical      -> open (a condition), never NO-GO by itself
//   UNSTATED-ASSUMPTION            -> open
//
// Asserted by EXECUTING validate.mjs against synthetic reports, plus SKILL.md step 7 (the step the
// model reads when it picks the verdict).
//
// Locked (evals/**): the fixer may never edit this file.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = process.cwd();
const P = 'plugins/lirbox/skills/plan-check';
const SKILL_MD = process.env.PLAN_CHECK_SKILL_MD || join(ROOT, P, 'SKILL.md');
const VALIDATE = process.env.PLAN_CHECK_VALIDATE || join(ROOT, P, 'assets/validate.mjs');

let skill;
try {
  skill = readFileSync(SKILL_MD, 'utf8');
} catch (e) {
  console.error(`FAIL check: cannot read ${SKILL_MD}: ${e.message}`);
  process.exit(1);
}

const TMP = mkdtempSync(join(tmpdir(), 'plan-check-verdict-'));
const row = (status, fix) =>
  `<tr class="claim" data-status="${status}"><td>p</td><td>${status} <span class="fix">fix: ${fix}</span></td></tr>`;
const report = (rows, verdict, conds) => `<!DOCTYPE html><html><body>
<p id="goal"><strong>Goal:</strong> ship the thing</p>
<div class="verdict" data-verdict="${verdict}"></div>
<ul class="conditions">${'<li class="condition"><div class="cbody">c</div></li>'.repeat(conds)}</ul>
<table><tbody>
<tr class="claim" data-goal-coverage="true" data-status="VERIFIED"><td>DoD reaches the goal</td></tr>
${rows.join('\n')}
</tbody></table>
<script type="application/json" id="dod">{"criteria":[{"id":"c1","text":"t","tier":"judged"}]}</script>
</body></html>`;

let n = 0;
const exitOn = (html) => {
  const f = join(TMP, `r${++n}.html`);
  writeFileSync(f, html);
  try {
    execFileSync('node', [VALIDATE, f], { stdio: 'pipe' });
    return 0;
  } catch (e) {
    return typeof e.status === 'number' ? e.status : 1;
  }
};

const verdictStep = skill.split(/\n(?=\s*\d+\.\s+\*\*)/).find((s) => /^\s*7\.\s+\*\*Verdict/.test(s)) || '';

const assertions = [
  {
    id: 'decision-refutation-is-no-go',
    ok: exitOn(report([row('REFUTED', 'needs-decision')], 'NO-GO', 0)) === 0 &&
        exitOn(report([row('REFUTED', 'needs-decision')], 'GO-WITH-CONDITIONS', 1)) === 1,
    want: 'a REFUTED row needing a decision must derive NO-GO, and nothing softer',
  },
  {
    id: 'mechanical-refutation-is-a-condition',
    ok: exitOn(report([row('REFUTED', 'mechanical')], 'GO-WITH-CONDITIONS', 1)) === 0 &&
        exitOn(report([row('REFUTED', 'mechanical')], 'NO-GO', 0)) === 1,
    want: 'a REFUTED row the evidence fully corrects must derive GO-WITH-CONDITIONS (one condition), never NO-GO',
  },
  {
    id: 'unstated-assumption-is-open',
    ok: exitOn(report([row('UNSTATED-ASSUMPTION', 'needs-decision')], 'GO', 0)) === 1 &&
        exitOn(report([row('UNSTATED-ASSUMPTION', 'needs-decision')], 'GO-WITH-CONDITIONS', 1)) === 0,
    want: 'an UNSTATED-ASSUMPTION row must block a clean GO and count as a condition',
  },
  {
    id: 'skill-step-7-states-the-class-rule',
    ok: /NO-GO[^.]*REFUTED[^.]*needs a decision/i.test(verdictStep) &&
        /fix: mechanical`?\s*`?REFUTED/i.test(verdictStep) && /UNSTATED-ASSUMPTION/.test(verdictStep),
    want: 'SKILL.md step 7 must tie NO-GO to a needs-decision refutation and list mechanical REFUTED + UNSTATED-ASSUMPTION as open',
  },
];

const failed = assertions.filter((a) => !a.ok);
if (!failed.length) {
  console.log(`PASS check: verdict derives from the fix class of refuted rows (${assertions.length}/${assertions.length}).`);
  process.exit(0);
}
console.error('FAIL check: the verdict is not derived from the fix class.');
for (const a of failed) console.error(`  - [${a.id}] ${a.want}`);
process.exit(1);
