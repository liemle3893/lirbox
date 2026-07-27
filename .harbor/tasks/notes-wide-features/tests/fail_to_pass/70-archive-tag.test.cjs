// Hidden grader: plugin `archive-tag` — bulk-complete pending notes by tag.
"use strict";
const assert = require("assert");
const path = require("path");
const { NoteService } = require(path.resolve("src/service.js"));
const { Replica } = require(path.resolve("src/replica.js"));
const { run } = require(path.resolve("src/cli.js"));

const svc = new NoteService(new Replica("t"));
run(["add", "a"], svc); // t-1
run(["add", "b"], svc); // t-2 (already done)
run(["add", "c"], svc); // t-3
run(["add", "d"], svc); // t-4 other tag
run(["tag", "t-1", "urgent"], svc);
run(["tag", "t-2", "urgent"], svc);
run(["tag", "t-3", "urgent"], svc);
run(["tag", "t-4", "other"], svc);
run(["done", "t-2"], svc);

const out = run(["plugin", "archive-tag", "urgent"], svc);
assert.deepStrictEqual(out, { archived: ["t-1", "t-3"] });
assert.strictEqual(svc.replica.store.get("t-1").done, true);
assert.strictEqual(svc.replica.store.get("t-3").done, true);
assert.strictEqual(svc.replica.store.get("t-4").done, false, "other tags untouched");

// tag now exists only on done records → empty result, not an error
assert.deepStrictEqual(run(["plugin", "archive-tag", "urgent"], svc), { archived: [] });

assert.throws(() => run(["plugin", "archive-tag", "nada"], svc), /unknown tag: nada/);
assert.throws(() => run(["plugin", "archive-tag"], svc), /tag required/);

console.log("ok");
