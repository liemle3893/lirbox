// HIDDEN grader: service backup/restore + CLI export/import round-trip per task.md §2–3.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { NoteService } = require(path.join(process.cwd(), 'src', 'service'));
const { run } = require(path.join(process.cwd(), 'src', 'cli'));

const f = path.join(os.tmpdir(), 'swe-grader-backup-' + process.pid + '.json');

// service round-trip into a non-empty target
const a = new NoteService();
a.create('alpha');
a.create('beta');
a.create('gamma');
a.complete(2);
assert.strictEqual(a.backup(f), 3, 'backup returns the number of notes exported');

const b = new NoteService();
b.create('pre-existing 1');
b.create('pre-existing 2');
assert.strictEqual(b.restore(f), 3, 'restore returns the number of notes imported');
const all = b.store.all();
assert.strictEqual(all.length, 5, 'restore merges into the existing store');
assert.strictEqual(new Set(all.map((n) => n.id)).size, 5, 'no id collisions after restore');
assert.strictEqual(all.filter((n) => n.done).length, 1, 'done flag survives the round-trip');

// CLI wiring
const c = new NoteService();
c.create('cli note');
assert.strictEqual(run(['export', f], c), 1, 'cli export returns svc.backup(path)');
const d = new NoteService();
assert.strictEqual(run(['import', f], d), 1, 'cli import returns svc.restore(path)');
assert.strictEqual(d.store.all()[0].text, 'cli note', 'cli import lands the notes');

fs.unlinkSync(f);
console.log('service-cli-roundtrip ok');
