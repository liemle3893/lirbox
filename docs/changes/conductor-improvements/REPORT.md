---
title: conductor improvements — model-mode + artifacts-to-PR
date: 2026-06-27
branch: improve/conductor
status: ready for review (NOT merged, NOT pushed — main is byte-unchanged)
---

# Morning review report

You invoked `/lirbox:whetstone` on the conductor skill and went to sleep. Whetstone's
autonomous eval-gated loop was the **wrong tool** here (the three asks were design-heavy features
with unsettled decisions, two of which conflicted with the repo's gitignore rule — not a backlog
of narrow checkable concerns). So I took the lead the way you asked: brainstormed the design,
decided the open questions, implemented surgically, and **eval'd + compared** every step. Delivered
the whetstone way — an isolated branch + this report, nothing merged.

## What shipped (3 asks → 3 features)

1. **Implementation-notes survive into the PR.** A new **Writeup** phase (before PR, hard-fail)
   promotes the worktree's `implementation-notes/*.html` into `docs/changes/<name>/notes/` instead
   of dropping them.
2. **Every delivery PR carries a write-up + a design diagram.** The same Writeup phase generates
   `writeup.html` (via `lirbox:pr-writeup`) and `design.html` (via `lirbox:flowchart`, validated),
   commits them under `docs/changes/<name>/`, and the PR body links them. On by default whenever a
   PR phase exists; `--no-writeup` opts out.
3. **`--model-mode balanced`.** Tiers each worker by phase class — `haiku` for mechanical work,
   `opus` for thinking (`--model-think` to override, e.g. `fable`), `sonnet` for the work phases
   (`--model-work`). `--model-mode default` (the default) is **byte-identical to before**.

### Decisions I made (you delegated them)
- DocsGate's `summary.md` moved into the per-run `docs/changes/<name>/` dir (artifacts group).
- Thinking tier defaults to `opus`; `--model-think fable` to opt up.
- Artifacts are **committed** under `docs/changes/` (a `.gitignore` carve-out: `!docs/changes/**`).
- Balanced **work** phase = `sonnet` (overridable) — your "may use Sonnet for work" note.

### Phase → model class (balanced) — change any with a one-word edit on the descriptor
| Class | Model | Phases |
|---|---|---|
| mechanical | `haiku` | Setup, every checkpoint, Verify, ReVerify, PR, TicketUpdate |
| think | `opus` | Brief, RED, PathGap, CodeGate, Review, TestGate, DocsGate, Writeup |
| work | `sonnet` | the `--phases` work phases |

Judgment calls worth a glance: **Brief** is "think" (it derives the goal that gates the run);
**Verify/ReVerify** are "mechanical" (they run a known suite and report).

## Eval & compare — the verdict (you said don't forget this)

- **Backward-compat (load-bearing):** regenerated the full 12-combo flag matrix from the pre-change
  generator and from this one with `--no-writeup` in default mode → **byte-identical except one
  intentional line** (the DocsGate `summary.md` path). model-mode adds zero bytes unless you opt in.
- **Balanced delta:** `--profile delivery --model-mode balanced` → 6 haiku / 6 opus / 1 sonnet,
  correct tier on every phase class; `--model-think fable` flips the think phases.
- **Writeup wiring:** `--pr` → `Writeup` before `PR`, targets `docs/changes/` + both skills;
  `--no-writeup` suppresses it.
- **Runtime purity:** balanced + writeup scripts mock-run clean — no conductor-layer
  fs/clock/ReferenceError.
- **gitignore:** `git check-ignore` confirms the artifacts are tracked; `.workflows/`/scratch stay ignored.

Regression net `test-scaffold.cjs`: **16 combos + 17 eval assertions green**, and it now includes a
conductor-purity string-scan (ported from prospector; negative-tested to catch an injected leak).

## Adversarial verification (multi-agent workflow)

Ran a 6-agent adversarial review (each agent attacking a distinct risk dimension, ~308k tokens).
Result: **0 critical, 0 high, 2 medium, 1 low** — the three core dimensions (backward-compat,
model-mode, writeup-wiring) came back **clean**. All 3 findings **fixed** (commit `740ed5d`):
- [med] Writeup's diagram validation hardcoded an in-repo `validate.mjs` path → now delegates to the
  flowchart skill (portable to any target repo).
- [med] README `--profile lite` phase-order example was stale (missing Writeup) → updated.
- [low] missing conductor-purity scan in the test net → ported + added.

## How to review

```bash
git diff main..improve/conductor                 # 11 files, +1043 / −30
open docs/changes/conductor-improvements/writeup.html   # this change, explained (offline)
open docs/changes/conductor-improvements/design.html    # the delivery pipeline diagram (needs internet for Mermaid)
node plugins/lirbox/skills/conductor/scripts/test-scaffold.cjs   # 16 combos + 17 evals
```

The `docs/changes/conductor-improvements/` artifacts are this PR's **own Writeup-phase output**,
hand-run to dogfood the feature and prove the gitignore carve-out tracks them.

## Commits (on `improve/conductor`)
- `68df38a` design spec
- `ff3f017` feat: model-mode + Writeup (generator + test + gitignore)
- `ac06fb4` docs: SKILL/README/delivery-phases/CLAUDE
- `b6b23d5` dogfood writeup + design + notes
- `740ed5d` fix: address the 3 verification findings

## To merge (your call — non-destructive default)
```bash
git checkout main && git merge improve/conductor
```
Nothing was pushed or merged. `main` is byte-unchanged.

## Not done (out of scope / follow-ups)
- Multi-diagram output (flowchart **and** sequence): v1 emits one diagram, worker picks the type.
- A live conductor run exercising the Writeup phase end-to-end (the skill invocation is a runtime
  behavior; the eval net only asserts the prompt wiring).
