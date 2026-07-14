const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { LamportClock } = require("../src/clock");
const { Store } = require("../src/store");
const { Peers } = require("../src/peers");
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
assert.deepStrictEqual(rep.store.get("a-1").tags, ["docs"], "tags read as a plain array");
svc.tag("a-1", "urgent");
assert.deepStrictEqual([...rep.store.get("a-1").tags].sort(), ["docs", "urgent"]);
svc.complete("a-2");
assert.strictEqual(svc.pending().length, 1);

// tombstones: hidden from list(), retained in records()
svc.remove("a-2");
assert.strictEqual(svc.list().length, 1);
assert.strictEqual(rep.store.records().length, 2);
assert.strictEqual(rep.store.getRecord("a-2").deleted, true);
assert.throws(() => svc.edit("a-2", "zombie"), /not found/);

// codec: roundtrip + validation
const env0 = rep.exportChanges();
assert.strictEqual(env0.version, 3);
assert.strictEqual(env0.replica, "a");
assert.strictEqual(env0.records.length, 2);
assert.doesNotThrow(() => codec.decode(env0));
assert.throws(() => codec.decode({ version: 2, records: [] }), /unsupported version/);
assert.throws(() => codec.decode({ version: 3, records: "x" }), /invalid change set/);

// sync: LWW merge, convergence, idempotence, counts
const b = new Replica("b");
const r1 = b.applyChanges(rep.exportChanges());
assert.strictEqual(r1.applied, 2);
b.edit("a-1", "b version");
rep.applyChanges(b.exportChanges());
assert.strictEqual(rep.store.get("a-1").text, "b version", "newer edit wins");
const r2 = rep.applyChanges(b.exportChanges());
assert.strictEqual(r2.applied, 0, "identical envelope re-applies nothing");
assert.strictEqual(JSON.stringify(rep.store.records()), JSON.stringify(b.store.records()), "replicas converge");

// tombstone semantics survive sync: the delete of a-2 propagates as a tombstone
assert.strictEqual(b.store.get("a-2"), null);
assert.strictEqual(b.store.getRecord("a-2").deleted, true);

// peers: applying an envelope records the sender's demonstrated clock
assert.strictEqual(rep.peers.ackOf("b"), b.clock.now());
assert.deepStrictEqual(rep.peers.known(), ["b"]);
rep.peers.register("c");
assert.strictEqual(rep.peers.ackOf("c"), 0, "registered-but-silent peers ack 0");
assert.strictEqual(rep.peers.minAck(), 0, "minAck is over ALL known peers");
const emptyPeers = new Peers();
assert.strictEqual(emptyPeers.minAck(), 0, "no peers means minAck 0");

// snapshot: identity + seq + clock + peer acks survive
const pf = path.join(os.tmpdir(), "notes-v4-snap-" + process.pid + ".json");
saveSnapshot(rep, pf);
const back = loadSnapshot(pf);
assert.strictEqual(back.id, "a");
assert.strictEqual(back.peers.ackOf("b"), rep.peers.ackOf("b"), "peer acks persist");
assert.deepStrictEqual(back.peers.known(), ["b", "c"]);
const n3 = back.create("after restore");
assert.strictEqual(n3.id, "a-3");
assert.ok(n3.rev.ts > rep.clock.now() - 1, "clock restored");
fs.unlinkSync(pf);

// store save/load
const sf = path.join(os.tmpdir(), "notes-v4-store-" + process.pid + ".json");
rep.store.save(sf);
assert.strictEqual(Store.load(sf).records().length, 2);
fs.unlinkSync(sf);

// cli: export/sync file roundtrip + peers commands
const xf = path.join(os.tmpdir(), "notes-v4-export-" + process.pid + ".json");
const svcB = new NoteService(b);
assert.strictEqual(run(["export", xf], svcB), 2);
const c = new NoteService(new Replica("c"));
const out = run(["sync", xf], c);
assert.strictEqual(out.applied, 2);
assert.strictEqual(run(["peers"], c)[0].id, "b");
assert.strictEqual(run(["peer", "d"], c), "d");
assert.deepStrictEqual(run(["peers"], c).map((p) => p.id), ["b", "d"]);
fs.unlinkSync(xf);

// app entrypoint: snapshot-backed persistence across invocations
const af = path.join(os.tmpdir(), "notes-v4-app-" + process.pid + ".json");
try { fs.unlinkSync(af); } catch (e) { /* fresh */ }
main(["add", "persisted"], af);
assert.strictEqual(main(["list"], af).length, 1);
assert.strictEqual(main(["add", "second"], af).id, "local-2");
fs.unlinkSync(af);

console.log("all tests passed");
