// HIDDEN grader: CLI-layer tagging per task.md §3 (tag <id> <tag>, bytag <tag>, stats wired to service).
const assert = require('assert');
const path = require('path');
const { run } = require(path.join(process.cwd(), 'src', 'cli'));
const { NoteService } = require(path.join(process.cwd(), 'src', 'service'));

const svc = new NoteService();
const a = svc.create('cli one');
svc.create('cli two');

// tag command
run(['tag', String(a.id), 'work'], svc);
assert.deepStrictEqual(svc.byTag('work').map((n) => n.id), [a.id], 'cli tag must tag the note via the service');

// bytag command
const got = run(['bytag', 'work'], svc);
assert.ok(Array.isArray(got), 'cli bytag must return the notes list');
assert.strictEqual(got.length, 1, 'cli bytag returns exactly the tagged notes');
assert.strictEqual(got[0].id, a.id, 'cli bytag returns the right note');

// stats command
const st = run(['stats'], svc);
assert.strictEqual(typeof st, 'object', 'cli stats must return the stats object');
assert.strictEqual(st.work, 1, 'cli stats counts must match');

console.log('cli-tags ok');
