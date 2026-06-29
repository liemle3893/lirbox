// ACCEPTANCE-CHECK — FAILS on the unmodified baseline (fail-before / pass-after).
//
// Concern: validate.mjs should FLAG an orphan node — a graph node id with NO `click` line
// AND no `STEPS` entry, i.e. an uninspectable component. The docs say "Every component the
// reader can inspect needs a click line and a matching STEPS entry", but the validator only
// checks the click→STEPS direction; a node that has neither is invisible to it. The fixture
// adds `metrics[Metrics Sink]` (real node, a typed edge `orders -->|emits| metrics`) with no
// click line and no STEPS key; everything else stays valid (validates clean today).
//
// RED on baseline: validate.mjs has no node→inspectability rule → exits 0 on the fixture →
// this check FAILS. It goes GREEN only once a future fix flags graph nodes lacking both a
// click and a STEPS entry (keyword: /orphan|no click|uninspectable/i). We do NOT fix here.
//
// Locked (evals/**): the fixer may never edit this file.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = process.cwd();
const VALIDATE = join(ROOT, 'plugins/lirbox/skills/component-diagram/assets/validate.mjs');
const FIXTURE = join(ROOT, 'plugins/lirbox/skills/component-diagram/evals/fixtures/orphan-node.html');

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
if (status === 1 && /orphan|no click|uninspectable/i.test(out)) {
  console.log('PASS check: an orphan node (no click + no STEPS entry) is flagged (exit 1).');
  process.exit(0);
}
console.error(
  'FAIL check: orphan node `metrics` (no click line, no STEPS entry) slipped through ' +
    `(validator exit ${status}; matched keyword: ` +
    `${/orphan|no click|uninspectable/i.test(out)}). ` +
    'validate.mjs must flag a graph node id that has neither a click line nor a STEPS entry.'
);
process.exit(1);
