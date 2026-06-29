// ACCEPTANCE-CHECK — FAILS on the unmodified baseline (fail-before / pass-after).
//
// Concern: validate.mjs should REJECT the exotic node shapes the docs forbid. The docs
// (references/components.md) say "Rectangles only ... do not use exotic shapes
// (id([stadium]), id[(cylinder)], id[/parallelogram/])." The validator rejects diamonds
// `id{…}` outright, but stadium `id([Label])` and parallelogram `id[/Label/]` slip through.
// The fixture turns two rectangles into a stadium (`auth([Auth Service])`) and a
// parallelogram (`orders[/Orders Service/]`); it is otherwise fully valid (validates clean
// today). A cylinder is intentionally NOT used — `id[(Label)]` already trips the raw-paren
// escaping rule, so it would not isolate THIS concern.
//
// RED on baseline: validate.mjs has no shape-allowlist rule → exits 0 on the fixture → this
// check FAILS. It goes GREEN only once a future fix rejects non-rectangle shapes
// (keyword: /shape|rectangle|exotic|stadium|parallelogram/i). We do NOT fix validate.mjs here.
//
// Locked (evals/**): the fixer may never edit this file.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = process.cwd();
const VALIDATE = join(ROOT, 'plugins/lirbox/skills/component-diagram/assets/validate.mjs');
const FIXTURE = join(ROOT, 'plugins/lirbox/skills/component-diagram/evals/fixtures/exotic-shape-rejected.html');

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
if (status === 1 && /shape|rectangle|exotic|stadium|parallelogram/i.test(out)) {
  console.log('PASS check: exotic node shapes (stadium / parallelogram) are rejected (exit 1).');
  process.exit(0);
}
console.error(
  'FAIL check: exotic shapes `auth([…])` (stadium) and `orders[/…/]` (parallelogram) ' +
    `slipped through (validator exit ${status}; matched keyword: ` +
    `${/shape|rectangle|exotic|stadium|parallelogram/i.test(out)}). ` +
    'validate.mjs must reject any node shape that is not a plain rectangle id[Label].'
);
process.exit(1);
