// pytest adapter: bundled py_related.py (stdlib only). Skipped when python3 is absent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { tmp, commit, git, selectJson, files } from './_fixture.mjs';

const hasPy = spawnSync('python3', ['--version']).status === 0;

test('pytest: a change reaches the tests that import it transitively; unrelated tests stay out', { skip: !hasPy && 'python3 not installed' }, () => {
  const dir = tmp('test-scope-py-');
  git(dir, 'init', '-q', '-b', 'main');
  commit(dir, 'init', {
    'pkg/__init__.py': '', 'pkg/core.py': 'X = 1', 'pkg/util.py': 'from . import core\n', 'pkg/other.py': 'Y = 1', 'pkg/lonely.py': 'Z = 1',
    'tests/test_util.py': 'from pkg.util import *\n', 'tests/test_other.py': 'import pkg.other\n', 'tests/test_pkg.py': 'import pkg\n',
    '.test-scope/parts.json': { packages: { py: { dir: '.', runner: 'pytest' } }, noTests: [], parts: {}, graphOnly: { py: ['tests/**'] } },
  });
  commit(dir, 'edit core', { 'pkg/core.py': 'X = 2' });
  let r = selectJson(dir);
  assert.equal(r.code, 0, r.stderr + r.stdout);
  // pkg/util imports core (relative); test_util imports util; test_pkg imports the pkg package (runs __init__ only: not core)
  assert.deepEqual(files(r), ['tests/test_util.py']);
  assert.equal(r.json.selection.graph.py, 'resolved');
  commit(dir, 'edit lonely', { 'pkg/lonely.py': 'Z = 2' });
  r = selectJson(dir);
  assert.equal(r.code, 3, 'no test imports pkg/lonely.py: uncovered');
  assert.deepEqual(r.json.selection.uncovered, ['pkg/lonely.py']);
});
