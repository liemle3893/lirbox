// HIDDEN grader: OR-set tag semantics under concurrency per task.md Part 1. RED on base
// (record-level LWW clobbers concurrent tag changes; untag does not exist).
const assert = require('assert');
const path = require('path');
const { Replica } = require(path.join(process.cwd(), 'src', 'replica'));

const a = new Replica('a');
const b = new Replica('b');

a.create('shared');                 // a-1
a.tag('a-1', 'x');
b.applyChanges(a.exportChanges());  // b observed x's add

// (a) concurrent untag-x vs add-y: untag wins for x AND the add of y survives — on BOTH sides
a.untag('a-1', 'x');
b.tag('a-1', 'y');
a.applyChanges(b.exportChanges());
b.applyChanges(a.exportChanges());
assert.deepStrictEqual(a.store.get('a-1').tags, ['y'], 'A: untag x + concurrent add y → ["y"]');
assert.deepStrictEqual(b.store.get('a-1').tags, ['y'], 'B: same outcome regardless of LWW winner');

// (b) concurrent re-add of the SAME tag survives an untag that never observed it
b.tag('a-1', 'x');                  // x returns via b
a.applyChanges(b.exportChanges());  // a sees it
assert.deepStrictEqual(a.store.get('a-1').tags, ['x', 'y'], 'x is back before the race');
a.untag('a-1', 'x');                // a removes the adds it observed…
b.tag('a-1', 'x');                  // …while b concurrently adds x AGAIN (unobserved by the untag)
a.applyChanges(b.exportChanges());
b.applyChanges(a.exportChanges());
assert.deepStrictEqual(a.store.get('a-1').tags, ['x', 'y'], 'A: the unobserved re-add survives');
assert.deepStrictEqual(b.store.get('a-1').tags, ['x', 'y'], 'B: converges to the same view');

// (c) local untag then local re-add leaves the tag present
a.untag('a-1', 'x');
assert.deepStrictEqual(a.store.get('a-1').tags, ['y'], 'local untag removes');
a.tag('a-1', 'x');
assert.deepStrictEqual(a.store.get('a-1').tags, ['x', 'y'], 'local re-add restores');

// view invariants + error contract
a.tag('a-1', 'x');                  // duplicate add: view stays deduped
assert.deepStrictEqual(a.store.get('a-1').tags, ['x', 'y'], 'view is deduplicated');
a.tag('a-1', 'alpha');
assert.deepStrictEqual(a.store.get('a-1').tags, ['alpha', 'x', 'y'], 'view is sorted ascending');
assert.throws(() => a.untag('a-1', 'nope'), /tag not found/, 'untagging an absent tag throws');

console.log('orset-concurrent ok');
