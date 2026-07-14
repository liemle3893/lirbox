const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { LamportClock } = require("../src/clock");
const { Store } = require("../src/store");
const { Replica } = require("../src/replica");
const { NoteService } = require("../src/service");
const { run } = require("../src/cli");
const codec = require("../src/codec");
const { saveSnapshot, loadSnapshot } = require("../src/snapshot");
const { main } = require("../src/app");

// clock: monotonic, observes forward only
const clock = new LamportClock();
assert.strictEqual(clock.tick(), 1);
assert.strictEqual(clock.observe(10), 10);
assert.strictEqual(clock.observe(3), 10);
assert.strictEqual(clock.tick(), 11);

// replica CRUD: ids carry the replica name, revisions strictly increase
const rep = new Replica("a");
const svc = new NoteService(rep);
const n1 = svc.create("write spec");
assert.strictEqual(n1.id, "a-1");
const n2 = svc.create("review spec");
assert.ok(n2.rev.ts > n1.rev.ts, "revisions increase");
svc.edit("a-1", "write the spec");
assert.strictEqual(rep.store.get("a-1").text, "write the spec");
svc.tag("a-1", "docs");
assert.deepStrictEqual(rep.store.get("a-1").tags, ["docs"]);
svc.complete("a-2");
assert.strictEqual(svc.pending().length, 1);

// tombstones: hidden from list(), retained in records()
svc.remove("a-2");
assert.strictEqual(svc.list().length, 1);
assert.strictEqual(rep.store.records().length, 2);
assert.strictEqual(rep.store.getRecord("a-2").deleted, true);
assert.throws(() => svc.edit("a-2", "zombie"), /not found/);

// codec: roundtrip + validation
const env = rep.exportChanges();
assert.strictEqual(env.version, 3);
assert.strictEqual(env.replica, "a");
assert.strictEqual(env.records.length, 2);
assert.doesNotThrow(() => codec.decode(env));
assert.throws(() => codec.decode({ version: 2, records: [] }), /unsupported version/);
assert.throws(() => codec.decode({ version: 3, records: "x" }), /invalid change set/);

// store save/load
const sf = path.join(os.tmpdir(), "notes-v3-store-" + process.pid + ".json");
rep.store.save(sf);
assert.strictEqual(Store.load(sf).records().length, 2);
fs.unlinkSync(sf);

// snapshot: identity + seq + clock survive, so post-restore ids/revisions never collide
const pf = path.join(os.tmpdir(), "notes-v3-snap-" + process.pid + ".json");
saveSnapshot(rep, pf);
const back = loadSnapshot(pf);
assert.strictEqual(back.id, "a");
const n3 = back.create("after restore");
assert.strictEqual(n3.id, "a-3");
assert.ok(n3.rev.ts > rep.clock.now() - 1, "clock restored");
fs.unlinkSync(pf);

// cli + app entrypoint
assert.strictEqual(run(["add", "via", "cli"], svc).text, "via cli");
const xf = path.join(os.tmpdir(), "notes-v3-export-" + process.pid + ".json");
assert.strictEqual(run(["export", xf], svc), 3);
fs.unlinkSync(xf);
const af = path.join(os.tmpdir(), "notes-v3-app-" + process.pid + ".json");
try { fs.unlinkSync(af); } catch (e) { /* fresh */ }
main(["add", "persisted"], af);
assert.strictEqual(main(["list"], af).length, 1);
assert.strictEqual(main(["add", "second"], af).id, "local-2");
fs.unlinkSync(af);

console.log("all tests passed");
