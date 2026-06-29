// ACCEPTANCE-CHECK — FAILS on the unmodified baseline (fail-before / pass-after).
//
// Concern: validate.mjs should FLAG a `STEPS` key that matches NO graph node id — a dangling
// panel entry. Today it only checks the click→STEPS direction (every click target has a STEPS
// entry); it never checks STEPS→node, so a STEPS key for a non-existent node passes silently.
// The fixture adds a `ghost:` STEPS entry with no matching graph node and no click line;
// click↔STEPS parity and DEFAULT_NODE stay intact, so the file is otherwise fully valid
// (validates clean today).
//
// RED on baseline: validate.mjs has no STEPS→node rule → exits 0 on the fixture → this check
// FAILS. It goes GREEN only once a future fix flags STEPS keys with no matching node
// (keyword: /STEPS.*(no (node|match)|dangling|orphan)/i). We do NOT fix validate.mjs here.
//
// Locked (evals/**): the fixer may never edit this file.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = process.cwd();
const VALIDATE = join(ROOT, 'plugins/lirbox/skills/component-diagram/assets/validate.mjs');
const FIXTURE = join(ROOT, 'plugins/lirbox/skills/component-diagram/evals/fixtures/steps-orphan-key.html');

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

const KEYWORD = /STEPS.*(no (node|match)|dangling|orphan)/i;
const { status, out } = runValidator();
if (status === 1 && KEYWORD.test(out)) {
  console.log('PASS check: a dangling STEPS key (no matching graph node) is flagged (exit 1).');
  process.exit(0);
}
console.error(
  'FAIL check: dangling STEPS key `ghost` (no matching graph node id) slipped through ' +
    `(validator exit ${status}; matched keyword: ${KEYWORD.test(out)}). ` +
    'validate.mjs checks click->STEPS but not STEPS->node; it must flag STEPS keys with no node.'
);
process.exit(1);
