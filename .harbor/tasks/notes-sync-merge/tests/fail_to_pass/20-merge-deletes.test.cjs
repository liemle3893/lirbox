// HIDDEN grader: delete-vs-edit both directions, tombstone retention/propagation, resurrection
// per task.md §3. RED on base.
const assert = require('assert');
const path = require('path');
const { Replica } = require(path.join(process.cwd(), 'src', 'replica'));

const a = new Replica('a');
const b = new Replica('b');
const c = new Replica('c');
const d = new Replica('d');

a.create('shared note');                       // a-1 rev{1,a}
b.applyChanges(a.exportChanges());
c.applyChanges(a.exportChanges());

b.remove('a-1');                               // tombstone rev{2,b}
a.edit('a-1', 'edited on a');                  // rev{2,a}

// delete-vs-edit at tied ts: "b" > "a" → the delete wins on BOTH sides
a.applyChanges(b.exportChanges());
assert.strictEqual(a.store.get('a-1'), null, 'winning tombstone deletes the note');
assert.strictEqual(a.store.getRecord('a-1').deleted, true, 'tombstone is retained, not dropped');
const back = b.applyChanges(a.exportChanges());
assert.strictEqual(b.store.get('a-1'), null, 'losing edit cannot resurrect the note');
assert.strictEqual(back.applied, 0, 'losing edit is skipped');

// tombstones propagate to replicas that sync later
d.applyChanges(b.exportChanges());
assert.strictEqual(d.store.get('a-1'), null, 'late-syncing replica learns the delete');
assert.strictEqual(d.store.getRecord('a-1').deleted, true, 'the delete arrives as a tombstone');

// resurrection: c never saw the delete and edits past the tombstone's ts
c.edit('a-1', 'revived');                      // rev{2,c}
c.edit('a-1', 'revived again');                // rev{3,c} — strictly newer than tombstone{2,b}
a.applyChanges(c.exportChanges());
assert.ok(a.store.get('a-1'), 'a strictly newer edit resurrects a deleted note');
assert.strictEqual(a.store.get('a-1').text, 'revived again', 'resurrected content is the winning edit');

console.log('merge-deletes ok');
