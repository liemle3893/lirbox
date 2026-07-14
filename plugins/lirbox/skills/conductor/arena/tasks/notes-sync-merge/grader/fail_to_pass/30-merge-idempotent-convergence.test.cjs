// HIDDEN grader: idempotence, convergence, and the clock rule per task.md §4/§6/§7. RED on base.
const assert = require('assert');
const path = require('path');
const { Replica } = require(path.join(process.cwd(), 'src', 'replica'));

const a = new Replica('a');
const b = new Replica('b');

a.create('one');                               // a-1 rev{1,a}
b.create('two');                               // b-1 rev{1,b}
b.applyChanges(a.exportChanges());
a.applyChanges(b.exportChanges());

// convergence: identical records(), same order
assert.strictEqual(JSON.stringify(a.store.records()), JSON.stringify(b.store.records()),
  'after a full exchange both replicas hold identical records');

// idempotence: re-applying the same envelope changes nothing
const env = b.exportChanges();
const before = JSON.stringify(a.store.records());
const again = a.applyChanges(env);
assert.strictEqual(again.applied, 0, 're-applying the same envelope applies nothing');
assert.strictEqual(JSON.stringify(a.store.records()), before, 'store is unchanged by a re-apply');

// clock rule: the next local mutation out-stamps everything seen
const maxSeen = Math.max(env.clock, ...a.store.records().map((r) => r.rev.ts));
const fresh = a.create('after sync');          // a-2
assert.ok(fresh.rev.ts > maxSeen, `post-sync mutation must stamp ts > ${maxSeen} (got ${fresh.rev.ts})`);

// a post-sync edit is strictly newer, so it wins the next exchange and both converge again
b.edit('a-1', 'b final');
a.applyChanges(b.exportChanges());
b.applyChanges(a.exportChanges());
assert.strictEqual(a.store.get('a-1').text, 'b final', 'newer post-sync edit wins');
assert.strictEqual(b.store.get('a-1').text, 'b final', 'both sides agree');
assert.strictEqual(JSON.stringify(a.store.records()), JSON.stringify(b.store.records()),
  'replicas re-converge after further edits');

console.log('merge-idempotent-convergence ok');
