#!/usr/bin/env node
/*
 * Build a hermetic fixture repo → git bundle for the arena. Deterministic: fixed author/committer
 * date so the committed bundle is reproducible and auditable. Fixtures are small MULTI-MODULE apps
 * (store + service + cli [+ app] + tests) so the arena's change-request can legitimately engage
 * conductor — the Task 0 spike proved headless claude bypasses conductor for one-file features.
 *
 * Variants (--fixture, default "notes-app"):
 *   notes-app     clean base app — feature tasks (add-tags, archive, search, import-export) build on it.
 *   notes-app-v2  adds a file-backed entrypoint (src/app.js) and PLANTS a persistence bug —
 *                 Store.load drops the id sequence — for SWE-bench-style bug-FIX tasks
 *                 (fault localization: symptom at the CLI, root cause in the store). The base
 *                 test suite deliberately never crosses a save→load→add cycle, so it is green
 *                 on the buggy base (PASS_TO_PASS) while the hidden graders are red.
 *
 * Usage: node make-fixture.cjs --task <id> --dir <workroot> [--bundle <path>] [--fixture <name>]
 * Prints: SHA=<commit>  BUNDLE=<path>
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function arg(name, def) { const i = process.argv.indexOf('--' + name); return i > -1 ? process.argv[i + 1] : def; }
const task = arg('task');
const dir = arg('dir');
const fixture = arg('fixture', 'notes-app');
if (!task || !dir) { console.error('usage: make-fixture.cjs --task <id> --dir <workroot> [--bundle <path>] [--fixture <name>]'); process.exit(1); }
const bundle = arg('bundle', path.join('plugins', 'lirbox', 'skills', 'conductor', 'arena', 'tasks', task, 'repo.bundle'));

const STORE_V1 =
  '// In-memory note store with JSON persistence.\n' +
  'const fs = require("fs");\n' +
  'class Store {\n' +
  '  constructor() { this.notes = []; this.seq = 0; }\n' +
  '  add(text) { const n = { id: ++this.seq, text, done: false }; this.notes.push(n); return n; }\n' +
  '  get(id) { return this.notes.find(n => n.id === id) || null; }\n' +
  '  all() { return this.notes.slice(); }\n' +
  '  save(path) { fs.writeFileSync(path, JSON.stringify({ notes: this.notes, seq: this.seq })); }\n' +
  '  static load(path) { const s = new Store(); const d = JSON.parse(fs.readFileSync(path, "utf8")); s.notes = d.notes; s.seq = d.seq; return s; }\n' +
  '}\n' +
  'module.exports = { Store };\n';

const SERVICE =
  '// Business logic over the store.\n' +
  'const { Store } = require("./store");\n' +
  'class NoteService {\n' +
  '  constructor(store) { this.store = store || new Store(); }\n' +
  '  create(text) { if (!text) throw new Error("text required"); return this.store.add(text); }\n' +
  '  complete(id) { const n = this.store.get(id); if (!n) throw new Error("not found"); n.done = true; return n; }\n' +
  '  pending() { return this.store.all().filter(n => !n.done); }\n' +
  '}\n' +
  'module.exports = { NoteService };\n';

const FIXTURES = {
  'notes-app': {
    'package.json': JSON.stringify({ name: 'notes-app', version: '1.0.0', scripts: { test: 'node test/run.js' } }, null, 2) + '\n',
    'src/store.js': STORE_V1,
    'src/service.js': SERVICE,
    'src/cli.js':
      '// Tiny CLI: `node src/cli.js add "text"` | `list`.\n' +
      'const { NoteService } = require("./service");\n' +
      'function run(argv, svc) {\n' +
      '  const [cmd, ...rest] = argv;\n' +
      '  if (cmd === "add") return svc.create(rest.join(" "));\n' +
      '  if (cmd === "list") return svc.pending();\n' +
      '  throw new Error("unknown command: " + cmd);\n' +
      '}\n' +
      'module.exports = { run };\n',
    'test/run.js':
      'const assert = require("assert");\n' +
      'const { Store } = require("../src/store");\n' +
      'const { NoteService } = require("../src/service");\n' +
      'const { run } = require("../src/cli");\n' +
      'const svc = new NoteService();\n' +
      'const a = svc.create("write spec");\n' +
      'assert.strictEqual(a.id, 1);\n' +
      'assert.strictEqual(svc.pending().length, 1);\n' +
      'svc.complete(1);\n' +
      'assert.strictEqual(svc.pending().length, 0);\n' +
      'assert.strictEqual(run(["add", "via", "cli"], svc).text, "via cli");\n' +
      'console.log("all tests passed");\n',
    'README.md': '# notes-app\n\nA tiny multi-module notes app (store → service → cli). `npm test` runs the suite.\n',
  },
  'notes-app-v2': {
    'package.json': JSON.stringify({ name: 'notes-app', version: '2.0.0', scripts: { test: 'node test/run.js' } }, null, 2) + '\n',
    // PLANTED BUG: load() restores notes but forgets the id sequence (seq stays 0).
    'src/store.js': STORE_V1.replace(
      '  static load(path) { const s = new Store(); const d = JSON.parse(fs.readFileSync(path, "utf8")); s.notes = d.notes; s.seq = d.seq; return s; }\n',
      '  static load(path) { const s = new Store(); const d = JSON.parse(fs.readFileSync(path, "utf8")); s.notes = d.notes; return s; }\n'
    ),
    'src/service.js': SERVICE,
    'src/cli.js':
      '// Tiny CLI: `add "text"` | `list` | `done <id>`.\n' +
      'const { NoteService } = require("./service");\n' +
      'function run(argv, svc) {\n' +
      '  const [cmd, ...rest] = argv;\n' +
      '  if (cmd === "add") return svc.create(rest.join(" "));\n' +
      '  if (cmd === "list") return svc.pending();\n' +
      '  if (cmd === "done") return svc.complete(Number(rest[0]));\n' +
      '  throw new Error("unknown command: " + cmd);\n' +
      '}\n' +
      'module.exports = { run };\n',
    'src/app.js':
      '// File-backed entrypoint: load the store (if the file exists), run one CLI command, save back.\n' +
      'const fs = require("fs");\n' +
      'const { Store } = require("./store");\n' +
      'const { NoteService } = require("./service");\n' +
      'const { run } = require("./cli");\n' +
      'function main(argv, file) {\n' +
      '  const store = fs.existsSync(file) ? Store.load(file) : new Store();\n' +
      '  const svc = new NoteService(store);\n' +
      '  const result = run(argv, svc);\n' +
      '  store.save(file);\n' +
      '  return result;\n' +
      '}\n' +
      'module.exports = { main };\n',
    'test/run.js':
      'const assert = require("assert");\n' +
      'const fs = require("fs");\n' +
      'const os = require("os");\n' +
      'const path = require("path");\n' +
      'const { NoteService } = require("../src/service");\n' +
      'const { run } = require("../src/cli");\n' +
      'const { main } = require("../src/app");\n' +
      'const svc = new NoteService();\n' +
      'const a = svc.create("write spec");\n' +
      'assert.strictEqual(a.id, 1);\n' +
      'assert.strictEqual(svc.pending().length, 1);\n' +
      'svc.complete(1);\n' +
      'assert.strictEqual(svc.pending().length, 0);\n' +
      'assert.strictEqual(run(["add", "via", "cli"], svc).text, "via cli");\n' +
      'assert.strictEqual(run(["done", "2"], svc).done, true);\n' +
      'const f = path.join(os.tmpdir(), "notes-app-v2-test-" + process.pid + ".json");\n' +
      'try { fs.unlinkSync(f); } catch (e) { /* fresh */ }\n' +
      'main(["add", "persisted"], f);\n' +
      'assert.strictEqual(main(["list"], f).length, 1);\n' +
      'fs.unlinkSync(f);\n' +
      'console.log("all tests passed");\n',
    'README.md': '# notes-app v2\n\nA tiny multi-module notes app (store → service → cli) with a file-backed entrypoint (`src/app.js`). `npm test` runs the suite.\n',
  },
};

// Commit messages are PINNED per fixture — changing one changes the bundle sha and breaks
// re-derivability of already-committed bundles.
const COMMIT_MSG = {
  'notes-app': 'initial: notes-app (store + service + cli + tests)',
  'notes-app-v2': 'initial: notes-app-v2 (store + service + cli + app + tests)',
};

const FILES = FIXTURES[fixture];
if (!FILES) { console.error(`unknown fixture "${fixture}" (have: ${Object.keys(FIXTURES).join(', ')})`); process.exit(1); }

fs.mkdirSync(dir, { recursive: true });
for (const [rel, content] of Object.entries(FILES)) {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

const DATE = '2026-01-01T00:00:00Z';
const env = Object.assign({}, process.env, {
  GIT_AUTHOR_DATE: DATE, GIT_COMMITTER_DATE: DATE,
  GIT_AUTHOR_NAME: 'arena-fixture', GIT_AUTHOR_EMAIL: 'fixture@arena.local',
  GIT_COMMITTER_NAME: 'arena-fixture', GIT_COMMITTER_EMAIL: 'fixture@arena.local',
});
const git = (args) => execFileSync('git', ['-C', dir, '-c', 'commit.gpgsign=false', ...args], { env, encoding: 'utf8' });
git(['init', '-q']);
git(['add', '-A']);
git(['commit', '-q', '-m', COMMIT_MSG[fixture]]);
const sha = git(['rev-parse', 'HEAD']).trim();

fs.mkdirSync(path.dirname(bundle), { recursive: true });
try { fs.unlinkSync(bundle); } catch (e) { /* first time */ }
git(['bundle', 'create', path.resolve(bundle), '--all']);

console.log('SHA=' + sha);
console.log('BUNDLE=' + bundle);
