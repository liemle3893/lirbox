// HIDDEN grader: the partial-envelope × ack × GC interaction per task.md §7/§9 — the rule
// one-shot implementations miss. RED on base.
const assert = require('assert');
const path = require('path');
const { Replica } = require(path.join(process.cwd(), 'src', 'replica'));

const a = new Replica('a');
const b = new Replica('b');

b.create('b work');      // b-1
b.tag('b-1', 'work');
b.create('b junk');      // b-2

// a PARTIAL envelope must not advance the sender's ack…
a.applyChanges(b.exportChanges({ tags: ['work'] }));
assert.strictEqual(a.peers.ackOf('b'), 0, 'partial envelopes must NOT advance the peer ack');

// …only a FULL envelope does
a.applyChanges(b.exportChanges());
assert.strictEqual(a.peers.ackOf('b'), b.clock.now(), 'full envelopes advance the ack');

// GC stays blocked while any known peer is below the tombstone ts
a.create('temp');                      // a-1
a.remove('a-1');                       // tombstone, ts > b's ack
assert.deepStrictEqual(a.gcTombstones(), [], 'peer acked below the tombstone ts blocks GC');

// a registered-but-silent peer (ack 0) blocks even when others are far ahead
a.peers.ack('b', 1000);
a.peers.register('c');
assert.deepStrictEqual(a.gcTombstones(), [], 'a silent registered peer blocks ALL collection');
assert.strictEqual(a.store.getRecord('a-1').deleted, true, 'tombstone still there');

console.log('partial-ack-gc ok');
