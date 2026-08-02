# Loop Consolidation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (W1) narrow `prospector` to objective code scalars and hand skill hill-climbing to
GEPA/OpenEvolve; (W2) make Harbor the acceptance-check layer for *behavioural* whetstone items,
replacing the artifact-level check that cannot see behaviour; (W3.0) measure which graded tasks
still have headroom at a low-end tier; (W4) reframe `arena` around low-end **lift** rather than
frontier A/B; (W3) port the surviving tasks to Harbor and retire `swe-run.mjs`.

**The load-bearing insight, discovered mid-plan:** most of this suite is **saturated**. A bare
`claude -p` session already scores 8/8 on `notes-wide-features` and 6/6 on `uglify-corner-cases` —
so the skill's measured lift there is zero and negative respectively. Lift is what the repo rule says
to report, and lift is bounded at zero on a task raw already passes. Everything downstream of that
fact changed: W3 became conditional, W4 was added, and the paid re-baseline was cut.

**Architecture:** Three layers, and each workstream touches exactly one.
*Measure* = Harbor (after W3, the only engine). *Aggregate* = `swe-score` (Wilson, absolute) and
arena pairwise (BT, relative) — both survive W3 unchanged in output, changed in input.
*Improve* = whetstone (unchanged core; W2 swaps what its per-item check runs) and prospector
(unchanged core; W1 removes one mode). Analysis:
[loop-consolidation.md](../loop-consolidation.md).

**Tech Stack:** `harbor` 0.20.0 (`-e docker`), `harbor-rewardkit`, Node 22, existing
`plugins/lirbox/skills/{prospector,whetstone,arena}` generators and their `test-*.cjs` nets.

## Global Constraints

- **These skills ship to users worldwide.** Usage inside this repo is not evidence about a skill's
  value, and "0 runs here" is never a reason to delete a published skill. Every change below is
  justified by overlap or correctness, never by local usage counts.
- **Every skill change lands behind a discrimination-gated frozen check and a green floor**
  ([CLAUDE.md](../../CLAUDE.md)). Prove RED on baseline first:
  `node plugins/lirbox/skills/whetstone/scripts/check-baseline.cjs "<cmd>"` → `DISCRIMINATING`.
  Register in that skill's `evals/checks-manifest.json` **with `mutations`**. This applies to W1, W2
  and W3 alike — all three modify shipped skills.
- **Never hand-edit a generated loop script.** Change `scripts/scaffold-*.cjs`, regenerate `--force`.
- **The conductor layer stays pure JS** — no `fs`/`git`/`require`/`Date.now()`/`Math.random()`.
  `test-*.cjs` enforces it by string scan.
- After touching a generator, run its net: prospector → `test-optimize.cjs`, whetstone →
  `test-improve.cjs`, arena → `test-arena.cjs`. Floor stays green:
  `node scripts/evals-all.mjs --fast`.
- **`.harbor/` is gitignored, per-machine, and has no drift gate** (verified: `git ls-files .harbor`
  → 0). The tracked declaration under `<skill>/harbor/tasks/` is the source of truth. **Editing the
  declaration does not change what runs** — re-copy into `.harbor/` before every run.
- **Never inject `plugins/lirbox/skills` unpruned** into a container: it hands the agent its own
  graders. Copy to `.harbor/skills/` and strip every skill's `evals/`, `harbor/`, `arena/`.
- **Never commit runtime artifacts**: `jobs/`, `.workflows/`, `.optimize/`, `.improve/`, `.arena/`,
  `.worktrees/`.
- `main` is pull-request-only; `.githooks/pre-commit` enforces commit identity.
- Paid Harbor runs are a **separate ask each time**. Free arms (`-a nop`, `-a oracle`) need no ask.
- **Out of scope, do not touch:** `loom`; whetstone's keep-rule, floor semantics, surface lock or
  consolidation pass; arena's pairwise judge, position-swap scheme or Bradley-Terry maths.

---

# W1 — Narrow `prospector` to objective code scalars

**Why:** prospector's shape (scalar + hard gate + keep-or-discard, worktree-isolated, never
auto-merged) is right for hot-path perf, bundle size, memory, cost — where it is already used.
Skill hill-climbing is a solved, maintained, better-researched problem elsewhere:
[GEPA `optimize_anything`](https://github.com/gepa-ai/gepa) and the AlphaEvolve open-source line
(OpenEvolve, ShinkaEvolve, CodeEvolve). Carrying a second-best skill-train mode costs a mode, a
config scaffolder, a val-contamination auditor, and two references — for a job we now delegate.

**Not doing:** deleting prospector, changing its keep-rule, or touching its variance handling.

## Success criteria — fixed now

- [ ] `skill <name>` no longer routes to skill-train mode; `$ARGUMENTS` auto-detection drops from
      four ways to three.
- [ ] `SKILL.md` frontmatter `description` names GEPA/OpenEvolve as the skill-hill-climb answer, so
      the trigger stops competing with whetstone for "improve a skill".
- [ ] Every generic-mode capability is byte-identical in behaviour: `test-optimize.cjs` green with
      no assertions weakened or deleted (diff the test file — removals must be skill-train-only).
- [ ] `node scripts/evals-all.mjs --fast` green.
- [ ] A frozen check proves the mode is gone and cannot silently return.

## Tasks

- [ ] **W1.1 — Inventory the skill-train surface.** Confirm each of these is skill-train-only and
      not load-bearing for generic mode before removing anything:
      `references/skill-train.md`, `scripts/scaffold-skilltrain-config.cjs`,
      `scripts/check-val-contamination.cjs`, the `skill <name>` branch in `SKILL.md`
      `<arguments>`, and any `--split`/train/val handling in `scaffold-optimize.cjs`.
      **`check-val-contamination.cjs` needs an explicit verdict** — if generic mode can also declare
      a train/val metric, it stays. Record the finding in the PR body.
- [ ] **W1.2 — Write the frozen check RED first.** Assert on the *invariant* ("the loop offers no
      skill-train mode"), not on incidental structure. Anchor to the `$ARGUMENTS` routing contract in
      `SKILL.md` plus the absence of a skilltrain config scaffolder. Prove RED on baseline via
      `check-baseline.cjs`; register in `prospector/evals/checks-manifest.json` with `mutations`.
- [ ] **W1.3 — Remove the mode.** Edit `SKILL.md` (routing + description), delete the
      confirmed-dead files, regenerate nothing (the generator only changes if W1.1 found train/val
      handling inside it — if so, edit `scaffold-optimize.cjs` and regenerate `--force`).
- [ ] **W1.4 — Re-home what whetstone still needs.** `scaffold-readiness.cjs --scored`,
      `harvest-feedback.cjs` and `flowchart/evals/run-scored.mjs` all reference prospector's
      skill-train recipe. The **scored runner and harvest stay** — they feed whetstone's backlog, not
      prospector. Move `references/skill-train.md` to `whetstone/references/scored-tasks.md`,
      rewritten as "how to build a scored task set for harvest", with the hill-climb section
      replaced by a pointer to GEPA/OpenEvolve. Update all 9 referencing files.
- [ ] **W1.5 — Prune the backlog.** `feedback/prospector.jsonl` — resolve or drop items that only
      applied to skill-train. `document-budget-scope` and `repeat-metric-measurement` are
      generic-mode concerns and **stay open**.
- [ ] **W1.6 — Verify.** `node plugins/lirbox/skills/prospector/scripts/test-optimize.cjs` ·
      `node scripts/prove-checks.mjs --skill prospector` · `node scripts/evals-all.mjs --fast` ·
      `claude plugin validate .`. Then PR.

> **Note for whoever runs the GEPA comparison later (not part of this plan):** before trusting any
> off-the-shelf optimizer on a latency metric, run it twice against an *unchanged* baseline. If it
> reports a win, it is ratcheting on sampling noise — the failure prospector's `minDelta`/`spread`
> keep-rule exists to prevent, and the one JetBrains hit on real IDE indexing times
> (17.4 ± 0.5s baseline; candidates screened for significance).

---

# W2 — Harbor replaces the behavioural acceptance-check layer in whetstone

**Why:** `CLAUDE.md` and `CONTRIBUTING.md` already claim whetstone keeps/reverts on Harbor's
`reward` key. It does not — `grep -ri harbor` across `whetstone/` returns nothing. Worse, the
current per-item check is artifact-level: for a behavioural concern it greps a generator, which is
the documented **false-green** failure mode. Harbor is the only layer that survives a model swap.

**The tiering rule this workstream establishes — the floor is NOT in scope:**

| layer | engine | why |
|---|---|---|
| **floor** — runs on every item | **stays deterministic, free** | it *is* the in-loop regression control. At $5–15/item it gets dropped, and post-hoc regression control is what sent GEPA's transfer score below baseline in [arXiv 2607.14004](https://arxiv.org/html/2607.14004) |
| **per-item check, behavioural claim** | **Harbor** `reward` key | the claim is about what the agent *does*; only a container can see it |
| **per-item check, structural claim** | stays deterministic | "does the generator emit `--frontend`" is genuinely artifact-level |

## Success criteria — fixed now

- [ ] A backlog item can declare `"checkKind": "harbor"` with a task ref, and the loop's keep
      decision reads that task's **`reward`** key (never a judged key).
- [ ] The discrimination gate still applies: a Harbor check must be proven RED on baseline —
      meaning `-a nop` = 0.000 **and** `-a oracle` = 1.000 **per dimension**, and the baseline
      `claude-code` run scores **< 1.0** on the reward key. An item whose baseline already scores 1.0
      is not a concern; it must be rejected at setup, not silently kept.
- [ ] A stochastic judge key can never reach the keep decision. Assert it structurally.
- [ ] Cost is declared and bounded before the run: the confirmed config carries a
      `budgets.harborRuns` cap, and exceeding it aborts rather than spends.
- [ ] The floor is untouched — `test-improve.cjs` proves floor evaluation still invokes no Harbor.
- [ ] Docs stop lying: `CLAUDE.md` + `CONTRIBUTING.md` describe what now exists.

## Tasks

- [ ] **W2.1 — Prove the shape by hand, once, before writing any generator code.** Take
      `conductor/scaffold-multiphase` (the one task proven end-to-end), re-sync `.harbor/`, run the
      free arms, and confirm the reward key is a usable scalar:
      `harbor run -p .harbor/tasks/conductor__scaffold-multiphase -a nop -y` (→ 0.000) and
      `-a oracle -y` (→ 1.000 on **every** dimension — the oracle previously scored quality 0.750,
      so check each key separately, not the headline). Record the exact `jq` expression that
      extracts `reward` from `jobs/<ts>/<task>/verifier/reward.json`. **Free — no ask needed.**
- [ ] **W2.2 — Get a paid baseline datapoint.** ONE `-a claude-code -m <pinned model>` run to
      establish what a real baseline scores on the reward key. **Separate ask — quote ~$0.52–15.**
      Without it there is no RED to discriminate against.
- [ ] **W2.3 — Write the frozen check RED first** (whetstone's own evals): the loop's keep decision
      must consume a Harbor reward for a `checkKind: "harbor"` item, and must **refuse** a config
      that points the keep decision at a judged key. Two mutations: (a) point it at the judge key →
      must go RED; (b) let a missing `reward.json` read as 0 instead of erroring → must go RED.
      Harbor does not distinguish "absent" from "judged bad" — the loop must.
- [ ] **W2.4 — Implement in `scaffold-improve.cjs`.** The **worker** runs `harbor run` and returns
      the scalar; the **conductor** only compares numbers — the purity scan will fail the build
      otherwise. Each dimension gets its own `rewardkit` process and its own output subdir: a single
      `TaskGroup` aborts every dimension when one raises, writing no `reward.json` at all (observed
      twice on 2026-07-30, once from an overlayfs failure, once from a 529 from the judge).
      Regenerate `--force`; never hand-edit the generated `.js`.
- [ ] **W2.5 — Setup-phase gate.** During whetstone setup, a `harbor` item runs the free arms and
      the baseline check; a task failing `nop`=0 / `oracle`=1.0, or an item whose baseline already
      scores 1.0, is rejected with a named reason before the human confirm.
- [ ] **W2.6 — Fix the docs.** `CLAUDE.md` and `CONTRIBUTING.md` § Tier 3: state the tiering rule
      above, and that the floor is deliberately excluded.
- [ ] **W2.7 — Verify.** `test-improve.cjs` · `prove-checks.mjs --skill whetstone` ·
      `evals-all.mjs --fast` · `claude plugin validate .`. Then PR.

---

# W3.0 — Headroom probe — ✅ RAN 2026-08-01. RESULT: 0 / 7 HEADROOM. W3 IS CANCELLED.

> **The probe answered its question and the answer stops the plan.** A raw arm — bare `claude -p`,
> no skill, no conductor, no `--plugin-dir` — resolved **all 7 registered graded tasks at full
> marks**, five of them in under 90 seconds, for **$2.12** total.
>
> | task | difficulty | raw sonnet-5 | time |
> |---|---|---|---|
> | notes-add-tags | easy | 3/3 | 62s |
> | notes-archive | easy | 3/3 | 55s |
> | notes-search | medium | 3/3 | 71s |
> | notes-import-export | medium-hard | 3/3 | 57s |
> | notes-fix-data-loss | **hard** | 3/3 | **84s** |
> | notes-sync-merge | xhard | 4/4 | ~25m (prior) |
> | uglify-corner-cases | xxhard | 6/6 | ~53m (prior) |
>
> **The declared stop condition fires: `HEADROOM < 4` → W3 is CANCELLED, not shrunk.** W4.2 is moot
> — there is no low-end tier to repoint at, since sonnet-5 is not low-end and saturates in a minute.
> All 7 published scorecards were measured at the ceiling.
>
> The diagnosis is **not** "the tasks are too easy". These tasks ask *did the feature get built*,
> which a raw session does trivially. They never ask what conductor is FOR — surviving interruption,
> enforcing gates, resuming after a crash, leaving an auditable trail, coordinating parallel work.
> Harder fixtures do not fix that, and per the suite's own note, hard-at-the-top degenerates into a
> timeout benchmark. **The next piece of work is a suite that measures the right dimension.**
>
> Reproduce: `node scripts/raw-headroom-probe.mjs`. Data: `docs/arena/experiments.md`.
> Limits: n=1 per task, one model, no repetitions — but 7/7 at full marks in ~60s is not a result
> repetitions would overturn.

## Original specification, kept for the reasoning

**Why:** the paired-matrix rule already in force says *report the lift, never the raw score*. A task
where a bare `claude -p` session already passes has **lift bounded at zero** — no skill, no config
and no model can score above it, so it cannot discriminate anything. That is not hypothetical here.
`docs/arena/experiments.md` records it twice:

| task | raw `claude -p` | conductor | measured lift |
|---|---|---|---|
| `notes-wide-features` | **8/8, 4.4 min, $0.99** (sonnet-5) | 8/8, 33 min (opus/high) | **0** |
| `uglify-corner-cases` | **6/6, 53 min** (sonnet-5) | 0/6, then 2/6 | **negative** |

And the suite's own theory note explains the mechanism: *"fair spec + hermetic tests =
self-verifiable → an unbounded frontier session always converges."* Externally,
[MAS-PromptBench](https://arxiv.org/pdf/2606.23664) reports the same ceiling effect — no measurable
gain where baseline already approaches 100%.

**Consequence for the pairwise half:** Bradley-Terry over a saturated suite ranks ties, and a rating
built from ties is noise. Arena's machinery is not the problem; the tier it is pointed at is.

## Success criteria — fixed now

- [ ] Every one of the 9 graded tasks has a **measured raw-arm result** (no skill injected) at the
      chosen low-end tier, recorded with the pinned model ID.
- [ ] Each task is labelled **HEADROOM** (raw fails ≥1 criterion) or **SATURATED** (raw passes all).
      Counts written into `docs/arena/scores/README.md`.
- [ ] **Stop condition, declared before the probe runs:** if fewer than **4** tasks show headroom,
      W3 is **cancelled, not shrunk** — a 3-task suite cannot support a comparison at any budget, and
      porting it would spend migration cost on an instrument that stays blind. Say so in the PR and
      stop; do not quietly proceed with a smaller suite.

## Tasks

- [ ] **W3.0.1 — Pick and pin the tier.** Recommend two arms: `claude-haiku-4-5-20251001` and
      `claude-sonnet-5` at low effort. `swe-run.mjs` **rejects floating aliases** by design — pin
      exact IDs or it exits 2. Record the choice; every later comparison is only valid against it.
- [ ] **W3.0.2 — Run the raw arm.** No Harbor, no port, no new tooling: clone each fixture bundle,
      run one bare `claude -p` session with the task text, grade with the existing
      `swe-grade.mjs`. ~9 runs. Budget from the recorded raw numbers ($0.99–1.63/task on sonnet-5,
      less on haiku) — **quote it and ask before spending**, but it is one to two orders of magnitude
      under the W3 re-baseline it replaces.
- [ ] **W3.0.3 — Label and publish.** HEADROOM / SATURATED per task, with the failing criteria
      listed for the headroom ones — those are the criteria that carry all the signal.
- [ ] **W3.0.4 — Retire the saturated tasks from the lift suite.** Do not delete them; mark them
      `"graded": false` with a one-line reason. A task that saturates at haiku today may have
      headroom against a future weaker or cheaper tier.

---

# W4 — Reframe `arena` around low-end lift

**Why:** arena's `suite.json` currently declares two frontier configs — `claude-opus-4-8[1m]` at
`high` and at `medium`. Both sit above the saturation point for most of this suite, which is why the
one clean cross-model finding it produced was about **engagement** (sonnet 2/5 engaged; 6/6 on every
criterion it attempted), not quality. Engagement failure is a *skill defect* and it is exactly the
kind of signal that only appears below the ceiling.

**Not doing:** touching the judge, the position-swap scheme, or the Bradley-Terry maths. The
machinery is right; its suite and its declared configs are not.

## Success criteria — fixed now

- [ ] `suite.json` configs target the pinned low-end tier from W3.0.1, not frontier.
- [ ] Every arm is **paired** — `{with skill} × {without skill}` — and the leaderboard reports the
      **lift**, never the raw score. This is already the repo rule; make it structural so a
      single-arm run cannot produce a scorecard.
- [ ] `SKILL.md`'s frontmatter description states the tier assumption, so the skill stops advertising
      itself for frontier A/B where it cannot discriminate.
- [ ] A frozen check proves an unpaired run is refused.

## Tasks

- [ ] **W4.1 — Frozen check RED first:** a scorecard produced from a single (unpaired) arm must be
      refused. Prove RED via `check-baseline.cjs`; register with `mutations` in
      `arena/evals/checks-manifest.json`.
- [ ] **W4.2 — Repoint `suite.json`** at the W3.0 tier and the HEADROOM task set.
- [ ] **W4.3 — Enforce pairing** in the scorecard writer; an arm with no matching control is an
      error, not a row.
- [ ] **W4.4 — Rewrite the description and `docs/arena-guide.md`** around low-end lift; state the
      ceiling effect and cite the two experiments.md rows so the next reader does not re-derive it.
- [ ] **W4.5 — Verify.** `test-arena.cjs` · `prove-checks.mjs --skill arena` · `evals-all.mjs
      --fast` · `claude plugin validate .`. Then PR.

---

# W3 — ❌ CANCELLED 2026-08-01 by W3.0's stop condition (0 HEADROOM < 4)

> **Do not execute this workstream.** It is kept for the reasoning, not the steps.
>
> Porting the suite to Harbor would have moved 7 tasks that cannot discriminate anything into a
> better-isolated engine, producing a leaderboard with the same measurement value as the current one:
> none. The $2.12 probe saved the $135–405 re-baseline *and* the migration effort.
>
> **What survives the cancellation, and is still true:** Harbor genuinely beats `swe-run.mjs` on
> every execution axis (containers, repeatable `-m`, `-k`, 20+ agents, remote backends, `harbor
> view`, `harbor analyze`), and `swe-score.mjs` owns statistics Harbor has no equivalent for (Wilson
> CIs, the comparability fingerprint, engagement tri-state). If a discriminating suite is ever
> authored, revisit this plan — the engine comparison in
> [loop-consolidation.md](../loop-consolidation.md) §M1 does not change. **Author the tasks first.**

**Why:** two behavioural engines, one job. Harbor wins every execution row (containers, repeatable
`-m`, `-k`, 20+ agents, remote backends, `harbor view`, `harbor analyze`); arena wins only the
statistics rows, and statistics is a post-processor. Three of the four gaps in
[eval-engine-plan.md §4](../evals/eval-engine-plan.md) close by deleting code.

**Explicitly preserved — these have no Harbor equivalent and must survive:** Wilson confidence
intervals, the suite fingerprint / comparability era, engagement as a *measured* tri-state, and the
forfeit accounting. `swe-score.mjs` keeps all of it, reading `jobs/*/verifier/reward.json` instead of
`swe-run` cell records.

**Not doing:** touching the pairwise judge, the position-swap scheme, or the BT maths. Those drive
their own runs and are out of scope.

## Success criteria — fixed now

- [ ] Every **HEADROOM** task (from W3.0) exists as a Harbor task declaration under
      `plugins/lirbox/skills/conductor/harbor/tasks/`, and **each passes the free gate**:
      `-a nop` = 0.000, `-a oracle` = 1.000 per dimension.
- [ ] Criterion count is preserved exactly for every ported task — a port that loses one is a
      regression, not a simplification. (Full suite today: 38 f2p criteria across 9 tasks; the
      ported subset is whatever W3.0 qualifies.)
- [ ] Pass-to-pass (the fixture's own `npm test`) is graded as its own dimension, as today.
- [ ] `swe-score.mjs` reads Harbor job output and reproduces the 5 published Wilson CIs
      **bit-identically** from the same underlying counts — the regression test for the port.
- [ ] Engagement stays tri-state (`true`/`false`/`null`); a task that never engaged still writes a
      record and still counts in the denominator.
- [ ] `swe-run.mjs` is deleted; nothing references it.
- [ ] Every existing scorecard is marked stale under a new suite fingerprint. **Do not silently
      re-point old rows at a new engine** — they are not comparable.

## Tasks

- [ ] **W3.1 — Write the shared grader once.** All 9 tasks share one shape: p2p = the fixture's
      `npm test`; f2p = copy each `grader/fail_to_pass/*.test.cjs` into the workspace *after* the
      agent finishes and run it. Author one `tests/test.sh` template that emits a `reward` key from
      the f2p fraction and a `p2p` key, via **separate `rewardkit` processes**. Port
      `notes-add-tags` (3 criteria, easy) first and prove the gate before touching the other 8.
- [ ] **W3.2 — Port the remaining 8 tasks.** `notes-archive`, `notes-search`, `notes-import-export`,
      `notes-fix-data-loss`, `notes-sync-merge`, `notes-selective-sync`, `notes-wide-features`,
      `uglify-corner-cases`. Each: `repo.bundle` → `files/`, `task.md` → `instruction.md` (with the
      harness preamble), `grader/fail_to_pass/` → `tests/`, the `repo.ref` branch → `solution/solve.sh`.
      Run the free gate on each. **The 2 orphan tasks (`notes-selective-sync`, `notes-wide-features`,
      13 criteria) join the suite here** — eval-engine-plan §4 item 5, closed for free.
- [ ] **W3.3 — Solve the skill-injection problem.** These tasks require `conductor` in the
      container. Build the pruned `.harbor/skills/` copy (strip every skill's `evals/`, `harbor/`,
      `arena/`, `*.bundle`), then **assert** no `verify.sh` and no `fail_to_pass` survived before any
      run. A grader leaked into the agent's discovery path invalidates every number after it.
- [ ] **W3.4 — Rewrite `swe-score.mjs`'s input layer.** Same output schema, same Wilson maths, same
      fingerprint logic; source changes from cell records to `jobs/*/verifier/reward.json`. Add the
      **engagement** signal — Harbor does not compute it, so derive it (did the run produce a `wf/`
      branch) inside the task's grader and emit it as its own key. Regression test: recompute the 5
      published CIs and require exact match.
- [ ] **W3.5 — Freeze a new era.** New suite fingerprint over 9 tasks; mark all 7 existing
      scorecards stale in `docs/arena/scores/README.md` with a one-line note that the engine changed.
- [ ] ~~**W3.6 — Re-baseline.**~~ **DEFERRED — do not run.** A lone baseline arm answers no
      question: `eval-engine-plan.md §3` computes ~14 runs/arm to detect even the enormous 100%→60%
      gap and ~81 for 20pp, so one 9-task × k=3 arm (27 trials, $14–405) cannot support a comparison
      and goes stale at the next fingerprint change. The port's acceptance test is the **free** gate
      (`nop`=0, `oracle`=1.0) plus the fixture-driven statistics regression in W3.4 — neither needs a
      paid run. Buy runs when there is a real A-vs-B, and buy **both arms, matched, at once**.
- [ ] **W3.7 — Delete `swe-run.mjs`** and its references in `arena/SKILL.md`,
      `docs/arena-guide.md`, `docs/evals/eval-engine-plan.md`. Narrow arena's frontmatter
      `description` to the pairwise leaderboard so the trigger stops advertising absolute scoring.
- [ ] **W3.8 — Frozen check + verify.** A check proving the statistics layer still refuses to
      compare across fingerprints (the comparability contract is the thing most likely to be lost in
      a rewrite). `test-arena.cjs` · `prove-checks.mjs --skill arena` · `evals-all.mjs --fast` ·
      `claude plugin validate .`. Then PR.

---

## Sequencing

```
W1  (independent, start any time)
W2  (independent; cheap datapoint — do before W3)
W3.0  headroom probe  ──┬──> W4  (reframe arena; proceeds even if W3 is cancelled)
                        └──> W3  (port; CANCELLED if <4 tasks have headroom)
```

W3.0 gates both. Run it before spending anything on W3 or committing to W4's suite.

**Deletion order matters.** `swe-grade.mjs` is the grader for the W3.0 raw probe *and* for arena's
pairwise half — it survives all of this. Only `swe-run.mjs` (the execution engine) is deleted in
W3.7, and only after W4 has repointed the scorecard writer. If W3 is cancelled, `swe-run.mjs` stays.

## Open risks

- **The probe may cancel W3.** If ≤3 tasks show headroom, the honest outcome is that this suite
  cannot support a behavioural comparison at any budget, and the work is to *author discriminating
  tasks*, not to port undiscriminating ones. That is a better finding than a completed migration.
- **W3 loses history if it proceeds.** Every existing scorecard becomes non-comparable. Accepted:
  5 of 7 were already stale from fingerprint churn.
- **W2 depends on one proven task.** If `conductor/scaffold-multiphase`'s oracle cannot be brought
  to 1.000 on every dimension, W2 has no RED to discriminate against and stalls at W2.2.
- **Low-end tiers may fail to engage rather than fail to deliver.** The recorded sonnet result was
  2/5 engaged, 6/6 on attempted criteria — a skill defect wearing a quality score's clothes. W4's
  suite must keep engagement tri-state and report it beside the lift, or the reframe reintroduces
  precisely the confound `#41` fixed.
