// Lamport logical clock — deterministic, no wall time anywhere in this app.
class LamportClock {
  constructor(start = 0) { this.time = start; }
  tick() { return ++this.time; }
  observe(ts) { if (typeof ts === "number" && ts > this.time) this.time = ts; return this.time; }
  now() { return this.time; }
}
module.exports = { LamportClock };
