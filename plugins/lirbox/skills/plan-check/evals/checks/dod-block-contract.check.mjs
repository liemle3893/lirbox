// ACCEPTANCE CHECK (RED on baseline) — plan-check's validate.mjs must enforce the #dod contract.
//
// Concern (feedback/plan-check.jsonl → dod-block-contract): a plan-check report must embed
// EXACTLY ONE <script type="application/json" id="dod"> block whose JSON is
//   { "criteria": [{ "id", "text", "tier": "checkable"|"judged", "check"? }] }
// with `check` REQUIRED iff tier is "checkable" (the machine-readable definition of done
// consumed by lirbox:conductor). Reports that violate the contract must be rejected (exit 1).
// Exact validator behavior specified in Task 5 of
//   docs/superpowers/plans/2026-07-10-dod-and-panel-review.md
//
// Each report below is otherwise contract-valid (one data-verdict matching the derived rows,
// conditions count == open rows) — the ONLY variable is the #dod block, so this check is
// independent of the sibling css-verdict concern (no <style> block in these minimal reports).
//
//   - missing #dod          → exit 1  (RED today: validator ignores #dod → exits 0)
//   - #dod tier "maybe"     → exit 1  (RED today)
//   - checkable, no "check" → exit 1  (RED today)
//   - well-formed #dod      → exit 0  (already passes today)
// Baseline: assertions 1–3 fail (those reports exit 0), so the overall check exits non-zero.
//
// Locked (evals/**): the whetstone fixer may NEVER edit this file.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(HERE, '..', '..');                       // .../skills/plan-check
const VALIDATE = resolve(SKILL_DIR, 'assets', 'validate.mjs');

// Minimal otherwise-valid report: one VERIFIED claim → derived verdict GO, 0 open, 0 conditions.
// (No <style> block on purpose — keeps this check independent of the css-verdict concern.)
// `dodBlock` is spliced in verbatim before </body>; pass '' for the missing-#dod case.
const report = (dodBlock) => `<!DOCTYPE html><html><head><meta charset="utf-8"><title>t</title></head><body>
<div class="verdict" data-verdict="GO"><span class="badge">GO</span></div>
<table><tbody>
  <tr class="claim" data-quadrant="known-known" data-status="VERIFIED"><td>a claim</td></tr>
</tbody></table>
${dodBlock}
</body></html>
`;

const dodScript = (json) => `<script type="application/json" id="dod">${json}</script>`;

const CASES = [
  { name: 'missing #dod block', dod: '', want: 1 },
  {
    name: '#dod criterion with tier "maybe"',
    dod: dodScript('{"criteria":[{"id":"ac1","text":"t","tier":"maybe"}]}'),
    want: 1,
  },
  {
    name: 'checkable criterion lacking a "check" command',
    dod: dodScript('{"criteria":[{"id":"ac1","text":"t","tier":"checkable"}]}'),
    want: 1,
  },
  {
    name: 'well-formed #dod block',
    dod: dodScript('{"criteria":[{"id":"ac1","text":"t","tier":"checkable","check":"true"},{"id":"ac2","text":"j","tier":"judged"}]}'),
    want: 0,
  },
];

const exitCode = (file) => {
  try {
    execFileSync('node', [VALIDATE, file], { encoding: 'utf8', stdio: 'pipe' });
    return 0;
  } catch (e) {
    if (typeof e.status === 'number') return e.status;
    console.error(`check: validate.mjs failed to run: ${e.message}`);
    process.exit(2);   // harness error, not a verdict
  }
};

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) failures++;
};

const dir = mkdtempSync(join(tmpdir(), 'dod-block-contract-'));
try {
  for (const [i, c] of CASES.entries()) {
    const file = join(dir, `case-${i}.html`);
    writeFileSync(file, report(c.dod));
    const got = exitCode(file);
    ok(got === c.want, `${c.name} → exit ${c.want} (got ${got})`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (failures) {
  console.error(`\ncheck RED: ${failures} assertion(s) failed — validate.mjs does not enforce the #dod contract.`);
  process.exit(1);
}
console.log('\ncheck GREEN: validate.mjs enforces the #dod block contract.');
process.exit(0);
