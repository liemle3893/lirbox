#!/usr/bin/env node
// ACCEPTANCE CHECK — id=retry-backoff-guidance  (DOC concern — no fixture)
// RED on the current docs; GREEN only after references/components.md shows how to model a
// retry-with-backoff interaction: a `loop` with an explicit exit/`break` condition AND a
// per-attempt backoff/delay. Today the Blocks section documents a bare `loop` with no exit
// and no backoff, so an author has no pattern to copy for the most common resilience flow.
//
// Passes (exit 0) IFF components.md documents retry-with-backoff — evidence of all three:
//   1. retry           (/retry/i)
//   2. backoff/delay   (/backoff|back-off|delay/i)
//   3. an exit/break    (/break|exit|until/i)
// Otherwise exits 1.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const DOC = join('plugins', 'lirbox', 'skills', 'sequence-diagram', 'references', 'components.md');

let text;
try {
  text = readFileSync(join(ROOT, DOC), 'utf8');
} catch (e) {
  console.error(`RED  retry-backoff-guidance — cannot read ${DOC}: ${e.message}`);
  process.exit(1);
}

const hasRetry = /retry/i.test(text);
const hasBackoff = /backoff|back-off|delay/i.test(text);
const hasExit = /break|exit|until/i.test(text);

if (hasRetry && hasBackoff && hasExit) {
  console.log('GREEN  retry-backoff-guidance — components.md documents retry-with-backoff (loop + exit + delay)');
  process.exit(0);
}
console.error('RED  retry-backoff-guidance — components.md lacks a retry-with-backoff pattern');
console.error(`     retry=${hasRetry}  backoff/delay=${hasBackoff}  break/exit/until=${hasExit}`);
console.error('     Need a `loop` with an explicit exit/break condition AND a per-attempt backoff/delay.');
process.exit(1);
