import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRepo, commit, ts, PARTS } from './_fixture.mjs';

test('coverage is clean when every test file is owned or graph-only and no glob is dead', () => {
  const { dir } = makeRepo();
  const r = ts(dir, ['coverage']);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /coverage clean/);
});

test('coverage flags an unowned test file and exits non-zero', () => {
  const { dir } = makeRepo({ parts: { ...PARTS, graphOnly: {} } });
  const r = ts(dir, ['coverage']);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /UNOWNED test files \(1\)[\s\S]*tests\/orphan\.test\.js/);
  assert.doesNotMatch(r.stdout, /tests\/live\.test\.js/, 'excluded (live) tests are not required to be owned');
});

test('coverage flags dead globs in every list', () => {
  const parts = JSON.parse(JSON.stringify(PARTS));
  parts.parts.db.tests.app.push('tests/gone/**/*.test.js');
  parts.parts.db.paths.push('src/missing/**');
  parts.noTests.push('nothing/**');
  parts.runAll.push('nope.cfg');
  parts.graphOnly.app.push('tests/zzz.test.js');
  const { dir } = makeRepo({ parts });
  const r = ts(dir, ['coverage']);
  assert.equal(r.code, 1);
  for (const dead of ['parts.db.tests.app: tests/gone/**/*.test.js', 'parts.db.paths: src/missing/**', 'noTests: nothing/**', 'runAll: nope.cfg', 'graphOnly.app: tests/zzz.test.js']) {
    assert.ok(r.stdout.includes(dead), `dead glob not reported: ${dead}\n${r.stdout}`);
  }
});

test('replay: per-commit selection vs. the full suite, with median / p90 / max', () => {
  const { dir } = makeRepo();
  commit(dir, 'edit a', { 'src/a.js': 'a1' });          // a.test + b.test (part)  = 2
  commit(dir, 'edit schema', { 'src/schema.sql': 'x' }); // db.test                 = 1
  commit(dir, 'docs', { 'docs/readme.md': 'd2' });       // none                    = 0
  const r = ts(dir, ['replay', '--commits', '3', '--json'], { json: true });
  assert.equal(r.code, 0, r.stderr);
  const { summary, commits } = r.json;
  assert.deepEqual(commits.map((c) => [c.subject, c.selected, c.total]), [['docs', 0, 5], ['edit schema', 1, 5], ['edit a', 2, 5]]);
  assert.deepEqual([summary.median, summary.p90, summary.max, summary.totalTestFiles], [1, 2, 2, 5]);
  assert.deepEqual(commits.map((c) => c.percent), [0, 20, 40]);
  const h = ts(dir, ['replay', '--commits', '3']);
  assert.match(h.stdout, /median 1 \(20%\)\s+p90 2 \(40%\)\s+max 2 \(40%\)/);
});

test('replay marks a run-all commit', () => {
  const { dir } = makeRepo();
  commit(dir, 'runner cfg', { 'config/runner.json': '{"a":1}' });
  const r = ts(dir, ['replay', '--commits', '1', '--json'], { json: true });
  assert.equal(r.json.commits[0].runAll, true);
  assert.equal(r.json.commits[0].selected, 4);
});
