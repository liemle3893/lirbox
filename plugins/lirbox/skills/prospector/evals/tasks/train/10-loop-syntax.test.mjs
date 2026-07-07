// SKILL-TRAIN task (TRAIN split — failures may be shown to the propose worker).
// The generated optimization conductor is syntactically valid JS (`node --check` passes).
// Grades prospector's output surface: scripts/scaffold-optimize.cjs. PASSES on baseline.
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const GEN = resolve(HERE, '..', '..', '..', 'scripts', 'scaffold-optimize.cjs');
const out = join(tmpdir(), `ptask-syntax-${process.pid}.js`);

const ok = (c, m) => { if (!c) { console.error('FAIL ' + m); process.exit(1); } };
try {
  execFileSync('node', [GEN, '--name', 'probe-syntax', '--out', out], { stdio: 'pipe' });
  execFileSync('node', ['--check', out], { stdio: 'pipe' });
  ok(true, 'generated conductor is valid JS');
} catch (e) {
  console.error('generation or syntax check threw: ' + e.message);
  process.exit(1);
}
console.log('10-loop-syntax: ok');
