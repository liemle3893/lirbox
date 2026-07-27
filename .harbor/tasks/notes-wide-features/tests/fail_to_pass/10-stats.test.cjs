// Hidden grader: plugin `stats` — counts, tag histogram, replica map, clock.
"use strict";
const assert = require("assert");
const path = require("path");
const { NoteService } = require(path.resolve("src/service.js"));
const { Replica } = require(path.resolve("src/replica.js"));
const { run } = require(path.resolve("src/cli.js"));

const svc = new NoteService(new Replica("t"));
run(["add", "a"], svc);            // t-1
run(["add", "b"], svc);            // t-2
run(["add", "c"], svc);            // t-3
run(["tag", "t-1", "docs"], svc);
run(["tag", "t-1", "docs"], svc);  // duplicate tag in array — still counts once for t-1
run(["tag", "t-2", "docs"], svc);
run(["tag", "t-2", "work"], svc);
run(["done", "t-2"], svc);
run(["rm", "t-3"], svc);

// a live record from another replica (id prefix "aa")
const other = new NoteService(new Replica("aa"));
run(["add", "remote"], other);
const os = require("os"), fs = require("fs");
const xf = path.join(os.tmpdir(), "wide-stats-" + process.pid + ".json");
run(["export", xf], other);
run(["sync", xf], svc);
fs.unlinkSync(xf);

const res = run(["plugin", "stats"], svc);
assert.strictEqual(res.total, 4, "total includes tombstones");
assert.strictEqual(res.live, 3);
assert.strictEqual(res.deleted, 1);
assert.strictEqual(res.pending, 2);
assert.strictEqual(res.done, 1);
assert.deepStrictEqual(res.tags, { docs: 2, work: 1 });
assert.strictEqual(JSON.stringify(Object.keys(res.tags)), '["docs","work"]', "tag keys sorted");
assert.deepStrictEqual(res.replicas, { aa: 1, t: 2 });
assert.strictEqual(JSON.stringify(Object.keys(res.replicas)), '["aa","t"]', "replica keys sorted");
assert.strictEqual(res.clock, svc.replica.clock.now());

assert.throws(() => run(["plugin", "stats", "x"], svc), /stats takes no arguments/);

console.log("ok");
