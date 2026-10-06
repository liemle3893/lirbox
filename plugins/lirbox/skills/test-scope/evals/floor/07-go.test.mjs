// go adapter: `go list -deps -test -json` reverse closure. Skipped when go is absent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { tmp, commit, git, selectJson, files } from './_fixture.mjs';

const hasGo = spawnSync('go', ['version']).status === 0;

test('go: a change selects the tests of its package and of every importer; not unrelated packages', { skip: !hasGo && 'go not installed' }, () => {
  const dir = tmp('test-scope-go-');
  git(dir, 'init', '-q', '-b', 'main');
  commit(dir, 'init', {
    'go.mod': 'module ex\n\ngo 1.20\n',
    'a/a.go': 'package a\n\nfunc A() int { return 1 }\n', 'a/a_test.go': 'package a\n\nimport "testing"\n\nfunc TestA(t *testing.T) { _ = A() }\n',
    'b/b.go': 'package b\n\nimport "ex/a"\n\nfunc B() int { return a.A() }\n', 'b/b_test.go': 'package b\n\nimport "testing"\n\nfunc TestB(t *testing.T) { _ = B() }\n',
    'c/c.go': 'package c\n\nfunc C() int { return 1 }\n', 'c/c_test.go': 'package c\n\nimport "testing"\n\nfunc TestC(t *testing.T) { _ = C() }\n',
    '.test-scope/parts.json': { packages: { go: { dir: '.', runner: 'go' } }, noTests: ['go.mod'], parts: {}, graphOnly: { go: ['**/*_test.go'] } },
  });
  commit(dir, 'edit a', { 'a/a.go': 'package a\n\nfunc A() int { return 2 }\n' });
  const r = selectJson(dir);
  assert.equal(r.code, 0, r.stderr + r.stdout);
  assert.deepEqual(files(r), ['a/a_test.go', 'b/b_test.go']);
  commit(dir, 'edit c', { 'c/c.go': 'package c\n\nfunc C() int { return 3 }\n' });
  assert.deepEqual(files(selectJson(dir)), ['c/c_test.go']);
});
