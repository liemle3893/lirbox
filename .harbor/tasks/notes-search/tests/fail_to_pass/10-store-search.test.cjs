// HIDDEN grader: store-layer search per task.md §1. RED on base, GREEN iff correctly implemented.
const assert = require('assert');
const path = require('path');
const { Store } = require(path.join(process.cwd(), 'src', 'store'));

const s = new Store();
s.add('Buy milk');    // id 1
s.add('buy bread');   // id 2
s.add('Call mom');    // id 3

// case-insensitive containment, ordered by ascending id
assert.deepStrictEqual(s.search('buy').map((n) => n.id), [1, 2], 'search must match case-insensitively');
assert.deepStrictEqual(s.search('BUY').map((n) => n.id), [1, 2], 'query casing must not matter');
assert.deepStrictEqual(s.search('mom').map((n) => n.id), [3], 'plain containment match');
assert.deepStrictEqual(s.search('zzz'), [], 'no match returns empty array');

// empty / missing query throws the named error
assert.throws(() => s.search(''), /query required/, 'empty query must throw "query required"');
assert.throws(() => s.search(), /query required/, 'missing query must throw "query required"');

console.log('store-search ok');
