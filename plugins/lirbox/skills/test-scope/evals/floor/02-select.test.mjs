import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRepo, commit, selectJson, files, ts, PARTS } from './_fixture.mjs';

test('related is always included, parts are added on top (union with reasons)', () => {
  const { dir } = makeRepo();
  commit(dir, 'edit a', { 'src/a.js': 'a1' });
  const r = selectJson(dir);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(files(r), ['tests/a.test.js', 'tests/b.test.js']);
  const by = Object.fromEntries(r.json.selection.entries.map((e) => [e.file, e]));
  assert.equal(by['tests/a.test.js'].part, '(graph)', 'a.test.js comes from the import graph even though no part lists it for src/a.js');
  assert.match(by['tests/a.test.js'].reason, /related: src\/a\.js/);
  assert.equal(by['tests/b.test.js'].part, 'a-extra');
  assert.deepEqual(r.json.selection.related.app, ['src/a.js']);
  assert.deepEqual(r.json.selection.parts, ['a-extra']);
});

test('a hidden link only a part knows is selected without any graph edge', () => {
  const { dir } = makeRepo();
  commit(dir, 'edit schema', { 'src/schema.sql': 'create table t(x);' });
  const r = selectJson(dir);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(files(r), ['tests/db.test.js']);
});

test('a changed source that selects no test exits 3 and is listed', () => {
  const { dir } = makeRepo();
  commit(dir, 'edit c', { 'src/c.js': 'c1' });
  const r = selectJson(dir);
  assert.equal(r.code, 3);
  assert.deepEqual(r.json.selection.uncovered, ['src/c.js']);
  assert.match(ts(dir, ['select', '--changed', 'HEAD~1', '--to', 'HEAD', '--list']).stdout, /uncovered changed files[\s\S]*src\/c\.js/);
});

test('noTests globs exempt a file; a part hit also covers it', () => {
  const { dir } = makeRepo();
  commit(dir, 'docs only', { 'docs/readme.md': 'doc2' });
  const r = selectJson(dir);
  assert.equal(r.code, 0);
  assert.deepEqual(r.json.selection.noTests, ['docs/readme.md']);
  assert.deepEqual(files(r), []);
});

test('a changed test file runs itself; an excluded (live) test is never selected', () => {
  const { dir } = makeRepo();
  commit(dir, 'edit tests', { 'tests/b.test.js': 'b1', 'tests/live.test.js': 'live1' });
  const r = selectJson(dir);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(files(r), ['tests/b.test.js']);
  assert.deepEqual(r.json.selection.noTests, ['tests/live.test.js']);
});

test('runAll: a runAll glob, or a manifest whose dependency fields changed', () => {
  let { dir } = makeRepo();
  commit(dir, 'runner config', { 'config/runner.json': '{"x":1}' });
  let r = selectJson(dir);
  assert.equal(r.json.selection.runAll, true);
  assert.deepEqual(files(r), ['tests/a.test.js', 'tests/b.test.js', 'tests/db.test.js', 'tests/orphan.test.js'], 'every non-excluded test, never the live one');

  ({ dir } = makeRepo());
  commit(dir, 'bump dep', { 'package.json': { name: 'fx', scripts: { test: 'x' }, dependencies: { left: '2.0.0' } } });
  r = selectJson(dir);
  assert.equal(r.json.selection.runAll, true);
  assert.match(r.json.selection.entries[0].reason, /run-all: package\.json/);
});

test('runAll does NOT fire for a scripts-only manifest edit, even if a runAll glob names the manifest', () => {
  const parts = { ...PARTS, runAll: [...PARTS.runAll, 'package.json'] };
  const { dir } = makeRepo({ parts });
  commit(dir, 'scripts only', { 'package.json': { name: 'fx', scripts: { test: 'y', lint: 'z' }, dependencies: { left: '1.0.0' } } });
  const r = selectJson(dir);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.json.selection.runAll, false);
  assert.deepEqual(r.json.selection.noTests, ['package.json']);
});

test('working tree and untracked files count when --to is omitted', () => {
  const { dir } = makeRepo();
  commit(dir, 'noop doc', { 'docs/readme.md': 'doc2' });
  const base = 'HEAD';
  const fsw = (rel, c) => import('node:fs').then((fs) => fs.writeFileSync(`${dir}/${rel}`, c));
  return Promise.all([fsw('src/a.js', 'dirty'), fsw('src/new.js', 'new')]).then(() => {
    const r = ts(dir, ['select', '--changed', base, '--json'], { json: true });
    assert.equal(r.code, 3, 'untracked src/new.js has no test');
    assert.deepEqual(r.json.selection.uncovered, ['src/new.js']);
    assert.deepEqual(files(r), ['tests/a.test.js', 'tests/b.test.js']);
  });
});

test('run --dry-run builds one runner command per package through the wrapper', () => {
  const parts = { ...PARTS, packages: { app: { ...PARTS.packages.app, wrapper: 'echo WRAP' } } };
  const { dir } = makeRepo({ parts });
  commit(dir, 'edit a', { 'src/a.js': 'a1' });
  const r = ts(dir, ['run', '--changed', 'HEAD~1', '--to', 'HEAD', '--dry-run']);
  assert.equal(r.code, 0, r.stderr);
  assert.equal((r.stdout.match(/^\$ /gm) || []).length, 1, 'one invocation for the package');
  const cmd = r.stdout.match(/^\$ (.*)$/m)[1].split(' ');
  assert.deepEqual([cmd.slice(0, 4), cmd.slice(4).sort()], [['echo', 'WRAP', 'node', '--test'], ['src/a.js', 'tests/a.test.js', 'tests/b.test.js']], 'related source plus the selected tests, through the wrapper');
  assert.match(r.stdout, /ok\s+app tests/);
});

test('run exits 1 when the runner fails and 3 when a changed file is uncovered', () => {
  const parts = { ...PARTS, packages: { app: { ...PARTS.packages.app, cmd: 'node -e process.exit(1) {files}' } } };
  const { dir } = makeRepo({ parts });
  commit(dir, 'edit a', { 'src/a.js': 'a1' });
  assert.equal(ts(dir, ['run', '--changed', 'HEAD~1', '--to', 'HEAD']).code, 1);
  commit(dir, 'edit c', { 'src/c.js': 'c1' });
  assert.equal(ts(dir, ['run', '--changed', 'HEAD~1', '--to', 'HEAD']).code, 3);
});

test('--part selects a part\'s tests and nothing else', () => {
  const { dir } = makeRepo();
  const r = ts(dir, ['select', '--part', 'db,a-extra', '--json'], { json: true });
  assert.deepEqual(files(r), ['tests/b.test.js', 'tests/db.test.js']);
  assert.equal(ts(dir, ['select', '--part', 'nope']).code, 64);
});
