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
---

$ARGUMENTS

# Conductor

## Purpose

The Workflow tool gives deterministic, JS-authored, massively-parallel subagent
orchestration — but its state is in-memory and its resume is **same-session only**. This
skill adds the missing half: a **durable local JSON state file** written by a worker
subagent after every phase, and a **resume protocol** that restarts an interrupted run
from disk across sessions or machines. The result is deterministic (the Workflow tool's
strength) AND durable + resumable + inspectable (an external state machine's strength), in
portable JS.

## When to use

Use when ALL of these hold:
- The task is multi-step and dispatches subagents (otherwise just do the work directly).
- The run is long, interruptible, or may span sessions — and losing progress is costly.
- A durable, inspectable record of progress and results on disk is wanted.

Do NOT use for a quick one-shot fan-out — call the Workflow tool directly; the checkpoint
overhead only pays off when durability matters.

## Arguments

`$ARGUMENTS` (placed at the top of this file) is a SINGLE free-text field. Resolve it three
ways — no separators, no flags (the autoflow-deliver "one arg, auto-detect" model):

1. **empty or `list`** → **list mode**: run `node <skill-dir>/scripts/list-workflows.cjs`
   (add `--all` to include completed) and show the table. Launch nothing.
2. **matches an existing `.workflows/state/<arg>.json`** → **resume** that workflow.
3. **looks like a tracker ticket** (Jira key e.g. `ISS-101`, or a Jira/Linear URL) →
   **ticket-sourced new run**: set `args.ticket`, derive `<name>` from the key (`ISS-101` →
   `iss-101`), and let the flow's first phase fetch the ticket for the goal (see
   `references/delivery-phases.md` §A). Jira tools are available here; Linear only if a Linear
   MCP is connected.
4. **anything else** → a **new goal**: derive a short kebab `<name>` slug from it, tell the
   user the slug, and start fresh.

`<name>` (whether matched, derived from a ticket, or from a goal) drives everything: state
path `.workflows/state/<name>.json`, branch `wf/<name>`, worktree `.worktrees/<name>`, and is
the resume key. The goal (and `ticket`, if any) is saved in `state.json`, so resume needs only
the name.

**Delivery is opt-in, not built in.** This harness is generic — it does not create PRs or
update tickets by default. When a run is a delivery, add the paste-ready PR / ticket-update
phases from `references/delivery-phases.md` to the authored conductor. Non-destructive default
holds: open a PR, never auto-merge.

Workflow `args` the conductor reads (resume only):
```jsonc
{ "phasesDone": ["Setup","PhaseA"], "results": { } }   // both read from state.json
```
Worktree branches from the remote's default branch — `git fetch origin` first, then branch from
`origin/<default>` — so it's never built on a stale local ref. Only if the invocation explicitly
asks for a different base/branch, pass the conductor's optional `args.base` / `args.branch`.

Examples:
```
Replace console.log with context.log across src/      → starts; slug e.g. migrate-logging
migrate-logging                                       → resumes that run
list                                                  → shows in-progress workflows
```

## Core model (read `references/workflow-runtime.md` before authoring)

A Workflow has two layers. Confusing them is the #1 source of bugs:
- **Conductor** = the workflow `.js` script. Restricted: pure JS, **no filesystem**, no git,
  no `Date.now()` / `Math.random()`. It only computes and dispatches.
- **Workers** = the subagents it spawns. Full tools (`Read`/`Write`/`Edit`/`Bash`). They do
  all side-effects — including creating the worktree, editing code, and writing `state.json`.

Therefore durable state is written by a **checkpoint worker**, never by the conductor.

**Isolation (shared-worktree model).** All code edits happen inside ONE shared git worktree
at `.worktrees/<name>` on branch `wf/<name>` (override via `args.branch`). The main working
tree is never touched until the human merges. The conductor cannot run git, so a **Setup
phase** spawns a worker that creates/reuses the worktree (idempotent for resume); every work
worker is scoped to that path and commits there; `state.json` stays in the **main repo**
(`.workflows/state/`) so it survives worktree removal. Do NOT use per-agent
`isolation:'worktree'` for work phases — that gives each agent its own separate tree;
phases must share the one from Setup.

## Procedure

### 1. Resolve `$ARGUMENTS` (list / resume / new)

- **empty or `list`** → run `node <skill-dir>/scripts/list-workflows.cjs` (`--all` for
  completed too), show the table, stop. Done.
- otherwise treat the arg as a candidate `<name>` and read its state (this skill runs in the
  main session, so read directly): `Read .workflows/state/<name>.json` (or `test -f … && cat`).
  - **file exists, `status: "running"`/`"failed"`** → **resume**. Goal comes from the file.
    Go to step 2 (review existing script) → step 4.
  - **no file (arg is a goal)** → **fresh run**. Derive a kebab `<name>` slug from the goal,
    tell the user the slug, go to step 2 → step 3.
  - **file exists, `status: "complete"`** → tell the user it's already done (offer the report
    via `node <skill-dir>/scripts/workflow-report.cjs <name>`); start fresh only if they meant
    a new run.

### 2. Generate the conductor (do NOT hand-write boilerplate)

Generate the conductor deterministically from params — never copy/author it by hand (that
reintroduces drift). The generator emits all mechanical boilerplate correctly (NAME/STATE/
BRANCH consts, the `startedAt`-preserving `checkpoint()`, the Setup worktree + `node_modules`
symlink, per-phase resume guards, optional Brief/PR/TicketUpdate, finalize):

```
node <skill-dir>/scripts/scaffold-workflow.cjs --name <name> --phases "Analyze,Implement" \
  [--ticket] [--pr] [--merge-gates] [--base <ref>] [--desc "..."]
```

**Size the workflow to the task — do NOT default to the full profile.** More phases = more
subagent round-trips; reserve them for work that warrants them:
- **Small / one-shot change** → bare (`--name x`, default single `Work` phase) or just a couple
  of `--phases`. Merge related steps into one phase rather than splitting mechanically.
- **Routine delivery (small/low-risk PR)** → `--profile lite` (= `--ticket --pr --merge-gates`,
  one work phase, gates collapsed into a single **Review** phase): ~6 phases, not ~12.
- **Substantial / risky work** → `--profile delivery` (full TDD cycle + every gate). Only here.

- `--phases` — comma-list of work phase titles.
- `--ticket` — adds a **Brief** phase (fetch the ticket → goal) and a **TicketUpdate** phase.
- `--pr` — adds a **PR** phase (push branch + `gh pr create`).
- `--merge-gates` — collapse CodeGate + TestGate into ONE **Review** phase (review+fix+build,
  ensure warranted tests green, ≤3 loop, hard-fail). Fewer steps for small tasks. Ignored under
  `--cycle`. Implied by `--profile lite`.
- `--base` — worktree branch point (default: the remote's default branch, fetched fresh from
  `origin` so it's never stale; don't hardcode across projects).
- `--enforce-code` — adds a **CodeGate**: review+fix loop (≤3) via `lirbox:lirbox-code-reviewer`;
  **hard-fails** (conductor throws → run `failed`) on unresolved Critical/High.
- `--enforce-tests` — adds a **TestGate** that first *assesses* whether the change needs
  `tryve-e2e` / `unit` / `none` (it does NOT enforce blindly — a non-behavioral change passes
  with no new tests), then enforces+loops (≤3) via `lirbox:lirbox-tryve-enhancer`; hard-fails if not green.
- `--enforce-docs` — adds a **DocsGate**: writes an implementation summary to `docs/changes/`
  via `lirbox:lirbox-docs-writer`, folding in the `implementation-notes/` fragments; hard-fails if missing.
- `--cycle` — enforces the full TDD cycle, reordering the core to
  **RED → GREEN(work) → Verify → PathGap → IMPROVE/SIMPLIFY(CodeGate) → ReVerify**:
  - **RED** (`lirbox:lirbox-test-writer`) writes AC tests first and confirms they fail.
  - work phases implement to **GREEN**; **Verify** requires the suite green.
  - **PathGap** closes coverage for code paths the ACs never specified: branch coverage ∩ the
    diff → every uncovered changed branch must be **tested or explicitly justified** (in
    `implementation-notes/pathgap.html`) — hard-fail on any silent gap.
  - **CodeGate** then improves/simplifies; **ReVerify** re-runs the suite to catch refactor
    regressions. (Supersedes the standalone TestGate.)
- `--profile delivery` — shorthand for `--cycle --ticket --pr --enforce-docs` (full, big tasks).
- `--profile lite` — shorthand for `--ticket --pr --merge-gates` (routine, small tasks).

**Swapping the gate agents.** Each gate defaults to an agent bundled with this plugin (in
`agents/`), referenced by its **plugin-namespaced** type, and is overridable: `--agent-red`
(default `lirbox:lirbox-test-writer`), `--agent-code` (default `lirbox:lirbox-code-reviewer`),
`--agent-tests` (default `lirbox:lirbox-tryve-enhancer`), `--agent-docs` (default
`lirbox:lirbox-docs-writer`). Pass your own `agentType`, or `none` to drop the `agentType`
so that gate uses a **generic built-in subagent** (the prompt still runs — no agent
dependency at all). Example: `--agent-code my-team-reviewer --agent-docs none`.

Work/gate workers may keep a per-worker `implementation-notes/<slot>.html` in the worktree
(unique per slot so parallel agents never clobber) — but only **when there's something a
reviewer genuinely needs**: a non-trivial design decision, an intentional deviation, a real
tradeoff, or an open question. Mechanical steps (e.g. the PR push) make no notes at all; no-
decision work skips the file rather than emitting boilerplate.

**Agent dependency.** The default gate agents (`lirbox:lirbox-test-writer`, `lirbox:lirbox-code-reviewer`,
`lirbox:lirbox-tryve-enhancer`, `lirbox:lirbox-docs-writer`) ship with this plugin, so the gates work out of the
box once the plugin is installed. Override any gate with your own agent (`--agent-*`) or pass
`--agent-*=none` to run it on a generic built-in subagent — no bundled-agent dependency.

Then edit **ONLY** the `TODO:` agent prompts (and their schemas) inside the generated work
phases — that is the one task-specific part. Do NOT touch the generated boilerplate; to change
structure, re-run the generator with `--force`. Review before launching.

### 3. Launch (fresh)

First stamp `startedAt` at launch (so duration is true wall-clock, not "after Setup" — the
checkpoints preserve this value):

```
node -e "const fs=require('fs');fs.mkdirSync('.workflows/state',{recursive:true});const f='.workflows/state/<name>.json';if(!fs.existsSync(f))fs.writeFileSync(f,JSON.stringify({workflow:'<name>',status:'running',startedAt:new Date().toISOString()},null,2))"
```

Then launch:

```
Workflow({ scriptPath: ".workflows/<name>.js" })
```

Each phase merges `.workflows/state/<name>.json` via its checkpoint worker (preserving
`startedAt`).

### 4. Launch (resume)

Pass the persisted progress so the conductor skips completed phases:

```
Workflow({ scriptPath: ".workflows/<name>.js",
           args: { phasesDone: <from state.json>, results: <from state.json> } })
```

Optimization: if resuming **in the same session**, the script is unchanged, and the prior
`runId` is known, use `Workflow({ scriptPath, resumeFromRunId })` instead (replays cached
results instantly). Otherwise always use the `args` path — it works across sessions and
after edits to later phases.

### 5. Finalize

When the Workflow returns, stamp `status` + `finishedAt` (the conductor cannot — main
session does it). **If the Workflow threw** (a hard-fail gate, e.g. CodeGate/TestGate/DocsGate),
set `status: "failed"` instead of `complete` — the last checkpoint's state is preserved, so a
later `resume` re-runs only the failed gate and onward:

```
# success
node -e "const f='.workflows/state/<name>.json';const s=JSON.parse(require('fs').readFileSync(f,'utf8'));s.status='complete';s.finishedAt=new Date().toISOString();require('fs').writeFileSync(f,JSON.stringify(s,null,2))"
# on Workflow error → status:failed (then report the throwing gate's message to the user)
node -e "const f='.workflows/state/<name>.json';const s=JSON.parse(require('fs').readFileSync(f,'utf8'));s.status='failed';s.finishedAt=new Date().toISOString();require('fs').writeFileSync(f,JSON.stringify(s,null,2))"
```

Then generate the run report (duration + tokens + estimated cost):

```
node <skill-dir>/scripts/workflow-report.cjs <name>
```

Report to the user: the report summary (duration, tokens, est. cost — written to
`.workflows/reports/<name>.md`), the final `results`, and the **branch** (`wf/<name>`) +
**worktree** (`.worktrees/<name>`) holding the committed work, to review and merge. **Do NOT
auto-merge or auto-remove the worktree** — the human's call (non-destructive default). After
merge, clean up with `git worktree remove .worktrees/<name>`. The state file + report are the
durable audit trail.

## Gotchas

- The conductor cannot write files, timestamps, or randomness — push all of that into
  workers; vary worker labels by index, not random IDs.
- Every phase needs a skip-if-done guard, or resume re-runs completed work.
- `.filter(Boolean)` after `parallel()` — dead agents return `null`.
- Durable ≠ unattended. The Workflow tool runs inside a live session and cannot be
  triggered by cron or run headless. For unattended execution a different mechanism is
  needed (a standalone runner driving the agent SDK).

## Bundled resources

- `scripts/scaffold-workflow.cjs` — **generates** the conductor from params (SoT for all
  boilerplate). Use this instead of hand-authoring. Step 2.
- `references/delivery-phases.md` — what the optional `--ticket` / `--pr` phases contain and
  how to customize them (Jira/Linear/PR).
- `references/workflow-runtime.md` — conductor constraints, native subagent capabilities,
  state-file schema, full resume protocol, and common mistakes. Load before authoring.
- `scripts/list-workflows.cjs` — list workflows from `.workflows/state/` (in-progress by
  default; `--all` for completed). Used in list mode (step 1).
- `scripts/workflow-report.cjs` — duration + tokens + estimated cost for one run, written to
  `.workflows/reports/<name>.md`. Used at finalize (step 5). Rates editable / `RATES_JSON`.
