# Flowchart Model-Ladder Lift — Implementation Plan

> ## STATUS: NOT PURSUED — decided 2026-07-28, before Task 1 ran
>
> **Do not execute this plan.** It is kept for the reasoning, not the steps. Task 0 (e2b) is the
> only part that ran; its finding is real and stands.
>
> **Why it was stopped.** The plan's own controls shrank it to nothing. Sealing `escaping-hostile`
> as a held-out task — required, or you tune and validate on the same cell and the green number
> means nothing — leaves flowchart with exactly **one** discovery cell. The outcome space was
> "sonnet saturates, learn nothing actionable" or "haiku gains a point on one task," and neither
> changes a decision.
>
> **The general lesson: flowchart was the wrong skill to pilot Harbor on, *because* it is the
> best-instrumented skill in the repo.** It already has 5 train / 4 val scored tasks, a held-out
> `run-scored.mjs`, a green floor, and a cookbook flow verified against a real run. Harbor's
> marginal value is highest where the local loop is *weakest*; here the local loop was already the
> strongest thing available, so Harbor added a slow behavioural layer on top of a fast one that
> worked.
>
> **When to revisit Harbor:** a skill with **no local scored surface** — nothing to hill-climb
> against, so Harbor is the only instrument — or when cross-model capability-floor data is wanted
> deliberately. Neither described flowchart.
>
> **What was banked anyway** (all independent of this plan, all landed):
> - the `.harbor/tasks` drift gate — a tracked-but-derived mirror left unguarded when `13fae03`
>   deleted the previous check;
> - five stale doc references pointing at the deleted `harbor-port.mjs`;
> - the e2b capability-floor finding in Task 0 below;
> - the paired-matrix rule (every model arm runs ± the skill; report the lift, never the raw
>   score) — cheap to hold, and the one thing `arena` structurally cannot express.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish whether `flowchart`'s `SKILL.md` measurably lifts a model on `flowchart__ci-pipeline`, and if so fix the *skill* defects costing weaker models points — filing them as whetstone items so the fix lands eval-gated, never as a hand-edit.

**Architecture:** Harbor is the *measurement* instrument (containerised, per-model, paired with/without skill); whetstone is the *improvement* loop (RED→GREEN, floor-gated, surface-locked, PR at the end). They do not overlap: Harbor produces the evidence and re-verifies the lift, whetstone owns every edit to `plugins/lirbox/skills/flowchart/SKILL.md`.

**Tech Stack:** `harbor` 0.20.0 (`-e docker`), `lirbox:whetstone`, `feedback/flowchart.jsonl` (repo-root backlog, 6 lines, append-only), flowchart `evals/{floor,checks,fixtures}`.

## Global Constraints

- **THE MATRIX IS ALWAYS PAIRED: every model runs `{with skill} × {without skill}`.** An absolute score is not admissible evidence — a model may pass without the skill entirely. The measured quantity is the **lift** (with-skill − no-skill), never the raw number. The no-skill arm is identical except that `--skill .harbor/skills` is dropped.
- **Do NOT hand-edit `plugins/lirbox/skills/flowchart/SKILL.md`** — every change flows through `feedback/flowchart.jsonl` → whetstone. This plan's only repo writes are backlog appends and this file.
- The backlog is at repo root: `feedback/flowchart.jsonl`. (`plugins/lirbox/skills/feedback/` is the *feedback skill*, not a backlog.) One JSON object per line, append-only, newline-terminated; do not touch existing lines.
- Existing ids — do not duplicate: `node-nonascii`, `floor-breaker`, `prettier`, `pan-zoom-fullscreen`, `harvest-03-edge-dashlabel-nonascii`, `harvest-04-round-node-special`.
- **Hold everything except the skill constant.** Same `--ak disallowed_tools=…` on every arm including big-window models; same `-k`; same task. Varying two things at once makes the lift uninterpretable.
- **Do not touch `plugins/lirbox/skills/flowchart/harbor/`** mid-ladder. Changing the task or its harness breaks comparability with arms already run.
- Never commit runtime artifacts (`jobs/`, `.workflows/`, `.worktrees/`, `.improve/`). `.harbor/tasks` is tracked but derived — never hand-edit; the `Harbor tasks in sync` CI step rebuilds and fails on drift.
- Commit identity enforced by `.githooks/pre-commit` (author `liemle3893 <33980597+liemle3893@users.noreply.github.com>`). `main` is pull-request-only.
- Credentials live in gitignored `.env` (`CLAUDE_CODE_OAUTH_TOKEN`). Source it; never echo it, never let it reach a log or a commit.
- **`total_cost_usd` is fictional on the Ollama endpoint** — a LiteLLM estimate. The e2b run reported `$33.35` for a local model. This Harbor version emits no `cost_source` tag, so the filter CONTRIBUTING prescribes will not catch it automatically. Never let it reach a scorecard.

## Success Criteria — fixed now, before any edit

Measured as **lift**, `-k 3` on every cell:

| Model | no-skill (control) | with-skill | Gate |
|---|---|---|---|
| sonnet-5 | must be **< 5/5** | 5/5 | lift > 0, else task is inadmissible (see Task 1) |
| haiku-4.5 | record | `partial: 4 → 5`, `reward: 0 → 1` | lift > 0 after whetstone |
| gemma4:e2b-mlx | — | — | **dropped from the ladder** (Task 0) |
| flowchart floor | — | — | green every whetstone iteration |

---

### Task 0: e2b — closed, capability floor recorded

**Status: DONE. Finding, not a defect. No action.**

The `-k 1` run (`jobs/2026-07-28__03-29-28`) failed all five criteria with **0 exceptions**. The trajectory settles the cause:

| Evidence | Value |
|---|---|
| Tools available | `["Bash","Edit","Read","Skill","Write"]` — trim worked |
| Skills injected | 15, pruned, no eval material leaked |
| `Skill` calls | **176, byte-identical args** |
| `Write` / `Edit` / `Read` / `Bash` calls | **0** |
| Turns / duration | 355 / 802s |
| Input tokens | 6,410,921 for 42,070 output |

The skill body **was** delivered (one user event carries the full `SKILL.md`), and the model knew the target — it embedded *"Output this flowchart to /app/out.html"* in its own args all 176 times. It never called `Write`. `Skill` returns the terse acknowledgement `"Launching skill: flowchart"` with content arriving in the *following* message; the model read that as failure and retried until it concluded the tool was broken. Its first move was calling a nonexistent tool named `flowchart` (`No such tool available`).

**Classified capability defect → discarded.** No `SKILL.md` wording fixes a model that receives correct instructions, knows the path, has `Write`, and never calls it.

- [x] Record as a capability-floor datapoint: flowchart is not drivable by gemma4:e2b-mlx at 32K.
- [ ] Do **not** file a whetstone item for it.
- [ ] Do **not** pursue a "minimal skeleton" path. The earlier hypothesis — that e2b would fail on the 4.2K-token template read — is **disproved**: it never read the template. Failure is at turn 2, not the context ceiling.

---

### Task 1: Null-skill control — the admissibility fork

The reference model saturating the task would make it a regression guard, not an improvement instrument. Nothing downstream is worth running until this is known.

**Files:** none (produces `jobs/`, gitignored)

- [ ] Source credentials without echoing: `set -a; . ./.env; set +a`
- [ ] Sonnet-5 **without** the skill, `-k 3`:
  ```bash
  harbor run -p .harbor/tasks/flowchart__ci-pipeline \
    -a claude-code -m claude-sonnet-5 -k 3 \
    --ae CLAUDE_FORCE_OAUTH=1 --ae CLAUDE_CODE_OAUTH_TOKEN="$CLAUDE_CODE_OAUTH_TOKEN" \
    --ak disallowed_tools="Task,Workflow,TodoWrite,Glob,Grep,CronCreate,CronDelete,CronList,EnterWorktree,ExitWorktree,NotebookEdit,ReportFindings,ScheduleWakeup,SendMessage,TaskCreate,TaskGet,TaskList,TaskOutput,TaskStop,TaskUpdate,ToolSearch,WebFetch,WebSearch" \
    -e docker -y
  ```
- [ ] Sonnet-5 **with** the skill: identical, plus `--skill .harbor/skills`.
- [ ] Archive both arms' `out.html`, `agent/` and `verifier/` outside `jobs/` — verified: `jobs/` does not preserve prior trials.

**Fork on the control result:**

| Sonnet no-skill | Meaning | Action |
|---|---|---|
| also 5/5 | task measures the model, not the skill | **STOP.** Drop `ci-pipeline` from the ladder; keep it as a regression guard. Go to Task 1b. |
| 2–3/5 | skill carries real weight; task discriminates | proceed to Task 2 |
| 0/5 | task is skill-gated end to end | proceed to Task 2 |

**Verify:** both sonnet arms complete at `-k 3` with retained artifacts; the lift is computed and the fork resolved in writing.

---

### Task 1b: Only if the control saturates — find a discriminating task

**Files:** none (analysis); may add a task under `plugins/lirbox/skills/flowchart/harbor/tasks/`

- [ ] Run the same paired matrix on `flowchart__escaping-hostile`. Its name suggests it targets the label-escaping failure mode `validate.mjs` exists to catch — **unverified**; read the task before assuming.
- [ ] If that also saturates, the ladder needs a harder task before any skill work is measurable. Authoring one is a separate decision, out of scope here.

---

### Task 2: Haiku paired arms

**Files:** none

- [ ] Haiku-4.5 no-skill and with-skill, `-k 3` each, same flags as Task 1.
- [ ] Compute the lift. A with-skill score that does not beat its own control is not evidence the skill helped, whatever its absolute value.

**Verify:** four sonnet cells + two haiku cells recorded, each with a lift figure.

---

### Task 3: Classify each lost criterion

**Files:** none (analysis)

- [ ] For every criterion haiku loses that sonnet-with-skill wins, diff the two `out.html` files **on that criterion alone** (e.g. `no_template_markers` is a literal grep for `{{` / `TEMPLATE-GRAPH` / `TEMPLATE-STEPS`).
- [ ] Read the losing trajectory for the divergence: did it read `assets/template.html`? load `references/components.md`? emit once and stop, or attempt self-checking?
- [ ] Label **skill defect** (instruction missing/buried/ambiguous — fixable) or **capability defect** (not fixable by wording — discard, record as floor).

**Verify:** each zeroed criterion carries a label and a one-line justification citing the diff or trajectory line that produced it.

**Prior:** `validator_passes: 0` and `no_template_markers: 0` look like skill defects — `feedback/plan-deck.jsonl`'s `wire-output-validator-into-verify` filed the identical complaint against a sibling skill ("step 5 lists only manual eyeball checks and invokes nothing runnable").

---

### Task 4: File the confirmed skill defects

**Files:** Modify `feedback/flowchart.jsonl` (append one line per confirmed defect)

- [ ] Append one object per confirmed skill defect, schema `{id, type, text, suggestedCriterion, acceptanceCheck}` matching existing entries. `text` states Expected / Actual.
- [ ] Lead candidate (no id collision):
  ```
  id: wire-output-validator-into-verify
  Expected: SKILL.md instructs running assets/validate.mjs on the generated HTML
            before finishing, so a failed Mermaid parse or a leftover {{marker}}
            is caught and repaired rather than shipped.
  Actual:   the verify step lists eyeball checks only; every recorded Harbor run
            scored validator_passes: 0.
  ```
- [ ] **Prove every `acceptanceCheck` is RED against current `SKILL.md` before the whetstone run.** A check already green fixes nothing and will be kept spuriously.

**Verify:** `python3 -c "import json;[json.loads(l) for l in open('feedback/flowchart.jsonl') if l.strip()]"` exits 0; each new check exits non-zero on the unmodified skill.

---

### Task 5: Run whetstone

**Files:** whetstone owns all writes to `plugins/lirbox/skills/flowchart/SKILL.md`

- [ ] Invoke `lirbox:whetstone` on `flowchart`. Editable surface = the skill MINUS `evals/` and the backlog.
- [ ] Keep only on floor-green AND the item's frozen check green AND surface-lock intact; revert otherwise.
- [ ] Let it finish on its own branch and open its PR. Do not merge.

**Verify:** `node scripts/evals-all.mjs --fast` green; each kept item's check flipped RED→GREEN.

---

### Task 6: Re-verify the lift

**Files:** none

- [ ] Re-run the **full paired matrix** (sonnet ± skill, haiku ± skill) against the whetstone branch, `-k 3`, same flags.
- [ ] Check against the Success Criteria table. Any unmet row loops back to Task 3.
- [ ] Record the outcome — including a null result — in the PR body. A fix that did not move the lift is a finding, not a failure to hide.

**Verify:** sonnet's lift unregressed, haiku's lift positive and reaching target across 3 attempts.

---

## What this plan can and cannot conclude

It can establish whether `flowchart`'s `SKILL.md` lifts sonnet and haiku on one task, and fix instruction-level defects that cost haiku points.

It cannot establish that flowchart is *good* — one task, two models, `-k 3`. This repo's own arena work puts the minimum detectable effect at ~20pp on a 7-cell suite; a single task at `-k 3` is weaker still. Treat a positive lift as directional, not as a scorecard.

And it says nothing about models below the capability floor. e2b's failure was not about instructions, context, or template size — it never called `Write`. That is a property of the model, and no skill change reaches it.
