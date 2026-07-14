// Persist/restore FULL replica state (identity + id sequence + clock + records incl. tombstones).
const fs = require("fs");
const { Store } = require("./store");
const { LamportClock } = require("./clock");
const { Replica } = require("./replica");

function saveSnapshot(replica, path) {
  fs.writeFileSync(path, JSON.stringify({
    version: 3, id: replica.id, seq: replica.seq, clock: replica.clock.now(),
    records: replica.store.records(),
  }));
}

function loadSnapshot(path) {
  const d = JSON.parse(fs.readFileSync(path, "utf8"));
  if (d.version !== 3) throw new Error("unsupported version");
  const store = new Store();
  for (const r of d.records) store.upsert(r);
  const replica = new Replica(d.id, store, new LamportClock(d.clock));
  replica.seq = d.seq;
  return replica;
}

module.exports = { saveSnapshot, loadSnapshot };
