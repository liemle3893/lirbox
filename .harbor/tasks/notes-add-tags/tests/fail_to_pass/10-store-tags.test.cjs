// HIDDEN grader (never shown to the agent): store-layer tagging per task.md §1.
// RED on the base commit; GREEN iff the feature is correctly implemented.
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { Store } = require(path.join(process.cwd(), 'src', 'store'));

const s = new Store();
const n = s.add('note one');

// tags default to []
assert.ok(Array.isArray(n.tags), 'note.tags must be an array by default');
assert.strictEqual(n.tags.length, 0, 'note.tags must default to empty');

// addTag / no duplicates
s.addTag(n.id, 'work');
s.addTag(n.id, 'work');
assert.deepStrictEqual(s.get(n.id).tags, ['work'], 'addTag must not duplicate tags');

// removeTag / removing absent tag is a no-op
s.addTag(n.id, 'urgent');
s.removeTag(n.id, 'work');
assert.deepStrictEqual(s.get(n.id).tags, ['urgent'], 'removeTag must remove the tag');
s.removeTag(n.id, 'nope'); // must not throw
assert.deepStrictEqual(s.get(n.id).tags, ['urgent'], 'removing an absent tag is a no-op');

// save/load round-trips tags
const f = path.join(os.tmpdir(), 'swe-grader-store-' + process.pid + '.json');
s.save(f);
const s2 = Store.load(f);
fs.unlinkSync(f);
assert.deepStrictEqual(s2.get(n.id).tags, ['urgent'], 'save/load must round-trip tags');

console.log('store-tags ok');
