# Checkout Latency — Implementation Plan

**Goal:** stop customers abandoning checkout because the payment step feels slow. Field data says
abandonment climbs sharply once the confirm button takes more than ~2s to respond, and we are
currently well past that at peak.

**Tech Stack:** Go 1.25, Redis, PostgreSQL 17.

---

### Task 1: Cache the tax-rate lookup

The tax service is called once per line item, serially.

**Files:**
- Modify: `internal/checkout/tax.go`

**Interfaces:**
- Consumes: nothing.
- Produces: `func (c *TaxCache) Rate(ctx context.Context, region string) (Rate, error)`

- [ ] **Step 1:** Add a Redis-backed cache keyed by region, 10 minute TTL.
- [ ] **Step 2:** Benchmark `BenchmarkTaxLookup` before and after.
- [ ] **Step 3:** Commit.

---

### Task 2: Batch the inventory reservation calls

**Files:**
- Modify: `internal/checkout/inventory.go`

**Interfaces:**
- Consumes: nothing.
- Produces: `func (r *Reserver) ReserveBatch(ctx context.Context, items []Item) error`

- [ ] **Step 1:** Replace the per-item loop with one batched call.
- [ ] **Step 2:** Benchmark `BenchmarkReserve` before and after.
- [ ] **Step 3:** Commit.

---

## Definition of done

- `go test ./internal/checkout/...` is green.
- `BenchmarkTaxLookup` improves by at least 40%.
- `BenchmarkReserve` improves by at least 40%.
- No new lint warnings.
