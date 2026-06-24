---
name: prospector
argument-hint: "[ <goal to start> | <name to resume> | list ]"
description: "This skill should be used to hill-climb a numeric metric over one declared code surface behind a hard correctness gate — a sequential keep-or-discard optimization loop (autoresearch-style 'generations') that auto-proposes a metric+gate from the goal, confirms once, then runs unattended/overnight, keeping a change only when it strictly improves the metric AND passes the gate, reverting otherwise, on an isolated branch that is never auto-merged. WHEN to use: there is an objective automatable scalar metric, a hard gate the metric cannot be gamed against, and a bounded surface where many small changes plausibly move the metric (hot-path perf, bundle/binary size, memory, test-suite speed, eval-score quality, LLM cost, config tuning); the run is long, interruptible, or overnight-capable. WHEN NOT: no objective metric (UI niceness, API ergonomics); a gameable metric behind a weak gate (reduce-lines, raise-coverage with a thin gate); a one-shot single change (use conductor); or each eval costs hours (throughput too low to converge). Built on conductor's durable, resumable, worktree-isolated Workflow backbone."
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Workflow
  - AskUserQuestion
---

$ARGUMENTS

# Prospector

## Purpose

`autoresearch` proved a pattern — one mutable file, one normalized metric, a fixed
per-run wall-clock, cumulative "generations", and a human who reviews in the morning —
but welds it all to ML training. `conductor` already gives the durable, resumable,
worktree-isolated, Workflow-driven backbone, but for a *fixed sequence of distinct
phases*, not an optimization loop. **Prospector = conductor's durability + autoresearch's
metric-driven keep-or-discard**, generalized: it takes a goal, **auto-proposes a success
metric + a hard gate** (you confirm once), then runs a **sequential keep-or-discard
hill-climbing loop** over one declared mutable surface — keeping a change only when it
strictly improves the metric *and* passes the gate, reverting otherwise — until a budget
is exhausted. Every experiment is wall-clock-bounded, so throughput is predictable and the
run is fully measurable. Improvements accumulate on an isolated branch; nothing is
auto-merged.

**Distinction from conductor:** conductor runs *one* path through distinct phases (a linear
FSM); prospector hill-climbs *one mutable surface* against a metric (repeat-until-budget
with keep/revert). Different control structure → standalone skill, shared infrastructure.

## When to use & anti-patterns

**Fit test:** an objective scalar metric that is automatable and not-too-expensive, a hard
correctness gate the metric cannot be gamed against, and a bounded surface where many small
changes plausibly move the metric. Prospector earns its keep when you have *a dial it can
read automatically and a fence it can't climb over*.

**Good fits:**

| Use case | metric (direction) | gate | surface |
|---|---|---|---|
| Hot-path performance (canonical) | bench p95 / ops-sec (min/max) | tests green | the hot module |
| Bundle / binary size | built artifact bytes (min) | build + tests + smoke E2E | source + build config |
| Memory / allocations | peak RSS from a profile harness (min) | tests | the allocating module |
| Test-suite speedup | suite wall-clock (min) | same tests pass + **coverage floor** | test config / parallelism |
| Eval-score quality (the true autoresearch analog) | accuracy / recall@k / pass-rate (max) | smoke tests | heuristic / model / chunking / ranking code |
| LLM pipeline cost | $ or tokens per request (min) | quality-eval ≥ threshold | prompt / pipeline code |
| Compiler / flag / config tuning | runtime under config (min) | correctness tests | build flags / config |

Strongest fits — **performance, size, eval-score**: cheap, trustworthy numbers, gameable
only if the gate is weak.

**Anti-patterns (the auto-propose step in §1b should DECLINE these):**

- **No objective metric** (UI "niceness", API "ergonomics") — nothing to hill-climb; use
  conductor or a human.
- **Gameable metric + weak gate** ("reduce lines", "raise coverage %" behind a thin gate) —
  the loop will delete needed code or add assertion-free tests. Prospector is only as safe
  as its gate.
- **One-shot change** (a single feature) — nothing to climb; that's conductor.
- **Eval costs hours each** — throughput too low to converge overnight.

The auto-propose step (§1b) uses exactly the fit test to say **no** to bad-fit goals rather
than inventing a gameable metric.

## Arguments & the `.optimize/` namespace

`$ARGUMENTS` (placed at the top of this file) is a SINGLE free-text field. Resolve it three
ways — no separators, no flags (the conductor "one arg, auto-detect" model):

1. **empty or `list`** → **list mode**: run
   `node <skill-dir>/scripts/list-optimizations.cjs` (add `--all` to include finished runs),
   show the table, launch nothing.
2. **matches an existing `.optimize/state/<arg>.json`** → **resume** that run from its ledger.
3. **anything else** → a **new goal**: derive a short kebab `<name>` slug, tell the user the
   slug, propose a metric+gate config (§1b), and — only if not declined — start fresh.

`<name>` (matched or derived) drives everything and is the resume key:

```
.optimize/
  config/<name>.json   # the approved run config (metric, gate, surface, budgets) — §1b
  state/<name>.json    # durable ledger + run state (generations, baseline, best) — §2
  <name>.js            # generated loop conductor (Workflow script) — §2
  reports/<name>.md    # run report (baseline→best, runs/kept, duration, tokens) — §5
```

This mirrors conductor's `.workflows/` namespace. The goal lives in `config/<name>.json` and
the ledger in `state/<name>.json` — both in the **main repo**, so they survive worktree
removal and resume needs only the name. Code edits happen on branch `opt/<name>` inside
worktree `.worktrees/opt-<name>`; **main is never touched** until the human merges.

Examples:

```
make the /search endpoint faster     → proposes a config; slug e.g. search-speed; confirm; runs
search-speed                         → resumes that run from its ledger
list                                 → shows in-progress optimizations
```

## Core model (read `references/loop-runtime.md` before authoring)

A Workflow has two layers; confusing them is the #1 source of bugs:

- **Conductor** = the loop `.js` script. Restricted: pure JS, **no filesystem**, no git, no
  `Date.now()` / `Math.random()`. It only computes the next experiment and dispatches.
- **Workers** = the subagents it spawns. Full tools (`Read`/`Write`/`Edit`/`Bash`). They do
  all side-effects: create the worktree, run the gate + metric, edit the surface, commit or
  revert, and write the ledger.

Therefore the durable ledger is written by a **checkpoint worker** after every experiment,
never by the conductor.

## Procedure

### 1. Resolve `$ARGUMENTS` (list / resume / new)

- **empty or `list`** → run `node <skill-dir>/scripts/list-optimizations.cjs` (`--all` for
  finished), show the table, stop. Done.
- otherwise treat the arg as a candidate `<name>` and read its state (this skill runs in the
  main session, so read directly): `Read .optimize/state/<name>.json`.
  - **file exists, `status: "running"`/`"stopped"`/`"failed"`** → **resume** (step 4). The
    goal and config come from `config/<name>.json`. Do NOT regenerate the loop script if it
    already exists unchanged.
  - **no file (arg is a goal)** → **fresh run**: derive a kebab `<name>` slug, tell the user
    the slug, run **§1b**; if not declined, go to step 2 → step 3.
  - **file exists, `status: "complete"`/`"stopped"`** → tell the user it's done (offer the
    report via `node <skill-dir>/scripts/optimize-report.cjs <name>`); start fresh only if
    they meant a new run.

### 1b. Auto-propose metric + gate, confirm once, measure baseline (new goals only)

This is the heart of the skill and the entire human-in-config step. Read
`references/metric-gate.md` for how to derive each field per goal type and the surface-lock
rule.

1. **Inspect the repo** — `package.json` scripts, Makefile, test dirs, CI config, README,
   any `bench/` — to find an automatable numeric metric and a hard gate.
2. **Propose a config** to `.optimize/config/<name>.json`:

   ```jsonc
   {
     "goal": "make the /search endpoint faster",
     "surface": "src/search/**",           // the train.py analog — the ONLY files the loop may edit
     "metric": { "cmd": "node bench/search.mjs", "parse": "p95=([0-9.]+)", "direction": "min" },
     "gate":   { "cmd": "npm test && npm run build" },   // MUST exit 0 or the candidate is discarded
     "budgets": {
       "evalCapSec": null,        // null → MEASURED at setup (~3× baseline gate+metric time)
       "agentCapSec": 600,        // bound the propose/edit step so a stuck agent can't stall the night
       "total": { "experiments": 100 },  // OR { "wallclockMin": 480 } OR { "tokens": N }
       "plateauStop": 15,
       "minDelta": 0.5            // ignore metric moves below this (noise guard)
     },
     "baseline": "origin/main"
   }
   ```

   - `metric.parse` extracts a number from stdout: a regex capture group, `json:<path>`, or
     `lastnumber`. `direction` is `min` | `max`.
   - **DECLINE if no defensible metric + gate.** Proceed only when you can propose BOTH an
     automatable numeric metric AND a hard gate the metric cannot be gamed against (e.g.
     "fewer lines" needs a gate that fails on deleted behavior). If you cannot find a
     defensible pair, **decline** (or ask one `AskUserQuestion`) rather than inventing one — a
     loop optimizing a gameable metric behind a weak gate will exploit it. This is the
     anti-pattern guard.
3. **Measure the baseline ONCE** — run the gate (must pass; a broken base cannot be
   optimized) + the metric. This confirms `metric.cmd` actually runs and `metric.parse`
   yields a number, and records `evalSec`, which derives `evalCapSec` (~3× `evalSec`) when it
   was left `null`.
4. **Report throughput up front:** `≈ nightBudget / (agentCapSec + evalCapSec)` → tell the
   user "~N experiments tonight" *before* launching.
5. **Confirm once** via `AskUserQuestion`: present the proposed config + baseline metric +
   estimated throughput; the user approves or edits. This is the only human gate.

### 2. Generate the loop conductor (pass config as data; do NOT hand-edit)

Generate the loop conductor deterministically from the approved config — never author it by
hand. The generator emits all mechanical boilerplate (NAME/STATE/BRANCH/SURFACE consts, the
Setup worktree phase, the baseline phase, the experiment loop with propose → bounded eval →
keep-or-discard → surface-lock → checkpoint, the stop-condition checks, and finalize):

```
node <skill-dir>/scripts/scaffold-optimize.cjs --config .optimize/config/<name>.json
```

This writes `.optimize/<name>.js`. Glance at the printed structure to confirm; to change it,
re-run with `--force` — never hand-edit (that reintroduces drift).

### 3. Launch (fresh)

Stamp the ledger at launch so duration is true wall-clock (the checkpoints preserve
`startedAt`):

```
node -e "const fs=require('fs');fs.mkdirSync('.optimize/state',{recursive:true});const f='.optimize/state/<name>.json';if(!fs.existsSync(f))fs.writeFileSync(f,JSON.stringify({name:'<name>',status:'running',startedAt:new Date().toISOString()},null,2))"
```

Then launch with the config as args:

```
Workflow({ scriptPath: ".optimize/<name>.js", args: { config: <config JSON> } })
```

The conductor reads the config (surface, metric, gate, budgets) from `args` and runs the
loop: baseline → experiment loop → stop. Each experiment's checkpoint worker appends to the
ledger (preserving `startedAt`).

### 4. Launch (resume)

Pass the persisted ledger so the conductor continues from `best` and skips done experiments —
no idea is repeated:

```
Workflow({ scriptPath: ".optimize/<name>.js",
           args: { config: <from config/<name>.json>,
                   experiments: <from state.json>,
                   best: <from state.json> } })
```

The loop re-reads the ledger, restores `best`, and continues numbering generations from where
it stopped. All KEPT commits on `opt/<name>` are already on the branch.

### 5. Finalize, report, and the overnight-trigger note

When the Workflow returns, stamp `status` + `finishedAt` (the conductor cannot — the main
session does it). Pick the status from why it stopped: `complete` (budget reached cleanly),
`stopped` (plateau / kill-switch), or `failed` (the Workflow threw, e.g. the baseline gate
failed). The last checkpoint's ledger is preserved, so a later `resume` continues correctly.

```
node -e "const f='.optimize/state/<name>.json';const s=JSON.parse(require('fs').readFileSync(f,'utf8'));s.status='complete';s.finishedAt=new Date().toISOString();require('fs').writeFileSync(f,JSON.stringify(s,null,2))"
```

Then generate the run report (baseline → best % improvement, experiments run/kept, plateau,
duration, tokens, est cost):

```
node <skill-dir>/scripts/optimize-report.cjs <name>
```

Report to the user: the report summary (written to `.optimize/reports/<name>.md`), the
**branch** (`opt/<name>`) + **worktree** (`.worktrees/opt-<name>`) holding the accumulated
KEPT commits, and `git diff <baseline>..opt/<name>` as the review artifact. **Do NOT
auto-merge or auto-remove the worktree** — the human reviews and merges (non-destructive
default).

**Overnight trigger (schedule-ready, not scheduled in v1).** In-session the skill drives the
loop via the Workflow tool and you watch. For unattended overnight runs, the committed config
+ durable ledger let a `/schedule` routine or a standalone Agent SDK runner **resume the same
loop** (step 4) and run overnight; you review the branch + report in the morning. v1 does NOT
wire cron — the engine is schedule-*ready*, matching the Workflow caveat that it cannot run
headless inside a live session.

## Gotchas

- **The gate is the floor.** Nothing is kept unless the deterministic gate passes; the loop
  can never "win" by breaking correctness. A KEPT entry exists **iff** the gate passed AND the
  metric beat `best` by ≥ `minDelta`; everything else is DISCARDED.
- **Surface lock.** After each experiment, `git diff --name-only` must be ⊆ `surface`. If the
  agent touched the metric/gate/harness/config (anything outside the surface glob), **discard**
  the experiment — this is the anti-metric-gaming fence. Globs must allow new matching files
  so a legitimate new file inside the surface is permitted.
- **Non-destructive.** KEPT commits accumulate on `opt/<name>`; **never auto-merged**.
  Revert-on-discard (`git checkout -- <surface>`) keeps the worktree clean — `git status` must
  be clean after every DISCARDED experiment.
- **Idempotent / at-least-once.** The checkpoint is written *after* the commit-or-revert, so a
  crash between them re-runs that experiment. Every experiment body must be idempotent; the
  revert makes a re-run safe.
- **Every experiment is bounded.** The propose step is capped by `agentCapSec` and the eval by
  `evalCapSec` (derived from the setup baseline); either timeout ⇒ discard, recorded. Because
  every experiment is bounded, the whole run is measurable.
- **Plateau = stop, not widen.** Sequential keep-or-discard: no KEPT in the last `plateauStop`
  experiments ⇒ stop. The total stop is the first of `{ experiments, wallclockMin, tokens }`.
- **The conductor cannot write files, timestamps, or randomness** — push all of that into
  workers; vary worker labels by experiment index, not random IDs.
- **Durable ≠ unattended.** The Workflow tool runs inside a live session and cannot be
  triggered by cron or run headless. Overnight needs a `/schedule` routine or an SDK runner
  that resumes the loop (step 4); v1 ships schedule-ready, not scheduled.

## Bundled resources

- `scripts/scaffold-optimize.cjs` — **generates** the loop conductor from the approved config
  (SoT for all loop boilerplate: baseline → experiment loop → keep/discard → surface-lock →
  checkpoint → stop). Use this instead of hand-authoring. Step 2.
- `scripts/optimize-report.cjs` — baseline→best (% improvement), runs/kept, plateau, duration,
  tokens, est cost for one run, written to `.optimize/reports/<name>.md`. Step 5.
- `scripts/list-optimizations.cjs` — list runs from `.optimize/state/` (in-progress by
  default; `--all` for finished). List mode (step 1).
- `scripts/test-optimize.cjs` — regression net for the generator: emits a representative
  matrix of configs, `node --check`s each emitted loop, and asserts the loop structure matches
  the config. Run after any change to `scaffold-optimize.cjs`.
- `references/loop-runtime.md` — the two-layer conductor/worker constraints recap, the ledger
  schema, the resume protocol, and the keep/discard rules. Load before authoring.
- `references/metric-gate.md` — how the auto-propose step (§1b) derives metric / parse /
  direction / gate per goal type, and the surface-lock rule. Load before proposing a config.
