// Record store with tombstones and revision metadata — the persistence half of a sync-ready app.
// A record: { id, text, done, tags, deleted, rev: { ts, replica } }. Deleted records stay in the
// store as tombstones (deleted: true) so other replicas can learn about the delete later.
const fs = require("fs");

class Store {
  constructor() { this.map = new Map(); }
  upsert(record) { this.map.set(record.id, record); return record; }
  // live-record accessor: tombstones are invisible here
  get(id) { const r = this.map.get(id); return r && !r.deleted ? r : null; }
  // raw accessor: includes tombstones
  getRecord(id) { return this.map.get(id) || null; }
  all() { return [...this.map.values()].filter((r) => !r.deleted).sort((a, b) => (a.id < b.id ? -1 : 1)); }
  records() { return [...this.map.values()].sort((a, b) => (a.id < b.id ? -1 : 1)); }
  save(path) { fs.writeFileSync(path, JSON.stringify({ version: 3, records: this.records() })); }
  static load(path) {
    const d = JSON.parse(fs.readFileSync(path, "utf8"));
    if (d.version !== 3) throw new Error("unsupported version");
    const s = new Store();
    for (const r of d.records) s.upsert(r);
    return s;
  }
}
module.exports = { Store };
