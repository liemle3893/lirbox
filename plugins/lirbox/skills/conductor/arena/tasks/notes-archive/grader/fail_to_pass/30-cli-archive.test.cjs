// HIDDEN grader: CLI-layer archiving per task.md §3 (archive <id>, unarchive <id>, archived).
const assert = require('assert');
const path = require('path');
const { run } = require(path.join(process.cwd(), 'src', 'cli'));
const { NoteService } = require(path.join(process.cwd(), 'src', 'service'));

const svc = new NoteService();
const a = svc.create('cli one');
svc.create('cli two');

// archive command
run(['archive', String(a.id)], svc);
assert.strictEqual(svc.pending().length, 1, 'cli archive must archive via the service');

// archived command
const got = run(['archived'], svc);
assert.ok(Array.isArray(got), 'cli archived must return the notes list');
assert.strictEqual(got.length, 1, 'cli archived returns exactly the archived notes');
assert.strictEqual(got[0].id, a.id, 'cli archived returns the right note');

// unarchive command
run(['unarchive', String(a.id)], svc);
assert.strictEqual(svc.pending().length, 2, 'cli unarchive must restore the note');

console.log('cli-archive ok');
