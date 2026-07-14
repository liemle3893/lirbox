// HIDDEN grader: the reported symptom is gone — restart/add cycles via app.main per task.md §1.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { main } = require(path.join(process.cwd(), 'src', 'app'));

const f = path.join(os.tmpdir(), 'swe-grader-restart-' + process.pid + '.json');
try { fs.unlinkSync(f); } catch (e) { /* fresh */ }

// each main() call is a separate "process run" — the exact reproduction from the bug report
const first = main(['add', 'first'], f);
const second = main(['add', 'second'], f);
assert.notStrictEqual(second.id, first.id, 'restarted add must not reuse an existing id');

const listed = main(['list'], f);
assert.strictEqual(listed.length, 2, 'both notes survive');
assert.strictEqual(new Set(listed.map((n) => n.id)).size, 2, 'ids are unique across restarts');

// done targets the right note now
main(['done', String(first.id)], f);
const remaining = main(['list'], f);
assert.strictEqual(remaining.length, 1, 'completing one leaves one pending');
assert.strictEqual(remaining[0].text, 'second', 'done completed the right note');

fs.unlinkSync(f);
console.log('app-restart ok');
