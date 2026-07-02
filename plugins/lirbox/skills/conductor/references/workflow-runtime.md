# Workflow Runtime — Constraints, State Schema, Resume Protocol

Reference for the conductor skill. Load when authoring or debugging a durable
workflow script.

---

## 1. The two-layer execution model (the key mental model)

A Workflow run has two distinct execution contexts. Confusing them causes most mistakes.

| Layer | What runs there | Capabilities |
|---|---|---|
| **Conductor** | the workflow `.js` script (`meta`, `phase()`, `agent()`, `parallel()`, `pipeline()`, control flow) | **Restricted.** Pure JS only — NO filesystem, NO Node APIs, NO network. `Date.now()` / `new Date()` / `Math.random()` are **blocked**. `JSON`, `Array`, `Math` (non-random) are fine. |
| **Workers** | every subagent spawned by `agent()` / `parallel()` / `pipeline()` | **Full Claude Code tools** — `Read`, `Write`, `Edit`, `Bash`, `Grep`, etc. Run in the real environment. Do all side-effects here. |

Consequences:
- The conductor **cannot write `state.json`** — a worker (the checkpoint agent) does it.
- The conductor **cannot generate timestamps or randomness** — a worker injects `updatedAt`; vary worker labels by index instead of random IDs.
- All file edits, shell, git, and persistence happen inside `agent(...)` prompts.

This restriction exists so the conductor is **deterministic and replayable** — required for
resume to be correct.

---

## 2. Native subagent capabilities (do NOT reimplement these)

The Workflow tool already provides large-scale subagent orchestration:
- `agent(prompt, opts)` — spawn one subagent. With `schema` (JSON Schema) it **forces
  validated structured JSON** back (retries on mismatch). Returns `null` if the agent dies
  after retries — `.filter(Boolean)` results.
- `parallel(thunks)` — run an array of `() => agent(...)` concurrently; **barrier** (awaits
  all). A thunk that throws → `null` in the array.
- `pipeline(items, stage1, stage2, ...)` — run each item through all stages with **no
  barrier between stages** (default for multi-stage work).
- Concurrency cap: `min(16, cores-2)` simultaneous; excess queues. Lifetime cap: 1000
  agents/run. Single `parallel`/`pipeline` call: ≤4096 items.
- `opts`: `label`, `phase`, `schema`, `model`, `effort`, `isolation:'worktree'`, `agentType`.

The conductor skill adds **only** durable cross-session state + a resume protocol on
top of this. It does not replace dispatch.

---

## 3. State file

**Path:** `.workflows/state/<workflow-name>.json` (relative to repo root).

**Schema:**
```json
{
  "workflow": "string — matches meta.name",
  "status": "running | complete | failed",
  "branch": "wf/<name> — the isolated branch holding committed work",
  "worktree": ".worktrees/<name> — where code edits happen",
  "phasesDone": ["Setup", "PhaseA", "PhaseB"],
  "results": {
    "setup":  { "...": "worktree-creation result" },
    "phaseA": { "...": "validated output of phase A's agent" },
    "phaseB": [ { "...": "per-item outputs" } ]
  },
  "startedAt": "ISO-8601 — set once by the first checkpoint worker",
  "updatedAt": "ISO-8601 — refreshed by every checkpoint worker",
  "finishedAt": "ISO-8601 — set by the skill (main session) at finalize"
}
```

`startedAt`/`finishedAt` drive the duration and the token/cost report
(`scripts/workflow-report.cjs`, which sums transcript usage within `[startedAt, finishedAt]`).

The state file lives in the **main repo** (`.workflows/state/`), NOT in the worktree — so it
survives worktree removal and stays readable for resume.

- Written by a **checkpoint subagent** after each phase (the generated `checkpoint()` does a
  `startedAt`-preserving merge: read prev → write payload + timestamps).
- `results` keys mirror the conductor's `results` object so a resumed run can reuse them.
- `status` is `running` during checkpoints; the **skill** (main session) flips it to
  `complete`/`failed` after the run returns.

---

## 3b. Isolation — shared-worktree model

All code edits happen inside ONE git worktree so the main working tree is never touched
until a human merges (the autoflow-deliver model).

- **Paths:** worktree `.worktrees/<name>`, branch `wf/<name>` (override via `args.branch`).
- **Setup phase:** a worker runs `git worktree add` (idempotent — reuses an existing
  worktree/branch on resume). The conductor cannot run git, so this must be a worker.
- **Work phases:** every work-worker prompt is prefixed with the `IN_WORKTREE` instruction
  (`cd` into the worktree, edit only there, commit there). Phases SHARE this one worktree.
- **Do NOT** pass `isolation:'worktree'` to work agents — that gives each agent its OWN
  separate tree, breaking the shared-state assumption (phase B can't see phase A's edits).
- **Finalize:** the skill reports branch + worktree; it does **not** auto-merge or
  auto-remove (non-destructive default). Cleanup after merge: `git worktree remove .worktrees/<name>`.
- **Commits are durable on the branch** even if the worktree dir is later removed.

## 4. Resume protocol

The conductor **skill runs in the main Claude Code session**, which has full tools —
so the skill reads/writes `state.json` directly (only the *conductor* is restricted).

On (re)entry:
1. **Read** `.workflows/state/<name>.json`.
2. If absent or `status: complete` → **fresh run** (launch with no resume `args`).
3. If present and `status` ∈ {`running`,`failed`} → **resume**:
   - **Primary (cross-session, robust):** pass `args = { phasesDone, results }` into the
     Workflow launch. The conductor skips done phases (`if (done.has('PhaseA')) …`) and
     reuses `results`. Works across sessions, machines, and after edits to later phases.
   - **Optimization (same session only):** if the prior `runId` is known and the script is
     unchanged, `Workflow({ scriptPath, resumeFromRunId })` replays cached agent results
     instantly. Falls back to the args path otherwise.

Always prefer the args path unless a same-session `runId` is available and the script is
byte-identical.

---

## 5. Opt-in note

The Workflow tool requires explicit user opt-in. Invoking the conductor skill (a
skill whose instructions call Workflow) satisfies that opt-in — no extra confirmation
needed once the skill is running.

---

## 6. Common mistakes

- ❌ Calling `fs`/`Date.now()`/`Math.random()` in the conductor → runtime error. Move to a worker; vary by index not randomness.
- ❌ Building `state.json` content in a worker from scratch → drift. The conductor serializes the canonical `results`; the worker only writes the bytes + `updatedAt`.
- ❌ Re-running a done phase on resume → wasted tokens. Every phase must guard with `if (done.has(...))`.
- ❌ Using this for a quick one-shot fan-out → overkill. Call the Workflow tool directly; reserve conductor for long/interruptible/auditable runs.
- ❌ Forgetting `.filter(Boolean)` after `parallel()` → null entries from dead agents leak downstream.
- ❌ Per-agent `isolation:'worktree'` on work phases → separate trees; phase B can't see phase A's edits. Use the single shared Setup worktree instead.
- ❌ Work-worker edits outside the worktree → defeats isolation, dirties the main tree. Always prefix prompts with `IN_WORKTREE`.
- ❌ Writing `state.json` inside the worktree → lost on `git worktree remove`. Keep it in the main repo `.workflows/state/`.
- ❌ Assuming a phase runs exactly once on resume → phases are **at-least-once**: the checkpoint is written *after* the side-effect, so a crash between them re-runs that phase. Every phase body must be **idempotent**.
- ❌ Trusting a corrupt/forged resume state → the generated conductor self-validates on entry that `phasesDone` is a **contiguous prefix** of the phase order (unknown or mid-skip phases throw), so it fails loudly instead of silently skipping Setup.

---

## 7. Durable ≠ unattended

Durability (survives restarts) is not headless autonomy. The Workflow tool runs inside a live
Claude Code session and cannot be triggered by cron or run **unattended** / headless. For
unattended execution a different mechanism is needed (a standalone runner driving the agent SDK).
