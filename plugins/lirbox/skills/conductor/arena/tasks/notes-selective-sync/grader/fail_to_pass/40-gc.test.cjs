// HIDDEN grader: ack-gated tombstone GC per task.md Part 3 (§8–10). RED on base (no gcTombstones).
const assert = require('assert');
const path = require('path');
const { Replica } = require(path.join(process.cwd(), 'src', 'replica'));

const a = new Replica('a');
a.create('one');   // a-1 ts1
a.create('two');   // a-2 ts2
a.remove('a-1');   // tombstone ts3

assert.deepStrictEqual(a.gcTombstones(), [], 'no known peers → nothing collected');
a.peers.register('b');
assert.deepStrictEqual(a.gcTombstones(), [], 'ack 0 blocks');
a.peers.ack('b', 2);
assert.deepStrictEqual(a.gcTombstones(), [], 'ack below tombstone ts blocks');
a.peers.ack('b', 3);
assert.deepStrictEqual(a.gcTombstones(), ['a-1'], 'all peers acked past ts → collected (sorted)');
assert.strictEqual(a.store.getRecord('a-1'), null, 'collected tombstone leaves records()');
assert.strictEqual(a.store.get('a-2').text, 'two', 'live records are never collected');
assert.deepStrictEqual(a.exportChanges().records.map((r) => r.id), ['a-2'],
  'post-GC exports omit collected tombstones');

// the MINIMUM ack governs when several peers are known
a.remove('a-2');   // tombstone ts4
a.peers.ack('b', 10);
a.peers.register('d');
assert.deepStrictEqual(a.gcTombstones(), [], 'min over ALL peers governs (d at 0)');
a.peers.ack('d', 4);
assert.deepStrictEqual(a.gcTombstones(), ['a-2'], 'collects once the minimum passes the ts');

console.log('gc ok');
