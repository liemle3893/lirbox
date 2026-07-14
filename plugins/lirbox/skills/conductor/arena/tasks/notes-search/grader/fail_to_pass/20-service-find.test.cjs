// HIDDEN grader: service-layer find with done-filter + pagination per task.md §2.
const assert = require('assert');
const path = require('path');
const { NoteService } = require(path.join(process.cwd(), 'src', 'service'));

const svc = new NoteService();
for (let i = 1; i <= 15; i++) svc.create(`task number ${i}`);
svc.create('unrelated note');   // id 16
svc.complete(3);
svc.complete(7);

// default: excludes done, total counts ALL matches after the done-filter
const p1 = svc.find('task');
assert.strictEqual(p1.total, 13, 'total = matches minus completed (15 - 2)');
assert.strictEqual(p1.page, 1, 'default page is 1');
assert.strictEqual(p1.results.length, 10, 'default pageSize is 10');
assert.ok(p1.results.every((n) => !n.done), 'completed notes excluded by default');

// pagination: page 2 carries the remainder, total unaffected
const p2 = svc.find('task', { page: 2 });
assert.strictEqual(p2.results.length, 3, 'page 2 has the remaining 3 matches');
assert.strictEqual(p2.total, 13, 'total is unaffected by page');
assert.strictEqual(p2.page, 2, 'page echoes the requested page');

// custom pageSize
const small = svc.find('task', { page: 3, pageSize: 5 });
assert.strictEqual(small.results.length, 3, 'pageSize 5, page 3 → 3 of 13');

// includeDone
assert.strictEqual(svc.find('task', { includeDone: true }).total, 15, 'includeDone counts completed matches');

// invalid page throws the named error
assert.throws(() => svc.find('task', { page: 0 }), /invalid page/, 'page < 1 must throw "invalid page"');
assert.throws(() => svc.find('task', { page: 1.5 }), /invalid page/, 'non-integer page must throw "invalid page"');

console.log('service-find ok');
