#!/usr/bin/env node
// Frozen check: the per-repo self-checks see the workspace.
//   doctor    warns (stale-build risk) when a workspace package's exports point at dist and a dependent's
//             runner config has no source alias for it; no such warning once the dependent aliases src
//   coverage  reports a workspace package with tests (a "test" script) that has no `packages` entry in
//             parts.json, and fails for it; a configured one is not reported
// Observed on a pnpm monorepo of ~10 packages: dependents imported upstream packages through exports ->
// dist, so even the runner's own graph ran their tests against a stale build, and nothing said so.
//
// Exit 0 = invariant holds, 1 = violated, 2 = harness could not run.
// TEST_SCOPE_OVERRIDE: any file in the scripts dir under test (set by prove-checks); test-scope.mjs beside it runs.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = process.env.TEST_SCOPE_OVERRIDE ? path.dirname(process.env.TEST_SCOPE_OVERRIDE) : path.join(here, '..', '..', 'scripts');
const SCRIPT = path.join(SCRIPTS, 'test-scope.mjs');

const dirs = [];
process.on('exit', () => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const git = (dir, ...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const pkg = (name) => ({ dir: `packages/${name}`, runner: 'custom', testGlobs: ['tests/**/*.test.js'], relatedCmd: 'node -e ""', cmd: 'node -e "" {files}' });
function makeRepo({ srcAlias = false, configureY = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-ws-doctor-'));
  dirs.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  const files = {
    'pnpm-workspace.yaml': "packages:\n  - 'packages/*'\n",
    'package.json': { name: 'root', private: true },
    '.test-scope/parts.json': { noTests: [], runAll: [], packages: { a: pkg('a'), b: pkg('b'), ...(configureY ? { y: pkg('y') } : {}) }, graphOnly: { a: ['tests/**'], b: ['tests/**'], y: ['tests/**'] }, parts: {} },
    'packages/a/package.json': { name: 'a', version: '1.0.0', scripts: { build: 'tsc', test: 'x' }, exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } } },
    'packages/a/src/index.js': 'export const u = 1;\n',
    'packages/a/tests/a.test.js': "import '../src/index.js';\n",
    'packages/b/package.json': { name: 'b', version: '1.0.0', scripts: { test: 'x' }, dependencies: { a: 'workspace:*' } },
    'packages/b/tests/b.test.js': "import 'a';\n",
    'packages/y/package.json': { name: 'y', version: '1.0.0', scripts: { test: 'x' } },
    'packages/y/tests/y.test.js': "import '../src/y.js';\n",
    'packages/docs/package.json': { name: 'docs', version: '1.0.0', scripts: { build: 'x' } },
    ...(srcAlias ? { 'packages/b/vitest.config.mjs': "export default { resolve: { alias: { 'a': '../a/src/index.js' } } };\n" } : {}),
  };
  for (const [rel, c] of Object.entries(files)) {
    const f = path.join(dir, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, typeof c === 'string' ? c : JSON.stringify(c, null, 2));
  }
  git(dir, 'add', '-A');
  git(dir, '-c', 'user.name=fx', '-c', 'user.email=fx@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'c');
  return dir;
}
const ts = (dir, args) => {
  const { NODE_TEST_CONTEXT, ...env } = process.env;
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: dir, encoding: 'utf8', env });
  if (r.status === null || r.status >= 2) { console.error(`harness: ${args.join(' ')} exit ${r.status}: ${(r.stderr || r.stdout).slice(0, 400)}`); process.exit(2); }
  return r;
};

let bad = 0;
const ok = (cond, what) => { if (!cond) bad++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`); };
const staleLine = (text) => text.split('\n').find((l) => /stale/i.test(l) && /\ba\b/.test(l) && /\bb\b/.test(l));

{
  const dir = makeRepo();
  const cov = ts(dir, ['coverage']);
  const yLine = cov.stdout.split('\n').find((l) => /packages\/y\b/.test(l));
  ok(cov.status === 1 && !!yLine, `coverage: unconfigured workspace package packages/y reported and fails (exit ${cov.status})`);
  ok(!cov.stdout.split('\n').some((l) => /packages\/(a|b)\b/.test(l)), 'coverage: configured packages a, b not reported');
  ok(!cov.stdout.split('\n').some((l) => /packages\/docs\b/.test(l) && !/no test/i.test(l)), 'coverage: a package without a test script is not a failure');
  const doc = ts(dir, ['doctor']);
  ok(!!staleLine(doc.stdout), `doctor: stale-build warning names a (exports -> dist) and its dependent b${staleLine(doc.stdout) ? '' : `\n${doc.stdout}`}`);
}
{
  const dir = makeRepo({ srcAlias: true, configureY: true });
  const cov = ts(dir, ['coverage']);
  ok(cov.status === 0 && !/packages\/y\b/.test(cov.stdout), `coverage: once y is configured it is clean (exit ${cov.status})\n${cov.status ? cov.stdout : ''}`);
  const doc = ts(dir, ['doctor']);
  ok(!doc.stdout.split('\n').some((l) => /stale/i.test(l)), 'doctor: no stale-build warning when b aliases a to src');
}

if (bad) { console.error(`\n${bad} assertion(s) violate: doctor/coverage see the workspace`); process.exit(1); }
console.log('\nall assertions hold');
