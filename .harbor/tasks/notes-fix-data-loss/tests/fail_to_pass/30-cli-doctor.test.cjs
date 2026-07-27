// HIDDEN grader: duplicates() + doctor diagnostics per task.md §3.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store } = require(path.join(process.cwd(), 'src', 'store'));
const { NoteService } = require(path.join(process.cwd(), 'src', 'service'));
const { run } = require(path.join(process.cwd(), 'src', 'cli'));

const f = path.join(os.tmpdir(), 'swe-grader-doctor-' + process.pid + '.json');

// a corrupted file (duplicate ids) — load preserves it as stored, doctor surfaces it
fs.writeFileSync(f, JSON.stringify({
  notes: [
    { id: 1, text: 'a', done: false },
    { id: 1, text: 'b', done: false },
    { id: 3, text: 'c', done: false },
    { id: 3, text: 'd', done: false },
    { id: 2, text: 'e', done: false },
  ],
}));
const svc = new NoteService(Store.load(f));
assert.deepStrictEqual(svc.duplicates(), [1, 3], 'duplicates() returns duplicated ids sorted ascending');
assert.deepStrictEqual(run(['doctor'], svc), [1, 3], 'doctor returns svc.duplicates()');

// clean store → empty array
const clean = new NoteService();
clean.create('x');
clean.create('y');
assert.deepStrictEqual(run(['doctor'], clean), [], 'no duplicates means an empty array');

fs.unlinkSync(f);
console.log('cli-doctor ok');
