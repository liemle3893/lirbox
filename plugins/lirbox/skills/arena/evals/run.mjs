#!/usr/bin/env node
// Runs every floor/*.test.mjs and exits 0 iff all pass. Each floor test throws on failure.
import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const floorDir = join(here, 'floor');
const tests = readdirSync(floorDir).filter((f) => f.endsWith('.test.mjs')).sort();

let failures = 0;
for (const t of tests) {
  try {
    await import(pathToFileURL(join(floorDir, t)).href);
    console.log(`PASS ${t}`);
  } catch (e) {
    console.error(`FAIL ${t} — ${e && e.message ? e.message : e}`);
    failures++;
  }
}
if (failures) { console.error(`\n${failures} floor test(s) failed`); process.exit(1); }
console.log(`\nfloor GREEN (${tests.length} test(s))`);
