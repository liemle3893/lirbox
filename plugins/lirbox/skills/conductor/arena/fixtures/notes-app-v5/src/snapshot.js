// Persist/restore FULL replica state (identity + id sequence + clock + peer acks + records
// including tombstones).
const fs = require("fs");
const { Store } = require("./store");
const { LamportClock } = require("./clock");
const { Peers } = require("./peers");
const { Replica } = require("./replica");

function saveSnapshot(replica, path) {
  fs.writeFileSync(path, JSON.stringify({
    version: 3, id: replica.id, seq: replica.seq, clock: replica.clock.now(),
    peers: replica.peers.known().map((id) => [id, replica.peers.ackOf(id)]),
    records: replica.store.records(),
  }));
}

function loadSnapshot(path) {
  const d = JSON.parse(fs.readFileSync(path, "utf8"));
  if (d.version !== 3) throw new Error("unsupported version");
  const store = new Store();
  for (const r of d.records) store.upsert(r);
  const peers = new Peers();
  for (const [id, ts] of d.peers || []) peers.ack(id, ts);
  const replica = new Replica(d.id, store, new LamportClock(d.clock), peers);
  replica.seq = d.seq;
  return replica;
}

module.exports = { saveSnapshot, loadSnapshot };
