import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeRepo, commit, ts, write } from './_fixture.mjs';

const { parseResults } = await import(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'test-scope.mjs'));

const JUNIT = `<?xml version="1.0"?>
<testsuites><testsuite name="x" tests="3" failures="2">
  <testcase classname="tests.orphan" name="test_c_breaks" time="0.1"><failure message="boom">Traceback</failure></testcase>
  <testcase classname="tests.a" name="test_ok" time="0.1"/>
  <testcase classname="tests.db" name="test_db" file="tests/db.test.js" time="0.1"><error message="e"/></testcase>
</testsuite></testsuites>`;

test('misses: an unselected failing test is a MISS with the likely culprit commit; a selected one is not', () => {
  const { dir, c0 } = makeRepo();
  const c1 = commit(dir, 'edit c', { 'src/c.js': 'c1' });         // orphan.test.js imports ../src/c.js, nothing selects it
  commit(dir, 'edit schema', { 'src/schema.sql': 'x' });          // part db selects tests/db.test.js
  write(dir, 'junit.xml', JUNIT);
  const r = ts(dir, ['misses', '--results', 'junit.xml', '--since', c0, '--json'], { json: true });
  assert.equal(r.code, 1, r.stdout + r.stderr);
  const by = Object.fromEntries(r.json.failing.map((f) => [f.test, f]));
  assert.equal(by['tests/orphan.test.js'].verdict, 'MISS');
  assert.equal(by['tests/orphan.test.js'].culprits[0].commit, c1.slice(0, 7));
  assert.equal(by['tests/orphan.test.js'].culprits[0].file, 'src/c.js');
  assert.match(by['tests/orphan.test.js'].proposal, /src\/c\.js/);
  assert.equal(by['tests/db.test.js'].verdict, 'SELECTED');
  assert.equal(by['tests/a.test.js'], undefined, 'a passing testcase is not reported');
  const human = ts(dir, ['misses', '--results', 'junit.xml', '--since', c0]);
  assert.match(human.stdout, /MISS\s+tests\/orphan\.test\.js/);
  assert.match(human.stdout, /nothing was edited/);
});

test('misses: only selected failures give exit 0, and the repo is never edited', () => {
  const { dir, c0 } = makeRepo();
  commit(dir, 'edit schema', { 'src/schema.sql': 'x' });
  write(dir, 'junit.xml', JUNIT.replace(/<testcase classname="tests.orphan"[\s\S]*?<\/testcase>/, ''));
  const before = fs.readFileSync(path.join(dir, '.test-scope/parts.json'), 'utf8');
  const r = ts(dir, ['misses', '--results', 'junit.xml', '--since', c0]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(fs.readFileSync(path.join(dir, '.test-scope/parts.json'), 'utf8'), before);
});

test('result parsers: vitest/jest json, go test -json, junit', () => {
  const vit = JSON.stringify({ testResults: [{ name: '/r/tests/a.test.js', status: 'failed', assertionResults: [] }, { name: '/r/tests/b.test.js', status: 'passed', assertionResults: [] }] });
  assert.deepEqual(parseResults(vit), ['/r/tests/a.test.js']);
  const go = ['{"Action":"run","Package":"ex/x"}', '{"Action":"fail","Package":"ex/x","Test":"TestA"}', '{"Action":"fail","Package":"ex/x"}', '{"Action":"pass","Package":"ex/y"}'].join('\n');
  assert.deepEqual(parseResults(go), [{ goPackage: 'ex/x', test: 'TestA' }, { goPackage: 'ex/x' }]);
  assert.deepEqual(parseResults(JUNIT), [{ classname: 'tests.orphan' }, 'tests/db.test.js']);
});
