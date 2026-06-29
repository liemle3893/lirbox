#!/usr/bin/env node
// ACCEPTANCE CHECK — id=steplist-missing-kind
// RED on the current validator; GREEN only after it learns to reject a STEPLIST entry missing
// the `kind` field. `kind` ("sync" | "return" | "async") labels the message in the detail
// panel; today the validator only counts `title:` keys and never requires `kind`.
//
// Fixture: evals/fixtures/steplist-missing-kind.html — a copy of clean.html where ONE STEPLIST
// entry has had its `kind` removed (from/to retained; otherwise fully valid; message↔STEPLIST
// parity preserved). The ONLY latent defect is the missing `kind`.
//
// Passes (exit 0) IFF: the validator exits 1 on the fixture AND its output names the defect
// (mentions kind). Otherwise exits 1.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = process.cwd();
const VALIDATOR = join('plugins', 'lirbox', 'skills', 'sequence-diagram', 'assets', 'validate.mjs');
const FIXTURE = join('plugins', 'lirbox', 'skills', 'sequence-diagram', 'evals', 'fixtures', 'steplist-missing-kind.html');
const KEYWORD = /\bkind\b/i;

function runValidator() {
  try {
    const stdout = execFileSync('node', [VALIDATOR, FIXTURE], { cwd: ROOT, encoding: 'utf8' });
    return { code: 0, out: stdout };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

const { code, out } = runValidator();
if (code === 1 && KEYWORD.test(out)) {
  console.log('GREEN  steplist-missing-kind — validator rejects an entry missing kind');
  process.exit(0);
}
console.error('RED  steplist-missing-kind — validator does NOT flag a STEPLIST entry missing kind');
console.error(`     validator exit=${code}, keyword(${KEYWORD}) matched=${KEYWORD.test(out)}`);
console.error(`     --- validator output ---\n${out.trim()}`);
process.exit(1);
