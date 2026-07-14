// HIDDEN grader: store-layer archiving per task.md §1. RED on base, GREEN iff correctly implemented.
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { Store } = require(path.join(process.cwd(), 'src', 'store'));

const s = new Store();
const n = s.add('note one');

// archived defaults to false
assert.strictEqual(n.archived, false, 'note.archived must default to false');

// archive / unarchive
s.archive(n.id);
assert.strictEqual(s.get(n.id).archived, true, 'archive(id) must set the flag');
s.unarchive(n.id);
assert.strictEqual(s.get(n.id).archived, false, 'unarchive(id) must clear the flag');

// save/load round-trips the flag
s.archive(n.id);
const f = path.join(os.tmpdir(), 'swe-grader-archive-' + process.pid + '.json');
s.save(f);
const s2 = Store.load(f);
fs.unlinkSync(f);
assert.strictEqual(s2.get(n.id).archived, true, 'save/load must round-trip archived');

console.log('store-archive ok');
