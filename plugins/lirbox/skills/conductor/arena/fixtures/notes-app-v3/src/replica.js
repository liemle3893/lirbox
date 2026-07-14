// A replica identity: wraps a store + clock, stamps every mutation with a revision
// { ts, replica } so concurrent edits on different replicas can later be ordered.
// Ids are minted as "<replica>-<n>" so two replicas can never mint the same id.
const { Store } = require("./store");
const { LamportClock } = require("./clock");
const codec = require("./codec");

class Replica {
  constructor(id, store, clock) {
    if (!id || typeof id !== "string") throw new Error("replica id required");
    this.id = id;
    this.store = store || new Store();
    this.clock = clock || new LamportClock();
    this.seq = 0;
  }
  stamp() { return { ts: this.clock.tick(), replica: this.id }; }
  _live(id) { const r = this.store.get(id); if (!r) throw new Error("not found"); return r; }
  create(text) {
    const id = `${this.id}-${++this.seq}`;
    return this.store.upsert({ id, text, done: false, tags: [], deleted: false, rev: this.stamp() });
  }
  edit(id, text) { return this.store.upsert({ ...this._live(id), text, rev: this.stamp() }); }
  complete(id) { return this.store.upsert({ ...this._live(id), done: true, rev: this.stamp() }); }
  tag(id, t) { const r = this._live(id); return this.store.upsert({ ...r, tags: [...r.tags, t], rev: this.stamp() }); }
  remove(id) { return this.store.upsert({ ...this._live(id), deleted: true, rev: this.stamp() }); }
  exportChanges() { return codec.encode(this); }
}
module.exports = { Replica };
