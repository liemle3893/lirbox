// trace / hubs / graphCuts. Python graph (stdlib) and Go graph are real; the JS path runs through the real
// esbuild_graph.mjs against a tiny stand-in `esbuild` module in the fixture's node_modules (the real one is a project dependency).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { tmp, git, commit, ts, selectJson, files } from './_fixture.mjs';

const hasPy = spawnSync('python3', ['--version']).status === 0;
const hasGo = spawnSync('go', ['version']).status === 0;

// app.py is the "composition root": it imports every domain; test_app only touches app.
function pyRepo({ cuts = [], parts = {} } = {}) {
  const dir = tmp('test-scope-graph-');
  git(dir, 'init', '-q', '-b', 'main');
  commit(dir, 'init', {
    'dom_a.py': 'A = 1\n', 'dom_b.py': 'B = 1\n', 'app.py': 'import dom_a\nimport dom_b\n',
    'tests/test_app.py': 'import app\n', 'tests/test_a.py': 'import dom_a\n', 'tests/test_b.py': 'import dom_b\n',
    '.test-scope/parts.json': { packages: { py: { dir: '.', runner: 'pytest' } }, noTests: [], parts, graphOnly: { py: ['tests/**'] }, graphCuts: cuts },
  });
  commit(dir, 'edit a', { 'dom_a.py': 'A = 2\n' });
  return dir;
}
const py = { skip: !hasPy && 'python3 not installed' };

test('trace prints the shortest import chain from a test to a source (python graph)', py, () => {
  const dir = pyRepo();
  const r = ts(dir, ['trace', 'tests/test_app.py', 'dom_a.py']);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.deepEqual(r.stdout.split('\n').slice(1, 4).map((l) => l.replace(/\s+/g, ' ').trim()), ['tests/test_app.py', '-> app.py', '-> dom_a.py']);
  assert.match(r.stdout, /2 hop\(s\)/);
  const none = ts(dir, ['trace', 'tests/test_b.py', 'dom_a.py']);
  assert.equal(none.code, 1);
  assert.match(none.stdout, /no import path/);
});

test('hubs ranks the nodes the chains pass through and says how many tests ONLY that node reaches; recommends refactor before a cut', py, () => {
  const dir = pyRepo();
  const r = ts(dir, ['hubs', '--changed', 'HEAD~1', '--to', 'HEAD', '--json'], { json: true });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const [pkg] = r.json;
  assert.equal(pkg.graphTests, 2);
  assert.deepEqual(pkg.hubs.map((h) => [h.node, h.chains, h.onlyVia]), [['app.py', 1, 1]]);
  const human = ts(dir, ['hubs', '--source', 'dom_a.py']);
  assert.match(human.stdout, /1\s+1\s+50%\s+1\s+0\s+app\.py/);
  assert.ok(human.stdout.indexOf('refactor first') < human.stdout.indexOf('interim only'), 'refactor is recommended before graphCuts');
  assert.match(human.stdout, /"graphCuts": \["app\.py"\] drops 1 test/);
  assert.deepEqual(pkg.chains, [{ test: 'tests/test_a.py', chain: ['tests/test_a.py', 'dom_a.py'] }, { test: 'tests/test_app.py', chain: ['tests/test_app.py', 'app.py', 'dom_a.py'] }], 'every graph-selected test gets its chain');
  assert.match(human.stdout, /chains \(shortest import chain per graph-selected test, 2\):\n  tests\/test_a\.py -> dom_a\.py\n  tests\/test_app\.py -> app\.py -> dom_a\.py/);
});

test('graphCuts: select drops graph-only tests whose every path crosses the cut, and says so', py, () => {
  const full = pyRepo();
  assert.deepEqual(files(selectJson(full)), ['tests/test_a.py', 'tests/test_app.py']);
  const cut = pyRepo({ cuts: ['app.py'] });
  const r = selectJson(cut);
  assert.equal(r.code, 0, r.stderr + r.stdout);
  assert.deepEqual(files(r), ['tests/test_a.py']);
  assert.deepEqual(r.json.selection.cutDropped.map((d) => d.file), ['tests/test_app.py']);
  assert.match(ts(cut, ['select', '--changed', 'HEAD~1', '--to', 'HEAD']).stdout, /graphCuts dropped 1 graph-only test\(s\)/);
});

test('graphCuts coverage rule: a module behind the cut with no owning part FAILS coverage; owning it fixes it', py, () => {
  const bad = pyRepo({ cuts: ['app.py'] });
  const r = ts(bad, ['coverage']);
  assert.equal(r.code, 1, r.stdout);
  assert.match(r.stdout, /CUT-UNOWNED modules \(2\)[\s\S]*dom_a\.py: 1 test\(s\) reach it only through a graphCut/);
  const parts = { mods: { description: 'domains', paths: ['dom_*.py'], tests: { py: ['tests/test_app.py'] } } };
  const good = pyRepo({ cuts: ['app.py'], parts });
  const ok = ts(good, ['coverage']);
  assert.equal(ok.code, 0, ok.stdout);
  assert.match(ok.stdout, /coverage clean/);
  // and the owning part now selects the dropped test again: nothing is lost
  assert.deepEqual(files(selectJson(good)), ['tests/test_a.py', 'tests/test_app.py']);
});

// ── JS through esbuild_graph.mjs ──
const ESBUILD_STUB = `const fs = require('fs'), path = require('path');
exports.build = async (o) => {
  const inputs = {}, seen = new Set();
  const rel = (f) => path.relative(o.absWorkingDir, f).split(path.sep).join('/');
  const visit = (f) => {
    if (seen.has(f)) return; seen.add(f);
    const src = fs.readFileSync(f, 'utf8'), imports = [];
    for (const m of src.matchAll(/(?:require\\(|from\\s+)['"](\\.[^'"]+)['"]/g)) {
      let p = path.resolve(path.dirname(f), m[1]); if (!fs.existsSync(p) && fs.existsSync(p + '.js')) p += '.js';
      imports.push({ path: rel(p), kind: 'import-statement' }); visit(p);
    }
    inputs[rel(f)] = { bytes: src.length, imports };
  };
  o.entryPoints.forEach(visit);
  return { metafile: { inputs, outputs: {} } };
};
`;
function jsRepo({ withEsbuild = true } = {}) {
  const dir = tmp('test-scope-jsgraph-');
  git(dir, 'init', '-q', '-b', 'main');
  commit(dir, 'init', {
    'package.json': { name: 'fx', devDependencies: { vitest: '1' } },
    ...(withEsbuild ? { 'node_modules/esbuild/package.json': { name: 'esbuild', main: 'index.js' }, 'node_modules/esbuild/index.js': ESBUILD_STUB } : {}),
    '.gitignore': withEsbuild ? '' : 'node_modules/\n',
    'src/dom/a.js': 'exports.a = 1;\n', 'src/dom/b.js': 'exports.b = 1;\n', 'src/registry.js': "require('./dom/a.js'); require('./dom/b.js');\n", 'src/app.js': "require('./registry.js');\n",
    'tests/app.test.js': "require('../src/app.js');\n", 'tests/a.test.js': "require('../src/dom/a.js');\n", 'tests/b.test.js': "require('../src/dom/b.js');\n",
    '.test-scope/parts.json': { packages: { app: { dir: '.', runner: 'vitest', testGlobs: ['tests/**/*.test.js'] } }, noTests: [], parts: {}, graphOnly: { app: ['tests/**'] } },
  });
  commit(dir, 'edit a', { 'src/dom/a.js': 'exports.a = 2;\n' });
  return dir;
}

test('JS: trace and hubs read the esbuild metafile; the composition root chain is found and ranked', () => {
  const dir = jsRepo();
  const t = ts(dir, ['trace', 'tests/app.test.js', 'src/dom/a.js']);
  assert.equal(t.code, 0, t.stdout + t.stderr);
  assert.deepEqual(t.stdout.split('\n').slice(1, 5).map((l) => l.replace(/\s+/g, ' ').trim()), ['tests/app.test.js', '-> src/app.js', '-> src/registry.js', '-> src/dom/a.js']);
  const h = ts(dir, ['hubs', '--changed', 'HEAD~1', '--to', 'HEAD', '--json'], { json: true });
  assert.equal(h.code, 0, h.stdout + h.stderr);
  const [pkg] = h.json;
  assert.deepEqual(pkg.hubs.map((x) => [x.node, x.onlyVia]), [['src/app.js', 1], ['src/registry.js', 1]]);
});

test('JS without esbuild: trace/hubs say "not measurable" with the reason (exit 4), never an empty answer', () => {
  const dir = jsRepo({ withEsbuild: false });
  const t = ts(dir, ['trace', 'tests/app.test.js', 'src/dom/a.js']);
  assert.equal(t.code, 4, t.stdout + t.stderr);
  assert.match(t.stdout, /not measurable: trace: esbuild is not resolvable/);
  assert.equal(ts(dir, ['hubs', '--source', 'src/dom/a.js']).code, 4);
});

test('graphCuts with no graph available is not applied and says so (the runner graph stays)', () => {
  const dir = jsRepo({ withEsbuild: false });
  git(dir, 'checkout', '-q', '-b', 'cuts');
  commit(dir, 'cuts', { '.test-scope/parts.json': { packages: { app: { dir: '.', runner: 'vitest', testGlobs: ['tests/**/*.test.js'] } }, noTests: [], parts: {}, graphOnly: { app: ['tests/**'] }, graphCuts: ['src/app.js'] } });
  const r = ts(dir, ['select', '--changed', 'HEAD~1', '--to', 'HEAD']);
  assert.match(r.stdout, /graphCuts not applied \(esbuild is not resolvable/);
});

test('go: trace walks test -> package -> imported package (go list graph)', { skip: !hasGo && 'go not installed' }, () => {
  const dir = tmp('test-scope-gotrace-');
  git(dir, 'init', '-q', '-b', 'main');
  commit(dir, 'init', {
    'go.mod': 'module ex\n\ngo 1.20\n',
    'a/a.go': 'package a\n\nfunc A() int { return 1 }\n', 'b/b.go': 'package b\n\nimport "ex/a"\n\nfunc B() int { return a.A() }\n',
    'b/b_test.go': 'package b\n\nimport "testing"\n\nfunc TestB(t *testing.T) { _ = B() }\n',
    '.test-scope/parts.json': { packages: { go: { dir: '.', runner: 'go' } }, noTests: ['go.mod'], parts: {}, graphOnly: { go: ['**/*_test.go'] } },
  });
  const r = ts(dir, ['trace', 'b/b_test.go', 'a/a.go']);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.deepEqual(r.stdout.split('\n').slice(1, 4).map((l) => l.replace(/\s+/g, ' ').trim()), ['b/b_test.go', '-> b', '-> a']);
});
