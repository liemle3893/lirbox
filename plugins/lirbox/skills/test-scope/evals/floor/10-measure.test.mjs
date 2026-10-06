// measure: a metrics record per call (label + sha), appended; compare prints the lift per metric.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeRepo, commit, ts, write, PARTS } from './_fixture.mjs';

const records = (dir) => fs.readFileSync(path.join(dir, '.test-scope/metrics.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

test('measure appends one record with label, git sha, selection stats, rates, parts and drift', () => {
  const { dir } = makeRepo();
  commit(dir, 'edit a', { 'src/a.js': 'a1' });         // a.test + b.test = 2
  commit(dir, 'edit schema', { 'src/schema.sql': 'x' }); // db.test = 1
  commit(dir, 'edit c', { 'src/c.js': 'c1' });          // nothing selects it: uncovered
  const r = ts(dir, ['measure', '--commits', '3', '--label', 'before', '--wall', '12.5']);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const [rec] = records(dir);
  assert.equal(rec.label, 'before');
  assert.match(rec.sha, /^[0-9a-f]{7,}$/);
  assert.deepEqual([rec.selection.median, rec.selection.p90, rec.selection.max, rec.selection.totalTestFiles], [1, 2, 2, 5]);
  assert.equal(rec.uncoveredRate, 0.333);
  assert.equal(rec.runAllRate, 0);
  assert.equal(rec.parts, 3);
  assert.deepEqual(rec.drift, { unowned: 0, dead: 0, problems: 0, cutUnowned: 0 });
  assert.equal(rec.wallSeconds, 12.5);
  assert.equal(rec.misses, null, 'no backstop result given: reported as not measured, not as zero');
  assert.match(r.stdout, /backstop misses: not measured/);
  ts(dir, ['measure', '--commits', '3', '--label', 'again']);
  assert.equal(records(dir).length, 2, 'appends, never overwrites');
  const nw = ts(dir, ['measure', '--commits', '3', '--no-write']);
  assert.equal(nw.code, 0);
  assert.equal(records(dir).length, 2, '--no-write leaves the file alone');
});

test('measure --compare A B prints the lift per metric (better / worse / same) from the labelled records', () => {
  const { dir } = makeRepo();
  commit(dir, 'edit a', { 'src/a.js': 'a1' });
  assert.equal(ts(dir, ['measure', '--commits', '1', '--label', 'base']).code, 0);
  // drop the part that widens src/a.js to tests/b.test.js: selection shrinks from 2 to 1
  const parts = JSON.parse(JSON.stringify(PARTS));
  delete parts.parts['a-extra'];
  parts.parts.core.tests.app.push('tests/b.test.js');
  commit(dir, 'narrow selection', { '.test-scope/parts.json': parts });
  commit(dir, 'edit a again', { 'src/a.js': 'a2' });
  assert.equal(ts(dir, ['measure', '--commits', '1', '--label', 'after']).code, 0);
  const r = ts(dir, ['measure', '--compare', 'base', 'after']);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /lift after .* vs base/);
  assert.match(r.stdout, /selection p90 \(files\)\s+2 ->\s+1\s+-1 \(-50%\)\s+info/, 'file counts are informational, never judged');
  assert.match(r.stdout, /parts\s+3 ->\s+2/);
  assert.equal(ts(dir, ['measure', '--compare', 'base', 'nope']).code, 64, 'an unknown label is a usage error, not a silent zero');
  assert.doesNotMatch(r.stdout, /not like with like/);
  assert.equal(ts(dir, ['measure', '--commits', '2', '--label', 'wide']).code, 0);
  assert.match(ts(dir, ['measure', '--compare', 'base', 'wide']).stdout, /warning: not like with like \(--commits 1 vs 2\)/);
});

test('measure --results records the fresh backstop miss count; later records carry it forward as last known', () => {
  const { dir, c0 } = makeRepo();
  commit(dir, 'edit c', { 'src/c.js': 'c1' });
  write(dir, 'junit.xml', '<testsuites><testsuite name="x"><testcase classname="tests.orphan" name="t"><failure message="b"/></testcase></testsuite></testsuites>');
  assert.equal(ts(dir, ['measure', '--commits', '1', '--results', 'junit.xml', '--since', c0, '--label', 'm1']).code, 0);
  assert.deepEqual(records(dir)[0].misses.count, 1);
  assert.equal(records(dir)[0].misses.fresh, true);
  ts(dir, ['measure', '--commits', '1', '--label', 'm2']);
  const m2 = records(dir)[1].misses;
  assert.deepEqual([m2.count, m2.fresh], [1, false]);
});
