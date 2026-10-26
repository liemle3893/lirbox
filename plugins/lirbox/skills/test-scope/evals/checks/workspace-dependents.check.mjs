#!/usr/bin/env node
// Frozen check: in a workspace monorepo, a changed source in package P selects the relevant tests of
// every TRANSITIVE workspace dependent, and when a dependent consumes P through its build output
// (package.json exports -> dist/), P is built BEFORE the dependents' tests run.
// Observed on a pnpm monorepo of ~10 packages: a change only reached the related-test lookup of its own
// package, so dependents' tests were never selected; and the ones a runner could find through dist ran
// against a stale build, because `checks` only run after the tests.
//
// Fixture: pnpm workspace packages/{a,b,c,z}. a exports dist; b depends on a (workspace:*); c depends on b
// (workspace:^), not on a; z is unrelated. Runner `custom`: tools/related.mjs is a tiny module resolver
// (relative imports, the cwd's vitest.config.mjs alias, else the package's exports) — like a real runner,
// its graph stops at dist. tools/rec.mjs appends every test/build command to a log, in order.
// Invariant, change in a/src/util.js:
//   dist   b:uses-a and c:uses-b selected "dependent of a (via dist)"; b:plain, c:other, z never;
//          --list plans the prebuild of a; `run` builds a once, before any b or c test command
//   src    (b and c alias a to its src) same tests, "dependent of a (via src)", no prebuild, nothing built
//   scan   (c's runner has no related lookup) c:uses-b still selected (it imports b), c:other not
//   fail   a failing prebuild stops b's and c's tests, a's own tests still run, `run` exits 1
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

const RELATED = `import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const cwd = process.cwd();
const cfg = path.join(cwd, 'vitest.config.mjs');
const alias = fs.existsSync(cfg) ? (await import(pathToFileURL(cfg).href)).default.resolve.alias : {};
function entry(name) {
  const dir = path.join(cwd, '..', name);
  const j = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const e = j.exports && j.exports['.'];
  return path.resolve(dir, typeof e === 'string' ? e : (e && e.import) || j.main);
}
const resolve = (spec, from) => spec.startsWith('.') ? path.resolve(path.dirname(from), spec) : alias[spec] ? path.resolve(cwd, alias[spec]) : entry(spec);
function closure(file, seen) {
  if (seen.has(file)) return seen;
  seen.add(file);
  if (!fs.existsSync(file)) return seen;
  for (const m of fs.readFileSync(file, 'utf8').matchAll(/from\\s+['"]([^'"]+)['"]/g)) closure(resolve(m[1], file), seen);
  return seen;
}
const tests = fs.readdirSync(path.join(cwd, 'tests')).filter((f) => f.endsWith('.test.js')).map((f) => 'tests/' + f);
for (const src of process.argv.slice(2)) {
  const abs = path.resolve(cwd, src);
  for (const t of tests) if (closure(path.resolve(cwd, t), new Set()).has(abs)) console.log(src + '\\t' + t);
}
`;
const REC = `import fs from 'node:fs';
const args = process.argv.slice(2);
fs.appendFileSync(process.env.REC_LOG, args.join(' ') + '\\n');
process.exit(args.includes('--fail') ? 1 : 0);
`;

const pkg = (name, { relatedCmd = true } = {}) => ({
  dir: `packages/${name}`, runner: 'custom', testGlobs: ['tests/**/*.test.js'],
  ...(relatedCmd ? { relatedCmd: 'node ../../tools/related.mjs' } : {}),
  cmd: `node ../../tools/rec.mjs test-${name} {files}`,
});
const parts = ({ prebuild = 'node tools/rec.mjs build {name}', cRelated = true } = {}) => ({
  noTests: [], runAll: [],
  workspace: { prebuild },
  packages: { a: pkg('a'), b: pkg('b'), c: pkg('c', { relatedCmd: cRelated }), z: pkg('z') },
  parts: {},
});
const distExports = { '.': { types: './dist/index.d.ts', import: './dist/index.js' } };
const alias = "export default { resolve: { alias: { 'a': '../a/src/index.js' } } };\n";

function makeRepo({ srcAlias = false, ...p } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-workspace-'));
  dirs.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  put(dir, {
    'pnpm-workspace.yaml': "packages:\n  - 'packages/*'\n",
    'package.json': { name: 'root', private: true },
    'tools/related.mjs': RELATED, 'tools/rec.mjs': REC,
    '.test-scope/parts.json': parts(p),
    'packages/a/package.json': { name: 'a', version: '1.0.0', scripts: { build: 'tsc' }, exports: distExports },
    'packages/a/src/index.js': "export { u } from './util.js';\n",
    'packages/a/src/util.js': 'export const u = 1;\n',
    'packages/a/dist/index.js': 'export const u = 1;\n',
    'packages/a/tests/util.test.js': "import { u } from '../src/util.js';\n",
    'packages/b/package.json': { name: 'b', version: '1.0.0', scripts: { build: 'tsc' }, exports: distExports, dependencies: { a: 'workspace:*' } },
    'packages/b/src/index.js': "import { u } from 'a';\nexport const v = u;\n",
    'packages/b/dist/index.js': "import { u } from 'a';\nexport const v = u;\n",
    'packages/b/tests/uses-a.test.js': "import { u } from 'a';\n",
    'packages/b/tests/plain.test.js': "import { x } from '../src/local.js';\n",
    'packages/b/src/local.js': 'export const x = 1;\n',
    'packages/c/package.json': { name: 'c', version: '1.0.0', dependencies: { b: 'workspace:^' } },
    'packages/c/tests/uses-b.test.js': "import { v } from 'b';\n",
    'packages/c/tests/other.test.js': "import { w } from '../src/w.js';\n",
    'packages/c/src/w.js': 'export const w = 1;\n',
    'packages/z/package.json': { name: 'z', version: '1.0.0' },
    'packages/z/tests/z.test.js': "import { z } from '../src/z.js';\n",
    'packages/z/src/z.js': 'export const z = 1;\n',
    ...(srcAlias ? { 'packages/b/vitest.config.mjs': alias, 'packages/c/vitest.config.mjs': alias } : {}),
  });
  put(dir, { 'packages/a/src/util.js': 'export const u = 2;\n' });
  return dir;
}

const ts = (dir, args) => {
  const log = path.join(dir, 'order.log');
  fs.rmSync(log, { force: true });
  const { NODE_TEST_CONTEXT, ...env } = process.env;
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: dir, encoding: 'utf8', env: { ...env, REC_LOG: log } });
  if (r.status >= 2 && r.status !== 3) { console.error(`harness: ${args.join(' ')} exit ${r.status}: ${(r.stderr || r.stdout).slice(0, 400)}`); process.exit(2); }
  return { ...r, log: fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : [] };
};
const json = (dir) => {
  const r = ts(dir, ['select', '--changed', 'HEAD~1', '--to', 'HEAD', '--json']);
  try { return JSON.parse(r.stdout).selection; } catch { console.error(`harness: no JSON: ${r.stderr.slice(0, 400)}`); process.exit(2); }
};
const list = (dir) => ts(dir, ['select', '--changed', 'HEAD~1', '--to', 'HEAD', '--list']).stdout;
const run = (dir) => ts(dir, ['run', '--changed', 'HEAD~1', '--to', 'HEAD']);

let bad = 0;
const ok = (cond, what) => { if (!cond) bad++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`); };
const entry = (sel, p, f) => sel.entries.find((e) => e.pkg === p && e.file === f);
const firstIdx = (log, re) => log.findIndex((l) => re.test(l));

// dist
{
  const dir = makeRepo();
  const sel = json(dir);
  ok(!!entry(sel, 'a', 'tests/util.test.js'), 'dist: own test a:util selected');
  for (const [p, f] of [['b', 'tests/uses-a.test.js'], ['c', 'tests/uses-b.test.js']]) {
    const e = entry(sel, p, f);
    ok(!!e && /dependent of a \(via dist\)/.test(e.reason), `dist: ${p}:${f} selected as "dependent of a (via dist)" (got ${e ? e.reason : 'not selected'})`);
  }
  for (const [p, f] of [['b', 'tests/plain.test.js'], ['c', 'tests/other.test.js']]) ok(!entry(sel, p, f), `dist: ${p}:${f} (does not import a) not selected`);
  ok(!sel.entries.some((e) => e.pkg === 'z'), 'dist: unrelated package z selects nothing');
  const text = list(dir);
  ok(/dependent of a \(via dist\)/.test(text), '--list states "dependent of a (via dist)"');
  ok(/^\s*prebuild\b.*\bbuild a\b/m.test(text), '--list plans the prebuild of a');
  const r = run(dir);
  const builds = r.log.filter((l) => /^build a\b/.test(l));
  const firstDep = firstIdx(r.log, /^test-(b|c)\b/);
  ok(r.status === 0, `dist: run exits 0 (got ${r.status})`);
  ok(builds.length === 1, `dist: a built exactly once (got ${builds.length}; log ${JSON.stringify(r.log)})`);
  ok(firstDep >= 0 && firstIdx(r.log, /^build a\b/) >= 0 && firstIdx(r.log, /^build a\b/) < firstDep, 'dist: build a runs before any b/c test command');
  ok(firstIdx(r.log, /^test-b\b/) >= 0 && firstIdx(r.log, /^test-c\b/) >= 0, 'dist: b and c tests ran');
  ok(firstIdx(r.log, /^test-z\b/) < 0, 'dist: z tests did not run');
}
// src alias
{
  const dir = makeRepo({ srcAlias: true });
  const sel = json(dir);
  for (const [p, f] of [['b', 'tests/uses-a.test.js'], ['c', 'tests/uses-b.test.js']]) {
    const e = entry(sel, p, f);
    ok(!!e && /dependent of a \(via src\)/.test(e.reason), `src: ${p}:${f} selected as "dependent of a (via src)" (got ${e ? e.reason : 'not selected'})`);
  }
  ok(!entry(sel, 'b', 'tests/plain.test.js') && !entry(sel, 'c', 'tests/other.test.js'), 'src: unrelated dependent tests not selected');
  ok(!/^\s*prebuild\b/m.test(list(dir)), 'src: no prebuild planned');
  const r = run(dir);
  ok(r.status === 0 && !r.log.some((l) => /^build\b/.test(l)), `src: run builds nothing (exit ${r.status}, log ${JSON.stringify(r.log)})`);
}
// scan fallback: c's runner has no related lookup
{
  const dir = makeRepo({ cRelated: false });
  const sel = json(dir);
  const e = entry(sel, 'c', 'tests/uses-b.test.js');
  ok(!!e && /dependent of a\b/.test(e.reason), `scan: c:uses-b selected as a dependent of a (got ${e ? e.reason : 'not selected'})`);
  ok(!entry(sel, 'c', 'tests/other.test.js'), 'scan: c:other not selected');
}
// failing prebuild
{
  const dir = makeRepo({ prebuild: 'node tools/rec.mjs build {name} --fail' });
  const r = run(dir);
  ok(r.status === 1, `fail: run exits 1 (got ${r.status})`);
  ok(r.log.some((l) => /^build a\b/.test(l)), 'fail: the prebuild ran');
  ok(!r.log.some((l) => /^test-(b|c)\b/.test(l)), `fail: b and c tests not started (log ${JSON.stringify(r.log)})`);
  ok(r.log.some((l) => /^test-a\b/.test(l)), "fail: a's own tests still ran");
  ok(/prebuild/i.test(r.stdout.split('== summary')[1] || ''), 'fail: the summary reports the prebuild');
}

if (bad) { console.error(`\n${bad} assertion(s) violate: workspace dependents selected, dist consumers prebuilt first`); process.exit(1); }
console.log('\nall assertions hold');
