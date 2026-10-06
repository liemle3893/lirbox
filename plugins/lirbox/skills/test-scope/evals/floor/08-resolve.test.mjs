// Regression: the vitest/jest resolver must go through the package wrapper, take a relative dir,
// and report the real error line. No real vitest needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeRepo, commit, ts, PARTS, tmp } from './_fixture.mjs';

const scripts = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts');
const { errorSummary } = await import(path.join(scripts, 'test-scope.mjs'));

test('(a) select --resolve runs the vitest resolver through the package wrapper', () => {
  const parts = { ...PARTS, packages: { app: { dir: '.', runner: 'vitest', testGlobs: ['tests/**/*.test.js'], wrapper: 'echo WRAP' } } };
  const { dir } = makeRepo({ parts });
  commit(dir, 'edit a', { 'src/a.js': 'a1' });
  const trace = path.join(tmp('trace-'), 'cmds');
  const r = spawnSync(process.execPath, [path.join(scripts, 'test-scope.mjs'), 'select', '--changed', 'HEAD~1', '--to', 'HEAD', '--resolve', '--json'], { cwd: dir, encoding: 'utf8', env: { ...process.env, TEST_SCOPE_TRACE: trace } });
  const cmds = fs.readFileSync(trace, 'utf8').split('\n').filter(Boolean);
  const resolver = cmds.filter((c) => c.includes('vitest_related.mjs'));
  assert.equal(resolver.length, 1, r.stdout + r.stderr);
  assert.match(resolver[0], /^echo WRAP node \S*vitest_related\.mjs /);
});

test('(b) vitest_related.mjs accepts a relative package dir', () => {
  const r = spawnSync(process.execPath, [path.join(scripts, 'vitest_related.mjs'), '--print-args', 'pkg/sub', 'src/a.ts'], { cwd: os.tmpdir(), encoding: 'utf8' });
  const j = JSON.parse(r.stdout);
  assert.equal(j.pkgDir, path.join(os.tmpdir(), 'pkg/sub'));
  assert.deepEqual(j.rels, ['src/a.ts']);
});

test('(c) the warning carries the Error line, not the trailing Node.js version line', () => {
  const sample = `file:///x/vitest.config.ts:3\nthrow new Error('run vitest through scripts/heavy.sh');\n^\n\nError: run vitest through scripts/heavy.sh\n    at file:///x/vitest.config.ts:3:7\n    at ModuleJob.run (node:internal/modules/esm/module_job:1)\n\nNode.js v24.19.0\n`;
  assert.equal(errorSummary(sample), 'Error: run vitest through scripts/heavy.sh');
  assert.equal(errorSummary('\nNode.js v24.19.0\n', 'x'), 'x');
  assert.equal(errorSummary('something odd happened\nNode.js v20'), 'something odd happened');
});
