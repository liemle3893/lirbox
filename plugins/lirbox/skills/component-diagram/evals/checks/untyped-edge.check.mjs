// ACCEPTANCE-CHECK — FAILS on the unmodified baseline (fail-before / pass-after).
//
// Concern: validate.mjs should FLAG an untyped dependency edge — a `-->` or `-.->`
// between two nodes with NO `|label|`. The skill's own docs (references/components.md)
// say "Every edge says what the dependency is — label it." but the validator never
// enforces it. The fixture's ONLY latent defect is one unlabelled edge (`auth --> pg`);
// every other edge is typed and the file is otherwise fully valid (validates clean today).
//
// RED on baseline: validate.mjs has no untyped-edge rule → exits 0 on the fixture → this
// check FAILS. It goes GREEN only once a future fix adds a rule that flags unlabelled
// edges (keyword: /untyped|unlabel/i). We deliberately DO NOT fix validate.mjs here.
//
// Locked (evals/**): the fixer may never edit this file.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = process.cwd();
const VALIDATE = join(ROOT, 'plugins/lirbox/skills/component-diagram/assets/validate.mjs');
const FIXTURE = join(ROOT, 'plugins/lirbox/skills/component-diagram/evals/fixtures/untyped-edge.html');

function runValidator() {
  try {
    const out = execFileSync('node', [VALIDATE, FIXTURE], { encoding: 'utf8' });
    return { status: 0, out };
  } catch (e) {
    return {
      status: typeof e.status === 'number' ? e.status : 1,
      out: `${e.stdout || ''}${e.stderr || ''}`,
    };
  }
}

const { status, out } = runValidator();
if (status === 1 && /untyped|unlabel/i.test(out)) {
  console.log('PASS check: an untyped (unlabelled) dependency edge is flagged (exit 1).');
  process.exit(0);
}
console.error(
  'FAIL check: an untyped (unlabelled) edge `auth --> pg` slipped through ' +
    `(validator exit ${status}; matched keyword: ${/untyped|unlabel/i.test(out)}). ` +
    'validate.mjs must flag `-->`/`-.->` edges that carry no `|label|`.'
);
process.exit(1);
