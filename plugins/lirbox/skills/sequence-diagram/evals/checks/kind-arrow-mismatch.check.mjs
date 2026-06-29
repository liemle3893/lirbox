#!/usr/bin/env node
// ACCEPTANCE CHECK — id=kind-arrow-mismatch
// RED on the current validator; GREEN only after it learns to flag a STEPLIST entry whose
// `kind` contradicts the arrow it maps to (e.g. kind:"return" on a solid sync `->>` message,
// or kind:"sync" on a dashed `-->>` return). The list maps 1:1 to the diagram, so a wrong
// `kind` mislabels the chip; today the validator never cross-checks kind against the arrow.
//
// Fixture: evals/fixtures/kind-arrow-mismatch.html — a copy of clean.html where STEPLIST[0]
// (which maps to the solid sync `U->>API` message) is mislabeled kind:"return". Message↔
// STEPLIST parity is preserved; the ONLY latent defect is the kind/arrow contradiction.
//
// Passes (exit 0) IFF: the validator exits 1 on the fixture AND its output names the defect
// (mentions kind/arrow/mismatch). Otherwise exits 1.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = process.cwd();
const VALIDATOR = join('plugins', 'lirbox', 'skills', 'sequence-diagram', 'assets', 'validate.mjs');
const FIXTURE = join('plugins', 'lirbox', 'skills', 'sequence-diagram', 'evals', 'fixtures', 'kind-arrow-mismatch.html');
const KEYWORD = /kind|arrow|mismatch/i;

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
  console.log('GREEN  kind-arrow-mismatch — validator flags the kind/arrow contradiction');
  process.exit(0);
}
console.error('RED  kind-arrow-mismatch — validator does NOT flag a kind that contradicts its arrow');
console.error(`     validator exit=${code}, keyword(${KEYWORD}) matched=${KEYWORD.test(out)}`);
console.error(`     --- validator output ---\n${out.trim()}`);
process.exit(1);
