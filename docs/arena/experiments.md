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
| **conductor (current)** | **sonnet-5** | **✅ 6/6** | **>90 min (cap hit)** | unknown | **2026-08-02.** Engaged (`wf/uglify-miscompile-fixes`), f2p 6/6 zero failures, p2p green. Reached Setup → DoDBaseline → implement, then the 5400 s cap fired **before** the gates, Writeup and Finalize. See the correction below. |

> **CORRECTION (2026-08-02): the three ❌ conductor rows above are HARNESS ARTIFACTS, not capability
> verdicts.** Both causes they name — the driver backgrounding the Workflow and orphaning the run,
> and `--plugin-dir` being shadowed by the installed plugin — have since been fixed. With both fixed,
> conductor resolves this task **6/6 with p2p green**, matching raw. Do not cite those rows as
> evidence that conductor cannot do hard work; the earlier reading was wrong.
>
> **It still shows no lift.** Raw does the same 6/6 in ~53 min, complete, for ~$24. Conductor matched
> the score but was slower and had *not finished* when the cap fired. Two numbers from that run must
> not be read as scores: `docs 0.00` is a timeout artifact (the Writeup phase never ran), and the
> `$0.00` in the runner output means **cost unknown** — the process was killed before the stream's
> final `total_cost_usd` event, not that the run was free.
>
> So across all seven registered tasks, easy through xxhard, conductor's measured **correctness lift
> is zero** — it matches raw everywhere and exceeds it nowhere, at 7.7× the cost on the cheap tasks
> and >1.7× the wall-clock on the hardest one.

## Older rung probes (uncapped, registration-gate probes)

| task | arm | model | resolved | time | cost |
|---|---|---|---|---|---|
| notes-sync-merge (xhard) | raw | sonnet-5 | ✅ 4/4 | ~25 min | — |
| notes-selective-sync (unregistered reserve) | raw | sonnet-5 | ✅ 5/5 | ~25 min | $1.63 |

## Headroom probe — the whole registered suite, raw arm (2026-08-01)

Ran the control arm across every **registered graded** task: bare `claude -p`, no skill, no
conductor, no `--plugin-dir`. Same bundle clone, same base sha, task content inlined, same
`swe-grade.mjs` as `swe-run`. All five graders passed `--validate` first (p2p green on base, 3/3 f2p
RED, zero leaks), so a failure would have been the agent's, not the grader's.

| task | difficulty | raw sonnet-5 | time | cost |
|---|---|---|---|---|
| notes-add-tags | easy | ✅ 3/3 | 62s | $0.42 |
| notes-archive | easy | ✅ 3/3 | 55s | $0.37 |
| notes-search | medium | ✅ 3/3 | 71s | $0.43 |
| notes-import-export | medium-hard | ✅ 3/3 | 57s | $0.39 |
| notes-fix-data-loss | **hard** | ✅ 3/3 | **84s** | $0.51 |
| notes-sync-merge | xhard | ✅ 4/4 | ~25 min | prior (above) |
| uglify-corner-cases | xxhard | ✅ 6/6 | ~53 min | prior (above) |

**HEADROOM: 0 of 7. Total spend $2.12.** Reproduce: `scripts/raw-headroom-probe.mjs`.

The difficulty ladder is not a ladder for the control arm — the task labelled *hard* fell in 84
seconds, faster than two labelled *easy* in the older probes. Recorded conductor runs on these same
tasks took 17–47 minutes.

**Consequence.** Lift is bounded at zero on a task the control already passes, so this suite cannot
discriminate any skill, config, model or version — and the pairwise Bradley-Terry half ranks ties,
which is noise. The Harbor port (plan W3) is **cancelled** by its own stop condition (`<4 headroom`),
and repointing `suite.json` at a "low-end tier" (W4.2) is moot: sonnet-5 is not low-end and saturates
in a minute.

**The diagnosis is not "too easy" — it is "wrong dimension."** These tasks ask *did the feature get
built*, which a raw session does trivially. They do not ask what conductor exists for: surviving
interruption, enforcing gates, resuming after a crash, leaving an auditable trail, coordinating
parallel work. Making the fixtures harder does not fix this, and per the note below, hard-at-the-top
degenerates into a timeout benchmark.

*Limits, stated plainly: n=1 per task, one model, no repetitions. 7/7 at full marks in ~60s is not a
result repetitions would overturn, but a genuinely weak model was not tested.*

## Variance / "insurance" probe — the paired arms, k=5 (2026-08-02)

The remaining conductor claim was *insurance*: the value shows up in the tail, not the mean. Tested
by repeating ONE task per arm under an **identical contract** (branch it, document it, record a
verified DoD checklist — both arms told the same thing, so the control could satisfy every
dimension). Task: `notes-fix-data-loss` (hard; the only cell in the suite that had ever scored below
1.0). Grader: `multi-grade.mjs`, four deterministic dimensions. Runner: `scripts/lift-probe.mjs`.

| | raw (n=5) | conductor, ENGAGED (n=4) | lift |
|---|---|---|---|
| correctness | 1.000 | 1.000 | **0** |
| docs | 1.000 | 1.000 | **0** |
| isolation | 1.000 | 1.000 | **0** |
| dod | 0.900 | 0.375 | **−0.525** |
| cost | $0.72–0.85 | $4.52–7.57 | **7.7×** |
| wall-clock | 184–223s | 1243–1865s | **7.7×** |

**Spend $28.98. The hypothesis is falsified in the direction opposite to the claim.**

**Engagement was 4/5.** One "conductor" cell produced `fix/…` rather than `wf/…` — the skill never
ran, and a raw delivery sat in the conductor arm at 205s/$0.86. Excluded from the means above and
reported separately. This is arena #41's confound, reintroduced because `multi-grade.mjs` is
arm-agnostic; `lift-probe.mjs` now measures engagement as a tri-state. **The single largest source of
outcome variance in either arm is conductor failing to execute at all** — which inverts the insurance
claim rather than supporting it.

**Do not over-read the −0.525 on `dod`.** That dimension scores *verification vocabulary*, not
verification: raw earned 1.0 partly on the sentence "npm test passes". Conductor's write-ups were
consistently **better prose** — root cause, fix, tests, files touched — but never a ticked checklist,
in 5/5 runs. The defensible claim is narrow: *conductor did not produce the verified checklist the
shared contract asked for; raw did, 4 times in 5.* Fixing the anchor is open work.

What is grader-independent: three of four dimensions are pinned at 1.000 for **both** arms, and
conductor takes 7.7× the cost and 7.7× the wall-clock to reach the identical result.

**Scope, stated plainly.** This tests the region the owner already predicted conductor would lose —
*"for simple task, of course, the without skill may even better."* It says nothing about work too
large for one context, or genuinely colliding parallel items. Those remain unmeasured, and this task
could never reach them. Stopping at n=5 was deliberate: the sign is unambiguous, and more runs would
only tighten an interval around a negative. Resolving a 20%→0% effect would need ~20–25 runs per arm
(see the MDE note in [scores/README.md](./scores/README.md)).

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
