// Throwaway git fixture for the test-scope floor. No network, no installs: the runner is `custom`.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const made = [];
process.on('exit', () => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
export const tmp = (prefix) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); made.push(d); return d; };

export const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'test-scope.mjs');

export const git = (dir, ...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

export function write(dir, rel, content) {
  const f = path.join(dir, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
}

export function commit(dir, msg, files = {}) {
  for (const [rel, c] of Object.entries(files)) write(dir, rel, c);
  git(dir, 'add', '-A');
  git(dir, '-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', msg);
  return git(dir, 'rev-parse', 'HEAD');
}

// `custom` runner: tools/related.mjs prints "<src>\t<test>" for every changed src/X.js with a tests/X.test.js.
const RELATED = `import fs from 'node:fs';
for (const f of process.argv.slice(2)) {
  const m = /^src\\/(.+)\\.js$/.exec(f);
  if (m && fs.existsSync('tests/' + m[1] + '.test.js')) console.log(f + '\\t' + 'tests/' + m[1] + '.test.js');
}
`;

export const PARTS = {
  noTests: ['docs/**', '**/*.md'],
  runAll: ['config/runner.json'],
  packages: { app: { dir: '.', runner: 'custom', testGlobs: ['tests/**/*.test.js'], exclude: ['tests/live.test.js'], relatedCmd: 'node tools/related.mjs', cmd: 'node --test {files}' } },
  parts: {
    db: { description: 'schema', paths: ['src/schema.sql'], tests: { app: ['tests/db.test.js'] }, checks: [] },
    'a-extra': { description: 'a also breaks b', paths: ['src/a.js'], tests: { app: ['tests/b.test.js'] }, checks: [] },
    core: { description: 'owns a', paths: ['tools/**'], tests: { app: ['tests/a.test.js'] }, checks: [] },
  },
  graphOnly: { app: ['tests/orphan.test.js'] },
};

/** c0: a,b,db,orphan,live tests + sources. Returns { dir, c0 }. */
export function makeRepo({ parts = PARTS } = {}) {
  const dir = tmp('test-scope-');
  git(dir, 'init', '-q', '-b', 'main');
  const c0 = commit(dir, 'init', {
    'package.json': { name: 'fx', scripts: { test: 'x' }, dependencies: { left: '1.0.0' } },
    'src/a.js': 'a0', 'src/b.js': 'b0', 'src/c.js': 'c0', 'src/schema.sql': 'create table t();',
    'docs/readme.md': 'doc', 'config/runner.json': '{}', 'tools/related.mjs': RELATED,
    'tests/a.test.js': 'a', 'tests/b.test.js': 'b', 'tests/db.test.js': 'db',
    'tests/orphan.test.js': "require('../src/c.js')", 'tests/live.test.js': 'live',
    '.test-scope/parts.json': parts,
  });
  return { dir, c0 };
}

export function ts(dir, args, { json = false } = {}) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: dir, encoding: 'utf8' });
  const out = { code: r.status, stdout: r.stdout, stderr: r.stderr };
  if (json) { try { out.json = JSON.parse(r.stdout); } catch { out.json = null; } }
  return out;
}

export const selectJson = (dir, base = 'HEAD~1', to = 'HEAD') => ts(dir, ['select', '--changed', base, '--to', to, '--json'], { json: true });
export const files = (r) => r.json.selection.entries.map((e) => e.file).sort();
