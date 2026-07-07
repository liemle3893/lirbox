// SKILL-TRAIN task (TRAIN split). The generated conductor carries the spec loop structure:
// a meta block, phases, agent() workers, and a final return. Grades scripts/scaffold-optimize.cjs.
// PASSES on baseline.
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const GEN = resolve(HERE, '..', '..', '..', 'scripts', 'scaffold-optimize.cjs');
const out = join(tmpdir(), `ptask-struct-${process.pid}.js`);

const ok = (c, m) => { if (!c) { console.error('FAIL ' + m); process.exit(1); } };
execFileSync('node', [GEN, '--name', 'probe-struct', '--out', out], { stdio: 'pipe' });
const src = readFileSync(out, 'utf8');
ok(/export const meta\s*=/.test(src), 'conductor declares a meta block');
ok(/phase\(/.test(src), 'conductor drives phases');
ok(/agent\(/.test(src), 'conductor spawns agent() workers');
ok(/return \{/.test(src), 'conductor finalizes with a return');
console.log('11-loop-structure: ok');
