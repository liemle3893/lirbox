// doctor: one call per change; aggregates coverage drift, rules, config, uncovered files, changecov and a mutate sample
// into a numbered list of actions, and exits non-zero iff that list is not empty.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRepo, commit, ts, write, PARTS } from './_fixture.mjs';
import { makeJsRepo, edit, JS_PARTS } from './_js.mjs';

const range = ['doctor', '--changed', 'HEAD~1', '--to', 'HEAD'];
const actions = (stdout) => (stdout.split('\nactions:\n')[1] || '').split('\n').filter((l) => /^ \d+\. /.test(l));

test('doctor on a healthy config is clean (exit 0) and says which change checks it skipped', () => {
  const { dir } = makeRepo();
  const r = ts(dir, ['doctor']);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /\[ok\s*\] config/);
  assert.match(r.stdout, /\[ok\s*\] coverage \(drift\)/);
  assert.match(r.stdout, /\[skip\] rules --check/);
  assert.match(r.stdout, /skip: change checks \(pass --changed/);
  assert.match(r.stdout, /doctor: clean/);
});

test('doctor aggregates drift, a stale rules file and a broken config into numbered actions with a non-zero exit', () => {
  const { dir } = makeRepo({ parts: { ...PARTS, graphOnly: {} } }); // tests/orphan.test.js is now unowned
  write(dir, '.test-scope/rules.source.json', { include: ['**/*'], exclude: [], rules: [{ path: 'src/schema.sql', rule: 'R' }] });
  const r = ts(dir, ['doctor']);
  assert.equal(r.code, 1, r.stdout);
  const a = actions(r.stdout);
  assert.equal(a.length, 2, r.stdout);
  assert.match(a[0], /^ 1\. run `test-scope coverage`/);
  assert.match(a[1], /^ 2\. run `test-scope rules --write`/);
  assert.match(r.stdout, /\[FAIL\] coverage \(drift\)[\s\S]*UNOWNED test files \(1\)/);
  write(dir, '.test-scope/parts.json', '{ not json');
  const broken = ts(dir, ['doctor']);
  assert.equal(broken.code, 1);
  assert.match(broken.stdout, /\[FAIL\] config\s*[\s\S]*not valid JSON/);
  assert.equal(actions(broken.stdout).length, 1, 'a config that cannot load stops the run at one action');
});

test('doctor --changed: an uncovered changed file is an action', () => {
  const { dir } = makeRepo();
  commit(dir, 'edit c', { 'src/c.js': 'c1' });
  const r = ts(dir, [...range, '--no-changecov', '--no-mutate']);
  assert.equal(r.code, 1, r.stdout);
  assert.match(actions(r.stdout)[0], /^ 1\. for each uncovered file, add it to a part's paths .*src\/c\.js/);
});

test('doctor --changed: an untested changed function fails changecov AND the mutate sample; testing it makes doctor clean', () => {
  const { dir } = makeJsRepo();
  commit(dir, 'change both', { 'src/a.js': edit('both') });
  const r = ts(dir, range);
  assert.equal(r.code, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /\[FAIL\] changecov[\s\S]*NOT RUN\s+bar/);
  assert.match(r.stdout, /\[FAIL\] mutate \(sample\)[\s\S]*SURVIVED  src\/a\.js:4 bar/);
  assert.deepEqual(actions(r.stdout).map((l) => l.replace(/^ \d+\. /, '').split(' ')[0]), ['add', 'a'], r.stdout);
  const { dir: ok } = makeJsRepo();
  commit(ok, 'change foo', { 'src/a.js': edit('foo') });
  const g = ts(ok, range);
  assert.equal(g.code, 0, g.stdout + g.stderr);
  assert.match(g.stdout, /\[ok\s*\] changecov/);
  assert.match(g.stdout, /\[ok\s*\] mutate \(sample\)/);
  assert.match(g.stdout, /doctor: clean/);
});

test('doctor fails closed when a check is not measurable; --allow-unmeasured downgrades it to a warning', () => {
  const parts = JSON.parse(JSON.stringify(JS_PARTS));
  delete parts.packages.app.coverage;
  const { dir } = makeJsRepo({ parts });
  commit(dir, 'change foo', { 'src/a.js': edit('foo') });
  const r = ts(dir, [...range, '--no-mutate']);
  assert.equal(r.code, 1, r.stdout);
  assert.match(r.stdout, /\[FAIL\] changecov: not measurable: runner "custom" has no built-in coverage/);
  assert.match(actions(r.stdout)[0], /make changecov measurable/);
  const w = ts(dir, [...range, '--no-mutate', '--allow-unmeasured']);
  assert.equal(w.code, 0, w.stdout);
  assert.match(w.stdout, /\[WARN\] changecov: not measurable/);
});
