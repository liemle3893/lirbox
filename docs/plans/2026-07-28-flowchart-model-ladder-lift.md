# Flowchart Model-Ladder Lift — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Use sonnet-5's passing Harbor artifact as the reference to find and fix the *skill* defects costing haiku-4.5 and gemma4:e2b-mlx points on `flowchart__ci-pipeline` — filing them as whetstone items so the fix lands eval-gated, never as a hand-edit. Separates skill defects (fixable by wording) from capability defects (not), so `SKILL.md` does not accrete text that helps nothing.

**Architecture:** Harbor is the *measurement* instrument (containerised, per-model, 6-key reward); whetstone is the *improvement* loop (RED→GREEN, floor-gated, surface-locked, PR at the end). They do not overlap: Harbor produces the evidence and re-verifies the lift, whetstone owns every edit to `plugins/lirbox/skills/flowchart/SKILL.md`. Precedent: `plan-deck.jsonl`'s `wire-output-validator-into-verify` filed this exact defect class ("step 5 lists only manual eyeball checks and invokes nothing runnable") for a sibling skill.

**Tech Stack:** `harbor` 0.20.0 (`-e docker`), `lirbox:whetstone`, `feedback/flowchart.jsonl` (repo-root backlog, 6 lines, append-only), flowchart `evals/{floor,checks,fixtures}`.

## Global Constraints

- **Do NOT hand-edit `plugins/lirbox/skills/flowchart/SKILL.md`** — every change flows through `feedback/flowchart.jsonl` → whetstone. This plan's only repo writes are backlog appends and this file.
- The backlog is at repo root: `feedback/flowchart.jsonl`. (`plugins/lirbox/skills/feedback/` is the *feedback skill*, not a backlog.) One JSON object per line, append-only, newline-terminated; do not touch existing lines.
- Existing ids — do not duplicate: `node-nonascii`, `floor-breaker`, `prettier`, `pan-zoom-fullscreen`, `harvest-03-edge-dashlabel-nonascii`, `harvest-04-round-node-special`.
- **Hold tools constant across all three arms.** The same `--ak disallowed_tools=…` on every model, including the big-window ones. Trimming only e2b would vary two things at once and make the ladder uninterpretable.
- Never commit runtime artifacts (`jobs/`, `.workflows/`, `.worktrees/`, `.improve/`). `.harbor/tasks` is tracked but derived — never hand-edit; the `Harbor tasks in sync` CI step rebuilds and fails on drift.
- Commit identity enforced by `.githooks/pre-commit` (author `liemle3893 <33980597+liemle3893@users.noreply.github.com>`). `main` is pull-request-only.
- Credentials live in gitignored `.env` (`CLAUDE_CODE_OAUTH_TOKEN`). Source it; never echo it, never let it reach a log or a commit.

## Success Criteria — fixed now, before any edit

| Model | Target | Attempts |
|---|---|---|
| sonnet-5 | stays `reward: 1` — **no regression** | `-k 3` |
| haiku-4.5 | `partial: 4 → 5`, `reward: 0 → 1` | `-k 3`, consecutive |
| gemma4:e2b-mlx | `output_exists: 0 → 1` **only** | `-k 3` |
| flowchart floor | green | every whetstone iteration |

e2b's target is deliberately not `reward: 1`. It is failing *engagement*, not quality; a 2B-class model at 32K producing a validator-clean interactive artifact is not a claim this plan makes.

---

### Task 1: Collect the reference evidence

n=1 is below the ~20pp MDE this repo already declared for its 7-cell suite. Nothing downstream is decidable from single trials, and sonnet's passing artifact does not currently exist anywhere on disk — it was run outside Claude Code and is in no transcript.

**Files:** none (produces `jobs/`, gitignored)

- [ ] Source credentials without echoing: `set -a; . ./.env; set +a`
- [ ] Run sonnet-5, `-k 3`, tools held constant:
  ```bash
  harbor run -p .harbor/tasks/flowchart__ci-pipeline \
    -a claude-code -m claude-sonnet-5 --skill .harbor/skills -k 3 \
    --ae CLAUDE_FORCE_OAUTH=1 --ae CLAUDE_CODE_OAUTH_TOKEN="$CLAUDE_CODE_OAUTH_TOKEN" \
    --ak disallowed_tools="Task,Workflow,TodoWrite,Glob,Grep,CronCreate,CronDelete,CronList,EnterWorktree,ExitWorktree,NotebookEdit,ReportFindings,ScheduleWakeup,SendMessage,TaskCreate,TaskGet,TaskList,TaskOutput,TaskStop,TaskUpdate,ToolSearch,WebFetch,WebSearch" \
    -e docker -y
  ```
- [ ] Same for `-m claude-haiku-4-5-20251001`
- [ ] Same for e2b (endpoint form, no OAuth):
  ```bash
  harbor run -p .harbor/tasks/flowchart__ci-pipeline \
    -a claude-code -m gemma4:e2b-mlx --skill .harbor/skills -k 3 \
    --ae ANTHROPIC_BASE_URL=http://100.84.254.2:11434 \
    --ae ANTHROPIC_AUTH_TOKEN=ollama \
    --ae CLAUDE_CODE_AUTO_COMPACT_WINDOW=26000 \
    --ae CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=85 \
    --ak disallowed_tools="Task,Workflow,TodoWrite,Glob,Grep,CronCreate,CronDelete,CronList,EnterWorktree,ExitWorktree,NotebookEdit,ReportFindings,ScheduleWakeup,SendMessage,TaskCreate,TaskGet,TaskList,TaskOutput,TaskStop,TaskUpdate,ToolSearch,WebFetch,WebSearch" \
    -e docker -y
  ```
- [ ] Archive each trial's `out.html`, `agent/` and `verifier/` outside `jobs/` before the next run — verified: `jobs/` currently holds exactly one trial dir, so runs are not self-preserving.

**Verify:** three model arms × 3 attempts, each with a readable `reward.json` and a retained `out.html` for at least one passing sonnet attempt.

---

### Task 2: Classify each lost criterion

**Files:** none (analysis)

- [ ] For every criterion scoring 0, diff the failing `out.html` against sonnet's passing one **on that criterion alone** (e.g. `no_template_markers` is a literal grep for `{{` / `TEMPLATE-GRAPH` / `TEMPLATE-STEPS`).
- [ ] Read the losing arm's `agent/` trajectory for the divergence: did it read `assets/template.html`? load `references/components.md`? emit once and stop, or attempt self-checking?
- [ ] Label each finding **skill defect** (instruction missing/buried/ambiguous — fixable, usually free for sonnet) or **capability defect** (could not hold template + output at once — not fixable by wording).
- [ ] Discard capability defects. They are findings for the capability-floor record, not backlog items.

**Verify:** each zeroed criterion carries a label and a one-line justification citing the diff or trajectory line that produced it.

**Prior from the recorded data** (all transcript runs scored `reward: 0`; best was `partial: 4`): `validator_passes: 0` and `no_template_markers: 0` are very likely skill defects — plan-deck's filed concern says the identical thing about a sibling skill. `single_crit_node: 0` in every recorded run points at instruction placement, not capability.

---

### Task 3: File the confirmed skill defects

**Files:** Modify `feedback/flowchart.jsonl` (append one line per confirmed defect)

- [ ] Append one object per confirmed skill defect, schema `{id, type, text, suggestedCriterion, acceptanceCheck}` matching existing entries. `text` states Expected / Actual.
- [ ] Lead candidate (no existing id collides):
  ```
  id: wire-output-validator-into-verify
  Expected: SKILL.md instructs running assets/validate.mjs on the generated HTML
            before finishing, so a failed Mermaid parse or a leftover {{marker}}
            is caught and repaired rather than shipped.
  Actual:   the verify step lists eyeball checks only; every recorded Harbor run
            scored validator_passes: 0.
  ```
- [ ] **Prove every `acceptanceCheck` is RED against current `SKILL.md` before the whetstone run.** A check that is already green fixes nothing and will be kept spuriously.
- [ ] Confirm each line is valid JSON and the file still parses line-by-line.

**Verify:** `python3 -c "import json;[json.loads(l) for l in open('feedback/flowchart.jsonl') if l.strip()]"` exits 0; each new check exits non-zero on the unmodified skill.

---

### Task 4: Run whetstone

**Files:** whetstone owns all writes to `plugins/lirbox/skills/flowchart/SKILL.md`

- [ ] Invoke `lirbox:whetstone` on `flowchart`. Editable surface = the skill MINUS `evals/` and the backlog.
- [ ] Keep only on floor-green AND the item's frozen check green AND surface-lock intact; revert otherwise.
- [ ] Let it finish on its own branch and open its PR. Do not merge.

**Verify:** `node scripts/evals-all.mjs --fast` green; each kept item's check flipped RED→GREEN; the run report lists kept/unresolved.

---

### Task 5: Re-verify the lift

**Files:** none

- [ ] Re-run all three arms from Task 1 against the whetstone branch, `-k 3`, same tool set.
- [ ] Check against the Success Criteria table. Any unmet row loops back to Task 2.
- [ ] Record the outcome — including a null result — in the PR body. A fix that did not move the number is a finding, not a failure to hide.

**Verify:** sonnet unregressed, haiku at target across 3 consecutive attempts, e2b's `output_exists` recorded either way.

---

## Expected outcome, stated honestly

The self-validate loop is the highest-value single change and should lift haiku. **It will probably not lift e2b** — generate→validate→repair costs *more* context, and e2b's problem is having none to spare: ~16–18K of its 32K is consumed before it writes a byte (tool schemas ~9–11K, `SKILL.md` ~933, `references/components.md` ~1.6K, `assets/template.html` ~4.2K), and it must then emit ~5–8K of exact HTML.

If e2b stays at `output_exists: 0` after Task 5, that is the capability floor, and the only remaining lever is a minimal-skeleton path that skips the template read entirely. **That is a separate decision and explicitly out of scope here** — it would change the skill's output contract, not just its wording.
