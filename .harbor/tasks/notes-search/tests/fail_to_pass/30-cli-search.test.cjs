// HIDDEN grader: CLI search command per task.md §3.
const assert = require('assert');
const path = require('path');
const { NoteService } = require(path.join(process.cwd(), 'src', 'service'));
const { run } = require(path.join(process.cwd(), 'src', 'cli'));

const svc = new NoteService();
svc.create('please buy milk today');  // id 1
svc.create('BUY MILK now');           // id 2
svc.create('call mom');               // id 3

// multi-word args join with single spaces into one query; returns svc.find(query).results
const results = run(['search', 'buy', 'milk'], svc);
assert.ok(Array.isArray(results), 'search returns the results array');
assert.deepStrictEqual(results.map((n) => n.id), [1, 2], 'case-insensitive multi-word query matches both');

assert.deepStrictEqual(run(['search', 'mom'], svc).map((n) => n.id), [3], 'single-word query');

console.log('cli-search ok');
