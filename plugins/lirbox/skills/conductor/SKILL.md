---
name: conductor
argument-hint: "[ <goal to start> | <name to resume> | list ]"
description: "This skill should be used when running a multi-step, multi-subagent Workflow that must survive session restarts, resume after interruption or crash, or leave an inspectable on-disk JSON state trail. It drives the Workflow tool (deterministic JS conductor plus native subagent fan-out) and adds durable local state written by a checkpoint subagent after each phase, plus an args-based resume protocol. Use for long or interruptible runs (large migrations, audits, staged delivery, anything that may span sessions) where the Workflow tool's built-in same-session-only resume is insufficient. Do NOT use for quick one-shot workflows; call the Workflow tool directly instead."
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Workflow
  - AskUserQuestion
---

$ARGUMENTS

# Conductor

## Purpose

The Workflow tool gives deterministic, JS-authored, massively-parallel subagent orchestration — but
its state is in-memory and resume is **same-session only**. This skill adds the missing half: a
**durable JSON state file** written by a worker after every phase, and a **resume protocol** that
restarts an interrupted run from disk across sessions — keeping the tool's determinism while adding
durable + resumable + inspectable state, in portable JS.

## When to use

Use only when ALL hold: multi-step and dispatches subagents; long/interruptible or may span
sessions where losing progress is costly; and a durable, inspectable on-disk record is wanted. For a
quick one-shot fan-out, call the Workflow tool directly — the checkpoint overhead only pays off when
durability matters.

## Arguments

`$ARGUMENTS` (top of this file) is a SINGLE free-text field — no separators, no flags. Resolve it:

1. **empty or `list`** → **list mode**: run `list-workflows.cjs` (`--all` for completed), show the table, launch nothing.
2. **matches `.workflows/state/<arg>.json`** → **resume** that workflow.
3. **a tracker ticket** (Jira key `ISS-101`, or Jira/Linear URL) → **ticket-sourced run**: set `args.ticket`, derive `<name>` from the key (`ISS-101` → `iss-101`), first phase fetches the goal (see `references/delivery-phases.md` §A).
4. **anything else** → a **new goal**: derive a kebab `<name>` slug, tell the user, start fresh.

`<name>` drives everything — state `.workflows/state/<name>.json`, branch `wf/<name>`, worktree
`.worktrees/<name>`, resume key; the goal (and `ticket`) is saved in `state.json`, so resume needs
only the name. **Delivery is opt-in** — this harness is generic (no PRs/tickets by default); add the
PR / ticket-update phases from `references/delivery-phases.md` for a delivery, and never auto-merge.
On resume the conductor reads `args = { phasesDone, results }`; the worktree branches fresh from
`origin/<default>` unless `args.base`/`args.branch` override — full protocol in
[`references/workflow-runtime.md`](references/workflow-runtime.md) §4.

Examples:
```
Replace console.log with context.log across src/      → starts; slug e.g. migrate-logging
migrate-logging                                       → resumes that run
list                                                  → shows in-progress workflows
```

## Core model (read `references/workflow-runtime.md` before authoring)

A Workflow has two layers — confusing them is the #1 source of bugs:
- **Conductor** = the workflow `.js` script. Restricted: pure JS, **no filesystem**, no git, no
  `Date.now()` / `Math.random()`; it only computes and dispatches. So durable state is written by a
  **checkpoint worker**, never by the conductor.
- **Workers** = the subagents it spawns. Full tools (`Read`/`Write`/`Edit`/`Bash`); they do all
  side-effects — creating the worktree, editing code, writing `state.json`.

**Isolation.** All edits happen in ONE shared worktree `.worktrees/<name>` on branch `wf/<name>`
(the main tree is untouched until the human merges); a **Setup** worker creates/reuses it, and
`state.json` stays in the **main repo** so it survives worktree removal. Do NOT pass per-agent
`isolation:'worktree'` to work phases. Two-layer rules, state schema, and shared-worktree details:
[`references/workflow-runtime.md`](references/workflow-runtime.md) — read before authoring.

## Procedure

### 1. Resolve `$ARGUMENTS` (list / resume / new)

Apply the Arguments resolution above. This skill runs in the main session, so read state directly
(`Read .workflows/state/<name>.json`):
- **empty or `list`** → run `node <skill-dir>/scripts/list-workflows.cjs` (`--all` for completed), show the table, stop.
- **`running`/`failed`** → **resume**: goal comes from the file; go straight to **step 4**. Don't regenerate the script if unchanged — only re-run the generator (`--force`) to change phase structure.
- **no file (a goal)** → **fresh run**: derive the kebab `<name>` slug, tell the user, run **triage (step 1b)**; if not declined, step 2 → step 3.
- **`complete`** → tell the user it's done (offer the report via `workflow-report.cjs <name>`); start fresh only if they meant a new run.

### 1b. Triage a new run — size it or decline (new goals only)

Before generating, classify the goal and pick ONE. Skip this for `list` and for `resume` (a
resume's profile is already fixed). Bias **down** — do not reach for a bigger profile than the
work earns:

- **decline** — trivial / one-shot / single-file; finishes in one pass and won't span sessions.
  Conductor is overkill: say so, do it inline or call the Workflow tool directly, and **STOP**.
  This applies **even if conductor was invoked explicitly** (e.g. `/lirbox:conductor <goal>` or
  by name) — explicit invocation selects the skill, it does not license skipping triage or
  jumping straight to scaffold/launch. Regardless of how directly conductor was called, when
  triage lands on decline you must still surface the cost/overkill caveat and offer to do the
  work inline **before** generating or launching anything.
- **bare** — multi-step but low-risk, no PR/ticket/gates → generator with just `--phases` (or
  the default single `Work`).
- **lite** — routine delivery, small/low-risk PR → `--profile lite`.
- **delivery** — substantial or risky: broad surface, migration, behavioral change, must not
  regress → `--profile delivery`.

Signals that push **up** a tier: spans sessions · losing progress is costly · many files
touched · behavioral/endpoint change · needs review/tests/docs/PR/ticket. With none present,
pick the lowest tier. When the signals are genuinely ambiguous, ask the user **one**
`AskUserQuestion` (decline / bare / lite / delivery) rather than guessing big.

### 2. Generate the conductor (pass prompts as data; do NOT hand-edit)

Generate the conductor deterministically from `scripts/scaffold-workflow.cjs` — never copy/author or
hand-edit it (that reintroduces drift). Pass the work-phase prompts as **DATA** (`--prompt` /
`--prompts-file`); to change structure or fill an empty prompt, re-run the generator with `--force`.
Size the workflow to the task's triage tier (bare / `--profile lite` / `--profile delivery`) — do
NOT default to the full profile.

```
node <skill-dir>/scripts/scaffold-workflow.cjs --name <name> --phases "Analyze,Implement" \
  --prompts-file <prompts.json> \
  [--ticket] [--pr] [--merge-gates] [--base <ref>] [--desc "..."]
```

→ **Full flag reference: [`references/generator-flags.md`](references/generator-flags.md)** — read
before generating. It documents every flag (phase/prompt/spec, the delivery flags, the gates, the
`--cycle` TDD ordering, the profiles), `--model-mode` model selection, gate-agent swapping, and the
`implementation-notes/` → `docs/changes/` promotion policy.

### 3. Launch (fresh)

First stamp `startedAt` at launch (so duration is true wall-clock; checkpoints preserve it):

```
node -e "const fs=require('fs');fs.mkdirSync('.workflows/state',{recursive:true});const f='.workflows/state/<name>.json';if(!fs.existsSync(f))fs.writeFileSync(f,JSON.stringify({workflow:'<name>',status:'running',startedAt:new Date().toISOString()},null,2))"
```

Then launch:

```
Workflow({ scriptPath: ".workflows/<name>.js" })
```

Each phase merges `state.json` via its checkpoint worker (preserving `startedAt`).

### 4. Launch (resume)

Pass the persisted progress so the conductor skips completed phases:

```
Workflow({ scriptPath: ".workflows/<name>.js",
           args: { phasesDone: <from state.json>, results: <from state.json> } })
```

Optimization: same-session, unchanged script, known prior `runId` → `Workflow({ scriptPath,
resumeFromRunId })` (replays cached results); otherwise always use the `args` path (works across
sessions and after edits to later phases).

### 5. Finalize

When the Workflow returns, stamp `status` + `finishedAt` (the conductor cannot — main session does
it). **If the Workflow threw** (a hard-fail gate), set `status: "failed"` not `complete` — the last
checkpoint's state is preserved, so a later `resume` re-runs only the failed gate onward:

```
# success
node -e "const f='.workflows/state/<name>.json';const s=JSON.parse(require('fs').readFileSync(f,'utf8'));s.status='complete';s.finishedAt=new Date().toISOString();require('fs').writeFileSync(f,JSON.stringify(s,null,2))"
# on Workflow error → status:failed (then report the throwing gate's message to the user)
node -e "const f='.workflows/state/<name>.json';const s=JSON.parse(require('fs').readFileSync(f,'utf8'));s.status='failed';s.finishedAt=new Date().toISOString();require('fs').writeFileSync(f,JSON.stringify(s,null,2))"
```

Then generate the run report (duration/tokens/cost):

```
node <skill-dir>/scripts/workflow-report.cjs <name>
```

Report to the user: the report summary (`.workflows/reports/<name>.md`), the final `results`, and
the **branch** (`wf/<name>`) + **worktree** (`.worktrees/<name>`) holding the committed work, to
review and merge. **Do NOT auto-merge or auto-remove the worktree** — the human's call
(non-destructive default; clean up after merge with `git worktree remove`). The state file + report
are the audit trail.

## Gotchas

- Every phase needs a skip-if-done guard, or resume re-runs completed work; phases are
  **at-least-once** and must be **idempotent**.
- `.filter(Boolean)` after `parallel()` — dead agents return `null`.
- Durable ≠ **unattended** — the Workflow tool needs a live session; it can't run headless/cron.

Full gotcha list (the `phasesDone` **contiguous**-prefix guard, checkpoint/isolation traps,
unattended-runner note) → [`references/workflow-runtime.md`](references/workflow-runtime.md) §6–§7.

## Bundled resources

- `scripts/scaffold-workflow.cjs` — **generates** the conductor from params (SoT for boilerplate). Step 2.
- `references/generator-flags.md` — full generator flag reference (step 2): every flag, `--model-mode`, agent-swapping, notes policy.
- `references/delivery-phases.md` — the optional `--ticket` / `--pr` phases and how to customize them (Jira/Linear/PR).
- `references/workflow-runtime.md` — conductor constraints, subagent capabilities, state schema, resume protocol, gotchas. Load before authoring.
- `scripts/list-workflows.cjs` — list workflows from `.workflows/state/` (`--all` includes completed). Step 1.
- `scripts/workflow-report.cjs` — duration/tokens/cost for one run → `.workflows/reports/<name>.md` (step 5; rates via `RATES_JSON`).
- `scripts/test-scaffold.cjs` — regression net: `node --check`s a flag/profile matrix, asserts emitted `phase()` order. Run after editing the generator.
