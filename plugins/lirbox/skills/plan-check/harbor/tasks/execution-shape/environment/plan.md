# Schedule Run Hang Fix — Implementation Plan

**Goal:** Stop schedule runs being stranded in `status='running'` forever when a run
outlives the job queue's timeout.

**Implementation order (decided 2026-08-02):** Task 1, then Task 2, then Task 3, then
Task 4. Land them in that sequence.

**Tech Stack:** Go 1.25, River v0.40, pgx v5, PostgreSQL 17.

---

### Task 1: Migration — add the run-error column

**Files:**
- Create: `server/migrations/0018_run_error.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: `schedule_runs.error`, the column every later task depends on.

- [ ] **Step 1:** Add `ALTER TABLE schedule_runs ADD COLUMN error text`.
- [ ] **Step 2:** Apply it against the test database and confirm the column exists.
- [ ] **Step 3:** Commit.

---

### Task 2: Bookkeeping survives job-context cancellation

The finalize `UPDATE` must land even after the job context is cancelled mid-fan-out.

**Files:**
- Modify: `server/internal/schedules/worker.go` (the finalize `UPDATE`, `recordDelivery`)
- Test: `server/internal/schedules/worker_test.go`

**Interfaces:**
- Consumes: Task 1's column.
- Produces: `func (w *Worker) bookkeep(ctx context.Context) (context.Context, context.CancelFunc)`

- [ ] **Step 1:** Write the failing test.
- [ ] **Step 2:** Add the `bookkeep` helper using `context.WithoutCancel`.
- [ ] **Step 3:** Route the finalize `UPDATE` and the ledger insert through it.
- [ ] **Step 4:** Commit.

---

### Task 3: The run records its own failure reason

The job queue reaps its own job rows after ~24h, so the reason a run ended must live in
our table instead.

**Files:**
- Modify: `server/internal/schedules/worker.go` (`Run`)
- Test: `server/internal/schedules/worker_test.go`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing exported.

- [ ] **Step 1:** Write the failing test.
- [ ] **Step 2:** Write the error string into `schedule_runs.error` on the failure path.
- [ ] **Step 3:** Commit.

---

### Task 4: Expose the run error on the API

**Files:**
- Modify: `server/internal/api/runs.go` (response shape)
- Test: `server/internal/api/runs_api_test.go`

**Interfaces:**
- Consumes: nothing.
- Produces: the `error` field on the run response.

- [ ] **Step 1:** Add `error` to the run read model.
- [ ] **Step 2:** Extend the API test to assert the field is present.
- [ ] **Step 3:** Run this after Task 2 has landed — the detached-context bookkeeping is
      what actually populates the column this endpoint reads, so asserting the field
      before Task 2 lands gives a test that passes against a value nothing writes.
- [ ] **Step 4:** Commit.

---

## Definition of done

- `make test-db` is green.
- A run whose job context is cancelled mid-fan-out still finalizes.
- `GET /api/v1/runs/{id}` returns the `error` field.
