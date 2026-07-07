// SKILL-TRAIN TASK — non-ASCII in a dash-form edge label — held-out generalization of the train gap
// Exit 0 iff the behavior holds. Locked (evals/**): a loop worker may NEVER edit this file or its fixture.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const HERE = dirname(fileURLToPath(import.meta.url));
const VALIDATE = join(HERE, '..', '..', '..', 'assets', 'validate.mjs');
const FIXTURE = join(HERE, '..', '..', 'fixtures', 'val-edge-dashlabel.html');
let exit = 0;
try { execFileSync('node', [VALIDATE, FIXTURE], { stdio: 'pipe' }); } catch (e) { exit = typeof e.status === 'number' ? e.status : 1; }
if (exit === 0) { console.error('FAIL task: validate.mjs did NOT flag val-edge-dashlabel.html — non-ASCII in a dash-form edge label — held-out generalization of the train gap'); process.exit(1); }
console.log('PASS task: validate.mjs flags val-edge-dashlabel.html');
