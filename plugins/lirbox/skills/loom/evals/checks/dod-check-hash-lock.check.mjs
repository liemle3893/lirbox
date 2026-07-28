// CHECK — DoD check files must be sha256-locked, so weakening the thing a check runs is
// DETECTED rather than rewarded. Also: baseline defaults to "red" (a criterion already
// met before the work cannot discriminate it).
// Locked (evals/**): improvement loops may NEVER edit this file.
import { mkdtempSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const FREEZE = resolve(HERE, '..', '..', 'scripts', 'dod-freeze.mjs');
const m = await import(FREEZE);

const tmp = mkdtempSync(join(tmpdir(), 'loom-dod-'));
const dodPath = join(tmp, 'dod.json');
const checksDir = join(tmp, 'checks');
writeFileSync(dodPath, JSON.stringify({ criteria: [
  { id: 'c1', text: 'behaviour holds', tier: 'checkable',
    script: '#!/usr/bin/env bash\nexit 1\n' },
  { id: 'c2', text: 'suite still passes', tier: 'checkable', baseline: 'green-ok',
    script: '#!/usr/bin/env bash\nexit 0\n' },
] }));
execFileSync('node', [FREEZE, '--dod', dodPath, '--checks-dir', checksDir], { stdio: 'pipe' });
const frozen = JSON.parse(readFileSync(dodPath, 'utf8'));

let bad = 0;
const ok = (c, msg) => { if (c) { console.log(`PASS ${msg}`); } else { console.error(`FAIL ${msg}`); bad++; } };

const c1 = frozen.criteria.find((c) => c.id === 'c1');
ok(/^sha256:[0-9a-f]{64}$/.test(c1.checkSha), 'check file carries a sha256 lock');
ok(c1.script === undefined, 'inline script was moved to a file, not duplicated');
ok(c1.baseline === 'red', 'baseline defaults to red');
ok(frozen.criteria.find((c) => c.id === 'c2').baseline === 'green-ok', 'green-ok waiver preserved');
ok(m.verifyChecks(frozen, tmp).every((r) => r.ok), 'untouched checks verify');

writeFileSync(join(checksDir, 'c1.sh'), '#!/usr/bin/env bash\nexit 0\n');
const weakened = m.verifyChecks(frozen, tmp).find((r) => r.id === 'c1');
ok(weakened.ok === false && /sha|hash|modified/i.test(weakened.reason),
  'a WEAKENED check file is detected');

unlinkSync(join(checksDir, 'c2.sh'));
const deleted = m.verifyChecks(frozen, tmp).find((r) => r.id === 'c2');
ok(deleted.ok === false && /missing/i.test(deleted.reason), 'a DELETED check file is detected');

if (bad) { console.error(`\ndod-check-hash-lock: ${bad} failed`); process.exit(1); }
console.log('dod-check-hash-lock: ok');
