// Hidden grader: plugin `dedupe` — normalized-text duplicate merge, keep lowest id.
"use strict";
const assert = require("assert");
const path = require("path");
const { NoteService } = require(path.resolve("src/service.js"));
const { Replica } = require(path.resolve("src/replica.js"));
const { run } = require(path.resolve("src/cli.js"));

const svc = new NoteService(new Replica("t"));
run(["add", "  Hello   World "], svc); // t-1 keeper
run(["add", "hello world"], svc);      // t-2 dup
run(["add", "hello world"], svc);      // t-3 dup
run(["add", "unique"], svc);           // t-4
run(["tag", "t-1", "a"], svc);
run(["tag", "t-2", "b"], svc);
const revBefore = svc.replica.store.getRecord("t-1").rev.ts;

const out = run(["plugin", "dedupe"], svc);
assert.deepStrictEqual(out, [{ kept: "t-1", removed: ["t-2", "t-3"], text: "hello world" }]);

const keeper = svc.replica.store.getRecord("t-1");
assert.deepStrictEqual(keeper.tags, ["a", "b"], "sorted deduped union of group tags");
assert.ok(keeper.rev.ts > revBefore, "mutations stamped through the replica");
assert.strictEqual(svc.replica.store.getRecord("t-2").deleted, true);
assert.strictEqual(svc.replica.store.getRecord("t-3").deleted, true);
assert.strictEqual(svc.replica.store.getRecord("t-4").deleted, false);

assert.deepStrictEqual(run(["plugin", "dedupe"], svc), [], "idempotent");

console.log("ok");
