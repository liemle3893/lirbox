# Schedule Run Bookkeeping — Implementation Plan

**Goal:** Stop schedule runs being stranded in `status='running'` when the job context is
cancelled mid-fan-out.

**Tech Stack:** Go 1.25, pgx v5, PostgreSQL 17. Source lives under `repo/`.

---

### Task 1: Detach the bookkeeping writes

`Run` finalizes on the job context, so a cancellation loses the finalize.

**Files:**
- Modify: `repo/internal/schedules/worker.go` (`Run`)

**Interfaces:**
- Consumes: nothing.
- Produces: `func (w *Worker) bookkeep(ctx context.Context) (context.Context, context.CancelFunc)`

- [ ] **Step 1:** `Run` already calls `w.recordDelivery(ctx, tg, status)` for every target
      immediately after the finalize `UPDATE`, so the ledger write is the natural place to
      introduce the detached context — wrap that existing call first.
- [ ] **Step 2:** Add the `bookkeep` helper using `context.WithoutCancel`.
- [ ] **Step 3:** Route the finalize `UPDATE` through it.
- [ ] **Step 4:** Commit.

---

### Task 2: Resolve targets before claiming the occurrence

**Files:**
- Modify: `repo/internal/schedules/resolver.go`

**Interfaces:**
- Consumes: nothing.
- Produces: the ordering invariant later work relies on.

- [ ] **Step 1:** Move the `Resolve` call above the run-row insert.
- [ ] **Step 2:** Do this only after Task 1 has landed — Task 1 rewrites the same statement
      ordering inside `Run`, and applying these two in the other order silently reverts it.
- [ ] **Step 3:** Commit.

---

## Definition of done

- A run whose job context is cancelled mid-fan-out still finalizes.
- Targets are resolved before the occurrence row is inserted.
