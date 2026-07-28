// FLOOR (characterization) — every check on disk is listed in checks-manifest.json.
// scripts/evals-all.mjs enforces this repo-wide, but the floor runs STANDALONE under the
// whetstone loop, where evals-all.mjs is not in the loop. Without this test a new check
// could be added and left unguarded for the whole of an improvement run.
// PASSES on baseline.
// Locked (evals/**): improvement loops may NEVER edit this file.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const EVALS = resolve(HERE, '..');
const checksDir = join(EVALS, 'checks');
const manifestPath = join(EVALS, 'checks-manifest.json');

let bad = 0;
const ok = (c, m) => { if (c) { console.log(`PASS floor: ${m}`); } else { console.error(`FAIL floor: ${m}`); bad++; } };

ok(existsSync(manifestPath), 'evals/checks-manifest.json exists');
if (!existsSync(manifestPath)) { console.error('\n02-checks-manifest: 1 assertion(s) failed'); process.exit(1); }

const onDisk = existsSync(checksDir)
  ? readdirSync(checksDir).filter((f) => f.endsWith('.check.mjs')).map((f) => basename(f, '.check.mjs')).sort()
  : [];
ok(onDisk.length > 0, 'at least one frozen check exists');

let manifest;
try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')); }
catch (e) { console.error(`FAIL floor: checks-manifest.json is not valid JSON: ${e.message}`); process.exit(1); }

const listed = Object.keys((manifest && manifest.checks) || {}).sort();
const unlisted = onDisk.filter((c) => !listed.includes(c));
const phantom = listed.filter((c) => !onDisk.includes(c));
ok(unlisted.length === 0, `every check is listed (unguarded: ${unlisted.join(', ') || 'none'})`);
ok(phantom.length === 0, `no manifest entry lacks a file (phantom: ${phantom.join(', ') || 'none'})`);

for (const [name, spec] of Object.entries((manifest && manifest.checks) || {})) {
  ok(spec && ['green', 'red'].includes(spec.expect), `${name}: expect is "green" or "red"`);
}

if (bad) { console.error(`\n02-checks-manifest: ${bad} assertion(s) failed`); process.exit(1); }
console.log('02-checks-manifest: ok');
