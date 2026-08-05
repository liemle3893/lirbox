// ACCEPTANCE-CHECK (BEHAVIOUR concern) — FAILS on the unmodified baseline (fail-before / pass-after).
//
// Concern: step 7 has told plan-check to tag every open row `fix: mechanical` / `fix: needs-decision`
// since #57, and the model largely ignores it. MEASURED, not suspected: across 20 paired Harbor
// trials on plan-check__execution-shape (sonnet-5, 2026-08-04), `fix_tags_present` scored 4/10 in
// BOTH arms — and that grader was lenient, scoring 1 for a single `fix:` string anywhere in the
// file. Six of ten reports per arm contained none at all, in runs whose reports carried 6-12 open
// rows each.
//
// Every OTHER element of the same report contract landed at ~100% over the same runs:
//
//     report feature          template slot   validate.mjs rule   observed
//     #dod block                   yes              yes            10/10
//     id="goal"                    yes              yes            20/20
//     data-goal-coverage row       yes              yes            20/20
//     #taskgraph                   yes              yes            10/10
//     fix: disposition              NO               NO              4/10
//
// The difference is not the instruction — step 7 states it plainly. It is that SKILL.md step 9
// loops the model until validate.mjs exits 0, so a rule that lives only in prose never enters the
// loop: the model writes from the template, the template said nothing, the validator passed.
//
// The invariant this guards is deliberately PER-ROW, not per-file. A file-level `fix:` grep is
// exactly the leniency the Harbor grader had, and it would let one tagged row excuse ten untagged
// ones — which is how a reader loses the ability to tell what can be applied and what needs a
// decision. Assertion `rejects-tag-on-wrong-row` is the one that pins this.
//
// Asserted by EXECUTING validate.mjs against synthetic reports, not by grepping it. The prior
// checks in this skill each shipped a FALSE-GREEN from a token surviving somewhere else.
//
// RED on baseline (53059a0): validate.mjs has no rule, template.html has no slot and no .fix
// class, and step 8 — the step that actually writes the HTML — never mentions the disposition.
//
// Locked (evals/**): the fixer may never edit this file.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = process.cwd();
const P = 'plugins/lirbox/skills/plan-check';
const SKILL_MD = process.env.PLAN_CHECK_SKILL_MD || join(ROOT, P, 'SKILL.md');
const TEMPLATE = process.env.PLAN_CHECK_TEMPLATE || join(ROOT, P, 'assets/template.html');
const VALIDATE = process.env.PLAN_CHECK_VALIDATE || join(ROOT, P, 'assets/validate.mjs');

const read = (p) => {
  try {
    return readFileSync(p, 'utf8');
  } catch (e) {
    console.error(`FAIL check: cannot read ${p}: ${e.message}`);
    process.exit(1);
  }
};

const skill = read(SKILL_MD);
const template = read(TEMPLATE);
// The template's own comments explain the disposition, so a whole-file test is satisfied by the
// GUIDANCE even after the actual slot is deleted (a FALSE-GREEN prove-checks.mjs caught). The
// model fills the specimen row, not the comment — assert on the row.
const specimenRow =
  (template.replace(/<!--[\s\S]*?-->/g, '').match(/<tr\b[^>]*\bclass="[^"]*\bclaim\b[^"]*"[^>]*>[\s\S]*?<\/tr>/) || [''])[0];
const TMP = mkdtempSync(join(tmpdir(), 'plan-check-fix-'));

const FIX_M = ' <span class="fix">fix: mechanical</span>';
const FIX_D = ' <span class="fix">fix: needs-decision</span>';

const row = (status, extra = '') =>
  `<tr class="claim" data-quadrant="known-known" data-status="${status}"><td>p</td><td>q</td>` +
  `<td><span class="s-${status}">${status}</span>${extra}</td><td>e</td><td>c</td></tr>`;

// A report that satisfies every OTHER rule, so only the disposition is under test.
const report = (rows, verdict, conds) => `<!DOCTYPE html><html><head><style>.fix{color:#000}
.verdict[data-verdict="GO"]{color:#000}</style></head><body>
<p id="goal"><strong>Goal:</strong> ship the thing without breaking checkout</p>
<div class="verdict" data-verdict="${verdict}"><span class="badge">${verdict}</span></div>
<ul class="conditions">${'<li class="condition"><div class="cbody">c</div></li>'.repeat(conds)}</ul>
<table><tbody>
<tr class="claim" data-goal-coverage="true" data-quadrant="known-known" data-status="VERIFIED"><td>DoD reaches the goal</td></tr>
${rows.join('\n')}
</tbody></table>
<script type="application/json" id="dod">{"criteria":[{"id":"c1","text":"t","tier":"judged"}]}</script>
<script type="application/json" id="taskgraph">{"nodes":[],"edges":[],"levels":[]}</script>
</body></html>`;

let n = 0;
const verdictOn = (html) => {
  const f = join(TMP, `r${++n}.html`);
  writeFileSync(f, html);
  try {
    execFileSync('node', [VALIDATE, f], { stdio: 'pipe' });
    return 0;
  } catch (e) {
    return typeof e.status === 'number' ? e.status : 1;
  }
};

// SKILL.md steps, so an assertion can be scoped to the one that writes the HTML. Step 7 has
// mentioned `fix:` since #57, so a whole-file test would be GREEN on the baseline — a false-green.
const steps = skill.split(/\n(?=\s*\d+\.\s+\*\*)/);
const emitStep = steps.find((s) => /^\s*8\./.test(s)) || '';

const assertions = [
  {
    id: 'template-carries-the-disposition-slot',
    where: 'assets/template.html',
    ok: /\.fix\s*\{/.test(template) && /class="fix"/.test(specimenRow) && /\bfix:/i.test(specimenRow),
    want:
      'the claim-row specimen must carry a fix-disposition span, and the <style> block a .fix ' +
      'rule — the model writes the report FROM this template',
  },
  {
    id: 'emit-step-carries-the-disposition',
    where: 'SKILL.md step 8',
    ok: /\bfix:/.test(emitStep) && /open row/i.test(emitStep),
    want:
      'step 8 (emit the report) must restate the per-open-row disposition — step 7 alone has ' +
      'measured 4/10, because nothing reaches the model at the moment it writes the HTML',
  },
  {
    id: 'rejects-untagged-open-row',
    where: 'assets/validate.mjs',
    ok: verdictOn(report([row('UNVERIFIED')], 'GO-WITH-CONDITIONS', 1)) === 1,
    want: 'an UNVERIFIED row with no fix disposition must be REJECTED',
  },
  {
    id: 'rejects-untagged-blind-spot-row',
    where: 'assets/validate.mjs',
    ok: verdictOn(report([row('BLIND-SPOT-RISK')], 'GO-WITH-CONDITIONS', 1)) === 1,
    want: 'a BLIND-SPOT-RISK row with no fix disposition must be REJECTED',
  },
  {
    id: 'accepts-fully-tagged-report',
    where: 'assets/validate.mjs',
    // Guards against a validator that rejects everything, which would make the rest pass for the
    // wrong reason.
    ok: verdictOn(report([row('UNVERIFIED', FIX_M), row('BLIND-SPOT-RISK', FIX_D)], 'GO-WITH-CONDITIONS', 2)) === 0,
    want: 'a report whose every open row is tagged must be ACCEPTED',
  },
  {
    id: 'scoped-to-open-rows-only',
    where: 'assets/validate.mjs',
    // VERIFIED / UNSTATED-ASSUMPTION / REFUTED are not open; demanding a disposition there would
    // be noise, and REFUTED already routes through step 7's "what would have to change".
    ok: verdictOn(report([row('VERIFIED'), row('UNSTATED-ASSUMPTION'), row('REFUTED')], 'NO-GO', 0)) === 0,
    want: 'rows that are not open need no disposition — the rule must not demand one',
  },
  {
    id: 'rejects-partial-tagging',
    where: 'assets/validate.mjs',
    ok: verdictOn(report([row('UNVERIFIED', FIX_M), row('BLIND-SPOT-RISK')], 'GO-WITH-CONDITIONS', 2)) === 1,
    want: 'tagging ONE of two open rows must still be REJECTED — the rule is per row',
  },
  {
    id: 'rejects-tag-on-wrong-row',
    where: 'assets/validate.mjs',
    // THE assertion separating this from a file-level grep. The Harbor grader that measured 4/10
    // scored 1 for any `fix:` anywhere in the file; that leniency would let one tagged row excuse
    // every untagged one.
    ok: verdictOn(report([row('VERIFIED', FIX_M), row('UNVERIFIED')], 'GO-WITH-CONDITIONS', 1)) === 1,
    want:
      'a disposition on a NON-open row must not satisfy an untagged open row — a file-level ' +
      'presence test is exactly the leniency this replaces',
  },
  {
    id: 'rejects-bogus-disposition',
    where: 'assets/validate.mjs',
    ok: verdictOn(report([row('UNVERIFIED', ' <span class="fix">fix: later</span>')], 'GO-WITH-CONDITIONS', 1)) === 1,
    want: 'only "mechanical" and "needs-decision" are dispositions; "fix: later" is not one',
  },
];

const failed = assertions.filter((a) => !a.ok);
if (!failed.length) {
  console.log(
    `PASS check: every open row must carry a fix disposition, enforced per row (${assertions.length}/${assertions.length} assertions).`
  );
  process.exit(0);
}
console.error('FAIL check: the fix disposition is not enforced per open row.');
for (const a of failed) console.error(`  - [${a.id}] ${a.where}: ${a.want}`);
process.exit(1);
