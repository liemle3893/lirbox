// Hidden grader: plugin `export-md` — tag-sectioned Markdown with escaping.
"use strict";
const assert = require("assert");
const path = require("path");
const os = require("os");
const fs = require("fs");
const { NoteService } = require(path.resolve("src/service.js"));
const { Replica } = require(path.resolve("src/replica.js"));
const { run } = require(path.resolve("src/cli.js"));

const svc = new NoteService(new Replica("t"));
run(["add", "task `one`*"], svc);   // t-1
run(["add", "two"], svc);           // t-2
run(["add", "plain"], svc);         // t-3 untagged
run(["add", "gone"], svc);          // t-4 → tombstone
run(["tag", "t-1", "docs"], svc);
run(["tag", "t-2", "docs"], svc);
run(["tag", "t-2", "work"], svc);
run(["done", "t-2"], svc);
run(["rm", "t-4"], svc);

const f = path.join(os.tmpdir(), "wide-md-" + process.pid + ".md");
const n = run(["plugin", "export-md", f], svc);
assert.strictEqual(n, 3, "distinct live notes written");
const lines = fs.readFileSync(f, "utf8").split("\n").filter((l) => l.trim() !== "");
assert.deepStrictEqual(lines, [
  "# Notes",
  "## docs",
  "- [ ] task \\`one\\`\\*",
  "- [x] two",
  "## work",
  "- [x] two",
  "## (untagged)",
  "- [ ] plain",
]);
fs.unlinkSync(f);

// empty store
const empty = new NoteService(new Replica("e"));
const f2 = path.join(os.tmpdir(), "wide-md-empty-" + process.pid + ".md");
assert.strictEqual(run(["plugin", "export-md", f2], empty), 0);
assert.strictEqual(fs.readFileSync(f2, "utf8"), "# Notes\n");
fs.unlinkSync(f2);

assert.throws(() => run(["plugin", "export-md"], svc), /path required/);

console.log("ok");
