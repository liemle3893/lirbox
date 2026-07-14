// HIDDEN grader: id sequence restored by Store.load per task.md §1–2. RED on the buggy base.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store } = require(path.join(process.cwd(), 'src', 'store'));

const f = path.join(os.tmpdir(), 'swe-grader-seq-' + process.pid + '.json');

// save → load → add must continue the sequence
const s = new Store();
s.add('one'); s.add('two'); s.add('three');
s.save(f);
const loaded = Store.load(f);
assert.strictEqual(loaded.add('four').id, 4, 'add() after load must continue past the highest existing id');
const ids = loaded.all().map((n) => n.id);
assert.strictEqual(new Set(ids).size, ids.length, 'ids must stay unique after load');

// files WITHOUT a seq field: derive from the highest note id
fs.writeFileSync(f, JSON.stringify({ notes: [{ id: 5, text: 'a', done: false }, { id: 2, text: 'b', done: false }] }));
const noSeq = Store.load(f);
assert.strictEqual(noSeq.add('next').id, 6, 'missing seq must be derived from the highest note id');
assert.strictEqual(noSeq.get(5).text, 'a', 'load must preserve notes exactly as stored');
assert.strictEqual(noSeq.get(2).text, 'b', 'load must not renumber or drop notes');

// empty notes list → next id is 1
fs.writeFileSync(f, JSON.stringify({ notes: [] }));
assert.strictEqual(Store.load(f).add('first').id, 1, 'empty file means the next id is 1');

fs.unlinkSync(f);
console.log('store-load-seq ok');
