// ACCEPTANCE CHECK (RED on baseline) — plan-check's authoring surfaces must carry the DoD.
//
// Concern (feedback/plan-check.jsonl → dod-template-and-audit): the report contract now requires a
// machine-readable definition-of-done (#dod) block, but the surfaces that AUTHOR a report must teach
// and template it too. Task 6 of docs/superpowers/plans/2026-07-10-dod-and-panel-review.md adds:
//   1. template.html  — a machine-readable `id="dod"` block AND a visible "Definition of done" heading;
//   2. blind-spot.md  — a "No definition of done" entry in the "Any plan" list;
//   3. SKILL.md       — the `#dod` block named in the emit step AND the Quality-bar rule "A DoD or no clean GO".
//   4. template.html stays SELF-CONTAINED — no external <script src>/<link>/http(s) resource — so the
//      existing floor + copy-button characterizations remain unthreatened. This one PASSES on baseline
//      and must KEEP passing after the fix.
//
// Passes iff all four hold.
//   - baseline (no DoD in template/blind-spot/SKILL.md) → assertions 1-3 RED → exit 1 (the discrimination gate wants this)
//   - after the Task 6 fix                              → all GREEN          → exit 0
//
// Locked (evals/**): the whetstone fixer may NEVER edit this file.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(HERE, '..', '..');                       // .../skills/plan-check
const TEMPLATE = resolve(SKILL_DIR, 'assets', 'template.html');
const BLIND_SPOT = resolve(SKILL_DIR, 'references', 'blind-spot.md');
const SKILL = resolve(SKILL_DIR, 'SKILL.md');

let template, blindSpot, skill;
try {
  template = readFileSync(TEMPLATE, 'utf8');
  blindSpot = readFileSync(BLIND_SPOT, 'utf8');
  skill = readFileSync(SKILL, 'utf8');
} catch (e) {
  console.error(`check: could not read a plan-check source file: ${e.message}`);
  process.exit(2);   // harness error, not a verdict
}

let failed = 0;
function ok(cond, msg) {
  if (cond) { console.log(`  ok   ${msg}`); }
  else { console.error(`  FAIL ${msg}`); failed++; }
}

// 1. template.html — machine-readable #dod block + a visible "Definition of done" heading.
ok(/id="dod"/.test(template),
  'template.html carries the machine-readable id="dod" block');
ok(/<h2[^>]*>\s*Definition of done\s*<\/h2>/i.test(template),
  'template.html has a visible "Definition of done" heading');

// 2. blind-spot.md — the missing-DoD entry.
ok(/No definition of done/.test(blindSpot),
  'blind-spot.md lists a "No definition of done" entry');

// 3. SKILL.md — names the #dod block and carries the Quality-bar rule.
ok(/#dod/.test(skill),
  'SKILL.md names the #dod block');
ok(/A DoD or no clean GO/.test(skill),
  'SKILL.md Quality bar carries "A DoD or no clean GO"');

// 4. template.html stays self-contained (must PASS on baseline AND after the fix).
const externals = [
  [/<script\b[^>]*\bsrc\s*=/i, 'external <script src=>'],
  [/<link\b[^>]*\brel\s*=\s*["']?stylesheet/i, '<link rel=stylesheet>'],
  [/\b(?:src|href)\s*=\s*["']https?:/i, 'http(s) resource URL in a src/href attribute'],
];
const offenders = externals.filter(([re]) => re.test(template)).map(([, label]) => label);
ok(offenders.length === 0,
  `template.html is self-contained (no ${offenders.join(', ') || 'external resources'})`);

if (failed) {
  console.error(`\ncheck RED: ${failed} assertion(s) failed — plan-check's authoring surfaces do not carry the DoD yet.`);
  process.exit(1);
}
console.log('\ncheck GREEN: template + blind-spot.md + SKILL.md carry the DoD, template stays self-contained.');
process.exit(0);
