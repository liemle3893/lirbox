// Known-peer registry: which replicas we sync with, and the highest clock each peer has
// DEMONSTRATED to us (recorded automatically when one of their change envelopes is applied).
class Peers {
  constructor() { this.acks = new Map(); }
  register(id) {
    if (!id || typeof id !== "string") throw new Error("peer id required");
    if (!this.acks.has(id)) this.acks.set(id, 0);
    return id;
  }
  ack(id, ts) {
    this.register(id);
    if (typeof ts === "number" && ts > this.acks.get(id)) this.acks.set(id, ts);
    return this.acks.get(id);
  }
  known() { return [...this.acks.keys()].sort(); }
  ackOf(id) { return this.acks.has(id) ? this.acks.get(id) : 0; }
  minAck() { return this.acks.size ? Math.min(...this.acks.values()) : 0; }
}
module.exports = { Peers };
