// HIDDEN grader: service-layer archiving per task.md §2 (delegate + throw; pending excludes archived;
// archived() lists them).
const assert = require('assert');
const path = require('path');
const { NoteService } = require(path.join(process.cwd(), 'src', 'service'));

const svc = new NoteService();
const a = svc.create('alpha');
const b = svc.create('beta');
const c = svc.create('gamma');

svc.archive(b.id);

// throwing on unknown id
assert.throws(() => svc.archive(999), 'archive on unknown id must throw');
assert.throws(() => svc.unarchive(999), 'unarchive on unknown id must throw');

// pending excludes archived (and still excludes completed)
svc.complete(c.id);
const pend = svc.pending();
assert.strictEqual(pend.length, 1, 'pending must exclude archived AND completed');
assert.strictEqual(pend[0].id, a.id, 'pending must contain only the live note');

// archived() lists archived notes
const arch = svc.archived();
assert.strictEqual(arch.length, 1, 'archived() must return archived notes');
assert.strictEqual(arch[0].id, b.id, 'archived() returns the right note');

// unarchive restores it to pending
svc.unarchive(b.id);
assert.strictEqual(svc.pending().length, 2, 'unarchive must restore the note to pending');

console.log('service-archive ok');
