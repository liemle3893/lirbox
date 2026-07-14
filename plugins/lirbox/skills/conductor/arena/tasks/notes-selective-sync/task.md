# Task: selective sync — OR-set tags, filtered envelopes, and ack-gated tombstone GC

The app already syncs: replicas exchange full change envelopes and converge via
last-writer-wins merge (`src/merge.js`), and applying an envelope records the sender's
demonstrated clock in the peer registry (`src/peers.js`). Build the next layer: three features
that must work **together**. All existing behavior is load-bearing — the current test suite
must stay green.

## Part 1 — OR-set tag semantics (record-level LWW is wrong for tags)

Today the whole record wins or loses a merge, so concurrent tag changes on different replicas
clobber each other. Fix the semantics for tags only:

1. New operation `untag(id, tag)` on **Replica**, **Service** (`untag(id, tag)`), and **CLI**
   (`untag <id> <tag>`). Untagging a tag the note does not currently carry throws
   `Error("tag not found")`.
2. `record.tags` remains a **plain array of tag names, sorted ascending, without duplicates** —
   every existing consumer keeps working. You may add fields to records to track tag state
   internally; existing records created before this change (plain `tags` arrays) must be
   honored as previously-added tags.
3. **Merge behavior** (add-wins OR-set, observationally):
   - an `untag` removes only the tag-adds the untagging replica had **observed** at the time;
   - concurrent add of a DIFFERENT tag survives: if replica A untags `"x"` while replica B
     (which had synced the same note) concurrently tags `"y"`, then after both replicas
     exchange envelopes both must read `tags: ["y"]` — the untag of `x` wins for `x` AND the
     add of `y` survives, regardless of which record revision wins LWW;
   - concurrent RE-ADD of the SAME tag survives: if A untags `"x"` while B concurrently tags
     `"x"` again, after exchange both replicas read `"x"` as present;
   - a local untag followed by a local re-add leaves the tag present;
   - tag state merges on EVERY envelope application for every record id present on both
     sides — even when the local record wins the LWW comparison or the revisions are
     identical. The `{ applied, skipped }` counts keep their existing record-level meaning
     and are NOT affected by tag-state merging.
   - Scalar fields (`text`, `done`, `deleted`) and `rev` keep exact existing LWW semantics.

## Part 2 — Selective (filtered) export

4. `Replica.exportChanges(opts)` accepts an optional `{ tags: [...] }`. When given a non-empty
   tag list, the envelope contains ONLY:
   - records currently carrying at least one of the listed tags, AND
   - **all tombstones** (deletes always propagate);
   and the envelope carries `partial: true`. Without the option, exports are unchanged (full,
   no `partial` flag required).
5. **Service**: `exportTo(path, tags)` — existing single-argument behavior unchanged; with a
   tag list it writes the filtered envelope. **CLI**: `export <path> [tag...]` — extra
   arguments after the path are the tag filter.
6. Applying a partial envelope merges exactly what it carries — records absent from a partial
   envelope must be left completely untouched on the receiver.
7. **Partial envelopes must NOT advance the sender's peer ack** (`peers.ack`): a filtered
   envelope does not demonstrate full-state transfer, and advancing acks on it would let the
   GC below collect tombstones the partially-synced peer never received. Only full envelopes
   advance the ack.

## Part 3 — Ack-gated tombstone garbage collection

8. `Replica.gcTombstones()` — removes from the store every tombstone whose `rev.ts` is
   less than or equal to the **minimum ack across ALL known peers**, and returns the array of
   collected ids, sorted ascending. Wire it as `gc()` on the **Service** and `gc` on the
   **CLI**.
9. Safety rules: with NO known peers, nothing is collected (returns `[]`); a registered peer
   that has never sent a full envelope (ack `0`) blocks ALL collection; live (non-deleted)
   records are never collected.
10. After collection, the collected tombstones no longer appear in `records()` or in exported
    envelopes.

## Tests

11. Wire coverage for all of the above into `npm test`: the OR-set scenarios from Part 1, the
    filter + `partial` flag + the ack rule from Part 2, and the GC gating rules from Part 3.

## Acceptance

- `npm test` passes, INCLUDING the entire existing suite — CRUD, LWW sync convergence,
  tombstone propagation, peer acks, snapshot persistence, and CLI behavior are all pinned and
  must not regress.
- No new runtime dependencies; the Lamport clock stays the only time source; everything
  stays deterministic.
