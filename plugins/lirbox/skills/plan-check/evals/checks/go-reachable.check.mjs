// ACCEPTANCE-CHECK (DOC concern) — a clean GO must be reachable, and the interview must be finite.
//
// Concern (2026-10-26), two rules that together made GO practically unreachable:
//   * the blind-spot pass is mandatory and every BLIND-SPOT-RISK row is open, so a pass that lists
//     generic risks ("what if the network fails?") downgrades every plan to GO-WITH-CONDITIONS;
//   * SKILL.md's non-negotiable demanded EVERY askable open row be asked, one at a time, before a
//     verdict, while interrogation.md rule 2 said to "defer or drop" questions that cannot change
//     it — a contradiction, and N round-trips for N open rows.
//
// The invariant: a blind-spot row is specific to this plan; the interview asks what could change
// the verdict, and everything else stays open as a condition-to-clear. Both docs say the same.
//
// Locked (evals/**): the fixer may never edit this file.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const P = 'plugins/lirbox/skills/plan-check';
const read = (env, rel) => {
  const p = process.env[env] || join(ROOT, P, rel);
  try {
    return readFileSync(p, 'utf8');
  } catch (e) {
    console.error(`FAIL check: cannot read ${p}: ${e.message}`);
    process.exit(1);
  }
};
const skill = read('PLAN_CHECK_SKILL_MD', 'SKILL.md');
const blind = read('PLAN_CHECK_BLIND_SPOT_MD', 'references/blind-spot.md');
const interview = read('PLAN_CHECK_INTERROGATION_MD', 'references/interrogation.md');

const gate = (skill.match(/<non-negotiable>\s*No verdict[\s\S]*?<\/non-negotiable>/) || [''])[0];
const blindIntro = blind.split(/^## /m)[0];
const rule2 = (interview.match(/^2\.[\s\S]*?(?=^\d+\.)/m) || [''])[0];

const assertions = [
  {
    id: 'blind-spots-are-plan-specific',
    where: 'references/blind-spot.md',
    ok: /specific to this plan/i.test(blindIntro) && /every plan/i.test(blindIntro),
    want: 'the blind-spot intro must reject risks that would apply to every plan',
  },
  {
    id: 'gate-asks-only-verdict-changing',
    where: 'SKILL.md non-negotiable',
    ok: /could change the verdict/i.test(gate) && /condition-to-clear/i.test(gate) &&
        !/any UNVERIFIED proposition is still/i.test(gate),
    want: 'the gate must block only on verdict-changing askable rows; the rest stay conditions',
  },
  {
    id: 'interview-rule-agrees-with-gate',
    where: 'references/interrogation.md rule 2',
    ok: /change the verdict/i.test(rule2) && /condition-to-clear/i.test(rule2) && !/drop/i.test(rule2),
    want: 'rule 2 must say a non-verdict-changing question is not asked and its row stays a condition — not "drop" it',
  },
];

const failed = assertions.filter((a) => !a.ok);
if (!failed.length) {
  console.log(`PASS check: GO is reachable and the interview is bounded (${assertions.length}/${assertions.length}).`);
  process.exit(0);
}
console.error('FAIL check: GO is unreachable or the interview rules contradict.');
for (const a of failed) console.error(`  - [${a.id}] ${a.where}: ${a.want}`);
process.exit(1);
