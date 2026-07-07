# Skill-improvement cookbook — the end-to-end SkillOpt-style flow

How to take a skill with a runnable surface and a set of behaviors it *should* have, and grind it
into shape: **scored tasks (train/val) → harvest failures into a backlog → `whetstone` with a
compaction pass → review the auto-PR**. Everything here is verified against a real run on the
`flowchart` skill (numbers at the bottom).

Two prerequisites and two neighbours:
- Prereq: the skill is **whetstone-ready** — a green floor + a checks dir. If not, do
  [whetstone-ready.md](./whetstone-ready.md) first (`scaffold-readiness.cjs` writes the scaffold).
- Prereq: the skill has a **deterministic surface** you can assert on (a validator / generator /
  parser / asset-transform). No surface → every concern is human-only; improve it by hand.
- Neighbour: to hill-climb an aggregate *pass-rate* instead of working discrete failures, use
  [`skill-train`](../plugins/lirbox/skills/prospector/references/skill-train.md) (prospector).
- Neighbour: the *why* behind these controls is
  [skillopt-exploration.md](./skillopt-exploration.md).

---

## When to use this flow

You have a skill whose behavior you can pin with small deterministic tasks, and you'd rather the
loop **discover and fix** concrete failures than have you hand-file every one. If you instead have a
short list of already-known nitpicks, skip the scored/harvest phases and just file them
(whetstone-ready.md §2) — the loop is the same.

---

## Phase 1 — make the skill *scored*

The scored task set is the SkillOpt "eval" your fixes are judged against. Scaffold it (idempotent;
adds to the normal whetstone floor):

```bash
node plugins/lirbox/skills/whetstone/scripts/scaffold-readiness.cjs --name <skill> --scored
```

You get `evals/run-scored.mjs` (prints one `score=<pct>` line) and `evals/tasks/train/` +
`evals/tasks/val/`. Now write the tasks — each a small deterministic `*.test.mjs` that runs the
skill's surface against a fixture and asserts (exit 0 = behavior holds):

- **Cover both directions.** Some tasks pin behavior that already works (guards against regressions);
  some assert behavior that is *currently broken* (the improvement targets). A baseline score below
  100 is expected and good — it's the headroom.
- **Split ~50/50, and hold val out.** `tasks/train/` failures may be shown to the fix worker;
  `tasks/val/` is the **held-out judge** — never shown, and the real measure of whether a fix
  *generalized* vs. memorized the train fixtures. Give val ≥4 tasks (a 1-task val flips 0↔100).
- Make val tasks *different fixtures of the same behavior classes* as train — that's what turns the
  val score into a generalization signal.

Measure the baseline:

```bash
node plugins/lirbox/skills/<skill>/evals/run-scored.mjs --split train
node plugins/lirbox/skills/<skill>/evals/run-scored.mjs --split val
```

Commit the task set (it's the contract — locked, in `evals/**`).

## Phase 2 — harvest the failures into a backlog

Turn every failing **train** task into a whetstone backlog item automatically:

```bash
node plugins/lirbox/skills/whetstone/scripts/harvest-feedback.cjs <skill>   # --dry-run to preview
```

Each failure becomes a `feedback/<skill>.jsonl` item whose `acceptanceCheck` **is that task** — so
it is RED-on-baseline *by construction* (it was just observed failing → it sails through whetstone's
discrimination gate) and already lives in the locked `evals/**` set the fixer can't touch. It
refuses `--split val` (harvesting the held-out judge would let the loop optimize against its own
grader). Idempotent — re-running after partial fixes only files newly-failing tasks.

> Mixing in hand-filed concerns is fine — they flow through the same gate. Harvest just saves you
> the transcription for anything already captured as a task.

## Phase 3 — run whetstone (with the compaction pass on)

Invoke the skill normally:

```text
/lirbox:whetstone <skill>
```

Setup drafts/free­zes a check per item, runs the discrimination gate, measures the floor, and asks
you to **confirm once**. Two config knobs worth setting for this flow (in the approved
`.improve/config/<run>.json`):

- `"consolidate": true` — after the backlog, one **compaction pass** compresses/dedupes the skill.
  Kept **only if** the floor + *every* check a kept item turned green stay green **and** the skill
  entrypoint gets strictly smaller. This fights the accretion a fix-only loop causes (every kept fix
  adds text; nothing ever removes any).
- `"budgets": { "maxDiffLines": <N> }` — an **edit-size budget** ("textual learning rate"). A fix
  whose diff exceeds `N` lines is reverted even if its check went green, keeping diffs reviewable and
  the ledger meaningful. ~120 is sane for a validator/generator.

The loop keeps a fix **iff** floor + its frozen check + the surface-lock + the edit budget all hold,
reverting otherwise. Each run gets a unique slug `<skill>-<UTC-timestamp>` → its own
branch/worktree/ledger, so you can have several runs in flight on one skill without collision.

## Phase 4 — review the auto-PR (and read the val delta)

When ≥1 item is kept, finalize **pushes the run branch and opens a PR** (never a merge) with the run
report as the body. Review it as you would any PR. The signal that matters is the **held-out val
score**: run `node …/run-scored.mjs --split val` on the branch —

- val rose toward 100 → the loop learned the *behavior classes*, not the train fixtures. Ship it.
- train rose but val didn't → it overfit; tighten the tasks or file the concern more specifically.

The compaction pass is the one change a gate can't fully vouch for (behavior-preserving but
prose-altering) — give it a human glance in the PR. Nothing is ever auto-merged; you merge.

---

## Worked example — `flowchart` (real run)

`flowchart/assets/validate.mjs` is a headless Mermaid-label validator. 9 scored tasks (5 train / 4
val) exposed two real gaps: it never extracted **dash-form edge labels** (`A -- text --> B`) or
**round-node labels** (`(..)`), so non-ASCII / raw specials there slipped through. Harvested both as
RED-by-construction items, plus one hand-filed concern (non-ASCII in node labels), ran whetstone with
`consolidate: true`, `maxDiffLines: 120`.

| Measure | Baseline | After |
|---|---|---|
| Train split (5 tasks) | 60.00 | **100.00** |
| **Held-out val split** (4 tasks, never shown to workers) | 50.00 | **100.00** |
| Floor | green | green |
| `SKILL.md` size (est. tokens) | 892 | **711 (−20.3%)** |

All 4 items kept (3 surgical `validate.mjs` fixes of 6–7 lines each + the compaction pass). The
val jump 50→100 on fixtures the workers never saw is the point: the loop fixed the *bug classes*, not
the specific files. Full write-up: [skillopt-exploration.md](./skillopt-exploration.md#empirical-run-2026-07-07-flowchart).

---

## Cheat sheet

```bash
# 1. scored-ready + write tasks/{train,val}/*.test.mjs, then measure
node .../whetstone/scripts/scaffold-readiness.cjs --name <skill> --scored
node .../<skill>/evals/run-scored.mjs --split train    # and --split val

# 2. harvest failing train tasks → backlog
node .../whetstone/scripts/harvest-feedback.cjs <skill>

# 3. run (set consolidate:true + maxDiffLines in the confirmed config)
/lirbox:whetstone <skill>

# 4. review the auto-PR; confirm generalization on the held-out split
node .../<skill>/evals/run-scored.mjs --split val
```
