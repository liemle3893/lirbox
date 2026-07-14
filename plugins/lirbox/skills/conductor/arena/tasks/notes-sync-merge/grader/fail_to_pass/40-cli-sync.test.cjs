// HIDDEN grader: service.sync(path) + CLI `sync <path>` wiring + validation errors
// per task.md §2/§8/§9. RED on base (no sync command).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Replica } = require(path.join(process.cwd(), 'src', 'replica'));
const { NoteService } = require(path.join(process.cwd(), 'src', 'service'));
const { run } = require(path.join(process.cwd(), 'src', 'cli'));

const f = path.join(os.tmpdir(), 'swe-grader-sync-' + process.pid + '.json');

const svcA = new NoteService(new Replica('a'));
svcA.create('cli one');
svcA.create('cli two');
assert.strictEqual(run(['export', f], svcA), 2, 'export writes the envelope (base behavior)');

const svcB = new NoteService(new Replica('b'));
const out = run(['sync', f], svcB);
assert.strictEqual(out.applied, 2, 'cli sync applies the file and returns the summary');
assert.strictEqual(out.skipped, 0, 'nothing skipped on first sync');
assert.strictEqual(svcB.list().length, 2, 'synced notes are visible');

// validation errors surface through service.sync
fs.writeFileSync(f, JSON.stringify({ version: 2, records: [] }));
assert.throws(() => svcB.sync(f), /unsupported version/, 'wrong envelope version');
fs.writeFileSync(f, JSON.stringify({ version: 3, records: 'nope' }));
assert.throws(() => svcB.sync(f), /invalid change set/, 'non-array records');

fs.unlinkSync(f);
console.log('cli-sync ok');
