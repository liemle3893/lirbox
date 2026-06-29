#!/usr/bin/env node
// ACCEPTANCE CHECK — id=steplist-missing-fromto
// RED on the current validator; GREEN only after it learns to reject a STEPLIST entry
// missing `from` or `to`. The detail panel's who→who chip needs BOTH; today the validator
// only counts `title:` keys and never inspects from/to, so a half-populated entry slips by.
//
// Fixture: evals/fixtures/steplist-missing-fromto.html — a copy of clean.html where ONE
// STEPLIST entry has had its `from`/`to` removed (otherwise fully valid; message↔STEPLIST
// parity preserved). The ONLY latent defect is the missing who→who.
//
// Passes (exit 0) IFF: the validator exits 1 on the fixture AND its output names the defect
// (mentions from/to). Otherwise exits 1.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = process.cwd();
const VALIDATOR = join('plugins', 'lirbox', 'skills', 'sequence-diagram', 'assets', 'validate.mjs');
const FIXTURE = join('plugins', 'lirbox', 'skills', 'sequence-diagram', 'evals', 'fixtures', 'steplist-missing-fromto.html');
const KEYWORD = /from|to\b/i;

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
  console.log('GREEN  steplist-missing-fromto — validator rejects an entry missing from/to');
  process.exit(0);
}
console.error('RED  steplist-missing-fromto — validator does NOT flag a STEPLIST entry missing from/to');
console.error(`     validator exit=${code}, keyword(${KEYWORD}) matched=${KEYWORD.test(out)}`);
console.error(`     --- validator output ---\n${out.trim()}`);
process.exit(1);
