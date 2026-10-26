// Function finder, mutation text and diff-line parsing: the shared core of changecov and mutate.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const { findFunctions, mutateText, changedFunctions, parseDiffLines, blank, rangeText } = await import(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'funcs.mjs'));

const JS = `import x from 'y';
export function a(p: number): { q: number } {
  const s = "}{ not a brace"; // } also not
  return { q: p };
}
const b = async (x) => {
  return \`\${x}\${'}'}\`;
};
const c = (x) => x + 1;
class K {
  constructor(v) { this.v = v; }
  async m() {
    if (x) { y(); }
  }
}
const re = /a{2}[}]\\//g;
`;

test('blank() hides braces inside strings, comments, templates and regex literals', () => {
  const b = blank(JS, 'js');
  assert.equal(b.length, JS.length);
  assert.equal((b.match(/\{/g) || []).length, (b.match(/\}/g) || []).length, 'braces balance once literals are blanked');
  assert.ok(!b.includes('not a brace') && !b.includes('also not'));
});

test('JS/TS: named, async-arrow, constructor and method bodies are found with exact line ranges; expression arrows are not', () => {
  const fns = findFunctions(JS, 'js');
  assert.deepEqual(fns.map((f) => [f.name, f.startLine, f.endLine]), [['a', 2, 5], ['b', 6, 8], ['constructor', 11, 11], ['m', 12, 14]]);
});

test('a JS mutant throws at function entry, keeps the module importable and carries the marker', () => {
  const src = 'function foo(x) {\n  return x + 1;\n}\nmodule.exports = { foo };\n';
  const [f] = findFunctions(src, 'js');
  const mutated = mutateText(src, 'js', f, 'TSMUT:x:1');
  assert.match(mutated, /function foo\(x\) \{ throw new Error\("TSMUT:x:1"\);/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-funcs-'));
  fs.writeFileSync(path.join(dir, 'm.js'), mutated);
  const r = spawnSync(process.execPath, ['-e', "const m = require('./m.js'); try { m.foo(1); process.exit(1); } catch (e) { console.log(e.message); }"], { cwd: dir, encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), 'TSMUT:x:1', 'import worked; calling the function threw the marker');
});

test('Python: multi-line signature and docstring are respected, one-line defs are reported not mutable', () => {
  const py = 'def a(x,\n      y=1):\n    """doc"""\n    return x\n\nclass K:\n    def one(self): return 2\n    def two(self):\n        return 3\n';
  const fns = findFunctions(py, 'py');
  assert.deepEqual(fns.map((f) => [f.name, f.startLine, f.endLine, f.mutable]), [['a', 1, 4, true], ['one', 7, 7, false], ['two', 8, 9, true]]);
  const m = mutateText(py, 'py', fns[0], 'M');
  assert.match(m, /"""doc"""\n    raise RuntimeError\("M"\)\n    return x/);
});

test('Go: functions, methods and closures; the mutant is a panic at entry', () => {
  const go = 'package a\nfunc A() int { return 1 }\nfunc (s *S) B(x int) (int, error) {\n\tf := func(y int) int { return y }\n\treturn f(x), nil\n}\n';
  const fns = findFunctions(go, 'go');
  assert.deepEqual(fns.map((f) => f.name), ['A', 'B', 'func literal']);
  assert.match(mutateText(go, 'go', fns[0], 'M'), /func A\(\) int \{ panic\("M"\); return 1 \}/);
});

test('changedFunctions picks the innermost function per changed line; module-level lines are reported', () => {
  const fns = findFunctions(JS, 'js');
  const { functions, moduleLevel } = changedFunctions(fns, new Set([7, 13, 16]));
  assert.deepEqual(functions.map((f) => f.name), ['b', 'm']);
  assert.deepEqual(moduleLevel, [16]);
});

test('parseDiffLines reads -U0 hunks: new-side lines, and deletion points as touches', () => {
  const diff = ['diff --git a/x.js b/x.js', '--- a/x.js', '+++ b/x.js', '@@ -3,0 +4,2 @@', '+a', '+b', '@@ -9 +11 @@', '-c', '+d', '@@ -20,2 +22,0 @@', '-e', '-f', '+++ /dev/null'].join('\n');
  const m = parseDiffLines(diff);
  assert.deepEqual([...m.get('x.js').lines], [4, 5, 11]);
  assert.deepEqual([...m.get('x.js').touch], [22]);
  assert.equal(rangeText([1, 2, 3, 7, 9, 10]), '1-3,7,9-10');
});
