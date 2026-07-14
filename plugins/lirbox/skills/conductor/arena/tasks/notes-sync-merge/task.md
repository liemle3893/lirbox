# Task: implement offline sync (replica merge) for notes-app v3

The app is already sync-READY — every mutation is revision-stamped (`{ ts, replica }`, Lamport
clock), deletes are tombstones, and `Replica.exportChanges()` produces a versioned change
envelope (`src/codec.js`). What's missing is the other half: **applying** an envelope exported
by another replica so that replicas converge. Deliver it end-to-end with tests.

## Requirements

1. **Merge module** (`src/merge.js`, new): export `applyChanges(replica, envelope)` implementing
   the rules below. **Replica** (`src/replica.js`) gains `applyChanges(envelope)` delegating to it.
2. **Envelope validation** (same rules as the codec): throw `Error("unsupported version")` unless
   `envelope.version === 3`; throw `Error("invalid change set")` unless `envelope.records` is an
   array.
3. **Merge rules** — for each incoming record, compared against the local record with the same
   `id` (tombstones included, i.e. compare against `store.getRecord(id)`):
   - no local record with that id → **adopt** the incoming record;
   - identical revision (same `rev.ts` AND same `rev.replica`) → **skip**;
   - otherwise **last-writer-wins**: the record with the higher `rev.ts` wins; on a `ts` tie, the
     record whose `rev.replica` is lexicographically **greater** wins (`"b"` beats `"a"`);
   - the loser is discarded entirely — no field-by-field merging;
   - **tombstones participate identically**: delete-vs-edit conflicts resolve by the same rule
     (a tombstone with a winning revision deletes the note; an edit with a revision newer than
     the tombstone resurrects it). Adopted tombstones are RETAINED in the store (visible via
     `records()`, hidden from `all()`), so deletes keep propagating to replicas that sync later.
4. **Clock rule**: after `applyChanges`, the local clock must have observed the envelope's
   `clock` and every incoming `rev.ts` — the next local mutation must stamp a `ts` strictly
   greater than anything seen.
5. **Return value**: `{ applied, skipped }` — `applied` counts incoming records adopted (new or
   winning), `skipped` counts records where the local copy won or the revision was identical.
6. **Idempotence**: applying the same envelope twice leaves the store unchanged; the second
   application returns `applied: 0`.
7. **Convergence**: after A applies B's export and B applies A's export, both replicas'
   `records()` are identical (same records, same revisions, same order).
8. **Service** (`src/service.js`): `sync(path)` — reads and JSON-parses the file at `path`,
   returns `replica.applyChanges(parsed)`.
9. **CLI** (`src/cli.js`): `sync <path>` → returns `svc.sync(path)`.
10. **Tests** (wired into `npm test`): cover LWW, the tie-break direction, delete-vs-edit both
    ways, resurrection, tombstone propagation, idempotence, convergence, the clock rule, and
    both validation errors.

## Acceptance

- `npm test` passes, including the existing suite (do not break CRUD, codec, snapshot, or CLI
  behavior).
- Two replicas exchanging `export`/`sync` files via the CLI converge.
- No new runtime dependencies; no wall-clock time — the Lamport clock is the only time source.
