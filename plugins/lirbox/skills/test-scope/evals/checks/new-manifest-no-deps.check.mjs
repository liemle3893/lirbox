#!/usr/bin/env node
// Frozen check: run-all fires on a package manifest ONLY when a dependency set changed.
// A manifest absent on one side of the range is a dependency change only if the side that
// exists declares dependencies. Observed: a commit adding a root package.json with nothing
// but "scripts" selected 242/249 test files because "absent at base" was read as "deps changed".
//
// Invariant, both directions (so an over-correction that never fires run-all is RED too):
//   added   manifest, no deps   -> no run-all      added   manifest, deps -> run-all
//   deleted manifest, no deps   -> no run-all      deleted manifest, deps -> run-all
// for package.json, requirements*.txt and go.mod.
//
// Exit 0 = invariant holds, 1 = violated, 2 = harness could not run.
// TEST_SCOPE_OVERRIDE points at the script under test (set by prove-checks).
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = process.env.TEST_SCOPE_OVERRIDE || path.join(here, '..', '..', 'scripts', 'test-scope.mjs');

const dirs = [];
process.on('exit', () => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const git = (dir, ...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const put = (dir, files) => {
  for (const [rel, c] of Object.entries(files)) {
    const f = path.join(dir, rel);
    if (c === null) { fs.rmSync(f); continue; }
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, typeof c === 'string' ? c : JSON.stringify(c, null, 2));
  }
  git(dir, 'add', '-A');
  git(dir, '-c', 'user.name=fx', '-c', 'user.email=fx@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'c');
};

const PARTS = {
  noTests: [], runAll: [],
  packages: { app: { dir: '.', runner: 'custom', testGlobs: ['tests/**/*.test.js'], relatedCmd: 'node -e ""', cmd: 'node --test {files}' } },
  parts: {},
};
const BASE = { '.test-scope/parts.json': PARTS, 'src/a.js': 'a', 'tests/a.test.js': 'a', 'tests/b.test.js': 'b' };

/** One repo per case: commit `base`, then commit `change`; return the run-all flag for HEAD~1..HEAD. */
function runAll(base, change) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-newmanifest-'));
  dirs.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  put(dir, { ...BASE, ...base });
  put(dir, change);
  const r = spawnSync(process.execPath, [SCRIPT, 'select', '--changed', 'HEAD~1', '--to', 'HEAD', '--json'], { cwd: dir, encoding: 'utf8' });
  let j;
  try { j = JSON.parse(r.stdout); } catch { console.error(`harness: no JSON (exit ${r.status}): ${r.stderr.slice(0, 400)}`); process.exit(2); }
  if (typeof j?.selection?.runAll !== 'boolean') { console.error('harness: selection.runAll missing'); process.exit(2); }
  return j.selection.runAll;
}

const scriptsOnly = { name: 'root', private: true, scripts: { test: 'node --test' } };
const withDeps = { name: 'root', scripts: { test: 'x' }, devDependencies: { vitest: '^3.0.0' } };
const emptyDeps = { name: 'root', scripts: { test: 'x' }, dependencies: {} };

const cases = [
  ['added root package.json, scripts only', {}, { 'package.json': scriptsOnly }, false],
  ['added root package.json, empty dependencies {}', {}, { 'package.json': emptyDeps }, false],
  ['added nested package.json, scripts only', {}, { 'tools/x/package.json': scriptsOnly }, false],
  ['added root package.json with devDependencies', {}, { 'package.json': withDeps }, true],
  ['deleted package.json that had no deps', { 'tools/x/package.json': scriptsOnly }, { 'tools/x/package.json': null }, false],
  ['deleted package.json that had deps', { 'tools/x/package.json': withDeps }, { 'tools/x/package.json': null }, true],
  ['added requirements.txt, comments only', {}, { 'requirements.txt': '# none yet\n\n' }, false],
  ['added requirements.txt with a requirement', {}, { 'requirements.txt': 'requests==2.32.0\n' }, true],
  ['added go.mod, module + go directive only', {}, { 'go.mod': 'module example.com/x\n\ngo 1.22\n' }, false],
  ['added go.mod with a require', {}, { 'go.mod': 'module example.com/x\n\ngo 1.22\n\nrequire github.com/pkg/errors v0.9.1\n' }, true],
  ['edited existing package.json dependency (control)', { 'package.json': withDeps }, { 'package.json': { ...withDeps, devDependencies: { vitest: '^4.0.0' } } }, true],
];

let bad = 0;
for (const [name, base, change, want] of cases) {
  const got = runAll(base, change);
  const ok = got === want;
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: runAll=${got} (want ${want})`);
}
if (bad) { console.error(`\n${bad}/${cases.length} cases violate: run-all only when a manifest's dependency set changed`); process.exit(1); }
console.log(`\nall ${cases.length} cases hold`);
