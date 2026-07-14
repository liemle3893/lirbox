# notes-app v3

A multi-module notes app built sync-ready: every mutation is stamped with a revision
(`{ ts, replica }`) from a Lamport clock, deletes are tombstones, and a versioned codec
exports the full record set as a change envelope. Replication itself (merging a change
envelope from another replica) is not implemented yet.

Modules: `src/clock.js` (Lamport clock) → `src/store.js` (record store, tombstone-aware)
→ `src/replica.js` (identity + revision stamping + CRUD) → `src/service.js` (user-level
facade) → `src/cli.js` (commands) → `src/app.js` (file-backed entrypoint via
`src/snapshot.js`). `src/codec.js` + `src/validate.js` define the change-envelope format.

`npm test` runs the suite.
