# Improvement-loop consolidation — replacement status

*Audit, 2026-07-30. Every usage claim below was read off disk or git, not from prose.*

Question asked: with `prospector`, `whetstone`, `arena` and now **Harbor** all in the repo, what
can be deprecated?

## Verdict

> **Decided 2026-07-31.** Plan: [2026-07-31-loop-consolidation.md](./plans/2026-07-31-loop-consolidation.md).
>
> ## ⛔ SUPERSEDED IN PART — headroom probe, 2026-08-01
>
> A raw arm (no skill, no conductor) resolved **7 of 7 registered graded tasks at full marks**, five
> in under 90 seconds, for **$2.12**. **HEADROOM: 0.** Lift is bounded at zero on a task the control
> already passes, so **arena's task suite cannot discriminate anything** — not a skill, not a config,
> not a model, not a version. The pairwise Bradley-Terry half ranks ties.
>
> **This does not change the tool-overlap analysis below — it changes what any of it can measure.**
> `arena` is not redundant with Harbor; arena's *suite* is dead, and porting it would have carried
> the deadness into Harbor. The port (W3) is cancelled; W4.2 is moot. Every scorecard in
> `docs/arena/scores/` was measured at the ceiling.
>
> The one thing here that *is* replaceable by Harbor — `swe-run.mjs`, §M1 — is still genuinely
> weaker than Harbor on every execution axis. That conclusion stands; it is simply not worth acting
> on until a suite exists that measures something. Data: [arena/experiments.md](./arena/experiments.md).

| | status | why |
|---|---|---|
| **`whetstone`** | **KEEP**, core unchanged | its per-item *check* layer moves to Harbor for behavioural concerns; the floor deliberately stays deterministic |
| **`arena` (pairwise BT half)** | **KEEP** — nothing replaces it | Harbor has no pairwise / position-swap / Bradley-Terry anything; verified against `harbor --help` (0.20.0) |
| **`arena` (`swe-run`/`swe-grade` half)** | **PORT TO HARBOR** | same job, worse isolation, hand-rolled model matrix Harbor ships as flags. `swe-score` survives as a statistics post-processor |
| **`prospector`** | **KEEP, narrowed** | stays the loop for objective code scalars (perf/size/memory/cost) where it is already used. **Skill hill-climbing is removed** — GEPA/OpenEvolve do it better |

Harbor replaces **no loop**. It replaces **half of arena's measurement layer** and **the part of
whetstone's check layer that could never see behaviour**.

> **Correction, 2026-07-31.** An earlier draft argued for deprecating `prospector` on "zero runs".
> That was scoped to this repo, and it is the wrong test: **these skills ship to users worldwide**,
> so local run-counts are not evidence about a published skill's value. Prospector is in real use
> elsewhere for P95/P99 work. What it loses is only the mode that duplicates a solved external
> problem.

## Evidence — what has actually been run

| | runs on disk | merged output | last run |
|---|---|---|---|
| `whetstone` | 8 reports in `.improve/reports/` | PRs #23 #24 #25 #27 #34 #35 #36 #37 #40 | 2026-07-30 |
| `arena` | 2 promoted runs in `docs/arena/` + 7 scorecards + the hand-run `experiments.md` matrix | #28–#33, #41 | 2026-07-27 |
| Harbor | 30+ job dirs in `jobs/` since 2026-07-28 | #46, #53; 1 task proven end-to-end | 2026-07-30 |
| `prospector` | none **in this repo** — used elsewhere for P95/P99 latency work | one local dogfood *audit* (`2654b89`, 2026-07-08) | 2026-07-08 |

Read that last row carefully: it says nothing about prospector's worth. A skill's users are not in
its own repo.

`prospector`'s only merged value is the two bugs its single dogfood audit surfaced (`isBetter`
NaN floor, rename surface-lock leak) — both of which were **copied into `whetstone`**, because
`scaffold-improve.cjs` is a literal fork of `scaffold-optimize.cjs`. That fork relationship is the
running cost: every fix has to be mirrored by hand across two generators and two test nets
(`test-optimize.cjs`, `test-improve.cjs`), for a loop nobody starts.

That fork tax is the argument for narrowing prospector's scope, not for removing it: the fewer modes
the two loops share, the less there is to mirror. `feedback/prospector.jsonl` holds 5 open concerns;
the skill-train-only ones close with the mode, and `repeat-metric-measurement` — noisy-metric
handling — stays open, because it is the one that matters most for latency work.

## Matrices

### M0 — Layer map: what is even comparable

"Harbor vs whetstone" is a category error until you place them. There are **three layers**, and
overlap can only happen *within* one.

| layer | what it does | who is here |
|---|---|---|
| **1 · Measure** | run an agent against a frozen task, produce a raw score | `arena/swe-run+swe-grade` · **Harbor** |
| **2 · Aggregate** | turn many raw scores into a defensible statement | `swe-score` (Wilson, absolute) · `arena` pairwise (BT, relative) |
| **3 · Improve** | mutate the artifact, decide keep-or-revert | `whetstone` · `prospector` · **GEPA** |

Read down the columns and the whole consolidation question collapses to three local questions:
who owns layer 1, does layer 2 survive a layer-1 swap, and does layer 3 need two loops.

| | layer 1 | layer 2 | layer 3 |
|---|---|---|---|
| Harbor | ✅ **strongest** | ❌ none | ❌ none |
| `arena` swe-* | ✅ weaker | ✅ Wilson + fingerprint | ❌ |
| `arena` pairwise | ✅ (drives its own runs) | ✅ **BT, sole owner** | ❌ |
| `whetstone` | ➖ consumes a floor/check | ❌ | ✅ **binary, regression-controlled** |
| `prospector` | ➖ consumes a metric cmd | ❌ | ✅ scalar |
| GEPA | ➖ consumes an evaluator | ➖ Pareto frontier | ✅ scalar + reflective |

### M1 — Layer 1: `swe-run.mjs` vs `harbor run` *(the real overlap)*

Both: frozen task suite · hidden graders injected after the agent finishes · discrimination gate ·
model axis · repetitions.

| | `arena/scripts/swe-*.mjs` | `harbor` 0.20.0 | winner |
|---|---|---|---|
| isolation | host + git worktrees, bundle clone | container per trial | **Harbor** |
| model matrix | `--model`, one scorecard per arm | `-m` **repeatable in one job** | **Harbor** |
| repetitions | `--runs N` (**recorded value is 1 in every scorecard**) | `-k / --n-attempts` | **Harbor** |
| agents | conductor-via-`claude -p` only | 20+ (`claude-code`, `codex`, `swe-agent`, `dspy-rlm`, `acp:*`) | **Harbor** |
| remote execution | no | Daytona / Modal / e2b / Runloop / GKE | **Harbor** |
| discrimination gate | `swe-grade --validate` (F2P red on base, P2P green) | `-a nop` = 0 **and** `-a oracle` = 1.0 per dimension | tie |
| multi-dimension grading | no | `harbor-rewardkit`, one subdir per reward key | **Harbor** |
| trajectory viewer | no | `harbor view` | **Harbor** |
| task-quality audit | no | `harbor check` (rubric) | **Harbor** |
| reward-hacking detection | no | `harbor analyze` (`reward_hacking`, `task_specification`) | **Harbor** |
| **Wilson CIs** | **yes, recomputed and verified** | no | **arena** |
| **suite fingerprint / era staleness** | **yes** | no | **arena** |
| **engagement as a tri-state measurement** | **yes** (#41) | no | **arena** |
| significance test | no (planned `swe-compare.mjs`) | no | neither |
| tasks on disk today | **9 tasks / 38 validated F2P criteria** | 5 tasks, 1 proven end-to-end | **arena** |

Harbor wins every *execution* row. arena wins every *statistics* row — and statistics is
`swe-score.mjs`, a post-processor, not an engine. The redundant part is `swe-run.mjs`: the ~400
lines that clone bundles, drive `claude -p`, detect engagement and time out cells.

Three of the four gaps in `docs/evals/eval-engine-plan.md §4` close by *deleting* code: `runs: 1`
everywhere → `-k` is a flag; no containerisation → default; no cross-agent axis → `-a` is a flag.

**Counter-argument, recorded and overruled (2026-07-31).** `docs/plans/2026-07-28` concluded
*"Harbor's marginal value is highest where the local loop is weakest"* — and swe-* is the strongest
local loop in the repo. The port also resets every scorecard's comparability era. It proceeds anyway
(W3): that lesson was about *where to spend a first Harbor pilot*, not about carrying two behavioural
engines indefinitely. The statistics layer — the part that made swe-* strong — is explicitly
preserved, so what is retired is the execution engine, not the rigour.

### M2 — Layer 2: what Harbor cannot aggregate

| capability | `arena` pairwise | `swe-score` | Harbor 0.20.0 |
|---|---|---|---|
| pairwise A-vs-B on the same task | ✅ | ❌ | ❌ |
| position-bias control | ✅ 4 position-swapped passes (even = exact balance) | n/a | ❌ |
| Bradley-Terry rating | ✅ | ❌ | ❌ |
| win-rate matrix | ✅ | ❌ | ❌ |
| forfeits surfaced not dropped | ✅ | ✅ | unknown |
| Wilson confidence intervals | ❌ | ✅ | ❌ |
| comparability fingerprint | ❌ | ✅ | ❌ |
| difficulty focusing | ❌ | ❌ | ✅ `harbor sweeps run` |
| per-trial rubric judge | ❌ | ❌ | ✅ rewardkit `[judge]` |

Verified against `harbor --help` (0.20.0): no `compare`, no `judge`, no `leaderboard`, no pairwise
command. `harbor sweeps run` drops tasks with ≥1 success each sweep — difficulty focusing, not
ranking. Rewardkit's `[judge]` scores **one trial against a rubric**; it never sees two diffs side
by side, so it has no position bias to control and nothing to aggregate.

arena's pairwise loop is the sole owner of relative ranking here, and it produced the repo's most
valuable finding (`eval-engine-plan.md §2`: a 40% "quality" gap that was entirely engagement
failure). **Not replaceable.**

### M3 — Layer 3: `whetstone` vs `prospector` vs GEPA

| | `whetstone` | `prospector` | **GEPA** |
|---|---|---|---|
| signal | binary per filed concern | one scalar | scalar **+ textual feedback (ASI)** |
| where work comes from | human-filed backlog, or `harvest-feedback.cjs` | a prose goal | a train set |
| search shape | serial over a fixed backlog | greedy hill-climb from global `best` | **Pareto frontier, tree of candidates** |
| proposer sees failures | ✅ the item text + check output | ➖ ledger digest only | ✅ **execution traces** |
| keep rule | floor ∧ item check RED→GREEN ∧ surface lock ∧ edit budget | metric > best + minDelta ∧ gate ∧ surface lock ∧ edit budget | val improves |
| **regression control** | ✅ **floor re-run per item, in-loop** | ⚠️ correctness gate only — no previously-solved-task set | ⚠️ **post-hoc — overfit in the study below** |
| held-out val | ➖ frozen human-confirmed checks instead | ✅ in skill-train mode | ✅ required |
| anti-gaming | surface lock + **discrimination gate** (check proven RED first) | surface lock + gate | none published |
| output | branch + **PR, never merged** | branch + PR | an optimized artifact |
| durable resume | ✅ ledger | ✅ ledger | unknown |
| maintained by | you | you | a research group, ICLR 2026 Oral |
| **noisy-metric handling** | n/a — binary | ✅ `minDelta` + `spread` (variance-aware keep) | ⚠️ val-split noise across *examples*, not repeated measurement |
| best fit | filed concerns on a skill | **objective code scalars: p95/p99, size, memory, cost** | skill/prompt hill-climb |

The last two rows are why prospector stays and skill-train goes. GEPA's noise story is a stable
comparison *set* — variance across examples. A latency metric's noise is variance across **repeated
measurements of the same benchmark**, which is a different problem and the one
[JetBrains hit](https://blog.jetbrains.com/ai/2026/05/how-we-use-alphaevolve-to-make-complex-ide-algorithms-faster/)
on real IDE indexing times (17.4 ± 0.5 s baseline; candidates screened for significance, because
"small changes can disappear in noise"). Before trusting any off-the-shelf optimizer on latency, run
it twice against an unchanged baseline — a reported "win" there means it ratchets on sampling noise.

**The external evidence lands on this matrix directly.**
[*Do Agent Optimizers Compound?*](https://arxiv.org/html/2607.14004) (2026-07-15) ran three
optimizers over Terminal-Bench 2.0 **on Harbor**:

| optimizer | phase 1 | transfer | phase 2 | lifelong avg |
|---|---|---|---|---|
| baseline | 62.5% | 56.8% | 56.8% | 58.7% |
| **GEPA** | 70.8% | **54.5%** ← *below baseline* | 72.7% | 66.0% |
| Meta Harness | 66.6% | 68.2% | 59.1% ← no phase-2 candidate beat phase 1 | 64.6% |
| RELAI-VCL | 79.2% | 72.7% | 77.3% | 76.4% |

Their stated cause: **regression control — rejecting a candidate that harms previously solved tasks
— must be enforced *during* optimization; post-hoc checking is insufficient.** That is the one row
in M3 where `whetstone` is the only ✅. You built the thing the literature says separates
compounding optimizers from overfitting ones, and you built it before the paper.

### M4 — Harbor vs `whetstone` *(the category error, answered)*

| question | Harbor | `whetstone` |
|---|---|---|
| does it change any code? | ❌ never | ✅ that is its whole job |
| does it decide keep-or-revert? | ❌ no loop at all | ✅ per item |
| does it survive a model swap? | ✅ **only layer that does** | ❌ artifact-level checks stay green |
| does it need a floor? | ❌ | ✅ cannot run without one |
| cost per unit | ~$0.52–15 per task run | ~$0 per check, one agent per item |
| what it produces | a number + a trajectory | a diff + a PR |

They compose; they do not compete. Harbor is the only instrument that can *produce* a check whose
green survives a model swap. whetstone is the only loop that can *act* on one. Which is why the
missing wiring below matters more than any deletion.

### M5 — Routing table: the question you have → the tool

| the question you are actually asking | tool | cost |
|---|---|---|
| "did I break something I already fixed?" | `evals-all.mjs` floor + frozen checks | free, seconds |
| "does this check still measure anything?" | `prove-checks.mjs` (mutation) | free |
| "turn these 8 filed concerns green, overnight, without letting the fixer touch the graders" | **`whetstone`** | ~1 agent/item |
| "which of these two conductor configs delivers better diffs?" | **`arena` pairwise** → BT | paid, 3 runs × 4 judge passes |
| "what fraction of the frozen suite does this config resolve, with a CI?" | `arena` `swe-run` + `swe-score` | paid, ~1 run/cell |
| "does this skill still work when I swap the model underneath?" | **Harbor** (`-m` × ±skill, paired) | $0.52–15/task |
| "is my task grader satisfiable / does it pass on nothing?" | **Harbor** `-a oracle` (=1.0) + `-a nop` (=0) | **free** |
| "did the agent reward-hack its way to green?" | **Harbor** `harbor analyze` | cheap |
| "hill-climb this skill's pass-rate on a scored task set" | `harvest-feedback.cjs` → **`whetstone`**, or **GEPA / OpenEvolve** | — |
| "drive p99 down on this hot path without breaking correctness" | **`prospector`** | one gate + metric run per experiment |

The two bottom rows are the split W1 makes explicit: prospector keeps the objective-code-scalar row
and hands the skill row to GEPA.

## Also found: a documented integration that does not exist

`CLAUDE.md` and `CONTRIBUTING.md` both state that Harbor's `reward` key is load-bearing because
"the whetstone loop keeps or reverts a change on that scalar". **It does not.** `grep -ri harbor`
across `whetstone/`, `prospector/` and `arena/` returns nothing — Harbor is a manual, repo-level
tier-3 step with no wiring into any loop.

That gap is worth more than any deprecation: a `harbor run … && jq .reward` one-liner *is* a
legal whetstone acceptance-check, and it is the only check shape that survives a model swap.
Today tier 3 is a thing a human runs twice and forgets.

## External landscape — what you could stop maintaining

### Skill hill-climbing has a maintained off-the-shelf owner: GEPA

Not prospector's *whole* shape — prospector's **skill-train mode**. That mode is what W1 removes.

[GEPA](https://github.com/gepa-ai/gepa) (Genetic-Pareto reflective prompt evolution, [ICLR 2026
Oral, arXiv 2507.19457](https://arxiv.org/pdf/2507.19457)):

- `optimize_anything` optimizes **any textual artifact**, not just DSPy programs. It asks the caller
  for a function returning **a scalar score plus textual feedback** ("Actionable Side Information")
  and a **held-out valset**. That is `evals/run-scored.mjs --split train|val` plus the failing
  assertion text — lirbox already produces both.
- It ships a **TerminalBench adapter** for optimizing an agent's system prompt, built on **Harbor**
  — the same harness this repo just adopted.
- It ships **as a Claude Code Agent Skill** (`.claude/skills/gepa-optimize-anything/`), so the
  invocation ergonomics prospector was built for are already there.
- It beats GRPO by up to 20% with ~35× fewer rollouts.

The AlphaEvolve open-source line covers the same ground for *code* rather than prompts —
[OpenEvolve, ShinkaEvolve, ThetaEvolve, CodeEvolve](https://arxiv.org/html/2510.14150v4).

**What none of them hands you**, and what prospector keeps: worktree isolation, the surface lock
(the fixer cannot edit the benchmark), never-auto-merge, the durable resumable ledger, and
variance-aware keep. Adopting GEPA for the skill row is a delegation; adopting it for the p99 row
would be a rewrite of everything around the search.

### The literature is unkind to scalar hill-climbing, and kind to whetstone's keep-rule

[*Do Agent Optimizers Compound?*](https://arxiv.org/html/2607.14004) (arXiv 2607.14004, 2026-07-15)
ran three optimizers over Terminal-Bench 2.0 **on Harbor**, in two phases:

| optimizer | phase 1 | transfer | phase 2 |
|---|---|---|---|
| baseline | 62.5% | 56.8% | 56.8% |
| **GEPA** | 70.8% | **54.5%** — *below baseline* | 72.7% |
| Meta Harness | 66.6% | 68.2% | 59.1% — no phase-2 candidate beat phase 1 |
| RELAI-VCL | 79.2% | 72.7% | 77.3% |

Their stated cause: **regression control — rejecting a candidate that harms previously solved
tasks — has to be enforced *during* optimization, not checked post-hoc.** GEPA checks post-hoc and
overfit; the method that enforced it in-loop was the only one that compounded.

That is a direct endorsement of `whetstone`'s keep-rule — *floor green* **and** *item's frozen check
green* **and** *surface lock*, evaluated per item with revert.

**It is also why W2 leaves the floor alone.** The floor is that in-loop regression control. Moving it
to Harbor would price it at $5–15 per item, which means it gets dropped or sampled — and a dropped
floor is exactly the post-hoc arrangement that sent GEPA's transfer score below baseline.

Corroborating, weaker:

- [MAS-PromptBench](https://arxiv.org/pdf/2606.23664) (2026-06): scalar hill-climbing "frequently
  produces narrow, brittle optimizations that don't generalize"; the optimization overhead exceeds
  the gain on tasks stock prompts already solve.
- [*A Single Rewrite Suffices*](https://arxiv.org/pdf/2606.30775) (2026-07-01): for production
  **skill descriptions**, one considered rewrite outperformed iterative refinement loops. Generic
  tool descriptions, not Claude `SKILL.md` — read it as suggestive, not as a result about this repo.

### Harbor's own scope, confirmed

[Harbor](https://harbor-framework-harbor.mintlify.app/introduction) is the official
[Terminal-Bench 2.0](https://harbor-index.org/) harness. The docs describe evaluation
infrastructure — containerised trials, 10+ agents, 20+ benchmarks, parallel execution, RL rollout
generation. Docs and CLI agree on the negative: **no pairwise comparison, no LLM judge, no
Bradley-Terry/Elo, no instruction-mutation loop.** `harbor sweeps run` drops tasks with ≥1 success
each sweep — difficulty focusing, not ranking.

The `-m` model flag being repeatable within one job is visible in `harbor run --help` (0.20.0) but
not in the docs — verified locally, not from documentation.

### What has no off-the-shelf equivalent

- **`whetstone`.** Nothing public runs a filed-concern backlog through a discrimination-gated
  RED→GREEN check with a surface lock and per-item revert. The closest published work
  ([SkillAxe](https://arxiv.org/pdf/2606.10546), 2026-06-11) is eval-guided self-refinement with no
  released code found and no anti-gaming story.
- **arena's pairwise Bradley-Terry judge over delivered diffs.** Pairwise BT is standard for ranking
  *models* on public leaderboards; nothing packaged does it over *your own* frozen task suite with
  position-swap control.

Caveat on sourcing: this section is one pass of web search plus the Harbor CLI on this machine. The
delegated research agent returned nothing usable, so the breadth here is mine, not a second opinion.
`SkillAudit`, `SkillJuror`, `MIND-Skill` and `RELAI-VCL` were surfaced but not read in depth —
RELAI-VCL in particular is worth a proper look before any redesign, since it is the only optimizer
in the compounding study that actually compounded.

## Decided — three workstreams

Full task breakdown: [2026-07-31-loop-consolidation.md](./plans/2026-07-31-loop-consolidation.md).

1. **W1 — narrow `prospector`.** Remove skill-train mode (`skill <name>` routing,
   `scaffold-skilltrain-config.cjs`, the val-contamination auditor, `references/skill-train.md`);
   point the description at GEPA/OpenEvolve for skill hill-climbing. The scored-task runner and
   `harvest-feedback.cjs` **stay** — they feed whetstone's backlog, not prospector. Prospector keeps
   its real job: objective code scalars, where its variance-aware keep is the differentiator.
2. **W2 — Harbor *replaces* whetstone's behavioural check layer.** Not "in addition to": for an item
   whose claim is about behaviour, the artifact-level check was the wrong instrument and is the
   documented false-green failure mode. The **floor stays deterministic** — see the tiering table in
   the plan. Do this before W3; it is the cheap datapoint that de-risks the expensive one.
3. **W3 — port the 9 arena tasks / 38 F2P criteria to Harbor**, retire `swe-run.mjs`, reduce
   `swe-score.mjs` to a statistics post-processor over `jobs/*/verifier/reward.json`. Wilson CIs,
   suite fingerprint, engagement tri-state and forfeit accounting all survive; Harbor has no
   equivalent for any of them. The 2 orphan tasks (13 idle criteria) join the suite for free.

## Not doing

- Deprecating `whetstone` in favour of Harbor. Different layers — Harbor measures, whetstone changes
  code and decides keep/revert. Harbor has no keep-or-revert loop at all.
- Deprecating `arena` wholesale. Its pairwise judge has no off-the-shelf substitute.
- Deleting `prospector`. See the correction at the top: local run-counts are not evidence about a
  skill that ships to users worldwide.
- Building `swe-compare.mjs` before W3 lands — it would be written against a deleted engine.
