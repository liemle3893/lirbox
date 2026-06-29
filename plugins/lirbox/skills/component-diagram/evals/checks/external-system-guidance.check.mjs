// ACCEPTANCE-CHECK (DOC concern) — FAILS on the unmodified baseline (fail-before / pass-after).
//
// Concern: references/components.md must document how to mark an external / third-party system
// distinctly (e.g. an `:::external` classDef or a dedicated convention). Today the doc covers
// :::boundary / :::store / :::crit but says nothing about external systems, so an author has no
// guided way to set a third-party dependency apart from a first-party component.
//
// This is a pure doc check — no fixture. It reads references/components.md and requires BOTH:
//   (a) the doc TALKS about external / third-party systems   — /external|third[- ]?party/i
//   (b) it gives a concrete MARKING convention               — /:::external|classDef\s+\w*ext/i
//
// RED on baseline: the doc mentions neither → this check FAILS. It goes GREEN only once the doc
// adds external-system guidance with a marking convention. We do NOT edit the doc here.
//
// Locked (evals/**): the fixer may never edit this file.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const DOC = join(ROOT, 'plugins/lirbox/skills/component-diagram/references/components.md');

let text;
try {
  text = readFileSync(DOC, 'utf8');
} catch (e) {
  console.error(`FAIL check: cannot read ${DOC}: ${e.message}`);
  process.exit(1);
}

const mentionsExternal = /external|third[- ]?party/i.test(text);
const hasConvention = /:::external|classDef\s+\w*ext/i.test(text);

if (mentionsExternal && hasConvention) {
  console.log('PASS check: components.md documents external/third-party systems with a marking convention.');
  process.exit(0);
}
console.error(
  'FAIL check: components.md lacks external-system guidance ' +
    `(mentions external/third-party: ${mentionsExternal}; has marking convention ` +
    `:::external|classDef *ext*: ${hasConvention}). ` +
    'Document how to mark an external/third-party system distinctly (e.g. a :::external classDef).'
);
process.exit(1);
