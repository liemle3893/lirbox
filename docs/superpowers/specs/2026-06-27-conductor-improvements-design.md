# Conductor improvements — design

**Date:** 2026-06-27
**Branch:** `improve/conductor`
**Status:** approved (user delegated open decisions; see §Decisions)

Three improvements to the `conductor` skill, all delivered as **surgical changes to the
generator** (`scaffold-workflow.cjs`) + its regression net + docs + `.gitignore`. No whetstone
loop, no hand-edited generated scripts. `main` is never touched; review on `improve/conductor`.

## Motivation (the three asks)

1. **Implementation-notes are written then always discarded.** Workers drop judgment-gated
   `implementation-notes/<slot>.html` in the worktree; DocsGate folds their *decisions* into a
   markdown summary, and the HTML itself is gitignored and dropped. The rich per-worker notes
   never reach the reviewer. → **Keep them; ride them into the PR.**
2. **Delivery PRs carry no reviewer-facing writeup or design visualization.** The PR phase just
   `git push` + `gh pr create` with a TODO body. → **Every delivery PR gets a pr-writeup HTML
   and a design diagram (flowchart/sequence), committed so they ride the PR.**
3. **No model selection.** The generator never emits `agent()` `model:` opts, so every worker
   runs on the session model. → **Add a `--model-mode`: `default` (today's behavior) and
   `balanced` (cheap model for mechanical work, strong model for thinking).**

## Decisions (user-delegated)

- **(a) DocsGate `summary.md` moves into the per-run dir** `docs/changes/<name>/summary.md`
  (was `docs/changes/<name>.md`) so a run's artifacts group in one directory.
- **(b) Thinking tier defaults to `opus`**, overridable to `fable` via `--model-think`.
- **(artifacts) Committed under `docs/`** — artifacts land in `docs/changes/<name>/` and are
  committed to the branch (ride the PR diff), which requires a `.gitignore` carve-out.
- **(balanced work model)** the Work phases are the *advisor's* call: in `default` mode they
  inherit the session model (no opt emitted); in `balanced` mode they default to `sonnet`,
  overridable via `--model-work`.

## 1. Artifacts ride the PR (asks 1 + 2)

### A new `Writeup` phase

A new generator-emitted phase, placed **after `DocsGate`, before `PR`**. It is a single worker
(`agent()` call) that, inside the shared worktree:

1. **Promotes** the worktree's `implementation-notes/*.html` into
   `docs/changes/<name>/notes/` (copy, not move-and-lose) — ask 1.
2. **Generates `docs/changes/<name>/writeup.html`** by invoking the sibling `lirbox:pr-writeup`
   skill (by name, via the Skill tool) over the branch diff — ask 2a. Graceful fallback if the
   Skill tool is unavailable: read the skill's `SKILL.md` + `assets/template.html` and follow it.
3. **Generates `docs/changes/<name>/design.html`** by invoking `lirbox:flowchart`, choosing the
   Mermaid diagram type (flowchart **or** sequence) that best fits the change, then validates it
   with the skill's `assets/validate.mjs` — ask 2b.
4. **Commits** everything under `docs/changes/<name>/` on the branch.

Returns `{ written, writeupPath, designPath, notesPreserved }`.

### Wiring

- **Flag `--writeup` / `--no-writeup`.** `Writeup` defaults **ON whenever a `PR` phase exists**
  (honors "every PR"); `--no-writeup` opts out; `--writeup` forces it on even without `--pr`.
  Included transitively by `--profile delivery` and `--profile lite` (both imply `--pr`).
- **PR phase** body updated: when a writeup exists, link the `docs/changes/<name>/` artifacts in
  the PR body instead of a bare TODO.
- **DocsGate** body updated: write to `docs/changes/<name>/summary.md` (decision a).

### Portability

`conductor` runs on *any* repo, but `pr-writeup`/`flowchart` live in the **lirbox plugin**, not
the target repo. The Writeup worker therefore invokes them **by skill name** (`lirbox:pr-writeup`,
`lirbox:flowchart`) — portable wherever the plugin is installed (which it is, since `conductor`
itself is a lirbox skill). The fallback path (read the skill files) only applies if the worker
lacks the Skill tool.

### `.gitignore` + CLAUDE.md

`.gitignore` currently kills `*-writeup.html`, `*-flowchart.html`, and `implementation-notes/` by
filename-glob. The chosen artifact names (`writeup.html`, `design.html`, `notes/*.html`) don't
match those globs, but to be robust we add an explicit un-ignore **after** the globs:

```gitignore
# Conductor delivery artifacts under docs/changes/<name>/ ARE tracked (they ride the PR).
!docs/changes/
!docs/changes/**
```

CLAUDE.md's "runtime artifacts are gitignored" section is updated: worktree
`implementation-notes/` stays build-scratch, but the conductor **promotes** kept notes into the
committed `docs/changes/<name>/` (alongside `writeup.html`, `design.html`, `summary.md`), which
DO ride the PR.

## 2. `--model-mode` (ask 3)

New flags on the generator:

- `--model-mode <default|balanced>` — default `default`.
- `--model-think <opus|fable|sonnet|haiku>` — thinking-tier model, default `opus`.
- `--model-work <sonnet|opus|fable|haiku>` — work-tier model in balanced, default `sonnet`.

Behavior:

- **`default`** — emits **zero** `model:` opts. Output is **byte-identical** to today's
  generator for every existing flag combo (the backward-compat invariant; the eval gate below
  proves it). Workers inherit the session model.
- **`balanced`** — each emitted `agent()` call gets a `model:` opt by **phase class**:

| Class | Model (default) | Phases |
|---|---|---|
| mechanical | `haiku` | Setup, **every checkpoint**, Verify, ReVerify, PR, TicketUpdate |
| think | `opus` (`--model-think`) | Brief, RED, PathGap, CodeGate, Review, TestGate, DocsGate, **Writeup** |
| work | `sonnet` (`--model-work`) | the `--phases` work phases |

`model:` values are the Workflow `agent()` enum (`sonnet`/`opus`/`haiku`/`fable`). Invalid flag
values are rejected at generation time.

Implementation: a `mdl(class)` helper (mirrors the existing `at(agent)` helper) returns
`model: '<m>',` in balanced mode or `''` otherwise; each phase descriptor's `build()` passes
`mdl('<class>')` to its emitter; Setup + checkpoint (template tail) use the mechanical frag.

## 3. Scope guard (what this is NOT)

- No effort tuning, no per-phase CLI model map (user chose tier-by-phase → YAGNI).
- No new diagram skill; sequence diagrams come free from Mermaid via `lirbox:flowchart`.
- v1 = exactly one design diagram per PR (worker picks the type), not flowchart+sequence both.
- No auto-merge; artifacts commit to the `wf/<name>` branch only. Non-destructive default holds.

## 4. Eval & compare (the gate)

The whetstone-style verdict, made deterministic:

1. **Backward-compat (the load-bearing eval):** generate the full flag matrix from the
   **pre-change** generator (`git show`) and the **post-change** generator in `default` mode;
   `diff` MUST be empty. Any non-empty diff fails the change.
2. **Balanced delta:** generate the matrix with `--model-mode balanced` and assert the correct
   `model:` tier on each phase class; `--model-think fable` flips think phases to `fable`.
3. **Writeup wiring:** a `--pr` run emits a `Writeup` phase before `PR`, whose prompt references
   `docs/changes/`, `lirbox:pr-writeup`, and `lirbox:flowchart`; `--no-writeup` suppresses it.
4. **Purity + syntax:** every emitted script (across model/writeup combos) `node --check`s clean
   and contains no `fs`/`git`/`Date.now()`/`Math.random()`/`meta.` in the conductor layer.
5. **gitignore:** `git check-ignore` confirms `docs/changes/x/{writeup,design}.html` and
   `docs/changes/x/notes/n.html` are **tracked**, while `.workflows/`, `implementation-notes/`
   stay ignored.

`scripts/test-scaffold.cjs` is extended to assert 1–4 as part of the regression net.

## 5. Files touched

| File | Change |
|---|---|
| `plugins/lirbox/skills/conductor/scripts/scaffold-workflow.cjs` | model-mode flags + `mdl()` + per-phase class; `Writeup` descriptor; DocsGate path; PR body |
| `plugins/lirbox/skills/conductor/scripts/test-scaffold.cjs` | eval/compare assertions (default byte-identity, balanced tiers, writeup wiring) |
| `plugins/lirbox/skills/conductor/SKILL.md` | document `--model-mode`/`--model-think`/`--model-work`, `--writeup`; notes-promotion |
| `plugins/lirbox/skills/conductor/README.md` | flag list + phase order + model tiers |
| `plugins/lirbox/skills/conductor/references/delivery-phases.md` | Writeup phase section; PR-body linking |
| `.gitignore` | un-ignore `docs/changes/**` |
| `CLAUDE.md` | artifacts-under-docs/changes exception to the gitignore rule |
| `docs/changes/conductor-improvements/` | **dogfood**: this change's own writeup.html + design.html |
