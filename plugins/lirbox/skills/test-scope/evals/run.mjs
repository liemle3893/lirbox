#!/usr/bin/env node
// Floor runner: node:test over every floor/*.test.mjs; exits 0 iff all pass. No network, no installs.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const floorDir = join(here, 'floor');
const tests = readdirSync(floorDir).filter((f) => f.endsWith('.test.mjs')).sort().map((f) => join(floorDir, f));
const r = spawnSync(process.execPath, ['--test', '--test-reporter=spec', ...tests], { stdio: 'inherit' });
if (r.status !== 0) { console.error('\nfloor RED'); process.exit(1); }
console.log(`\nfloor GREEN (${tests.length} file(s))`);
