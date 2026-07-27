// HIDDEN grader: adopt-new, last-writer-wins, tie-break direction, identical-rev skip, counts
// per task.md §3/§5. RED on base (applyChanges does not exist).
const assert = require('assert');
const path = require('path');
const { Replica } = require(path.join(process.cwd(), 'src', 'replica'));

const a = new Replica('a');
const b = new Replica('b');

a.create('hello world');                       // a-1 rev{1,a}
const r1 = b.applyChanges(a.exportChanges());
assert.strictEqual(r1.applied, 1, 'new record is adopted');
assert.strictEqual(r1.skipped, 0, 'nothing to skip yet');
assert.strictEqual(b.store.get('a-1').text, 'hello world', 'adopted record is readable');

b.create('from b');                            // b-1 rev{2,b} (b observed ts 1)
b.edit('a-1', 'b version');                    // rev{3,b}
a.edit('a-1', 'a version');                    // rev{2,a}

// LWW: b's ts3 beats a's ts2; b-1 is new to a
a.applyChanges(b.exportChanges());
assert.strictEqual(a.store.get('a-1').text, 'b version', 'higher ts wins');
assert.strictEqual(a.store.get('b-1').text, 'from b', 'foreign creates arrive');

// the losing edit travels back: local copy wins, nothing applied
const r2 = b.applyChanges(a.exportChanges());
assert.strictEqual(b.store.get('a-1').text, 'b version', 'losing edit must not overwrite');
assert.strictEqual(r2.applied, 0, 'local wins count as skipped');
assert.strictEqual(r2.skipped, 2, 'identical + losing records are skipped');

// identical revisions skip
const r3 = a.applyChanges(b.exportChanges());
assert.strictEqual(r3.applied, 0, 'identical revisions are never re-applied');

// ts tie → lexicographically greater replica wins ("b" beats "a")
a.edit('a-1', 'tie a');                        // rev{4,a}
b.edit('a-1', 'tie b');                        // rev{4,b}
a.applyChanges(b.exportChanges());
b.applyChanges(a.exportChanges());
assert.strictEqual(a.store.get('a-1').text, 'tie b', 'tie must resolve to greater replica id');
assert.strictEqual(b.store.get('a-1').text, 'tie b', 'tie resolves the same way on both sides');

console.log('merge-lww ok');
