// A real JS fixture for changecov / mutate / doctor: node:test files, a `custom` runner, and a fake coverage writer.
//   src/a.js has two functions: foo (tests/a.test.js asserts it; selected via the related map) and bar (asserted only
//   by tests/b.test.js, which the related map does NOT select: a hidden link). tests/c.test.js touches nothing.
import { tmp, git, commit } from './_fixture.mjs';

export const A0 = `function foo(x) {
  return x + 1;
}
function bar(x) {
  return x * 2;
}
module.exports = { foo, bar };
`;

const RELATED = `import fs from 'node:fs';
for (const f of process.argv.slice(2)) {
  const m = /^src\\/(.+)\\.js$/.exec(f);
  if (m && fs.existsSync('tests/' + m[1] + '.test.js')) console.log(f + '\\t' + 'tests/' + m[1] + '.test.js');
}
`;

// Fake coverage: run the tests for real, then write an lcov file marking src/a.js lines hit inside the functions named in
// "// covers: foo,bar" comments of the tests that ran. Stands in for a real coverage tool behind the same interface.
const FAKECOV = `import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
const [out, ...tests] = process.argv.slice(2);
const r = spawnSync(process.execPath, ['--test', ...tests], { stdio: 'inherit' });
const covered = new Set();
for (const t of tests) for (const m of fs.readFileSync(t, 'utf8').matchAll(/covers:\\s*([\\w,]+)/g)) m[1].split(',').forEach((x) => covered.add(x));
const src = fs.readFileSync('src/a.js', 'utf8').split('\\n');
const rec = ['SF:src/a.js'];
let fn = null;
src.forEach((l, i) => {
  const m = /^function (\\w+)/.exec(l);
  if (m) fn = m[1];
  if (fn && /^\\s+\\S/.test(l)) rec.push('DA:' + (i + 1) + ',' + (covered.has(fn) ? 1 : 0));
  if (/^}/.test(l)) fn = null;
});
rec.push('end_of_record');
fs.mkdirSync('cov', { recursive: true });
fs.writeFileSync(out, rec.join('\\n') + '\\n');
process.exit(r.status ?? 1);
`;

export const JS_PARTS = {
  noTests: [],
  runAll: [],
  packages: { app: { dir: '.', runner: 'custom', testGlobs: ['tests/**/*.test.js'], relatedCmd: 'node tools/related.mjs', cmd: 'node --test {tests}', coverage: { file: 'cov/lcov.info', format: 'lcov', cmd: 'node tools/fakecov.mjs {out} {tests}' } } },
  parts: { core: { description: 'a', paths: ['tools/**'], tests: { app: ['tests/a.test.js', 'tests/b.test.js', 'tests/c.test.js'] }, checks: [] } },
};

const test = (name, body) => `const t = require('node:test');\nconst assert = require('node:assert');\n${body}\n`;

/** c0 = foo/bar on disk, tests as above. */
export function makeJsRepo({ parts = JS_PARTS } = {}) {
  const dir = tmp('test-scope-js-');
  git(dir, 'init', '-q', '-b', 'main');
  const c0 = commit(dir, 'init', {
    'package.json': { name: 'fx', dependencies: {} },
    'src/a.js': A0,
    'tests/a.test.js': test('a', "// covers: foo\nconst { foo } = require('../src/a.js');\nt('foo', () => assert.equal(foo(1), 2));"),
    'tests/b.test.js': test('b', "// covers: bar\nconst { bar } = require('../src/a.js');\nt('bar', () => assert.equal(bar(2), 4));"),
    'tests/c.test.js': test('c', "t('unrelated', () => assert.ok(true));"),
    'tools/related.mjs': RELATED, 'tools/fakecov.mjs': FAKECOV,
    '.gitignore': 'cov/\n',
    '.test-scope/parts.json': parts,
  });
  return { dir, c0 };
}

/** Behaviour-preserving edits: `which` is 'foo', 'bar' or 'both'. */
export const edit = (which) => {
  let s = A0;
  if (which !== 'bar') s = s.replace('x + 1', '1 + x');
  if (which !== 'foo') s = s.replace('x * 2', '2 * x');
  return s;
};
