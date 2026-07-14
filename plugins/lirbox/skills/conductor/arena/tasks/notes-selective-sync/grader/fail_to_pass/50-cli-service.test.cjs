// HIDDEN grader: service + CLI wiring per task.md §1/§5/§8. RED on base.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Replica } = require(path.join(process.cwd(), 'src', 'replica'));
const { NoteService } = require(path.join(process.cwd(), 'src', 'service'));
const { run } = require(path.join(process.cwd(), 'src', 'cli'));

const f = path.join(os.tmpdir(), 'swe-grader-selsync-' + process.pid + '.json');

// untag via service + CLI
const svc = new NoteService(new Replica('a'));
svc.create('n');                    // a-1
svc.tag('a-1', 'x');
svc.tag('a-1', 'work');
run(['untag', 'a-1', 'x'], svc);
assert.deepStrictEqual(svc.list()[0].tags, ['work'], 'cli untag removes the tag');
assert.throws(() => run(['untag', 'a-1', 'zzz'], svc), /tag not found/, 'cli untag error contract');

// filtered export via CLI: extra args after the path are the tag filter
svc.create('other');                // a-2 (untagged)
run(['export', f, 'work'], svc);
const env = JSON.parse(fs.readFileSync(f, 'utf8'));
assert.strictEqual(env.partial, true, 'cli filtered export writes a partial envelope');
assert.deepStrictEqual(env.records.map((r) => r.id), ['a-1'], 'only the tagged record is carried');

// single-argument export unchanged (full)
run(['export', f], svc);
const fullEnv = JSON.parse(fs.readFileSync(f, 'utf8'));
assert.strictEqual(fullEnv.records.length, 2, 'plain export stays full');
assert.ok(!fullEnv.partial, 'plain export is not partial');

// gc via service + CLI
svc.remove('a-2');
const tombTs = svc.replica.store.getRecord('a-2').rev.ts;
svc.replica.peers.ack('b', tombTs);
assert.deepStrictEqual(run(['gc'], svc), ['a-2'], 'cli gc returns the collected ids');
assert.strictEqual(svc.replica.store.getRecord('a-2'), null, 'gc really collected');

fs.unlinkSync(f);
console.log('cli-service ok');
