// HIDDEN grader: service-layer tagging per task.md §2 (tag/untag delegate + throw on unknown id;
// byTag; stats as {tag: count}).
const assert = require('assert');
const path = require('path');
const { NoteService } = require(path.join(process.cwd(), 'src', 'service'));

const svc = new NoteService();
const a = svc.create('alpha');
const b = svc.create('beta');
const c = svc.create('gamma');

// tag / untag delegate to the store
svc.tag(a.id, 'work');
svc.tag(b.id, 'work');
svc.tag(b.id, 'home');
svc.tag(c.id, 'home');
svc.untag(b.id, 'home');

// throwing on unknown id
assert.throws(() => svc.tag(999, 'x'), 'tag on unknown id must throw');
assert.throws(() => svc.untag(999, 'x'), 'untag on unknown id must throw');

// byTag returns all notes carrying that tag
const work = svc.byTag('work');
assert.strictEqual(work.length, 2, 'byTag(work) must return both work notes');
assert.ok(work.some((n) => n.id === a.id) && work.some((n) => n.id === b.id), 'byTag returns the tagged notes');
assert.strictEqual(svc.byTag('home').length, 1, 'byTag(home) after untag must return 1');
assert.strictEqual(svc.byTag('nope').length, 0, 'byTag on unused tag returns []');

// stats returns { tag: count } across all notes
const st = svc.stats();
assert.strictEqual(st.work, 2, 'stats().work must be 2');
assert.strictEqual(st.home, 1, 'stats().home must be 1');

console.log('service-tags ok');
