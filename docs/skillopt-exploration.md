# SkillOpt exploration — what it is, what lirbox already has, what's worth stealing

*Research note, July 2026. Sources at the bottom.*

## What SkillOpt is

[Microsoft SkillOpt](https://github.com/microsoft/SkillOpt) (paper: *"SkillOpt: Executive Strategy
for Self-Evolving Agent Skills"*, arXiv 2605.23904, `pip install skillopt`) treats a natural-language
skill file as a **trainable parameter outside a frozen model**. Instead of hand-editing a skill or
fine-tuning weights, it runs a training loop in text space:

1. **Rollout** — the frozen *target* model executes benchmark tasks with the current skill.
2. **Reflect** — trajectories are scored (task success/failure).
3. **Aggregate** — scored trajectories are collected into a mini-batch.
4. **Select** — a separate *optimizer* model analyzes success/failure minibatches and proposes
   **bounded structured edits** (add / delete / replace) to the skill text.
5. **Update & evaluate** — a candidate edit is accepted **only if it improves held-out validation
   performance**.

The deployed artifact is a compact `best_skill.md` (300–2,000 tokens, ~920 median) that runs
against the unchanged target model.

Control mechanisms (their words, roughly):

- **Validation gating** — accept an edit iff held-out val improves; prevents overfitting.
- **Rejected-edit buffer** — failed proposals are fed back as negative signal so they aren't re-proposed.
- **Textual learning rate** — a budget bounding edit magnitude per step; keeps updates stable.
- **Slow/meta updates** — epoch-wise consolidation passes that compress and capture longer-horizon
  patterns.
- **Best-version selection** — the final artifact is the best validated version, not the last one.
- **Stopping** — val plateau, edit-rejection-rate threshold, or epoch budget.

Headline results: +23.5 points average over six benchmarks for GPT-5.5 direct chat; best or
tied-best on all 52 (model × benchmark × harness) cells including the **Claude Code CLI harness**
(+19.1). Ablations that matter to us: removing the rejected-edit buffer degraded scores across
benchmarks, and **removing slow/meta consolidation dropped SpreadsheetBench from 77.5 to 55.0** —
consolidation is the single most load-bearing component after the val gate. Optimized skills
transferred across models and harnesses (a spreadsheet skill trained in Codex transferred to
Claude Code at +59.7) because they capture reusable procedures, not harness-specific tricks.

## Mapping onto lirbox

The striking thing: **prospector + whetstone already implement most of the SkillOpt control loop**,
independently derived. The premise is identical — frozen model, edit the text, keep only validated
improvements, never auto-merge.

| SkillOpt concept | lirbox today | Status |
|---|---|---|
| Skill file as trainable parameter, frozen model | whetstone edits `SKILL.md`+refs; model untouched | ✅ same premise |
| Propose → evaluate → accept/reject loop | prospector's propose → gate+metric → keep/discard; whetstone's fix → floor+check → keep/revert | ✅ |
| Validation gating (accept iff strictly better) | prospector keeps iff gate ∧ metric beats `best` by ≥`minDelta` ∧ beyond noise `spread` | ⚠️ gated, but **no train/val split** — see gap 1 |
| Rejected-edit buffer | ledger digest (`change` + `kept` per generation) is fed to the propose agent — "no idea is repeated" | ✅ equivalent |
| Anti-gaming constraints | **surface lock** (every touched path ⊆ surface, evals/backlog locked) + **discrimination gate** (checks must be RED on baseline) | ✅ lirbox is *stronger* here — SkillOpt has no per-check validity test |
| Stopping: plateau / rejection rate / budget | `plateauStop`, two-clock caps, `{experiments, wallclockMin, tokens}` totals, bounded `maxRestarts` escapes | ✅ |
| Durable, resumable, reviewable | ledger + branch + worktree, never auto-merged | ✅ lirbox stronger (SkillOpt has no non-destructive review story) |
| **Trajectory-driven reflection** (optimizer reads scored rollouts) | whetstone's backlog is human-filed; prospector's proposer sees the goal + ledger digest, not transcripts | ❌ gap 4 |
| **Textual learning rate** (bounded edit size per step) | surface lock bounds *where*, nothing bounds *how much* | ❌ gap 3 |
| **Slow/meta consolidation** (periodic compress/dedupe pass) | nothing — kept fixes accrete; `skill-lint` catches bloat but nothing removes it in-loop | ❌ gap 2 — biggest ablation win |
| **Compactness pressure / best-version selection** | no token-count signal anywhere in the loop | ❌ gap 2b |
| Scalar skill-quality metric (pass-rate over a task set) | whetstone is binary per-concern; prospector is scalar but pointed at code, not skills | ❌ gap — but it's a *recipe*, not new machinery: see proposal 1 |

Where lirbox is ahead of SkillOpt: the **surface lock** (SkillOpt trusts its optimizer not to edit
the benchmark; we enforce it), the **discrimination gate** (SkillOpt never proves a signal is RED
before crediting a fix for turning it green), and the **non-destructive branch + human review**
default. None of those should be traded away while adopting the ideas below.

## What's worth applying (ranked by leverage ÷ cost)

### 1. The "skill-train" recipe — prospector *is* SkillOpt if you point it at a skill
**Leverage: high. Cost: low (a doc + one small runner).**
SkillOpt = prospector with:
- `surface` = `plugins/lirbox/skills/<skill>/**` **minus** `evals/**` (already how whetstone's
  editable−locked works),
- `gate` = `quick_validate.py` + the whetstone floor (`evals/run.mjs`),
- `metric` = **pass fraction over a scored task set** — an `evals/run-scored.mjs` that runs N task
  checks and prints `passed=<k>/<n>` (parse: `passed=([0-9.]+)`, direction: `max`).

Everything else — ledger, keep/discard, plateau, surface lock, resume — already exists. This wants
a short recipe doc (or a `references/skill-train.md` in prospector) plus a tiny scored-runner
template in whetstone's readiness scaffold. It converts skill improvement from whetstone's
"fixed backlog of binary concerns" into SkillOpt's "hill-climb a scalar", which is the right mode
when you have many small tasks rather than a few filed complaints.

### 2. Consolidation pass (SkillOpt's "slow/meta update") — the ablation-proven one
**Leverage: high (77.5 → 55.0 without it, in their ablation). Cost: medium-small.**
Whetstone's failure mode over many runs is monotone accretion: every KEPT fix adds text; nothing
ever removes any. Add a **final consolidation item** to the generated loop (in
`scaffold-improve.cjs`, so it's generator-owned, not hand-edited): after the backlog is exhausted,
one extra fixer pass with the prompt "compress/dedupe/reorganize the skill — change no behavior",
KEPT iff floor ∧ **all** frozen checks from this run still green ∧ surface lock ∧ **token count of
SKILL.md did not increase**. Same keep/revert machinery, one new item type. This is also the loop
that `skill-lint` (already in-repo) wants to feed: lint findings are natural consolidation targets.

### 2b. Compactness in the ledger
**Leverage: medium. Cost: trivial.**
Have the eval/checkpoint worker record `skillTokens` (≈ `wc -w`-derived or the `skill-lint` count)
per experiment/item in the ledger, and surface baseline→final size in `improve-report.cjs` /
`optimize-report.cjs`. Costless observability; makes bloat visible in the morning review and gives
proposal 2 its threshold.

### 3. Textual learning rate — bound edit *size*, not just edit *location*
**Leverage: medium. Cost: small.**
SkillOpt bounds edit magnitude per step for stability. lirbox analog: a `budgets.maxDiffLines`
(insertions+deletions within the surface, from `git diff --numstat`) checked by the eval worker
and enforced by the conductor exactly like the surface lock — oversized diff ⇒ DISCARD/revert.
Big rewrites are how a loop "wins" by accident and how diffs become unreviewable; small bounded
steps are also what makes the ledger digest meaningful ("cache compiled regex", not "rewrote
everything"). Opt-in per config, default off, so nothing existing changes behavior.

### 4. Trajectory harvesting — rollout-fed backlogs instead of human-fed ones
**Leverage: high eventually. Cost: largest of the list.**
SkillOpt's proposer reads *scored trajectories*; whetstone's reads a human-filed `feedback/*.jsonl`.
The bridge is a **harvest mode**: run the skill against its eval task set, capture each failure's
transcript tail + the failing assertion, and auto-file `{id, type: "harvested", text, acceptanceCheck}`
items into `feedback/<skill>.jsonl` — which then flow through the *existing* discrimination gate and
human confirmation. The gate matters: SkillOpt's val split protects it from bad automatic feedback;
whetstone's equivalent protection is exactly the RED-on-baseline check + the one human confirm.
Do this after 1–3; it's the piece that makes the loop self-evolving rather than complaint-driven.

### 5. Held-out validation split — the true SkillOpt val gate
**Leverage: high for recipe 1, N/A for whetstone as-is. Cost: medium.**
Prospector's keep decision measures the same metric the proposer is optimizing against — fine for
perf (the benchmark *is* the objective), but for a *skill* pass-rate metric it overfits: the loop
learns the eval tasks, not the task family. SkillOpt's fix: the proposer sees **train** rollouts;
the keep decision runs on **held-out val** tasks the proposer never sees. lirbox version: the
scored runner from proposal 1 takes `--split train|val`; `metric.cmd` runs the **val** split;
the propose worker's prompt gets **train**-split failure summaries only. Whetstone doesn't need
this (its per-concern checks are frozen and human-confirmed — a different, adequate control), but
recipe 1 shouldn't ship without it, or it will look better than it is.

### Not worth adopting
- **Dual-model (separate optimizer model)** — Workflow workers already run whatever the session
  runs; a config knob for `opts.model` on the propose worker is free if ever wanted, but there's
  no evidence gap to close.
- **Their epochs/batch vocabulary** — prospector's generations/budgets vocabulary covers it; renaming
  is churn.
- **Dropping any lirbox guard to match them** — surface lock, discrimination gate, and never-auto-merge
  all stay. SkillOpt is weaker on all three.

## Suggested order

1. Ledger `skillTokens` + report line (2b) — trivial, immediately useful.
2. Consolidation pass in `scaffold-improve.cjs` + `test-improve.cjs` coverage (2).
3. `maxDiffLines` budget in both scaffolds (3).
4. Skill-train recipe doc + scored runner with train/val split (1 + 5, shipped together).
5. Harvest mode (4).

## Implementation status (this branch)

- ✅ **1–4 implemented.** `skillTokens` telemetry (baseline + per-item, `improve-report.cjs` size
  line); opt-in `config.consolidate` Consolidate phase in `scaffold-improve.cjs` (kept iff floor +
  every kept check + surface-lock hold AND the skill strictly shrinks); opt-in
  `budgets.maxDiffLines` edit budget in **both** generators (`withinEditBudget`, whetstone revert /
  prospector `oversized-diff` discard); `references/skill-train.md` + `scaffold-readiness.cjs
  --scored` (train/val-split `run-scored.mjs`). All pinned by `test-improve.cjs` /
  `test-optimize.cjs` (structure markers + unit + E2E scored-runner cases).
- ⬜ **5 (harvest mode)** — not implemented; do after a real skill-train run proves the task-set
  format.

## Sources

- [microsoft/SkillOpt (GitHub)](https://github.com/microsoft/SkillOpt)
- [SkillOpt: Agent skills as trainable parameters — Microsoft Research blog](https://www.microsoft.com/en-us/research/blog/skillopt-agent-skills-as-trainable-parameters/)
- [SkillOpt project page](https://microsoft.github.io/SkillOpt/)
- [Paper: arXiv 2605.23904](https://huggingface.co/papers/2605.23904)
- [VentureBeat coverage](https://venturebeat.com/orchestration/microsofts-open-source-skillopt-automatically-upgrades-ai-agent-skills-without-touching-model-weights)
