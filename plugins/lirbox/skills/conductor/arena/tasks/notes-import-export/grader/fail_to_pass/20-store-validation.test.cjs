// HIDDEN grader: import validation errors per task.md §1.
const assert = require('assert');
const path = require('path');
const { Store } = require(path.join(process.cwd(), 'src', 'store'));

const s = new Store();
assert.throws(() => s.importNotes({ version: 2, notes: [] }), /unsupported version/, 'wrong version must throw "unsupported version"');
assert.throws(() => s.importNotes({ notes: [] }), /unsupported version/, 'missing version must throw "unsupported version"');
assert.throws(() => s.importNotes({ version: 1, notes: 'nope' }), /invalid notes/, 'non-array notes must throw "invalid notes"');
assert.throws(() => s.importNotes({ version: 1 }), /invalid notes/, 'missing notes must throw "invalid notes"');
assert.strictEqual(s.all().length, 0, 'failed imports must not add anything');

console.log('store-validation ok');
