---
name: arena
argument-hint: "[ <goal to start> | <name to resume> | list ]"
description: "Reproducible pairwise ARENA for skills (conductor-first): runs conductor against frozen fixture tasks under multiple configs (model/mode/effort), judges the DELIVERED DIFFS pairwise (3 runs × 4 position-swapped passes (even count = exact position balance)), and emits a Bradley-Terry/win-rate leaderboard on an isolated branch that is NEVER auto-merged. Overnight, durable, resumable on conductor's backbone. USE WHEN you want to know whether a change (or config) actually improves conductor's delivered output across a frozen task suite, scored reproducibly. NOT WHEN there's an objective scalar to hill-climb (use prospector), a single filed concern to turn RED→GREEN (use whetstone), or you need a one-shot delivery (use conductor)."
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Workflow
  - AskUserQuestion
---

$ARGUMENTS

<arguments>
`$ARGUMENTS` (top of file) is ONE free-text field — auto-detected three ways:

1. **empty / `list`** → list mode: `node <skill-dir>/scripts/list-arena.cjs` (`--all` for finished). Launch nothing.
2. **matches `.arena/state/<arg>.json`** → resume that run from its ledger (re-pass runs/judges via `args`).
3. **anything else** → new run: derive a kebab goal slug, then a unique run name `<name> = arena-$(date -u +%Y%m%d-%H%M%S)`
   (timestamp keeps concurrent runs from clobbering each other's branch/worktree/ledger), build the config from the
   committed suite, confirm once, launch.

`<name>` drives everything and is the resume key. Namespace (mirrors conductor's `.workflows/`):

```
.arena/
  config/<name>.json   # approved run config: tasks, configs, budget       (step 1)
  state/<name>.json    # durable ledger: runs[], judges[], ratings, matrix  (checkpoint worker)
  <name>.js            # generated loop conductor (Workflow script)         (step 2)
  <name>/cells/…       # captured per-run diffs + .meta (scratch)
docs/arena/<name>/     # PROMOTED, TRACKED deliverable: leaderboard.html + report.md  (step 5)
```

`config/` and `state/` live in the **main repo** (survive worktree removal; resume needs only the name). The
leaderboard is promoted to tracked `docs/arena/<name>/` so the finalize PR carries a real diff; `main` is never
touched by a merge — a human reviews the PR.
</arguments>

<execution-model>
The arena is a THIN comparison harness on conductor's backbone. It does NOT reimplement execution: each cell
INVOKES conductor headless (`claude -p`) as its run engine (proven feasible by the Task 0 spike), and adds only
fixture-checkout, pairwise judging, Elo, and the leaderboard. Read `references/loop-runtime.md` before authoring
/debugging the loop; the judge rubric + forfeit rule are in `references/judging.md`. A Workflow has two layers:

- **Conductor** = the loop `.js` — pure JS, NO fs/git/`Date.now()`/`Math.random()`. It only computes the cell
  plan, samples judge pairs, and tallies verdicts into ratings from values workers return.
- **Workers** = the subagents it spawns — full tools. They clone the fixture, run conductor headless under a cap,
  capture the diff, judge pairs, write the durable ledger (a **checkpoint worker** after every unit), and finalize.
</execution-model>

<procedure>

<step n="1" name="Resolve $ARGUMENTS + build/approve config">
- **empty / `list`** → run `list-arena.cjs` (`--all` for finished), show the table, stop.
- else read `.arena/state/<arg>.json` (the skill runs in the main session):
  - exists (`running`/`stopped`) → **resume** (step 3): re-pass `runs`/`judges`/`ratings` from the ledger via `args`.
    Don't regenerate the loop script if it already exists unchanged.
  - no file → **new run**: derive slug, run name `arena-<ts>`, and build `.arena/config/<name>.json` from the
    committed suite `plugins/lirbox/skills/conductor/arena/suite.json` (tasks + configs + budget). Confirm ONCE via
    `AskUserQuestion`: the resolved **cell count** (`tasks × configs × runs`) + a rough cost estimate (each cell is a
    full conductor run — overnight). This is the only human gate; if declined, stop.
</step>

<step n="2" name="Scaffold the loop">
`node <skill-dir>/scripts/scaffold-arena.cjs --name <name>` → writes `.arena/<name>.js`. Never hand-edit the
generated script; to change loop structure, change the generator and regenerate with `--force`.
</step>

<step n="3" name="Launch / resume">
`Workflow({ scriptPath: '.arena/<name>.js', args: { config } })`. On resume, pass the ledger's
`{ config, runs, judges, ratings }` in `args` so completed cells/judgements are skipped. The run is unattended and
overnight; a crash re-launches from `.arena/state/<name>.json`.
</step>

<step n="4" name="Finalize (automatic)">
The loop's Finalize phase promotes `leaderboard.html` + `report.md` into `docs/arena/<name>/`, commits on branch
`arena/<name>`, and opens a PR (or leaves the branch if there's no remote). It NEVER merges.
</step>

<step n="5" name="Report">
Point the human at `docs/arena/<name>/leaderboard.html` (or re-render with `node <skill-dir>/scripts/arena-report.cjs
<name>`). Lead with the win-rate matrix; Bradley-Terry rating is the headline number, per-task/per-run breakdown
below it so a noisy cell is visible, not averaged away. Forfeited cells are flagged, never silently dropped.
</step>

</procedure>
