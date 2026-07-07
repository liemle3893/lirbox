// SKILL-TRAIN task (VAL split — HELD OUT: the keep decision runs here; never shown to the worker).
// The generated conductor is PURE at the loop layer: no require/fs/Date/Math.random — every
// side-effect lives inside an agent() worker prompt. Grades scripts/scaffold-optimize.cjs.
// PASSES on baseline.
//
// Scan the EXECUTING body only: slice from `const CONFIG` (drop the meta block) and strip every
// agent(`…`) template literal (worker instructions are strings, not conductor code) before matching
// — mirrors the conductorBody() scan in scripts/test-optimize.cjs so prompt text can't false-trip.
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const GEN = resolve(HERE, '..', '..', '..', 'scripts', 'scaffold-optimize.cjs');
const out = join(tmpdir(), `ptask-purity-${process.pid}.js`);

const ok = (c, m) => { if (!c) { console.error('FAIL ' + m); process.exit(1); } };
execFileSync('node', [GEN, '--name', 'probe-purity', '--out', out], { stdio: 'pipe' });
const src = readFileSync(out, 'utf8');
const body = src.slice(src.indexOf('const CONFIG')).replace(/`(?:[^`\\]|\\.)*`/g, '""');

const FORBIDDEN = [['require(', /\brequire\s*\(/], ['fs.', /\bfs\./], ['Date.now', /\bDate\.now\s*\(/],
  ['new Date', /\bnew Date\b/], ['Math.random', /\bMath\.random\s*\(/]];
for (const [name, re] of FORBIDDEN) ok(!re.test(body), `conductor layer is free of ${name}`);
console.log('20-conductor-purity: ok');
