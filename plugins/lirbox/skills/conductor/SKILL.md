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

<purpose>
Workflow gives deterministic, JS-authored subagent orchestration — but in-memory state and
**same-session-only** resume. This skill adds a **durable JSON state file** plus an args-based
**resume protocol** that restarts a run from disk.
</purpose>

<when-to-use>
Only when ALL hold: multi-step, dispatches subagents; long or interruptible, where losing progress
is costly; a durable on-disk record is wanted. Otherwise call Workflow directly.
</when-to-use>

<core-model>
Two layers — confusing them is the #1 source of bugs:
- **Conductor** = the workflow `.js`: pure JS, **no filesystem**, no git, no `Date.now()` /
  `Math.random()` — it only computes and dispatches, so durable state is written by a **checkpoint
  worker**, never the conductor.
- **Workers** = the subagents it spawns: full tools, every side-effect.

**Isolation.** ONE shared worktree `.worktrees/<name>` on branch `wf/<name>` holds every edit (a
**Setup** worker creates/reuses it); `state.json` stays in the **main repo**. Do NOT pass per-agent
`isolation:'worktree'` to work phases. Details →
[`workflow-runtime.md`](references/workflow-runtime.md) (read before authoring).
</core-model>

<procedure>

### 1. Resolve `$ARGUMENTS`

`$ARGUMENTS` (top of this file) is ONE free-text field — no separators, no flags. This skill runs in
the main session, so read state directly (`Read .workflows/state/<name>.json`):

| `$ARGUMENTS` | do |
|---|---|
| empty or `list` | `node <skill-dir>/scripts/list-workflows.cjs`, show the table, stop |
| a state file, `running`/`failed` | **resume** → step 4; regenerate (`--force`) only to change phase structure |
| a state file, `complete` | say so (offer `workflow-report.cjs <name>`); fresh run only if they meant one |
| a tracker ticket (Jira key, Jira/Linear URL) | ticket run: set `args.ticket`, `<name>` from the key, phase 1 fetches the goal ([`delivery-phases.md`](references/delivery-phases.md) §A) → 1b |
| anything else — a goal | fresh run: kebab `<name>`, tell the user → 1b → 1c → 2 → 3 |

`<name>` keys the state file, branch and worktree; goal and `ticket` live in `state.json`, so resume
needs only the name plus `args = { phasesDone, results }`
([`workflow-runtime.md`](references/workflow-runtime.md) §4). **Delivery is opt-in** — add PR/ticket
phases from [`delivery-phases.md`](references/delivery-phases.md), never auto-merge.

### 1b. Triage a new run — size or decline

Classify the goal, pick ONE tier, bias **down** (skip for `list`/`resume`):

| tier | when | generate with |
|------|------|---------------|
| **decline** | trivial / single-file, one pass | nothing — overkill |
| **bare** | multi-step, low-risk, no gates | `--phases` only |
| **lite** | routine delivery, small PR | `--profile lite` |
| **delivery** | broad, risky, must not regress | `--profile delivery` |

**Decline is a hard STOP**, even when conductor was invoked explicitly (`/lirbox:conductor <goal>`
or by name): explicit invocation selects the skill, it does not license skipping triage. Surface the
cost/overkill caveat and offer to do the work inline **before** any scaffold or launch.

No up-signal → lowest tier; genuinely ambiguous → ONE `AskUserQuestion`. Up-signal list →
[`run-planning.md`](references/run-planning.md) §1.

### 1c. Acquire the DoD (new lite/delivery runs)

Every lite/delivery run carries a **definition of done**: 3–7 criteria (**no hard cap** — never drop
ticket-supplied ACs), each `checkable` (a frozen command, exit 0 = met) or `judged` (a verdict citing
evidence); above ~10, propose a **split** into independently-shippable slices. Precedence: ticket /
plan ACs → a plan-check report's `<script type="application/json" id="dod">` block → your own; UI
goals also fold in a probed `frontend` block (`--frontend` → **FrontendGate**), content goals a
prose-lint criterion. Confirm ONCE (`AskUserQuestion`: accept / edit), then freeze
`.workflows/<name>.dod.json` and pass `--dod-file` in step 2 — bare may skip it, lite/delivery
require it (`--no-dod` opts out). **DoDGate** verifies every criterion at run end (fix-loop ≤3, then
hard-fail). Probes, formats, precedence → [`run-planning.md`](references/run-planning.md) §2.

### 2. Generate the conductor (prompts as data)

Always generate from `scripts/scaffold-workflow.cjs` — never author or hand-edit the `.js` (drift);
re-run with `--force` to change structure. Prompts travel as **DATA** (`--prompt` /
`--prompts-file`). Size to the triage tier (`--profile lite` / `--profile delivery`) — never default
to the full profile.

**The human declares the goal + DoD; the LOOP decides the decomposition — never author a work-item
or dependency table here.** Nothing has read the code yet, so any split you write down is a guess,
and a wrong edge is silent. Splitting happens **at runtime**: each work phase first runs a
**planner** worker that reads the repo and returns that phase's items plus each item's dependency
edges, then the conductor dispatches them by dependency **level** — every ready item in ONE
`parallel()` batch, each worker in its own worktree/branch off the level's integrated base, so an
item always sees the output it depends on. `--phases` declares human-visible **stages** (each gets
its own planner), not items; `--no-plan-fanout` is the single escape hatch (one serial worker per
phase). Want specific items? State them in the phase prompt — the planner returns them. Detail →
[§3](references/run-planning.md).

```
node <skill-dir>/scripts/scaffold-workflow.cjs --name <name> --phases "Analyze,Implement" \
  --prompts-file <prompts.json> --dod-file .workflows/<name>.dod.json \
  [--ticket] [--pr] [--merge-gates] [--base <ref>] [--desc "..."]
```

→ **Full flag reference: [`references/generator-flags.md`](references/generator-flags.md)** — read
before generating: every phase/prompt/delivery/gate flag, `--cycle` ordering, the profiles,
`--model-mode` (**`auto` per-phase tiering is the default; `inherit` gives workers the session
model**), agent swapping, `implementation-notes/` → `docs/changes/` promotion.

### 3. Launch (fresh)

Stamp `startedAt` first (true wall-clock duration), then launch:

```
node -e "const fs=require('fs');fs.mkdirSync('.workflows/state',{recursive:true});const f='.workflows/state/<name>.json';if(!fs.existsSync(f))fs.writeFileSync(f,JSON.stringify({workflow:'<name>',status:'running',startedAt:new Date().toISOString()},null,2))"
```

```
Workflow({ scriptPath: ".workflows/<name>.js" })
```

**Headless / non-interactive (`claude -p`): launch in the FOREGROUND — `run_in_background: false` —
and do NOT end your turn while the workflow runs.** The foreground call itself BLOCKS until the
workflow completes: the blocking call IS the wait, so never background it and narrate "waiting" —
saying so does not make it so, and ending the turn kills the run (`wf/` branch, zero commits). After
it returns, VERIFY: re-read `.workflows/state/<name>.json` and confirm its `status` is no longer
`running`. Only then finalize (step 5); same for resume (step 4).

Each phase merges `state.json` via its checkpoint worker (preserving `startedAt`).

### 4. Launch (resume)

Pass the persisted progress so the conductor skips completed phases:

```
Workflow({ scriptPath: ".workflows/<name>.js",
           args: { phasesDone: <from state.json>, results: <from state.json> } })
```

Same session + unchanged script + known prior `runId` → `Workflow({ scriptPath, resumeFromRunId })`
replays cached results; otherwise always the `args` path.

### 5. Finalize

When the Workflow returns, stamp `status` + `finishedAt` (the conductor cannot) — `failed`, not
`complete`, if it threw, so a later `resume` re-runs only the failed gate. Then run
`workflow-report.cjs <name>` and hand the user the report, the `results`, and the run's **branch +
worktree**. **Never auto-merge** or auto-remove the worktree — that is the human's call. Commands →
[`run-planning.md`](references/run-planning.md) §4.
</procedure>

<gotchas>
- Phases are **at-least-once**: each needs a skip-if-done guard and must be **idempotent**.
- `.filter(Boolean)` after `parallel()` — dead agents return `null`.
- Durable ≠ **unattended** — Workflow needs a live session; no headless/cron.

Full list → [`references/workflow-runtime.md`](references/workflow-runtime.md) §6–§7.
</gotchas>

<resources>

- `scripts/` — `scaffold-workflow.cjs` (step 2) · `list-workflows.cjs` (step 1; `--all` includes
  completed) · `workflow-report.cjs` (step 5; rates via `RATES_JSON`) · `test-scaffold.cjs`
  (generator regression net).
- `references/` — `run-planning.md` (steps 1b–1c, 5; runtime decomposition) · `generator-flags.md` (step 2) ·
  `delivery-phases.md` (`--ticket` / `--pr` / writeup phases) · `workflow-runtime.md` (layers,
  state schema, resume, gotchas).
</resources>
