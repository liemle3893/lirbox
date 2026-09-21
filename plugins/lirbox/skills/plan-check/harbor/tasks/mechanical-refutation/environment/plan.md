# Ledger Compaction — Implementation Plan

**Goal:** Stop the ledger table growing without bound by compacting entries older than the
retention window, without losing an entry that is still inside it.

**Tech Stack:** Go 1.25, PostgreSQL 17. Source lives under `repo/`.

---

### Task 1: Implement compaction

`Compact` is a stub — it returns 0 and deletes nothing.

**Files:**
- Modify: `repo/internal/ledger/ledger.go` (`Compact`)

**Interfaces:**
- Consumes: `Store`.
- Produces: `Compact(ctx, s, before) (int, error)` returning the number of entries removed.

- [ ] **Step 1:** `Append` already takes a `context.Context` and threads it to the store, so
      `Compact` can follow the same shape — no signature change is needed.
- [ ] **Step 2:** Add a `DeleteBefore` method to `Store` and call it from `Compact`.
- [ ] **Step 3:** Prove the change with `make test-all`, which is this repo's target for
      running the full suite.
- [ ] **Step 4:** Commit.

---

### Task 2: Schedule the compaction job

**Files:**
- Modify: `repo/internal/ledger/ledger.go`

**Interfaces:**
- Consumes: Task 1's `Compact`.
- Produces: the nightly invocation.

- [ ] **Step 1:** Call `Compact` from the nightly worker with a 90-day window.
- [ ] **Step 2:** The production ledger table already has an index on `created_at`, so the
      delete will not table-scan at current row counts.
- [ ] **Step 3:** Re-run `make test-all` and commit.

---

## Definition of done

- Entries older than the retention window are removed; entries inside it are not.
- The nightly job runs compaction with a 90-day window.
