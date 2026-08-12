// Floor: the state machine still refuses what it claims to refuse.
// Delegates to the skill's own node --test suite rather than restating it — that suite SHOWS every
// illegal pair refused instead of asserting it, which is the part worth keeping green.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const suite = join(here, '..', '..', 'scripts', 'test-transitions.mjs');

try {
  execFileSync(process.execPath, ['--test', suite], { stdio: 'pipe', timeout: 60_000 });
} catch (e) {
  const out = String(e.stdout || '') + String(e.stderr || '');
  throw new Error(`test-transitions.mjs failed (exit ${e.status})\n${out.split('\n').slice(-15).join('\n')}`);
}
