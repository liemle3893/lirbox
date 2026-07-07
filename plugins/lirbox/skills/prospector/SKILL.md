---
name: prospector
argument-hint: "[ <goal to start> | <name to resume> | list ]"
description: "Sequential keep-or-discard optimization loop (autoresearch-style 'generations'): auto-proposes a numeric metric + hard correctness gate from a goal (confirm once), then hill-climbs ONE declared code surface — keeping a change only when it strictly beats the metric AND passes the gate, reverting otherwise — on an isolated branch that is never auto-merged. Runs unattended/overnight on conductor's durable, resumable, worktree-isolated backbone. USE WHEN there is an objective automatable scalar (hot-path perf, bundle/binary size, memory, test-suite speed, eval-score, LLM cost, config tuning), a gate the metric cannot be gamed against, and a bounded surface where many small edits plausibly move the number. NOT WHEN the metric is subjective (UI/ergonomics), gameable behind a weak gate (reduce-lines, raise-coverage), one-shot (use conductor), or each eval costs hours."
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
`$ARGUMENTS` (top of file) is ONE free-text field — no flags, auto-detected three ways:

1. **empty / `list`** → list mode: `node <skill-dir>/scripts/list-optimizations.cjs` (`--all` for
   finished). Launch nothing.
2. **matches `.optimize/state/<arg>.json`** → resume that run from its ledger.
3. **anything else** → new goal: derive a kebab goal slug, then a unique run name
   `<name> = <goalslug>-$(date -u +%Y%m%d-%H%M%S)`, tell the user, auto-propose a config (step 1b),
   and — only if not declined — start fresh. The timestamp keeps two runs of the same goal from
   clobbering each other's branch/worktree/ledger.

`<name>` drives everything and is the resume key. Namespace (mirrors conductor's `.workflows/`):

```
.optimize/
  config/<name>.json   # approved run config: metric, gate, surface, budgets   (step 1b)
  state/<name>.json    # durable ledger + run state: generations, baseline, best (schema: loop-runtime.md)
  <name>.js            # generated loop conductor (Workflow script)             (step 2)
  reports/<name>.md    # run report: baseline→best, runs/kept, duration, tokens (step 5)
```

`config/` and `state/` live in the **main repo** (survive worktree removal; resume needs only the
name). Code edits happen on branch `opt/<name>` in worktree `.worktrees/opt-<name>`; **main is never
touched** until the human merges.

Examples: `make the /search endpoint faster` → proposes config, run name `search-speed-20260707-143205`,
confirm, run · `search-speed-20260707-143205` → resume · `list` → show in-progress.
</arguments>

<execution-model>
Prospector hill-climbs **one mutable surface** against a metric (repeat-until-budget, keep/revert) —
contrast conductor, which runs one path through distinct phases (a linear FSM): shared
infrastructure, different control structure. Read `references/loop-runtime.md` before
authoring/debugging the loop. A Workflow has two layers — confusing them is the #1 bug source:

- **Conductor** = the loop `.js` — pure JS, NO filesystem/git/`Date.now()`/`Math.random()`. It only
  computes the next experiment and makes the keep-or-discard *decision* from values workers return.
- **Workers** = the subagents it spawns — full tools. They do every side-effect: create the
  worktree, run gate + metric, edit the surface, commit/revert, write the ledger.

So the durable ledger is written by a **checkpoint worker** after every experiment, never by the
conductor.
</execution-model>

<procedure>

<step n="1" name="Resolve $ARGUMENTS">
- **empty / `list`** → run `list-optimizations.cjs` (`--all` for finished), show the table, stop.
- else read `.optimize/state/<arg>.json` directly (the skill runs in the main session):
  - `running` / `stopped` / `failed` → **resume** (step 4); goal + config come from `config/`. Don't
    regenerate the loop script if it already exists unchanged.
  - no file → **new goal**: derive slug, tell the user, run step 1b; if not declined → step 2 → 3.
  - `complete` → tell the user it's done (offer `optimize-report.cjs <name>`); start fresh only if
    they meant a new run.
</step>

<step n="1b" name="Auto-propose metric + gate, confirm once, measure baseline" note="new goals only — the heart of the skill">
Full derivation rules, the DECLINE rule, surface-lock guidance, and the ready-to-use setup-agent
prompt template are in `references/metric-gate.md`. The flow:

1. **Inspect the repo** (`package.json` scripts, Makefile, `bench/`, test dirs, CI, README) for an
   automatable numeric metric and a hard gate. Use the setup-agent prompt from `metric-gate.md` §8.
2. **Propose** `.optimize/config/<name>.json`:
   ```jsonc
   {
     "goal": "make the /search endpoint faster",
     "surface": "src/search/**",                         // the ONLY files the loop may edit
     "metric": { "cmd": "node bench/search.mjs", "parse": "p95=([0-9.]+)", "direction": "min", "repeat": 5 },
     "gate":   { "cmd": "npm test && npm run build" },    // MUST exit 0 or the candidate is discarded
     "budgets": {
       "evalCapSec": null,                // null → MEASURED at setup (~3× baseline gate+metric time)
       "agentCapSec": 600,                // bound the propose/edit step so a stuck agent can't stall
       "total": { "experiments": 100 },   // OR { "wallclockMin": 480 } OR { "tokens": N } — first wins
       "plateauStop": 15,
       "maxRestarts": 0,                  // >0 → on plateau, restart proposing from a NON-incumbent (baseline / kept-but-not-best) for that many rounds before stopping
       "minDelta": 0.5,                   // ignore sub-noise metric moves
       "maxDiffLines": 0                  // >0 → per-experiment edit-size budget (insertions+deletions); oversized ⇒ discard ('oversized-diff')
     },
     "baseline": "origin/main"
   }
   ```
   `parse`: regex capture group, `json:<path>`, or `lastnumber`. `direction`: `min` | `max`.
   `repeat` (optional, default 1): for a NOISY metric set N>1 — baseline+eval measure it N times and
   use the **median** + a variance-aware keep floor (a within-noise move isn't kept); leave 1 for a
   deterministic metric.
3. **DECLINE if no defensible metric + gate.** The fit test: *a dial it can read automatically and a
   fence it can't climb over.* Proceed only with BOTH an automatable number AND a gate the metric
   can't be gamed against (e.g. "fewer lines" needs a gate that fails on deleted behavior); else
   decline (or ask one `AskUserQuestion`) naming which half is missing (full bad-fit list in
   `metric-gate.md`). This is the anti-gaming guard.
4. **Measure the baseline ONCE** — gate (must pass; a broken base can't be optimized) + metric
   (run `metric.repeat` times → median + spread). This
   proves `metric.cmd` runs and `metric.parse` yields a number, and records `evalSec` →
   `evalCapSec` (~3× `evalSec`) when left `null`.
5. **Report throughput up front**: `≈ nightBudget / (agentCapSec + evalCapSec)` → "~N experiments
   tonight" *before* launching.
6. **Confirm once** via `AskUserQuestion`: config + baseline metric + throughput. The only human gate.
</step>

<step n="2" name="Generate the loop conductor (config as data — never hand-edit)">
```
node <skill-dir>/scripts/scaffold-optimize.cjs --name <name>      # --force to overwrite; --out to redirect
```
Writes `.optimize/<name>.js` (slug drives state/branch/worktree paths). The config is **not** baked
in — it is passed at launch via `args.config` (step 3), so resume re-passes it unchanged (the
conductor can't read the filesystem). Glance at the printed structure; to change structure or fill a
prompt, re-run with `--force` — never hand-edit (reintroduces drift).
</step>

<step n="3" name="Launch (fresh)">
Stamp the ledger so duration is true wall-clock (checkpoints preserve `startedAt`):
```
node -e "const fs=require('fs');fs.mkdirSync('.optimize/state',{recursive:true});const f='.optimize/state/<name>.json';if(!fs.existsSync(f))fs.writeFileSync(f,JSON.stringify({name:'<name>',status:'running',startedAt:new Date().toISOString()},null,2))"
```
Then launch with the config as args:
```
Workflow({ scriptPath: ".optimize/<name>.js", args: { config: <config JSON> } })
```
The conductor reads surface/metric/gate/budgets from `args` and runs baseline → experiment loop →
stop. Each experiment's checkpoint worker appends to the ledger.
</step>

<step n="4" name="Launch (resume)">
Pass the persisted ledger so the conductor continues from `best` and repeats no idea:
```
Workflow({ scriptPath: ".optimize/<name>.js",
           args: { config: <config/<name>.json>, experiments: <state.experiments>,
                   best: <state.best>, baseline: <state.baseline> } })
```
**Pass `baseline` too** — the conductor re-derives the eval cap from `baseline.evalSec` and
re-persists it each checkpoint; omitting it overwrites the saved baseline with null and the report
loses baseline→best. The loop skips Baseline, restores `best`, and numbers generations from where it
stopped. KEPT commits are already on `opt/<name>`.
</step>

<step n="5" name="Finalize, report, overnight note">
When the Workflow returns, stamp `status` + `finishedAt` (the conductor can't — the main session
does). Status by why it stopped: `complete` (budget reached), `stopped` (plateau/kill-switch), or
`failed` (Workflow threw, e.g. baseline gate failed). Last checkpoint's ledger is preserved → resume
continues correctly.
```
node -e "const f='.optimize/state/<name>.json';const s=JSON.parse(require('fs').readFileSync(f,'utf8'));s.status='complete';s.finishedAt=new Date().toISOString();require('fs').writeFileSync(f,JSON.stringify(s,null,2))"
node <skill-dir>/scripts/optimize-report.cjs <name>
```
Report: the summary (`.optimize/reports/<name>.md`), branch `opt/<name>` + worktree
`.worktrees/opt-<name>` holding the KEPT commits, and `git diff <baseline>..opt/<name>` as the review
artifact.

**Auto-PR (the delivery step).** If `best` beat the baseline (≥1 KEPT experiment), open a PR so
review is one click, never a merge:
1. Push the branch: `git -C .worktrees/opt-<name> push -u origin opt/<name>` (retry with backoff on
   network error, per the git-ops rules).
2. Open a PR **into the run's baseline branch** (NOT a merge) with the GitHub MCP / `gh` — title
   `prospector(<name>): <baseline.metric> → <best.metric>` and the report markdown as the body.
   Search for a PR template first and populate it if present.
3. Report the PR URL back, plus the `git diff <baseline>..opt/<name>` pointer.

**Never merge, and never `git worktree remove`** — the PR is the deliverable; the human reviews and
merges. **Fallback:** no remote / no PR tooling → skip the PR, report the local branch + report path
as before. If `best` never beat the baseline, don't open a PR; report the outcome.

**Overnight (schedule-ready, not scheduled in v1):** the committed config + durable ledger let a
`/schedule` routine or a standalone Agent SDK runner resume the loop (step 4) overnight; you review
the branch + report in the morning. v1 does not wire cron — the Workflow tool can't run headless in a
live session.
</step>

</procedure>

<gotchas>
Full rules in `references/loop-runtime.md` (keep/discard §4, surface lock §4, two-clock §4, resume
§5, common mistakes §6).

- **The gate is the floor.** A KEPT entry exists **iff** the gate passed AND the metric beat `best`
  by ≥ `minDelta` AND the surface lock held; everything else is DISCARDED. The loop can never win by
  breaking correctness.
- **Surface lock.** Every changed path — including new untracked files (`git status --porcelain
  --untracked-files=all`, not `git diff --name-only`) — must be ⊆ `surface`, else discard. An empty
  diff also fails. This is the anti-metric-gaming fence: it stops the loop editing the benchmark/gate.
- **Non-destructive revert.** DISCARD resets the WHOLE worktree (`git reset --hard HEAD && git clean
  -fd`, not a surface-scoped checkout — an out-of-surface edit must not survive). Prior KEPT commits
  are on the branch, so only the uncommitted candidate drops; `git status` is clean after every
  discard. The branch is **never auto-merged**.
- **Idempotent / at-least-once.** The checkpoint writes *after* commit-or-revert, so a crash between
  them re-runs that experiment; the revert makes a re-run safe.
- **Every experiment is bounded** — propose by `agentCapSec`, eval by the derived `evalCapSec`;
  either timeout ⇒ discard. That is what makes the run measurable.
- **Plateau = stop, or a bounded escape.** No KEPT in the last `plateauStop` experiments ⇒ plateau.
  With `budgets.maxRestarts: 0` (default) that is terminal. With `maxRestarts > 0` the loop first
  attempts a BOUNDED escape: it restarts proposing from a NON-incumbent commit (the baseline, or a
  kept-but-not-best commit — never `best`) for up to that many rounds, jumping the search to a
  different basin; it stops only once those restarts are exhausted. Total stop is the first of
  `{ experiments, wallclockMin, tokens }`.
- **Conductor can't write files/timestamps/randomness** — push all into workers; vary worker labels
  by experiment index, never `Math.random()`.
- **Durable ≠ unattended** — see the overnight note (step 5).
</gotchas>

<resources>
- `scripts/scaffold-optimize.cjs` — **generates** the loop conductor from the approved config (SoT
  for all loop boilerplate: baseline → experiment loop → keep/discard → surface-lock → checkpoint →
  stop). Use instead of hand-authoring. Step 2.
- `scripts/optimize-report.cjs <name>` — baseline→best % improvement, runs/kept, plateau, duration,
  tokens, est cost → `.optimize/reports/<name>.md`. Step 5.
- `scripts/list-optimizations.cjs [--all]` — list runs from `.optimize/state/` (in-progress by
  default; `--all` for finished). List mode (step 1).
- `scripts/test-optimize.cjs` — regression net for the generator (emits a config matrix, `node
  --check`s each loop, asserts structure). Run after any change to `scaffold-optimize.cjs`.
- `references/loop-runtime.md` — two-layer constraints, ledger schema, keep/discard, surface lock,
  two-clock budget, resume protocol, common mistakes. Load before authoring.
- `references/metric-gate.md` — step-1b derivation (metric/parse/direction/gate per goal), DECLINE
  rule, surface-lock guidance, baseline measurement, setup-agent prompt template. Load before proposing.
- `references/skill-train.md` — the SkillOpt recipe: point prospector at a SKILL (surface = skill
  text minus `evals/`, metric = held-out `run-scored.mjs --split val` pass rate, gate = the
  whetstone floor, `maxDiffLines` as the textual learning rate). Load when the goal is "make skill
  X better", not "make code Y faster".
</resources>
