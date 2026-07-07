// SKILL-TRAIN TASK — raw specials in a ROUND (..) node label must be flagged; only [..] and {..} labels are extracted today
// Exit 0 iff the behavior holds. Locked (evals/**): a loop worker may NEVER edit this file or its fixture.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const HERE = dirname(fileURLToPath(import.meta.url));
const VALIDATE = join(HERE, '..', '..', '..', 'assets', 'validate.mjs');
const FIXTURE = join(HERE, '..', '..', 'fixtures', 'round-node-special.html');
let exit = 0;
try { execFileSync('node', [VALIDATE, FIXTURE], { stdio: 'pipe' }); } catch (e) { exit = typeof e.status === 'number' ? e.status : 1; }
if (exit === 0) { console.error('FAIL task: validate.mjs did NOT flag round-node-special.html — raw specials in a ROUND (..) node label must be flagged; only [..] and {..} labels are extracted today'); process.exit(1); }
console.log('PASS task: validate.mjs flags round-node-special.html');
