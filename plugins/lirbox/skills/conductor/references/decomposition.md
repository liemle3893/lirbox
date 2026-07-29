# Decomposition — the loop's job, not the caller's (SKILL.md step 2)

SKILL.md keeps the DECISION (which tier, which flag, the hard rules); this file holds the HOW —
long-form probes, formats, precedence and worked examples. Split out of the old `run-planning.md`
so a run loads only the step it is on.

**You declare the GOAL (step 1) and the DEFINITION OF DONE (step 1c). The loop decides the
SPLIT.** There is no caller-facing decomposition step: writing down work items and their edges
before generating means guessing at a shape nothing has read the code to confirm, and a wrong edge
does not fail loudly — it produces a clean merge over semantically broken work.

### 3a. Planner fan-out (runtime — work inside a phase is not serial)

By default each work phase first runs a **planner** worker (`plan:<Phase>`) that reads the repo and
returns its items plus each item's `dependsOn`; the conductor then dispatches them **by dependency
level** — every ready item in ONE `parallel()` batch, each worker in its own worktree/branch, each
level integrated back into the run branch before the next level branches off it, so a dependent item
always starts from a base carrying what it needs. Phase ORDER is untouched. The plan is
checkpointed before the first item runs, so a resume reuses that decomposition instead of
re-planning a different one, and a one-item plan is just today's single worker. Pass
`--no-plan-fanout` to turn a phase back into one serial worker.

### 3b. What the caller still controls

- **The prompt.** If you already know the items, name them in the phase prompt — the planner reads
  it and returns them, with the edges it derives from the code rather than from your guess.
- **`--phases`.** Genuinely staged, human-visible stages (e.g. `Analyze,Implement`) — each stage
  gets its own planner. Not a way to spell out work items.
- **`--no-plan-fanout`.** The single escape hatch: force ONE serial worker for the phase.

`--independent` (caller-declared items, fanned out at scaffold time) has been **removed** and now
hard-errors; its per-worker worktree isolation lives on in the planner fan-out.
