// FLOOR (characterization) — PASSES on baseline; pins: plan-check's validator must not count CSS as verdicts.
// Promoted from evals/checks/ after whetstone run plan-check-20260710-003245 merged (backlog item of the same name).
//
// Concern (feedback/plan-check.jsonl → validate-counts-css-verdict): assets/validate.mjs matches
// /data-verdict="..."/g across the WHOLE file, so the six `.verdict[data-verdict="..."]` attribute
// selectors in template.html's <style> block are counted as verdict elements. A real report rendered
// from the template (keeping the full <style>, as the skill's step 8 requires) fails its OWN validator
// with "expected exactly one data-verdict, found 7". The fix scopes the verdict/contract checks to the
// body / real elements so the CSS selectors don't inflate the count.
//
// The fixture below is a COMPLETE, contract-satisfying render of template.html (full <style> kept
// verbatim, one real .verdict element, matched claim rows + conditions). It is valid EXCEPT for the
// bug under test, so validate.mjs's only complaint on baseline is the inflated data-verdict count.
//   - baseline (whole-file scan) → found 7 → validate exits 1 → this check exits 1 (RED)
//   - after the fix (body-scoped) → found 1 → validate exits 0 → this check exits 0 (GREEN)
//
// Frozen fixture: it must NOT read/transform the live template (that gets edited by sibling fixes).
// It also carries a machine-readable <script id="dod"> block that today's validator ignores but a
// sibling concern will make REQUIRED — this frozen fixture must stay valid after that fix lands.
//
// Locked (evals/**): the whetstone fixer may NEVER edit this file.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(HERE, '..', '..');                       // .../skills/plan-check
const VALIDATE = resolve(SKILL_DIR, 'assets', 'validate.mjs');
const FIXTURE = resolve(HERE, '..', 'fixtures', 'full-template-render.html');

let failed = 0;
const ok = (cond, label, detail) => {
  if (cond) {
    console.log(`  ok   ${label}`);
  } else {
    failed++;
    console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

// --- Fixture sanity: it must not be quietly gutted into passing trivially. ---
let html;
try {
  html = readFileSync(FIXTURE, 'utf8');
} catch (e) {
  console.error(`check: cannot read fixture ${FIXTURE}: ${e.message}`);
  process.exit(2);
}

const styleBlock = (html.match(/<style\b[^>]*>([\s\S]*?)<\/style>/i) || [])[1] || '';
const cssVerdictSelectors = (styleBlock.match(/\[data-verdict=/g) || []).length;
ok(cssVerdictSelectors >= 3,
   `fixture keeps ≥3 [data-verdict= CSS selectors in <style> (the whole point)`,
   `found ${cssVerdictSelectors}`);
ok(/id="dod"/.test(html),
   `fixture carries the machine-readable DoD block (id="dod")`);

// --- The real assertion: a full render passes its own validator (exit 0). ---
let code = 0;
let stderr = '';
try {
  const out = execFileSync('node', [VALIDATE, FIXTURE], { encoding: 'utf8' });
  console.log(`  validate.mjs → ${out.trim()}`);
} catch (e) {
  code = typeof e.status === 'number' ? e.status : 1;
  stderr = (e.stderr || '').toString();
}
ok(code === 0,
   `validate.mjs accepts the full-template render (exit 0)`,
   code !== 0 ? `exit ${code}; validator said:\n${stderr.trim().split('\n').map((l) => `      ${l}`).join('\n')}` : '');

if (failed) {
  console.error(`\ncheck RED: ${failed} assertion(s) failed.`);
  process.exit(1);
}
console.log('\ncheck GREEN: validate.mjs no longer counts CSS attribute selectors as verdict elements.');
process.exit(0);
