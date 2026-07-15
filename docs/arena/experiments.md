# Arena experiments — raw vs conductor comparison matrix

Hand-run probe/cell results that do NOT live in the [scoreboard](./scores/README.md) (that page
only records `swe-run` scorecards). One row per arm. "raw" = single `claude -p` session with the
task text + non-interactive preamble, no conductor. All arms graded by `swe-grade` (hidden
F2P + P2P); cap 3600s unless noted. Dates 2026-07-14/15; suite era `68fc7b29894a` context.

## notes-wide-features (8 independent plugins, one file each — UNREGISTERED)

| arm | model | resolved | time | cost | notes |
|---|---|---|---|---|---|
| raw | sonnet-5 | ✅ 8/8 | **4.4 min** | $0.99 | 6 tool calls; width × cheap items never defeats raw |
| raw | opus-4-8[1m] | ✅ 8/8 | **4.6 min** | — | ≈ sonnet: model speed is not the differentiator |
| conductor | opus-4-8[1m]/high | ✅ 8/8 | **33 min** | — | first clean parallel cell: `--independent` → `parallel()`, foreground held; **gate caught a real worker bug** (dedupe append-order) that would have graded 7/8 |
| conductor | sonnet-5/high | ✅ 8/8 | ~47 min\* | — | **sonnet's first resolved conductor cell ever** (engaged, no bypass); \*wall-clock polluted by overnight machine sleep |

Breakdown of conductor+opus's 33 min: ~8 min planning (DoD, prompts, scaffold) + **~2 min actual
parallel work** (8 plugins landed within 112 s) + ~19 min gates/finalize. The bookends are the
entire cost; the work phase matched raw's total.

## uglify-corner-cases (6 real miscompilations, all in the 12.6k-line compress.js — REGISTERED xxhard)

| arm | model | resolved | time | cost | notes |
|---|---|---|---|---|---|
| raw (uncapped) | sonnet-5 | ✅ 6/6 | **53 min**† | ~$24 | 279 tool calls, zero web lookups; †clean-run number — a 3-segment kill/resume run earlier read ~2 h |
| conductor v1 ×2 | opus-4-8[1m]/high | ❌ 0/6 | 17–18 min | — | driver backgrounded the Workflow and ended its turn → orphaned run, empty wf/ (→ `headless-background-workflow-orphan`) |
| conductor v1 | opus-4-8[1m]/high | ❌ 2/6 | timeout 3600s | — | sequential Report1…6 phases, ~5-min full-suite verify each; surgical gold-quality fixes, too slow |
| conductor v2 (post-whetstone) | opus-4-8[1m]/high | ❌ 0/6 | 22–25 min | — | first run: `--plugin-dir` at checkout root silently shadowed by installed plugin (fixed in swe-run); true run: driver READ `--independent` and correctly declined (all fixes share one file) → `independent-work-needs-per-worker-worktrees` |

## Older rung probes (uncapped, registration-gate probes)

| task | arm | model | resolved | time | cost |
|---|---|---|---|---|---|
| notes-sync-merge (xhard) | raw | sonnet-5 | ✅ 4/4 | ~25 min | — |
| notes-selective-sync (unregistered reserve) | raw | sonnet-5 | ✅ 5/5 | ~25 min | $1.63 |

## The theory the matrix supports

- **Fair spec + hermetic tests = self-verifiable** → an unbounded frontier session always
  converges; "hard" at the top of the ladder means *effort under a cap*, not unsolvable.
- **Model speed is irrelevant at fixture scale** (raw opus ≈ raw sonnet). Conductor's cost is its
  bookends (planning + gates), invariant to driver model; its value is *insurance* (the caught
  dedupe bug) and only pays when work is expensive or failure is costly.
- **Depth** (one expensive item): raw wins on hot context (53 min vs timeout).
  **Width × cheap**: raw wins trivially (4.4 min).
  **Width × expensive** is the only "raw fails, conductor wins" construction — blocked on
  `independent-work-needs-per-worker-worktrees` (the 8–10 candidate uglify bugs all share
  compress.js).

Full narrative: `docs/arena-handoff.md` items 7–12. Conductor backlog: `feedback/conductor.jsonl`.
