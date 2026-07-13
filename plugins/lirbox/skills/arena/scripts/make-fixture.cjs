#!/usr/bin/env node
/*
 * Build a hermetic fixture repo → git bundle for the arena. Deterministic: fixed author/committer
 * date so the committed bundle is reproducible and auditable. The fixture is a small MULTI-MODULE app
 * (store + service + cli + tests) so the arena's change-request can legitimately engage conductor —
 * the Task 0 spike proved headless claude bypasses conductor for one-file features.
 *
 * Usage: node make-fixture.cjs --task <id> --dir <workroot> [--bundle <path>]
 * Prints: SHA=<commit>  BUNDLE=<path>
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function arg(name, def) { const i = process.argv.indexOf('--' + name); return i > -1 ? process.argv[i + 1] : def; }
const task = arg('task');
const dir = arg('dir');
if (!task || !dir) { console.error('usage: make-fixture.cjs --task <id> --dir <workroot> [--bundle <path>]'); process.exit(1); }
const bundle = arg('bundle', path.join('plugins', 'lirbox', 'skills', 'conductor', 'arena', 'tasks', task, 'repo.bundle'));

const FILES = {
  'package.json': JSON.stringify({ name: 'notes-app', version: '1.0.0', scripts: { test: 'node test/run.js' } }, null, 2) + '\n',
  'src/store.js':
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
    'module.exports = { Store };\n',
  'src/service.js':
    '// Business logic over the store.\n' +
    'const { Store } = require("./store");\n' +
    'class NoteService {\n' +
    '  constructor(store) { this.store = store || new Store(); }\n' +
    '  create(text) { if (!text) throw new Error("text required"); return this.store.add(text); }\n' +
    '  complete(id) { const n = this.store.get(id); if (!n) throw new Error("not found"); n.done = true; return n; }\n' +
    '  pending() { return this.store.all().filter(n => !n.done); }\n' +
    '}\n' +
    'module.exports = { NoteService };\n',
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
};

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
git(['commit', '-q', '-m', 'initial: notes-app (store + service + cli + tests)']);
const sha = git(['rev-parse', 'HEAD']).trim();

fs.mkdirSync(path.dirname(bundle), { recursive: true });
try { fs.unlinkSync(bundle); } catch (e) { /* first time */ }
git(['bundle', 'create', path.resolve(bundle), '--all']);

console.log('SHA=' + sha);
console.log('BUNDLE=' + bundle);
