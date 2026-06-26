# whetstone — overnight, feedback-driven, eval-gated skill improver

- **Status:** design — pending review
- **Date:** 2026-06-26
- **Author:** websliem (+ Claude)
- **Name:** `whetstone` (provisional — sharpens existing skills; sibling to `prospector`, which mines. Alts: `forge`, `lapidary`.)

## 1. Problem

We accumulate **feedback about our skills** — suggestions, concerns, raw conversation excerpts ("conductor lacks a test-running gate", "flowchart mislabels nodes with quotes"). Acting on each by hand is slow, and we want it to happen **overnight, unattended**, then review a branch in the morning.

The danger: an autonomous overnight improver is only as trustworthy as its eval. Point it at a weak or subjective judge and it **reward-hacks** — mutates the skill into something that scores well but is worse. So the whole design is organized around **what can be trusted to gate a change without a human.**

## 2. What it is (and isn't)

whetstone is **`prospector`'s overnight loop, retargeted**: the surface is a *skill directory*, the "metric" is a *skill-eval*, and the driver is a *feedback backlog* instead of blind mutation. It **reuses** prospector/conductor's durable-ledger + worktree-isolation + resume backbone; it does not rebuild them.

It is **not**:
- a scalar optimizer (that's `prospector` — use it when you have a number + a fence);
- a skill *creator* or quality *benchmarker* (that's `skill-creator`);
- an auto-merger — the branch `improve/<skill>` is **never** merged automatically.

## 3. Core principle — the eval is everything

> **Feedback sets direction. The check sets truth. A human merges.**

- The loop may **auto-keep** a change **only** when a **deterministic** signal confirms it: the skill still passes its **floor** AND the backlog item's own **acceptance-check** passes.
- Anything assessable only by subjective judgment is **out of v1's autonomous path** — surfaced for the human, never declared a win by the loop.
- The target skill's **floor scripts, evals, and backlog are locked** (read-only to the loop). This is the anti-gaming fence — the loop cannot "pass" by weakening its own check.

## 4. Flow

### 4a. Setup (attended, once per run) — mirrors prospector's "propose + confirm once"
1. Read the backlog `feedback/<skill>.jsonl`.
2. **Draft a failing acceptance-check per item (RED-first).** A `check-drafter` worker (the `lirbox-test-writer` agent) investigates each item and writes a deterministic check (a `validate.mjs` case + fixture, a script, an assertion) that **captures the concern**. Each drafted check must pass the **discrimination gate**: run it against the **unmodified baseline skill — it MUST fail, for a genuine assertion reason** (not a crash / missing-file error). A check that passes on baseline, or only errors, is rejected as non-discriminating. Items that cannot be reduced to a failing check are marked **`human-only`** and **excluded** from the autonomous run.
3. **Measure the baseline:** the skill's **floor must pass unmodified** (a broken skill cannot be improved — abort if red). Record the result.
4. **Confirm once** (`AskUserQuestion`): the drafted checks (with their baseline-failure evidence) + which items are `human-only` + budgets. The human edits/rejects any check here — **this is where faithfulness is judged.** On confirmation, **all checks are frozen and added to the locked set.** This is the only human gate before overnight.

### 4b. Overnight loop (unattended) — per checkable item, a GREEN step against a frozen check
1. **Fix (GREEN):** a `fixer` worker makes a focused edit to turn the item's **frozen, human-approved, baseline-failing check** green — editing **only the unlocked surface** (never a check). It authors no checks; the goalposts are fixed.
2. **Eval:**
   - **Floor** (all deterministic gates) must hold.
   - The item's frozen **`acceptanceCheck`** must pass.
   - **Surface lock** must hold (no change outside the editable surface — including no touch of any check/fixture).
3. **Decide:**
   - all three hold → **KEEP** (commit on `improve/<skill>`).
   - floor breaks, or surface-lock violated → **REVERT** (non-destructive: reset worktree).
   - acceptance-check fails → retry ≤ `N` (= 2); still failing → **REVERT**, mark item `unresolved`.
4. **Checkpoint** to the durable ledger (written by a checkpoint worker, *after* commit-or-revert → at-least-once, idempotent).

Per item this is a mini **RED (drafted + confirmed at setup) → GREEN (overnight fix) → VERIFY (floor)** cycle — the same discipline as conductor's `--cycle`, reusing `lirbox-test-writer` for RED.

### 4c. Morning (attended)
Human reads the **report** + reviews `improve/<skill>` and merges. `human-only` and `unresolved` items are listed for manual follow-up.

## 5. Components

| Component | Location | Role |
|---|---|---|
| **Backlog** | `feedback/<skill>.jsonl` (in the skill repo) | items the loop works through — **locked** during the run |
| **Config** | `.improve/config/<skill>.json` | skill path, floor command(s), backlog path, editable-surface globs + locked globs, budgets, baseline |
| **Ledger / state** | `.improve/state/<skill>.json` | items done, per-item verdict (kept/reverted/unresolved/human-only), baseline floor result, `startedAt`, resume key |
| **Loop conductor** | `.improve/<skill>.js` (generated) | the Workflow script — pure JS, picks next item, decides keep/revert from worker results |
| **Workers** | (subagents) | `check-drafter` (RED, **setup-only**, writes failing checks — `lirbox-test-writer`), `fixer` (GREEN, edits surface only), `evaluator` (runs floor + acceptanceCheck), `checkpointer` (writes ledger) |
| **Report** | `.improve/reports/<skill>.md` | per-item verdict + eval deltas + diff pointers |

`config/` and `state/` live in the **main repo** (survive worktree removal; resume needs only the skill name). Edits happen on `improve/<skill>` in worktree `.worktrees/improve-<skill>`; **main is never touched until the human merges.**

### Backlog item schema
```jsonc
{
  "id": "fc-quote-labels",
  "type": "concern",                 // suggestion | concern | conversation
  "text": "flowchart mislabels nodes whose label contains a quote",
  "acceptanceCheck": "node validate.mjs fixtures/quote-label.json",  // deterministic; or null
  "status": "pending"                // pending | kept | reverted | unresolved | human-only
}
```

## 6. The eval — v1 layers

- **Deterministic floor (hard, auto-gate, the only thing that can auto-kill a change):**
  - skill still validates (`skill-creator`'s `quick_validate.py`);
  - any bundled-script tests pass;
  - the skill's own validator holds (e.g. flowchart's `validate.mjs`), plus any declared golden-master signature.
- **Per-item acceptance-check (hard, auto):** the item's `acceptanceCheck` passes. It is validated **fail-before / pass-after**: the **discrimination gate** at setup proves it fails on the frozen baseline (a check that doesn't fail on baseline proves nothing and is rejected), and the overnight GREEN step proves it passes after the fix.

**Deferred to v2** (explicitly out of v1): trigger/description tuning via `run_loop.py`; a subjective LLM/vision **judge** that scores un-checkable changes and commits them **flagged-for-review**; a **transcript harvester** that auto-mines concerns into the backlog.

## 7. Safety / anti-gaming (inherited from prospector)

- **Surface lock:** editable surface = `<skill>/**` **minus** the locked set (`validate.mjs`, `evals/**`, the backlog, any floor/check script — **plus every check/fixture drafted-and-confirmed at setup**, frozen into the locked set before the overnight run). Every changed path — including new untracked files — must be ⊆ editable surface, else **discard**. The `fixer` can therefore never author or weaken a check.
- **Floor is the floor:** a KEEP exists iff floor passes AND acceptance-check passes AND surface-lock held. Everything else is discarded.
- **Baseline must pass:** a skill whose floor is already red is aborted, not "improved."
- **Non-destructive revert:** discard resets the whole worktree (`git reset --hard && git clean -fd`); prior KEEPs stay on the branch.
- **Bounded:** each propose/eval step is time-budgeted; timeout → discard. Total stop = first of `{items exhausted, wallclockMin, tokens}`.
- **Never auto-merge.**

## 8. Reuse map

- **prospector:** `scaffold-optimize`-style generator (adapted → `scaffold-improve`), durable ledger schema, worktree isolation, resume protocol, surface-lock + non-destructive revert, report script.
- **skill-creator:** `quick_validate.py` (floor), and — in v2 — `run_loop.py` (trigger metric) and `agents/grader.md` / `comparator.md` (subjective judge).
- **conductor:** the two-layer conductor/worker model, checkpoint-after-side-effect discipline, and the `--cycle` RED→GREEN→VERIFY shape (the per-item loop is one such cycle).
- **lirbox agents:** `lirbox-test-writer` as the `check-drafter` (writes failing-first checks and confirms they fail for the right reason = the discrimination gate).

## 9. v1 scope

Feedback-driven, **deterministic floor + acceptance-check gated**, overnight skill editor with a morning report. Manual backlog. **Zero reward-hacking surface** — the loop only auto-keeps what a deterministic check confirms.

**First target:** `flowchart` (ships `validate.mjs` — cleanest real floor + a genuine capability gain).

## 10. Testing the skill itself

- A generator regression net (like prospector's `test-optimize.cjs`): emit the loop script for a sample config, `node --check` it, assert structure.
- A **dry run on flowchart** with a 2-item backlog: one item *with* an acceptance-check that fails-then-passes (→ proves KEEP), one item whose edit breaks the floor (→ proves REVERT), and one `human-only` item (→ proves it's excluded + reported). This is the v1 acceptance test for whetstone.

## 11. Resolved decisions

1. **Retry budget `N` = 2.**
2. **Backlog format = `jsonl`** (machine append/harvest).
3. **Check authoring (the trust-critical one).** The `fixer` may **never** author or edit a check. A `check-drafter` (`lirbox-test-writer`) may **draft** checks **at setup**, each subject to the **discrimination gate** (must fail on baseline for a genuine assertion reason); the human confirms/edits them; all checks are then **frozen into the locked set before the overnight run**. So overnight the loop only writes *fixes* against fixed, human-approved goalposts — it never sets its own. **Deferred to v2:** authoring checks *during* the unattended run, gated by an independent LLM judge (faithfulness) rather than the human — the harder autonomous mode.
