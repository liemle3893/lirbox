# notes-app v4

A multi-module, sync-CAPABLE notes app. Every mutation is revision-stamped (`{ ts, replica }`,
Lamport clock), deletes are tombstones, and replicas exchange versioned change envelopes:
`export` writes one, `sync` applies one (deterministic last-writer-wins merge — see
`src/merge.js`), converging replicas. Applying an envelope records the sender's demonstrated
clock in the peer registry (`src/peers.js`, `peers` CLI command).

Modules: `src/clock.js` → `src/store.js` → `src/replica.js` → `src/merge.js` + `src/peers.js`
→ `src/service.js` → `src/cli.js` → `src/app.js` (file-backed via `src/snapshot.js`).
`src/codec.js` + `src/validate.js` define the change-envelope format.

`npm test` runs the suite.
