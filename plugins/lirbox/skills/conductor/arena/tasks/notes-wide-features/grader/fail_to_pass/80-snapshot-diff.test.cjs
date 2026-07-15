// Hidden grader: plugin `snapshot-diff` — structural diff of two store snapshots.
"use strict";
const assert = require("assert");
const path = require("path");
const os = require("os");
const fs = require("fs");
const { NoteService } = require(path.resolve("src/service.js"));
const { Replica } = require(path.resolve("src/replica.js"));
const { Store } = require(path.resolve("src/store.js"));
const { run } = require(path.resolve("src/cli.js"));

function snap(name, records) {
  const s = new Store();
  for (const r of records) s.upsert(r);
  const f = path.join(os.tmpdir(), "wide-snap-" + name + "-" + process.pid + ".json");
  s.save(f);
  return f;
}
const rec = (id, text, extra) => Object.assign({ id, text, done: false, tags: [], deleted: false, rev: { ts: 1, replica: "a" } }, extra);

const fA = snap("a", [
  rec("a-1", "one"),
  rec("a-2", "two"),
  rec("a-3", "three"),
  rec("a-5", "tags", { tags: ["x", "y"] }),
]);
const fB = snap("b", [
  rec("a-2", "TWO", { done: true }),
  rec("a-3", "three", { rev: { ts: 9, replica: "b" } }), // rev-only change: not "changed"
  rec("a-4", "new"),
  rec("a-5", "tags", { tags: ["y", "x"] }),              // order-sensitive tags change
]);

const svc = new NoteService(new Replica("t"));
const out = run(["plugin", "snapshot-diff", fA, fB], svc);
assert.deepStrictEqual(out, {
  added: ["a-4"],
  removed: ["a-1"],
  changed: [
    { id: "a-2", fields: ["done", "text"] },
    { id: "a-5", fields: ["tags"] },
  ],
});

const badVer = path.join(os.tmpdir(), "wide-snap-bad-" + process.pid + ".json");
fs.writeFileSync(badVer, JSON.stringify({ version: 2, records: [] }));
assert.throws(() => run(["plugin", "snapshot-diff", fA, badVer], svc), /unsupported version/);

assert.throws(() => run(["plugin", "snapshot-diff", fA], svc), /two paths required/);

console.log("ok");
