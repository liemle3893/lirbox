// Characterization: the skill's own regression net (generators + helpers + readiness scaffold)
// must stay green. Pins directory-mode scaffold-readiness behavior among everything else — a fix
// that extends the scripts may add behavior but must not regress this.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(HERE, '..', '..');
try {
  execFileSync('node', [join(SKILL_DIR, 'scripts', 'test-improve.cjs')], { stdio: 'inherit', timeout: 120000 });
} catch {
  console.error('FAIL floor: scripts/test-improve.cjs regression net is red');
  process.exit(1);
}
console.log('PASS floor: test-improve.cjs green');
