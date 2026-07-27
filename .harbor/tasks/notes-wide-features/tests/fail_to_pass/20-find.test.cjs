// Hidden grader: plugin `find` — ranked case-insensitive search with tag filter + paging.
"use strict";
const assert = require("assert");
const path = require("path");
const { NoteService } = require(path.resolve("src/service.js"));
const { Replica } = require(path.resolve("src/replica.js"));
const { run } = require(path.resolve("src/cli.js"));

const svc = new NoteService(new Replica("t"));
run(["add", "Alpha Bravo"], svc);      // t-1, first match of "bravo" at index 6
run(["add", "bravo charlie"], svc);    // t-2, index 0
run(["add", "delta"], svc);            // t-3
run(["add", "BRAVO"], svc);            // t-4, index 0
run(["tag", "t-2", "work"], svc);
run(["tag", "t-4", "work"], svc);
run(["done", "t-3"], svc);

const all = run(["plugin", "find", "bravo"], svc);
assert.strictEqual(all.total, 3);
assert.deepStrictEqual(all.items.map((i) => i.id), ["t-2", "t-4", "t-1"], "index asc, then id asc");
assert.deepStrictEqual(Object.keys(all.items[0]).sort(), ["done", "id", "tags", "text"]);

const tagged = run(["plugin", "find", "bravo", "--tag", "work"], svc);
assert.deepStrictEqual(tagged.items.map((i) => i.id), ["t-2", "t-4"]);
assert.strictEqual(tagged.total, 2);

const page = run(["plugin", "find", "bravo", "--limit", "1", "--offset", "1"], svc);
assert.strictEqual(page.total, 3, "total is pre-paging");
assert.deepStrictEqual(page.items.map((i) => i.id), ["t-4"]);

// done records are still live and searchable
assert.strictEqual(run(["plugin", "find", "delta"], svc).total, 1);

assert.throws(() => run(["plugin", "find"], svc), /query required/);
assert.throws(() => run(["plugin", "find", "x", "--limit", "abc"], svc), /invalid limit/);
assert.throws(() => run(["plugin", "find", "x", "--limit", "-1"], svc), /invalid limit/);
assert.throws(() => run(["plugin", "find", "x", "--offset", "-2"], svc), /invalid offset/);
assert.throws(() => run(["plugin", "find", "x", "--limit", "101"], svc), /limit too large/);

console.log("ok");
