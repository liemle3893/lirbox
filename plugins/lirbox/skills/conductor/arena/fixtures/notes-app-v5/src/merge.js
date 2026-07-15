// Deterministic state-based merge: last-writer-wins by (rev.ts, rev.replica).
// Applying an envelope also records the sender's demonstrated clock in the peer registry.
const codec = require("./codec");

function beats(inc, loc) {
  if (inc.rev.ts !== loc.rev.ts) return inc.rev.ts > loc.rev.ts;
  return inc.rev.replica > loc.rev.replica;
}

function applyChanges(replica, envelope) {
  const env = codec.decode(envelope);
  let applied = 0, skipped = 0;
  for (const inc of env.records) {
    const loc = replica.store.getRecord(inc.id);
    if (!loc) {
      replica.store.upsert(JSON.parse(JSON.stringify(inc)));
      applied++;
    } else if (inc.rev.ts === loc.rev.ts && inc.rev.replica === loc.rev.replica) {
      skipped++;
    } else if (beats(inc, loc)) {
      replica.store.upsert(JSON.parse(JSON.stringify(inc)));
      applied++;
    } else {
      skipped++;
    }
    replica.clock.observe(inc.rev.ts);
  }
  replica.clock.observe(env.clock);
  replica.peers.ack(env.replica, env.clock);
  return { applied, skipped };
}

module.exports = { applyChanges };
