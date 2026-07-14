// Hidden grader: plugin `import-csv` — quoted-field CSV with tag lists and row errors.
"use strict";
const assert = require("assert");
const path = require("path");
const os = require("os");
const fs = require("fs");
const { NoteService } = require(path.resolve("src/service.js"));
const { Replica } = require(path.resolve("src/replica.js"));
const { run } = require(path.resolve("src/cli.js"));

function tmp(name, content) {
  const f = path.join(os.tmpdir(), "wide-csv-" + name + "-" + process.pid + ".csv");
  fs.writeFileSync(f, content);
  return f;
}

const svc = new NoteService(new Replica("t"));
const good = tmp("good", 'text,tags\nplain,\n"quoted, comma",docs\n"say ""hi""",docs;work\nthird,;;a;\n"multi\nline",x\n');
const res = run(["plugin", "import-csv", good], svc);
assert.deepStrictEqual(res, { created: 5, ids: ["t-1", "t-2", "t-3", "t-4", "t-5"] });
assert.strictEqual(svc.replica.store.get("t-2").text, "quoted, comma");
assert.deepStrictEqual(svc.replica.store.get("t-2").tags, ["docs"]);
assert.strictEqual(svc.replica.store.get("t-3").text, 'say "hi"');
assert.deepStrictEqual(svc.replica.store.get("t-3").tags, ["docs", "work"]);
assert.deepStrictEqual(svc.replica.store.get("t-4").tags, ["a"], "empty tag entries skipped");
assert.strictEqual(svc.replica.store.get("t-5").text, "multi\nline");

const headerOnly = tmp("empty", "text,tags\n");
assert.deepStrictEqual(run(["plugin", "import-csv", headerOnly], new NoteService(new Replica("e"))), { created: 0, ids: [] });

const badHeader = tmp("badh", "notes,labels\nx,\n");
assert.throws(() => run(["plugin", "import-csv", badHeader], new NoteService(new Replica("h"))), /bad header/);

const threeFields = tmp("three", "text,tags\na,b,c\n");
assert.throws(() => run(["plugin", "import-csv", threeFields], new NoteService(new Replica("f"))), /bad row 2/);

const unterminated = tmp("unterm", 'text,tags\nok,\n"never closed,docs\n');
assert.throws(() => run(["plugin", "import-csv", unterminated], new NoteService(new Replica("u"))), /bad row 3/);

assert.throws(() => run(["plugin", "import-csv"], svc), /path required/);

console.log("ok");
