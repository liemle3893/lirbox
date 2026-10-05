// changecov: run the selected tests with coverage; changed functions/lines that no selected test executes are reported.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { tmp, git, commit, ts } from './_fixture.mjs';
import { makeJsRepo, edit, JS_PARTS } from './_js.mjs';

const range = ['changecov', '--changed', 'HEAD~1', '--to', 'HEAD'];

test('changecov flags a changed function no selected test executes (custom runner writing an lcov file)', () => {
  const { dir } = makeJsRepo();
  commit(dir, 'change both', { 'src/a.js': edit('both') });
  const r = ts(dir, range);
  assert.equal(r.code, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /executed\s+foo \(lines 1-3\)/);
  assert.match(r.stdout, /NOT RUN\s+bar \(lines 4-6\)/);
  assert.match(r.stdout, /uncovered changed lines: 5/);
  assert.match(r.stdout, /rule: every changed function executed at least once -> FAIL \(1 not executed/);
});

test('changecov passes when every changed function is executed by a selected test', () => {
  const { dir } = makeJsRepo();
  commit(dir, 'change foo only', { 'src/a.js': edit('foo') });
  const r = ts(dir, range);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /changed functions: 1, executed: 1/);
  assert.match(r.stdout, /-> PASS/);
});

test('--threshold switches the rule to changed-line coverage; a failing selected run is never a pass', () => {
  const { dir } = makeJsRepo();
  commit(dir, 'change both', { 'src/a.js': edit('both') });
  assert.equal(ts(dir, [...range, '--threshold', '50']).code, 0, '1 of 2 changed executable lines is 50%');
  assert.equal(ts(dir, [...range, '--threshold', '51']).code, 1);
  const parts = JSON.parse(JSON.stringify(JS_PARTS));
  parts.packages.app.coverage.cmd = 'node tools/fakecov.mjs {out} tests/a.test.js tests/fail.test.js'; // the run itself fails
  const bad = makeJsRepo({ parts });
  commit(bad.dir, 'change foo', { 'src/a.js': edit('foo'), 'tests/fail.test.js': "const t = require('node:test'); t('red', () => { throw new Error('red'); });" });
  const r = ts(bad.dir, range);
  assert.equal(r.code, 1, 'covered, but the selected tests failed');
  assert.match(r.stdout, /selected tests failed: YES/);
});

test('a runner with no coverage support is "not measurable" (exit 4), never a silent pass', () => {
  const parts = JSON.parse(JSON.stringify(JS_PARTS));
  delete parts.packages.app.coverage;
  const { dir } = makeJsRepo({ parts });
  commit(dir, 'change foo', { 'src/a.js': edit('foo') });
  const r = ts(dir, range);
  assert.equal(r.code, 4, r.stdout + r.stderr);
  assert.match(r.stdout, /not measurable: runner "custom" has no built-in coverage/);
});

test('a runner that writes no coverage file is not measurable, with the runner\'s own error', () => {
  const parts = JSON.parse(JSON.stringify(JS_PARTS));
  parts.packages.app.coverage = { file: 'cov/never.info', format: 'lcov' };
  const { dir } = makeJsRepo({ parts });
  commit(dir, 'change foo', { 'src/a.js': edit('foo') });
  const r = ts(dir, range);
  assert.equal(r.code, 4);
  assert.match(r.stdout, /wrote no coverage file \(cov\/never\.info\)/);
});

test('changed files that are only docs/tests/manifests: nothing to measure, said out loud', () => {
  const { dir } = makeJsRepo();
  commit(dir, 'doc', { 'README.md': 'x' });
  const r = ts(dir, range);
  assert.equal(r.code, 4, 'a markdown file is a changed source with no reader: not silently fine');
  commit(dir, 'test only', { 'tests/c.test.js': "const t = require('node:test'); t('x', () => {});" });
  const r2 = ts(dir, range);
  assert.equal(r2.code, 0);
  assert.match(r2.stdout, /no changed source file to measure/);
});

const hasGo = spawnSync('go', ['version']).status === 0;
test('go (real coverprofile): the untested changed function is reported', { skip: !hasGo && 'go not installed' }, () => {
  const dir = tmp('test-scope-gocov-');
  git(dir, 'init', '-q', '-b', 'main');
  const A = 'package a\n\nfunc A() int {\n\treturn 1\n}\n\nfunc B() int {\n\treturn 2\n}\n';
  commit(dir, 'init', {
    'go.mod': 'module ex\n\ngo 1.20\n', 'a/a.go': A,
    'a/a_test.go': 'package a\n\nimport "testing"\n\nfunc TestA(t *testing.T) {\n\tif A() != 1 {\n\t\tt.Fatal("a")\n\t}\n}\n',
    '.test-scope/parts.json': { packages: { go: { dir: '.', runner: 'go' } }, noTests: ['go.mod'], parts: {}, graphOnly: { go: ['**/*_test.go'] } },
  });
  commit(dir, 'edit both', { 'a/a.go': A.replace('return 1', 'return 0 + 1').replace('return 2', 'return 0 + 2') });
  const r = ts(dir, range);
  assert.equal(r.code, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /executed\s+A \(lines 3-5\)/);
  assert.match(r.stdout, /NOT RUN\s+B \(lines 7-9\)/);
});

test('go: a function executed only by ANOTHER package\'s test counts as executed (-coverpkg)', { skip: !hasGo && 'go not installed' }, () => {
  const dir = tmp('test-scope-gocov2-');
  git(dir, 'init', '-q', '-b', 'main');
  const A = 'package a\n\nfunc A() int {\n\treturn 1\n}\n';
  commit(dir, 'init', {
    'go.mod': 'module ex\n\ngo 1.20\n', 'a/a.go': A,
    'b/b.go': 'package b\n\nimport "ex/a"\n\nfunc B() int {\n\treturn a.A()\n}\n',
    'b/b_test.go': 'package b\n\nimport "testing"\n\nfunc TestB(t *testing.T) {\n\tif B() != 1 {\n\t\tt.Fatal("b")\n\t}\n}\n',
    '.test-scope/parts.json': { packages: { go: { dir: '.', runner: 'go' } }, noTests: ['go.mod'], parts: {}, graphOnly: { go: ['**/*_test.go'] } },
  });
  commit(dir, 'edit a', { 'a/a.go': A.replace('return 1', 'return 0 + 1') });
  const r = ts(dir, range);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /executed\s+A \(lines 3-5\)/);
});

const nodeMajor = parseInt(process.versions.node, 10);
test('node built-in coverage (real lcov reporter) through a coverage.cmd', { skip: nodeMajor < 22 && 'needs node >= 22' }, () => {
  const parts = JSON.parse(JSON.stringify(JS_PARTS));
  parts.packages.app.coverage.cmd = 'node --test --experimental-test-coverage --test-reporter=lcov --test-reporter-destination={out} {tests}';
  const { dir } = makeJsRepo({ parts });
  commit(dir, 'change both', { 'src/a.js': edit('both') });
  const r = ts(dir, range);
  assert.equal(r.code, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /NOT RUN\s+bar/);
  assert.match(r.stdout, /executed\s+foo/);
});

test('coverage readers: istanbul (statements + functions), py-json, lcov and go profiles normalise to repo paths', async () => {
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const { parseCoverage, fnExecuted } = await import(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'changecov.mjs'));
  const fs = await import('node:fs');
  const dir = tmp('test-scope-fmt-');
  fs.writeFileSync(path.join(dir, 'go.mod'), 'module ex\n');
  const H = { root: dir };
  const pkg = { dir: '.' };
  const ist = parseCoverage(H, pkg, 'istanbul', JSON.stringify({ [`${dir}/src/a.ts`]: { path: `${dir}/src/a.ts`, statementMap: { 0: { start: { line: 2 } }, 1: { start: { line: 6 } } }, s: { 0: 3, 1: 0 }, fnMap: { 0: { name: 'f', decl: { start: { line: 1 } } }, 1: { name: 'g', decl: { start: { line: 5 } } } }, f: { 0: 3, 1: 0 } } }));
  const a = ist.get('src/a.ts');
  assert.deepEqual([...a.lines], [[2, 3], [6, 0]]);
  assert.equal(fnExecuted(a, { startLine: 1, bodyOpenLine: 1, endLine: 3 }), true);
  assert.equal(fnExecuted(a, { startLine: 5, bodyOpenLine: 5, endLine: 7 }), false);
  const py = parseCoverage(H, pkg, 'py-json', JSON.stringify({ files: { 'pkg/m.py': { executed_lines: [2, 3], missing_lines: [5] } } })).get('pkg/m.py');
  assert.equal(fnExecuted(py, { startLine: 1, bodyOpenLine: 1, endLine: 3 }), true);
  assert.equal(fnExecuted(py, { startLine: 4, bodyOpenLine: 4, endLine: 5 }), false);
  assert.equal(fnExecuted(py, { startLine: 8, bodyOpenLine: 8, endLine: 9 }), null, 'no executable line known: not judged');
  const lcov = parseCoverage(H, { dir: '.' }, 'lcov', 'SF:x/y.js\nDA:1,0\nDA:2,4\nend_of_record\n').get('x/y.js');
  assert.deepEqual([...lcov.lines], [[1, 0], [2, 4]]);
  const go = parseCoverage(H, pkg, 'go', 'mode: set\nex/a/a.go:3.14,5.2 1 1\nex/a/a.go:7.14,9.2 1 0\n').get('a/a.go');
  assert.deepEqual([go.lines.get(4), go.lines.get(8)], [1, 0]);
  assert.throws(() => parseCoverage(H, pkg, 'nope', ''), /unknown coverage format/);
});
