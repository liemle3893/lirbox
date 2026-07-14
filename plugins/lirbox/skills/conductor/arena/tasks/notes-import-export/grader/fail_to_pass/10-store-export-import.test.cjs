// HIDDEN grader: store-layer export/import with id re-numbering per task.md §1.
const assert = require('assert');
const path = require('path');
const { Store } = require(path.join(process.cwd(), 'src', 'store'));

// export shape + deep copy
const a = new Store();
a.add('one');            // id 1
const two = a.add('two'); // id 2
two.done = true;
const exp = a.exportNotes();
assert.strictEqual(exp.version, 1, 'export carries version 1');
assert.strictEqual(exp.notes.length, 2, 'export carries all notes');
exp.notes[0].text = 'MUTATED';
assert.strictEqual(a.get(1).text, 'one', 'export must be a deep copy — mutating it must not affect the store');

// import into a NON-EMPTY store: ids re-numbered from the receiving sequence, order + fields kept
const b = new Store();
b.add('existing 1');     // id 1
b.add('existing 2');     // id 2
const imported = b.importNotes(a.exportNotes());
assert.deepStrictEqual(imported.map((n) => n.id), [3, 4], 'imported notes get NEW ids from the receiving store');
assert.deepStrictEqual(imported.map((n) => n.text), ['one', 'two'], 'import order and text preserved');
assert.deepStrictEqual(imported.map((n) => n.done), [false, true], 'done flags preserved');

// no collisions ever: all ids unique, and add() after import continues the sequence
const ids = b.all().map((n) => n.id);
assert.strictEqual(new Set(ids).size, ids.length, 'ids stay unique after import');
assert.strictEqual(b.add('after import').id, 5, 'add() after import continues the sequence uniquely');

console.log('store-export-import ok');
