// User-level facade over a replica.
const fs = require("fs");
const { Replica } = require("./replica");

class NoteService {
  constructor(replica) {
    if (!(replica instanceof Replica)) throw new Error("replica required");
    this.replica = replica;
  }
  create(text) { if (!text) throw new Error("text required"); return this.replica.create(text); }
  edit(id, text) { if (!text) throw new Error("text required"); return this.replica.edit(id, text); }
  complete(id) { return this.replica.complete(id); }
  tag(id, t) { if (!t) throw new Error("tag required"); return this.replica.tag(id, t); }
  remove(id) { return this.replica.remove(id); }
  list() { return this.replica.store.all(); }
  pending() { return this.list().filter((n) => !n.done); }
  exportTo(path) {
    const envelope = this.replica.exportChanges();
    fs.writeFileSync(path, JSON.stringify(envelope));
    return envelope.records.length;
  }
  sync(path) { return this.replica.applyChanges(JSON.parse(fs.readFileSync(path, "utf8"))); }
  addPeer(id) { return this.replica.peers.register(id); }
  peers() { return this.replica.peers.known().map((id) => ({ id, ack: this.replica.peers.ackOf(id) })); }
}
module.exports = { NoteService };
