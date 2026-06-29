#!/usr/bin/env node
// ACCEPTANCE CHECK — id=unbalanced-activation
// RED on the current validator; GREEN only after it learns to flag an unbalanced activation
// bar — an opening `->>+` (or `activate X`) with no matching closing `-->>-` (or `deactivate
// X`). Mermaid renders this broken (the activation never closes), but today the validator's
// ARROW regex accepts the `+`/`-` suffix and never balances them.
//
// Fixture: evals/fixtures/unbalanced-activation.html — a copy of clean.html where one message
// opens an activation (`API->>+DB`) that is never closed (the return is a plain `DB-->>API`,
// no `-`). Arrow count and message↔STEPLIST parity are preserved; the ONLY latent defect is
// the dangling activation.
//
// Passes (exit 0) IFF: the validator exits 1 on the fixture AND its output names the defect
// (mentions activation/activate/unbalanced). Otherwise exits 1.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = process.cwd();
const VALIDATOR = join('plugins', 'lirbox', 'skills', 'sequence-diagram', 'assets', 'validate.mjs');
const FIXTURE = join('plugins', 'lirbox', 'skills', 'sequence-diagram', 'evals', 'fixtures', 'unbalanced-activation.html');
const KEYWORD = /activation|activate|unbalanced/i;

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
  console.log('GREEN  unbalanced-activation — validator flags the dangling activation bar');
  process.exit(0);
}
console.error('RED  unbalanced-activation — validator does NOT flag an unclosed activation bar');
console.error(`     validator exit=${code}, keyword(${KEYWORD}) matched=${KEYWORD.test(out)}`);
console.error(`     --- validator output ---\n${out.trim()}`);
process.exit(1);
