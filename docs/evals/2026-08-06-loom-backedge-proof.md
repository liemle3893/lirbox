# loom: runtime proof of the gate-failure back-edge

**Date:** 2026-08-06
**Claim under test:** loom's back-edge — a gate that fails routes control *backwards* to an earlier
node, carrying its findings — actually fires at runtime, and the run then *converges* rather than
looping to its visit cap.

This is the only behaviour that distinguishes `loom` from `conductor`. Everything else in loom
(durable state, worker isolation, DoD gating, PR handoff) conductor also does. Until this fired,
choosing loom was unjustified.

## Result: PROVEN

```
loom run: ratelimit
status:   complete
graph:    v0, 8 nodes

VISITS
  Setup            1/3
  DoDBaseline      1/3
  Plan             1/3
  Implement        2/4   <- revisited
  Review           2/3   <- revisited
  DoDGate          1/3
  PR               1/3

PATH
  Setup#1        -     -> DoDBaseline
  DoDBaseline#1  -     -> Plan
  Plan#1         -     -> Implement
  Implement#1    -     -> Review
  Review#1       FAIL  -> Implement      <-- BACK-EDGE
  Implement#2    -     -> Review
  Review#2       pass  -> DoDGate
  DoDGate#1      pass  -> PR
  PR#1           -     -> Done
```

Five criteria were set **before** the run. All five hold.

| # | Criterion | Result |
|---|---|---|
| 1 | `PATH` contains `Review#1 FAIL -> Implement` | met |
| 2 | `VISITS` shows a node revisited | met — `Implement 2/4`, `Review 2/3` |
| 3 | `CARRIED FORWARD` non-empty and *actionable* | met — three full diagnoses with reproduction |
| 4 | Run reaches `complete` by convergence, not the visit cap | met — converged on visit 2 of 4 |
| 5 | The first pass could not have pre-satisfied the gate | met — see below |

## Why this run could fail where two earlier ones could not

Two earlier honest attempts never fired the edge:

- **`parselimit`** — the DoD asserted an exact error string, committed in a readable test. The
  implementer read the test and matched it first try.
- **`safepath`** — `resolveUserFile(baseDir, userPath)`; the naive `path.join` passes every
  functional criterion yet allows `../../etc/passwd`. The implementer wrote the full lexical
  containment check unprompted.

The diagnosis those two produced: **any deterministic gate must exist as a file in the repo, and a
full-tools implementer can read that file and satisfy it.** So a deterministic gate can never force
re-entry. Only a *judged* gate can — which is what loom's design assumes.

`ratelimit` was built on that diagnosis. The task is a per-key token-bucket `RateLimiter`. The
frozen DoD exercises two keys and the happy path. The defects that matter are invisible to it:

- `Review`'s prompt was a **generic** production-readiness rubric — resource exhaustion, input
  validation, edge-case correctness, concurrency. It never mentions token buckets, key maps, or
  eviction. Tailoring it to the known defect would have been handing the gate its answer.
- `Implement` kept the seed's stock prompt and was **never told the review's bar**. That asymmetry
  ships in the seed; it was not manufactured for this run.

Before spending anything, the gap was verified to exist: the naive implementation **passes the DoD**
while retaining **200,000 bucket entries with 0 evicted and 32.6 MB heap**.

## What `Implement#1` produced

```js
// ponytail: unbounded key map, add LRU/TTL eviction if keys are unbounded (per-IP)
this.buckets = new Map();
```

It shipped the defect and labelled it. The frozen test suite passes.

## What `Review#1` returned

`passed: false`, `buildExit: 0`, three findings — each independently reproduced by the reviewer,
not merely asserted:

1. **Non-monotonic clock.** `(now - b.last)` is unclamped and the default `clock` is `Date.now`
   (wall-clock; steps backwards on NTP correction, snapshot restore, admin time change). Verified:
   at capacity 10 / refill 10 a one-hour backwards step sets tokens to **−35991**, denying every
   request for that key for the next **3599 consecutive seconds**.
2. **Unbounded key map.** Verified 200,000 synthetic keys all retained, no eviction path. On the
   `ponytail:` comment: *"acknowledges this but ships it anyway; that is not acceptable at a trust
   boundary."*
3. **No constructor validation.** `new RateLimiter({})` and `{capacity: 5, refillPerSec: 'fast'}`
   both yield `tokens === NaN`; `NaN >= 1` is false, so the limiter denies **100% of traffic
   forever, silently**. Same for `refillPerSec: Infinity` and any `capacity < 1`.

This is criterion 5. None of the three is discoverable from the repo — the bar is a judgement about
the cases the tests omit, and the reviewer's own rubric says so: *"Tests passing is NOT sufficient
evidence... a test suite exercises the cases its author imagined."*

## What the carry delivered, and what `Implement#2` did with it

`edge.carry: ["findings"]` moved all three diagnoses — full prose, with fixes — into `Implement`'s
second visit. Each was addressed one-to-one:

| Finding | Fix in `6d6f551` |
|---|---|
| backwards clock | `const elapsed = Math.max(0, now - b.last)`; default clock moved to `performance.now()` |
| unbounded map | `maxKeys = 10000` + LRU eviction via `Map` insertion order |
| no validation | four `TypeError` guards in the constructor |

`Implement#2` also **declined** one of the reviewer's two suggested remedies, with a reason: dropping
a bucket once it refills to capacity is a no-op in this access path. A gate whose findings are
adopted wholesale is a gate being obeyed; one whose findings are argued with is a gate being *used*.

`Review#2`: `passed: true`, `findings: []`.

## What `DoDGate` verified

Both frozen checks: sha256 matched the frozen `checkSha` (not tampered), then run — exit 0 each.
It explicitly confirmed the contract was not weakened:

> *"Frozen contract unmodified: git diff --stat main..HEAD lists only src/limiter.js and net-new
> test/hardening.test.js, so test/limiter.test.js has zero changes — passed by implementation, not
> by weakening the measurement."*

## Two honest caveats

**The seed's own `Review` prompt would not have produced this.** The shipped `delivery.json` tells
`Review` to *"Fix every Critical and High finding... and commit"* — fix-and-pass, so it repairs the
work and reports success instead of routing backwards. This run replaced **only that node's prompt**
with an adjudicate-only one; same graph, same edges, same goal, same model. That single change took
the edge from 0/3 fires to firing on the first try. The interpreter was never the problem — the
shipped prompt was. Filed as `review-gate-repairs-instead-of-routing`.

**`PR#1` did not open a PR, and the run still said `complete`.** The experiment repo has no git
remote, so the node correctly refused to invent an external side effect and returned
`BLOCKED: no PR opened`. The seed's `PR -> Done` edge is `when: "always"`, so a blocked delivery
still terminates as `complete`. Every gate genuinely passed — this is a reporting hole in the
terminal, not a soundness hole in the gates. Filed as
`pr-node-reports-complete-without-delivering`.

## Still unproven

- **Runtime graph patching.** The graph stayed at `v0` in all four runs. `Plan#1` explicitly
  declined to patch, reasoning that splitting `Implement` would land `Review`'s carry on a fragment
  owning only part of the file — sound, but it means the feature is unexercised.
- **loom vs conductor on the same hard task.** That is `arena`'s question, not this one. Proving the
  edge fires is not the same as proving it earns its cost.

## Reproduce

Run state, full trace, and every node result: `~/loom-ratelimit/.loom/state/ratelimit.json`.
Work branch: `wf/ratelimit` in `~/loom-ratelimit/.worktrees/ratelimit`.

```
node plugins/lirbox/skills/loom/scripts/loom-report.cjs ratelimit
```

## Backlog outcome

All four concerns this run produced are now closed.

| id | outcome |
|---|---|
| `review-gate-repairs-instead-of-routing` | fixed — both seeds' `Review` is adjudicate-only, `findings` is `required` |
| `dodgate-back-edge-carries-ids-not-evidence` | fixed — `DoDGate` carries `criteria` (required, evidence-bearing) |
| `pr-node-reports-complete-without-delivering` | fixed — `PR` reports `delivered`, and `PR -> Done` branches on it |
| `validategraph-fails-open-on-arity` | **withdrawn — filed in error** |

### Why the fourth was withdrawn

The report claimed `validateGraph(next, prev, cursor)` fails open when called with one argument,
since both lock-enforcement branches are guarded on `prev`. That guard is intended and explicitly
tested — `scripts/test-loom.cjs`:

```js
test('pre-approval, the graph may still declare its own invariants', () => {
  // With no prior graph there is nothing to be frozen against, so seeding works.
  assert.deepStrictEqual(core.validateGraph(LOCKED, null, null), []);
});
```

The supporting evidence does not hold either. The claim was that `scaffold-loom.cjs` rejected a graph
`validateGraph` had accepted — two components disagreeing. In fact `scaffold-loom.cjs:47` calls
`core.validateGraph(graph, graph, null)`, passing the graph as its own `prev`, which is the
pre-approval idiom. The disagreement was between a correct two-argument call and my own incorrect
one-argument call. **Nothing failed open; the caller was wrong.**

Making the one-argument form strict would break a documented, tested behaviour to close a ticket that
should not have been opened. The residual complaint is ergonomic — the permissive mode is what
omission gives you — but no current caller relies on the unsafe shape, so a check for it would be
green on arrival and therefore not a gate at all.
