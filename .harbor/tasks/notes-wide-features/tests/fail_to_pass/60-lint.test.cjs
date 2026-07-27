// Hidden grader: plugin `lint` — store consistency codes E1..E5, sorted output.
"use strict";
const assert = require("assert");
const path = require("path");
const { NoteService } = require(path.resolve("src/service.js"));
const { Replica } = require(path.resolve("src/replica.js"));
const { run } = require(path.resolve("src/cli.js"));

const svc = new NoteService(new Replica("t"));
const S = svc.replica.store;
// plant violations directly through the app's own store API
S.upsert({ id: "t-1", text: "   ", done: false, tags: [], deleted: false, rev: { ts: 1, replica: "t" } });          // E1
S.upsert({ id: "t-2", text: "ok", done: false, tags: ["a", "a"], deleted: false, rev: { ts: 2, replica: "t" } });   // E2
S.upsert({ id: "t-3", text: "ok", done: true, tags: [], deleted: true, rev: { ts: 3, replica: "t" } });             // E3
S.upsert({ id: "t-4", text: "ok", done: false, tags: [], deleted: false, rev: { ts: 4, replica: "ghost" } });       // E4
S.upsert({ id: "badid", text: "ok", done: false, tags: [], deleted: false, rev: { ts: 5, replica: "t" } });         // E5

const out = run(["plugin", "lint"], svc);
assert.deepStrictEqual(out, [
  { id: "badid", code: "E5" },
  { id: "t-1", code: "E1" },
  { id: "t-2", code: "E2" },
  { id: "t-3", code: "E3" },
  { id: "t-4", code: "E4" },
]);

// a registered peer's records are not E4
svc.replica.peers.register("ghost");
assert.ok(!run(["plugin", "lint"], svc).some((v) => v.code === "E4"));

// clean store
const clean = new NoteService(new Replica("c"));
run(["add", "fine"], clean);
assert.deepStrictEqual(run(["plugin", "lint"], clean), []);

console.log("ok");
