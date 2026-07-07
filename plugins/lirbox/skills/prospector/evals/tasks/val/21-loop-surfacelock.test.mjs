// SKILL-TRAIN task (VAL split — HELD OUT). The generated conductor carries the anti-gaming machinery:
// a surfaceAllows() lock and a checkpoint worker (the durable ledger writer). Grades
// scripts/scaffold-optimize.cjs. PASSES on baseline.
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const GEN = resolve(HERE, '..', '..', '..', 'scripts', 'scaffold-optimize.cjs');
const out = join(tmpdir(), `ptask-lock-${process.pid}.js`);

const ok = (c, m) => { if (!c) { console.error('FAIL ' + m); process.exit(1); } };
execFileSync('node', [GEN, '--name', 'probe-lock', '--out', out], { stdio: 'pipe' });
const src = readFileSync(out, 'utf8');
ok(/function surfaceAllows/.test(src), 'conductor defines the surface-lock');
ok(/checkpoint/i.test(src), 'conductor drives a checkpoint worker');
ok(/baseline/i.test(src), 'conductor measures a baseline');
console.log('21-loop-surfacelock: ok');
