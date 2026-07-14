// HIDDEN grader: filtered export envelopes per task.md Part 2 (§4–6). RED on base
// (exportChanges takes no options; no partial flag).
const assert = require('assert');
const path = require('path');
const { Replica } = require(path.join(process.cwd(), 'src', 'replica'));

const a = new Replica('a');
a.create('work item');   // a-1
a.tag('a-1', 'work');
a.create('home item');   // a-2
a.tag('a-2', 'home');
a.create('junk');        // a-3
a.remove('a-3');         // tombstone

// filtered: matching records + ALL tombstones, flagged partial
const env = a.exportChanges({ tags: ['work'] });
assert.strictEqual(env.partial, true, 'filtered envelopes carry partial: true');
assert.deepStrictEqual(env.records.map((r) => r.id).sort(), ['a-1', 'a-3'],
  'filtered = tagged records + all tombstones');

// unfiltered exports unchanged
const full = a.exportChanges();
assert.strictEqual(full.records.length, 3, 'full export carries everything');
assert.ok(!full.partial, 'full export is not flagged partial');

// receiver: merges exactly what is carried; absent records completely untouched
const b = new Replica('b');
b.create('b own');       // b-1
b.applyChanges(env);
assert.strictEqual(b.store.get('a-1').text, 'work item', 'subscribed record arrives');
assert.deepStrictEqual(b.store.get('a-1').tags, ['work'], 'tags arrive intact');
assert.strictEqual(b.store.getRecord('a-2'), null, 'unsubscribed record must NOT appear');
assert.strictEqual(b.store.getRecord('a-3').deleted, true, 'tombstones always propagate');
assert.strictEqual(b.store.get('b-1').text, 'b own', 'receiver-local records untouched');

// subscribed subset keeps converging across repeated partial syncs
a.edit('a-1', 'work item v2');
b.applyChanges(a.exportChanges({ tags: ['work'] }));
assert.strictEqual(b.store.get('a-1').text, 'work item v2', 'partial re-sync converges the subset');

console.log('partial-export ok');
