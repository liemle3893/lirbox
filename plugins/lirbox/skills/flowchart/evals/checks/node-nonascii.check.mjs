// ITEM-A ACCEPTANCE-CHECK — FAILS on the unmodified baseline (fail-before / pass-after).
//
// Deviation 1 (see implementation-notes/floordryrun.html): this lives under evals/checks/,
// NOT in run.mjs, precisely because it must NOT pass on baseline. The floor (run.mjs) must
// stay green on baseline; this check must be RED on baseline so the discrimination gate
// (check-baseline.cjs) accepts it.
//
// It asserts validate.mjs FAILS a fixture whose ONLY non-ASCII character is in a NODE label
// (A[Cost—high], no edge labels). On baseline validate.mjs:58 checks non-ASCII for EDGE
// labels only, so it PASSES that fixture → this check FAILS on baseline (discriminating).
// It goes green only once the real fix extends the non-ASCII check to node labels — a fix a
// future TOP-LEVEL whetstone run must make. We deliberately DO NOT fix validate.mjs here.
//
// Locked (evals/**): the fixer may never edit this file.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const VALIDATE = join(HERE, '..', '..', 'assets', 'validate.mjs');
const FIXTURE = join(HERE, '..', 'fixtures', 'node-nonascii.html');

function validateExit() {
  try {
    execFileSync('node', [VALIDATE, FIXTURE], { stdio: 'pipe' });
    return 0;
  } catch (e) {
    return typeof e.status === 'number' ? e.status : 1;
  }
}

const exit = validateExit();
if (exit === 1) {
  console.log('PASS check: non-ASCII em-dash in a NODE label is flagged (exit 1).');
  process.exit(0);
}
console.error(
  'FAIL check: non-ASCII em-dash in a NODE label slipped through (validate.mjs exit ' +
    exit +
    '). validate.mjs only checks non-ASCII for EDGE labels — extend it to node labels.'
);
process.exit(1);
