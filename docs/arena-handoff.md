# Arena + SWE-scoring — handoff

State of the conductor-evaluation system as of 2026-07-14. Read this first; details live in
[arena-guide.md](./arena-guide.md) (how to run) and the skill's `references/` (internals).

## What exists (one paragraph)

`lirbox:arena` evaluates the **conductor** skill by running it headless against **frozen fixture
tasks** and scoring the **delivered diffs** two complementary ways: **rung 1 — SWE-bench-style
deterministic grading** (hidden fail-to-pass tests; verdict `resolved` yes/no; absolute scorecards,
independent runs) and **rung 4 — blinded pairwise LLM judging** (Bradley-Terry ranking; only among
resolved runs; for quality beyond correctness). Everything is committed on `main` + PR; runtime
scratch is gitignored (`.arena/`); deliverables promote to tracked `docs/arena/**`.

## The two scoring layers — when to use which

| Question | Layer | Command / entry |
|---|---|---|
| "Is the new conductor version better at delivering **correct** work?" | **Absolute score** (rung 1) | `node plugins/lirbox/skills/arena/scripts/swe-run.mjs --name <label> --model <m> --effort <e> [--plugin-dir <lirbox-checkout>] [--runs N]` → row in `docs/arena/scores/README.md`. Independent runs — no baseline re-run. |
| "Between these two configs/versions, whose delivery is **better**?" | **Pairwise judge** (rung 4) | the `lirbox:arena` skill loop (or the manual orchestration in the guide). Judged only among resolved runs; EVEN pass count. |

Rule of thumb: **absolute score for progress-over-time; pairwise for taste when scores tie.**

## Map of the pieces

```
plugins/lirbox/skills/arena/
  SKILL.md                      # lirbox:arena — the durable pairwise loop (confirm-once → Workflow)
  scripts/scaffold-arena.cjs    # generator: pure helpers + emits the 5-phase loop (NEVER hand-edit output)
  scripts/swe-grade.mjs         # rung-1 grader: diff → {p2p, f2p, resolved}; --validate = RED-on-base gate
  scripts/swe-run.mjs           # absolute benchmark: whole suite × one config → scorecard + scoreboard
  scripts/swe-score.mjs         # scorecard math: rate + Wilson CI + SUITE FINGERPRINT; --index rebuilds board
  scripts/arena-report.cjs      # pairwise leaderboard renderer   scripts/list-arena.cjs  # run lister
  scripts/make-fixture.cjs      # deterministic fixture-repo bundle builder
  scripts/test-arena.cjs        # THE regression net (run after ANY change here)
  evals/                        # floor: frontmatter + Elo characterization
  references/{loop-runtime,judging}.md
plugins/lirbox/skills/conductor/arena/
  suite.json                    # frozen suite: budget {runs, judges(EVEN!), cellCapSec} + configs + tasks
  tasks/<id>/{task.md, repo.bundle, repo.ref, grader/fail_to_pass/*.test.cjs}   # grader = HIDDEN from agent
docs/arena/
  scores/README.md              # THE SCOREBOARD (absolute); scores/<name>.json = scorecards
  real-conductor-opus-vs-baseline/, swe-graded-effort-high-vs-med/   # sample runs + evidence/
docs/arena-guide.md             # full how-to        docs/eval-rungs-2-5-guide.md  # theory (local, untracked)
```

## What is PROVEN (with evidence)

1. **Headless conductor works** — `claude -p` runs the Workflow/subagent fleet unattended (Task 0 spike).
2. **Cell contract works live** — clone bundle → conductor (task **content** inlined) → `wf/`-branch
   diff → swe-grade: **4/4 real cells engaged + resolved** across both tasks (Test 3, evidence in
   `docs/arena/swe-graded-effort-high-vs-med/evidence/`).
3. **Graders discriminate and resist gaming** — F2P RED-on-base proven per task (`--validate`, re-run
   by `test-arena.cjs`); adversarial deliveries (partial / regression / **npm-test-gaming cheat**) all
   correctly UNRESOLVED (Test 1).
4. **Judge position-bias is real and handled** — a live judge picked shown-position B **6/6**; odd pass
   counts convert that into a fake winner. Default is now **judges=4 (EVEN)**. If all verdicts pick the
   same shown-position, treat the pair as a tie.
5. **Model caveat** — **sonnet bypasses conductor** on these tasks (implements directly, no `wf/`
   branch) → forfeits. Engagement is asserted, never assumed.
6. **First results** — pairwise: current conductor (`7a2c5ee`) beat baseline (`455ff36`) 3–0 (quality,
   not correctness — all diffs resolved). Absolute: opus high 2/2, opus med 2/2 (CI 34–100%).
7. **The 5-task ladder discriminates (era 484dce71c275 calibration, 2026-07-14)** — opus/high 5/5
   (engagement 100%) > opus/medium 4/5 (bypassed conductor on the hard bug-fix) > sonnet-5/high 2/5
   (bypassed 3 of 5). The discriminating dimension is ENGAGEMENT DISCIPLINE: small-patch /
   hard-localization tasks tempt direct implementation; lower effort and smaller models yield to
   the temptation.
8. **Bypassed work can still be correct** — every cell sonnet-5 forfeited graded `resolved: true`
   when its working-tree diff was graded out-of-band; sonnet even one-shot the xhard sync-merge
   task (4/4). **Measurement posture:** at micro-fixture scale, the fairness law (graders assert
   only task.md-named behavior) hands the solver a complete spec, and frontier models one-shot
   complete specs. This benchmark therefore honestly measures (a) conductor regressions from the
   ceiling, (b) engagement discrimination, (c) pairwise quality-beyond-correctness — NOT raw
   frontier capability. Capability discrimination needs real-repo scale (SWE-bench Pro's path);
   deferred deliberately.
9. **"Probe must fail" is structurally unreachable; effort is the real hard-task dimension
   (2026-07-14)** — three escalations (notes-selective-sync interaction traps, then real-repo
   uglify-corner-cases: UglifyJS v3.17.4 + six real upstream miscompilations, gold = the upstream
   fixes) were ALL eventually resolved by an unbounded sonnet-5 session: a fair task (complete
   spec) + hermetic tests = self-verifiable, and frontier models converge given iteration. What
   DOES separate rungs is effort: uglify-corner-cases cost sonnet ~2 h wall-clock / ~$13 /
   ~194 tool calls with repeated 5-min full-suite verifications (vs ~25 min / $1.63 for
   notes-selective-sync; zero web lookups — solved honestly, 122-line patch vs gold's 27).
   With the suite's `cellCapSec: 3600`, that effort profile IS the discriminator: weak configs
   time out, forfeit, or regress the 126-file P2P minefield. notes-selective-sync stays an
   UNREGISTERED reserve task (proven fair both ways; sonnet one-shots it in ~25 min).
   CORRECTION from the capped head-to-head (below): the ~2 h figure was inflated by two
   kill/resume cycles — a clean uninterrupted raw session resolves in ~53 min (~$24, 279 calls).
10. **Capped head-to-head on uglify-corner-cases (cap=3600s, 2026-07-14) — conductor LOSES to
    raw today** — raw sonnet-5 one-shot: RESOLVED 6/6 in ~53 min. opus-4-8[1m]/high + conductor:
    TIMEOUT at 3603s with 2/6 fixed (surgical, gold-quality fixes — but sequential Report1…6
    phases each paying worker spin-up + a ~5-min full-suite verification). Two harness-level
    findings first: (a) on LONG tasks the headless driver backgrounds the Workflow and ends its
    turn, orphaning the run (2/2 reproduction; empty wf/ branch; filed as
    `headless-background-workflow-orphan`; swe-run's cell prompt now pins
    `run_in_background: false` as part of the cell contract); (b) the capability gap itself is
    filed as `parallelize-independent-work-items` — the six bugs were embarrassingly parallel and
    conductor serialized them. Until conductor parallelizes, NO cap value can make
    "one-shot fails, conductor succeeds" true (conductor is the slower arm); the xxhard rung
    currently measures conductor's process overhead honestly — that's the arena doing its job.
    Experiment scorecard: `docs/arena/scores/x-uglify-conductor-opus48-high.json` (0/1, timeout).
11. **The v2 re-match (post-whetstone conductor) still lost — and characterized exactly why
    (2026-07-15)** — whetstone run conductor-20260714-182449 KEPT both fixes (PR #31: SKILL.md
    headless foreground pin + `--independent` parallel fan-out). Re-running the head-to-head
    surfaced, in order: (a) **`--plugin-dir` at the checkout ROOT silently loads nothing and the
    installed plugin cache shadows the candidate** — proven by A/B forced-skill-invocation probe;
    swe-run now resolves `<checkout>/plugins/lirbox` (this invalidates one earlier cell run under
    the old flag semantics; scorecard overwritten); (b) with the improved skill verifiably loaded,
    the driver READ the `--independent` guidance and **correctly declined it** — all six fixes
    touch `lib/compress.js`, and parallel workers share ONE worktree, so 'no shared state'
    excludes precisely the tasks where parallelism matters (filed:
    `independent-work-needs-per-worker-worktrees` — per-worker worktrees + a merge step);
    (c) the driver STILL ended its turn while narrating 'holding my turn open' (filed:
    `headless-driver-still-ends-turn` — the foreground Workflow call must block; don't narrate
    waiting). Final cells: 0/6 in ~22-25 min (harness-only wf/ deliveries). The conductor backlog
    in `feedback/conductor.jsonl` is now the measured path to flipping the head-to-head.

## Invariants — do not break

- **Graders stay hidden**: agents get task *content*, never a path near `grader/`. Grader tests assert
  only interfaces `task.md` names.
- **Suite fingerprint gates comparability**: any change to `suite.json`/task.md/graders/pins starts a
  new era; old scoreboard rows auto-flag ⚠️stale-suite. Never hand-compare across fingerprints.
- **Judges budget stays EVEN.** **Failures count in the denominator.** **Never auto-merge** (PR only).
- **Model IDs are pinned, never aliases**: configs and `swe-run --model` use exact IDs
  (`claude-opus-4-8[1m]`) — `swe-run` rejects `opus`/`sonnet`/`haiku`, which drift over time and
  silently corrupt scorecard comparability.
- **Every graded task proves discrimination both ways**: F2P RED on base (`--validate`, re-run by
  the net) and `resolved: true` on a gold solution diff (fairness — no impossible graders).
- Loop-skill rules (CLAUDE.md): conductor layer pure-JS; never hand-edit generated loops; run
  `test-arena.cjs` after touching the generator.
- Fixture tasks must be **multi-module** or headless claude bypasses conductor entirely.

## Known gaps / next steps (in value order)

1. ~~**Suite is too easy**~~ — ADDRESSED: the suite now has a 5-task difficulty ladder (2 easy /
   2 medium / 1 hard) built from SWE-bench's empirical difficulty factors (multi-file scope,
   edge-case-laden graders, fault localization — see arena-guide §3b). Every new task is proven
   RED-on-base (`--validate`) AND GREEN-on-gold (a reference solution resolves). Remaining:
   run a real benchmark on the new era to confirm the ladder actually spreads configs.
2. **The `lirbox:arena` skill loop end-to-end** — the generated Workflow loop is structure-tested and
   its cell contract is live-proven, but a full skill-invoked run (Setup→…→Finalize with PR) hasn't
   been executed as one piece.
3. **Judge panel diversity** — single-judge position bias is mitigated by even swaps, not eliminated;
   a cross-family judge panel (biases cancel) is the literature-backed upgrade.
4. **`--plugin-dir` version benchmarking at scale** — proven for one baseline; make it the standard
   pre-merge ritual for conductor changes (run `swe-run.mjs --plugin-dir <candidate checkout>`).
5. **Trajectory checks** (rung-5 → rung-3): grade *how* conductor ran (phases skipped? gates gamed?)
   from the stream-json trace, not just the diff.

## Operational gotchas (learned the hard way)

- Conductor delivers on a **`wf/` branch**; the working tree stays clean — always diff `<sha>..wf/…`.
- Run headless cells **backgrounded on real disk** with an explicit `timeout` (foreground shell caps
  at 10 min; the sandbox discards writes between calls). Keep run logs **outside** the fixture clone.
- A killed run's completed work is recoverable from its `wf/` branch.
- ~2 parallel cells max — each spawns a full subagent fleet.
- **uglify-corner-cases P2P is load-sensitive, not flaky** (proven 3/3 green idle after one red
  under load): its mocha half has 10s timeouts and heavy process-spawning, so NEVER overlap two
  full-suite runs (a cell's grade + `test-arena` validate, or two uglify cells). Grade serially.
- PRs on this repo: `gh auth switch --user liemle3893` → create → switch back to `liemlhd_msn`.

## History

PR #28 (merged): arena skill + first pairwise leaderboard + guide. This PR: SWE-bench-style rung-1
grading (hidden graders, swe-grade), Test 1/3 validation incl. the position-bias fix (even judges),
and the absolute scorecard system (swe-run/swe-score + scoreboard). Full narrative: PR comment
threads on #28 and this PR.
