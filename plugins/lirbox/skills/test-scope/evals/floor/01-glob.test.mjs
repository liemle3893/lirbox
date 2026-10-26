import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { matchGlob, matchesPaths, expandBraces } = await import(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'test-scope.mjs'));

test('** crosses directories, * stays in one, ? is one non-slash char', () => {
  assert.ok(matchGlob('server/src/pipeline/a/b.ts', 'server/src/pipeline/**'));
  assert.ok(!matchGlob('server/src/pipeline', 'server/src/pipeline/**'));
  assert.ok(!matchGlob('test/a/b.test.ts', 'test/*.test.ts'));
  assert.ok(matchGlob('test/b.test.ts', '**/*.test.ts'));
  assert.ok(matchGlob('b.test.ts', '**/*.test.ts'));
  assert.ok(matchGlob('a/b/c.ts', 'a/**/c.ts'));
  assert.ok(matchGlob('a/c.ts', 'a/**/c.ts'));
  assert.ok(matchGlob('ab.ts', '?b.ts'));
  assert.ok(!matchGlob('a/b.ts', 'a?b.ts'));
});

test('braces, including several groups and nesting; the dot is literal', () => {
  assert.deepEqual(expandBraces('x/{a,b}/{c,d}').sort(), ['x/a/c', 'x/a/d', 'x/b/c', 'x/b/d']);
  assert.ok(matchGlob('a.tsx', '*.{ts,tsx}'));
  assert.ok(matchGlob('src/domains/processing.ts', 'src/domains/{pipeline,processing}.ts'));
  assert.ok(!matchGlob('src/domains/files.ts', 'src/domains/{pipeline,processing}.ts'));
  assert.ok(matchGlob('a.test.ts', '*.{test,spec}.{ts,tsx}'));
  assert.ok(matchGlob('a/y/z', 'a/{x,y/{z,w}}'));
  assert.ok(!matchGlob('axts', 'a.ts'));
  assert.ok(matchGlob('a+b(1).ts', 'a+b(1).ts'), 'regex metacharacters are literal');
});

test('leading ! excludes win over any positive glob', () => {
  const paths = ['src/ai/**', '!src/ai/indexing.ts'];
  assert.ok(matchesPaths('src/ai/agent.ts', paths));
  assert.ok(!matchesPaths('src/ai/indexing.ts', paths));
  assert.ok(!matchesPaths('src/other.ts', paths));
  assert.ok(!matchesPaths('src/ai/x.ts', ['!src/ai/x.ts']), 'exclusion alone matches nothing');
});
