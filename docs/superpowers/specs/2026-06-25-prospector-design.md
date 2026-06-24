# prospector — Autonomous Improvement Loop Skill (design)

- **Status:** approved design, pre-implementation
- **Date:** 2026-06-25
- **Sibling:** `plugins/lirbox/skills/conductor`
- **Inspiration:** Karpathy's `autoresearch` (overnight agent that edits `train.py`, optimizes `val_bpb`, keep-or-discard, "generations")

## Summary

`prospector` is a skill that takes a **goal**, **auto-proposes a success metric + hard gate** (you confirm once), then runs a **sequential keep-or-discard hill-climbing loop** over one declared mutable surface — keeping a change only when it improves the metric *and* passes the gate, reverting otherwise — until a budget is exhausted. Every experiment is wall-clock-bounded, so throughput is predictable and the run is fully measurable. Improvements accumulate on an isolated branch; nothing is auto-merged. It is overnight-capable and resumable.

One-liner: **conductor's durability + autoresearch's metric-driven keep-or-discard.**

## Motivation & positioning

`autoresearch` proves the pattern (one mutable file, one normalized metric, fixed per-run wall-clock, cumulative generations, human reviews in the morning) but hardcodes everything to ML training. `conductor` already provides the durable, resumable, worktree-isolated, Workflow-driven backbone — but for a *fixed sequence of distinct phases*, not an *optimization loop*. `prospector` generalizes autoresearch and reuses conductor's backbone.

| autoresearch | prospector |
|---|---|
| agent edits only `train.py` | a declared **mutable surface** (file/glob) |
| metric = `val_bpb` (lower better, normalized) | **auto-proposed** metric: command → comparable scalar + direction |
| each run = exactly 5 min → ~100 experiments/night | **per-experiment wall-clock cap** → predictable throughput |
| keep-or-discard vs last result | keep iff metric improves **and** the hard gate passes, else revert |
| "10,205th generation" | generations accumulate on a branch; durable ledger |
| `program.md` instructions | goal + skill-derived run config |

**Distinction from conductor:** conductor runs *one* path through distinct phases (a linear FSM); prospector hill-climbs *one mutable surface* against a metric (repeat-until-budget with keep/revert). Different control structure → standalone skill, shared infrastructure.

## Decisions locked (from brainstorming)

1. **Metric model:** the skill **auto-proposes** a metric command + direction + a hard gate from goal + repo; the user **confirms once**; then it runs unattended.
2. **Loop shape:** **sequential keep-or-discard** (faithful to autoresearch; cheapest; predictable throughput). No parallel/adaptive in v1.
3. **Structure:** **standalone skill** (`prospector`) that **reuses conductor's backbone** (worktree isolation, durable JSON state, report, scaffold-from-params). Converges with a committed runner for the overnight trigger.

## Architecture

### §1 Run config — auto-proposed metric/gate (the heart)

On `prospector <goal>`, a setup agent inspects the repo (package.json scripts, Makefile, test dirs, CI config, README) and proposes a committed config:

```jsonc
// .optimize/config/<name>.json
{
  "goal": "make the /search endpoint faster",
  "surface": "src/search/**",          // the train.py analog — the ONLY files the loop may edit
  "metric": { "cmd": "node bench/search.mjs", "parse": "p95=([0-9.]+)", "direction": "min" },
  "gate":   { "cmd": "npm test && npm run build" },   // MUST exit 0 or the candidate is discarded
  "budgets": {
    "evalCapSec": null,        // null → MEASURED at setup (~3× baseline gate+metric time); set a number to pin it
    "agentCapSec": 600,        // bound the propose/edit step so a stuck agent can't stall the night
    "total": { "experiments": 100 },  // OR { "wallclockMin": 480 } OR { "tokens": N } — first to hit stops the run
    "plateauStop": 15,
    "minDelta": 0.5            // ignore metric moves below this (noise guard)
  },
  "baseline": "origin/main"
}
```

- `metric.parse` extracts a number from the command's stdout (regex capture group, or `json:<path>`, or `lastnumber`).
- `direction`: `min` | `max`.
- Auto-proposal examples: "reduce bundle size" → metric = built bytes (`min`), gate = build+tests; "raise coverage" → metric = coverage % (`max`), gate = tests green.
- **Decline if no defensible metric + gate.** The skill proceeds only when it can propose BOTH an automatable numeric metric AND a hard gate the metric cannot be gamed against (e.g. "fewer lines" needs a gate that fails on deleted behavior). If it can't find a defensible pair it **declines** (or asks) rather than inventing one — a loop optimizing a gameable metric behind a weak gate will exploit it.
- **Setup measures the baseline once** (runs gate + metric): this confirms the metric command actually works and yields the eval time that derives the per-experiment cap (§3).
- **Confirm once:** the skill presents the proposed config; the user approves/edits; this is the entire human-in-config step.

### §2 The loop & generation ledger

Sequential keep-or-discard on branch `opt/<name>` in worktree `.worktrees/opt-<name>`:

1. **Baseline:** run gate (must pass) + metric → `best`. If the baseline gate fails, stop (cannot optimize a broken base).
2. **Each experiment `g`:**
   - **Propose:** an agent makes ONE focused edit to the surface, given the goal + the **ledger of past experiments** (what was tried, metric delta, kept/discarded) so it does not repeat ideas.
   - **Eval (bounded):** run gate; fail → discard. Pass → run metric. The propose step is bounded by `agentCapSec` and the eval by `evalCapSec` (§3); either timeout → discard.
   - **Keep-or-discard:** gate passed AND metric strictly better than `best` by ≥ `minDelta` → commit on the branch, advance `best`, record **KEPT**; else `git checkout -- <surface>` (revert) and record **DISCARDED**.
   - **Checkpoint:** append to the durable ledger.
3. **Stop** on the first budget/condition hit (see §3).

```jsonc
// .optimize/state/<name>.json  (durable ledger + run state)
{
  "name": "search-speed", "status": "running|complete|failed|stopped",
  "branch": "opt/search-speed", "worktree": ".worktrees/opt-search-speed",
  "baseline": { "metric": 41.2, "sha": "..." },
  "best":     { "metric": 33.8, "sha": "...", "experiment": 27 },
  "experiments": [
    { "g": 1, "change": "cache compiled regex", "metric": 39.9, "gate": "pass", "kept": true,  "sha": "...", "sec": 188, "tokens": 5123 },
    { "g": 2, "change": "swap sort algo",       "metric": 42.1, "gate": "pass", "kept": false, "sec": 201, "tokens": 4880 }
  ],
  "startedAt": "...", "updatedAt": "...", "finishedAt": null
}
```

The ledger merges autoresearch "generations" with conductor's durable state: it drives **resume** (re-read, continue from `best`) and morning review.

### §3 Budget & throughput control

The per-experiment cap is **derived, not fixed.** autoresearch's 5 min is welded to its single-GPU
setup, where 5 min of training *is* both the experiment and the signal. Here an experiment's time is
*agent propose/edit + eval*, and eval cost is wildly project-specific (10s test suite vs. 18-min
test+bench), so a fixed cap either kills slow evals or wastes time on fast ones. Instead:

- **Measure once at setup:** run gate + metric and record `evalSec` (this also proves the metric command works).
- **Two clocks, each bounding a discard:**
  - **`evalCapSec`** ≈ `factor × evalSec` (default factor ~3 — generous enough to measure a change that
    legitimately got slower, tight enough to kill an infinite loop). Override to pin.
  - **`agentCapSec`** — bounds the propose/edit step so a stuck agent can't stall the night.
- **Throughput reported up front**, not assumed: `≈ nightBudget / (agentCapSec + evalCapSec)` → you
  see "~N experiments tonight" *before* launching instead of hoping for 100.
- **Total stop:** first of `{ experiments, wallclockMin, tokens }`.
- **Plateau stop:** no KEPT in the last `plateauStop` experiments ⇒ stop (sequential, so plateau = stop, not widen).
- **`minDelta`:** ignore metric moves below this (noise guard for non-deterministic benchmarks).
- Every experiment is bounded ⇒ the whole run is measurable.

The tradeoff the derivation balances: a **shorter** cap = more, cheaper experiments but a noisier /
under-powered metric (and a bias toward changes that are fast to eval); a **longer** cap = fewer,
higher-signal experiments. That balance is per-project — which is why it's measured, not copied.

### §4 Isolation & safety

- All edits in `.worktrees/opt-<name>` on branch `opt/<name>`; **main untouched**. State/ledger live in the **main repo** (`.optimize/`) so they survive worktree removal.
- **Surface lock:** after each experiment, `git diff --name-only` must be ⊆ `surface`. If the agent touched the metric/gate/harness/config (outside the surface), **discard the experiment** — prevents metric-gaming.
- **Gate is the floor:** nothing is kept unless the deterministic gate passes. The loop can never "win" by breaking correctness.
- **Non-destructive:** KEPT commits accumulate on the branch; **never auto-merged**; the human reviews + merges. Revert-on-discard keeps the worktree clean.
- **Kill-switch + token/$ ceiling.**

### §5 Reporting

Per-run report (`.optimize/reports/<name>.md`): baseline → best (% improvement), experiments run/kept, plateau, duration, tokens, est cost; the `git diff baseline..opt/<name>` as the review artifact; and a short "what kinds of changes helped/didn't" synthesis derived from the ledger.

### §6 Overnight trigger (separate from the engine)

- **In-session (attended):** the skill drives the loop via the Workflow tool; you watch.
- **Unattended (overnight):** the committed config + ledger let a `/schedule` routine or a standalone Agent SDK runner **resume the same loop** and run overnight; you review the branch + report in the morning.
- v1 does **not** wire cron — the engine is schedule-*ready*. (Matches the Workflow caveat: it cannot run headless; unattended needs a `/schedule` routine or SDK runner.)

## Use cases & anti-patterns

**Fit test:** an objective scalar metric that is automatable and not-too-expensive, a hard correctness
gate the metric cannot be gamed against, and a bounded surface where many small changes plausibly move
the metric.

**Good fits:**

| Use case | metric (direction) | gate | surface |
|---|---|---|---|
| Hot-path performance (canonical) | bench p95 / ops-sec (min/max) | tests green | the hot module |
| Bundle / binary size | built artifact bytes (min) | build + tests + smoke E2E | source + build config |
| Memory / allocations | peak RSS from a profile harness (min) | tests | the allocating module |
| Test-suite speedup | suite wall-clock (min) | same tests pass + **coverage floor** | test config / parallelism |
| Eval-score quality (the true autoresearch analog) | accuracy / recall@k / eval pass-rate (max) | smoke tests | heuristic / model / chunking / ranking code |
| LLM pipeline cost | $ or tokens per request (min) | quality-eval ≥ threshold | prompt / pipeline code |
| Compiler / flag / config tuning | runtime under config (min) | correctness tests | build flags / config |

Strongest fits: **performance, size, eval-score** — cheap, trustworthy numbers, gameable only if the gate is weak.

**Anti-patterns (the auto-propose step should decline these):**
- **No objective metric** (UI "niceness", API "ergonomics") — nothing to hill-climb; use conductor or a human.
- **Gameable metric + weak gate** ("reduce lines", "raise coverage %" behind a thin gate) — the loop deletes
  needed code or adds assertion-free tests. Prospector is only as safe as its gate.
- **One-shot change** (a single feature) — nothing to climb; that's conductor.
- **Eval costs hours each** — throughput too low to converge overnight.

Unifying line: prospector earns its keep when you have *a dial it can read automatically and a fence it
can't climb over*. The auto-propose step (§1) uses exactly this to say no to bad-fit goals.

## Components / files

```
plugins/lirbox/skills/prospector/
  SKILL.md                       # arguments (goal | resume <name> | list), procedure, gotchas
  scripts/
    scaffold-optimize.cjs        # generate the loop conductor (.optimize/<name>.js) from config — SoT for boilerplate
    list-optimizations.cjs       # list runs from .optimize/state/ (in-progress; --all for done)
    optimize-report.cjs          # baseline→best, runs/kept, duration, tokens, est cost → .optimize/reports/<name>.md
  references/
    loop-runtime.md              # conductor two-layer constraints recap; ledger schema; resume protocol; keep/discard rules
    metric-gate.md               # how auto-propose derives metric/parse/direction/gate per goal type; surface-lock rule
```

Run-state namespace (mirrors conductor's `.workflows/`):

```
.optimize/
  config/<name>.json   # the approved run config (§1)
  state/<name>.json    # durable ledger + run state (§2)
  <name>.js            # generated loop conductor (Workflow script)
  reports/<name>.md    # run report (§5)
```

## Reuse-from-conductor map

| Concern | Reused from conductor |
|---|---|
| Worktree isolation (one shared tree, branch from fresh origin) | Setup-phase worker pattern |
| Durable cross-session state written by a worker | checkpoint-worker + `startedAt`-preserving merge |
| Restricted conductor / full-tool workers split | two-layer execution model |
| Generate boilerplate from params, edit only task-specific bits | scaffold-from-params approach |
| Run report (duration/tokens/est cost) | report-script pattern |
| `list` / `resume` / new arg resolution | `$ARGUMENTS` one-arg auto-detect |

## YAGNI cuts (v1)

- No parallel or adaptive exploration (sequential only).
- No LLM-judge metric (numeric metric + deterministic gate only; ask if none derivable).
- No auto-merge; no built-in cron (schedule-ready, not scheduled).

## Verifiable success criteria

1. **Config derivation:** in a repo exposing `npm test` and a bench script, `prospector "<goal>"` emits a config whose `metric.cmd` runs and `metric.parse` extracts a number, `metric.direction` is set, and `gate.cmd` runs; the run halts for user confirmation before looping.
2. **Keep rule:** a KEPT ledger entry exists **iff** that experiment's gate passed and its metric beat `best` by ≥ `minDelta`; every other experiment is DISCARDED and leaves the worktree clean (`git status` clean after revert).
3. **Monotonic best:** `best.metric` is non-worsening across the run (≤ baseline for `min`, ≥ for `max`); checking out `opt/<name>` reproduces `best.metric` within `minDelta`.
4. **Per-experiment bound:** the propose step never exceeds `agentCapSec` and the eval never exceeds `evalCapSec` (derived from the setup baseline); either timeout ⇒ discard, recorded.
5. **Surface lock:** an experiment that edits a file outside `surface` is discarded (verify by injecting an out-of-surface edit).
6. **Stop conditions:** the run stops at the first of {N experiments, wall-clock, tokens, plateau}; `status` reflects why.
7. **Resume:** interrupting mid-run and re-invoking `prospector <name>` continues from the ledger with all KEPT commits intact and no repeated experiments.
8. **Non-destructive:** `main` is byte-unchanged after a run; no merge happens without the human.
9. **Report:** `optimize-report.cjs <name>` outputs baseline→best (% improvement), runs/kept, duration, tokens, est cost.

## Open questions (resolve during planning)

- **Metric noise:** for non-deterministic metrics, do we run the metric command `k` times and take median? (v1: single run + `minDelta`; revisit if flaky.)
- **Propose-agent context budget:** how much of the ledger to feed the propose agent as it grows (full vs. last-N + best). 
- **Gate cost:** if the gate (full test suite) is slow, throughput drops; do we allow a fast "smoke" gate per experiment + a full gate before a KEEP commit? (Likely yes — two-tier gate — but deferred unless needed.)
- **Surface lock enforcement** when a change legitimately needs a new file inside the surface glob (globs must allow new matching files).

## Implementation outline (high level; details → writing-plans)

1. Skill skeleton (`SKILL.md` + arg resolution) mirroring conductor.
2. `metric-gate.md` + the auto-propose setup agent prompt (goal → config).
3. `scaffold-optimize.cjs` — generate the loop conductor (baseline → experiment loop → checkpoint → stop), reusing conductor's Setup/worktree + checkpoint patterns.
4. The keep-or-discard + surface-lock + timeout logic inside the generated loop's workers.
5. `optimize-report.cjs` + `list-optimizations.cjs`.
6. Dry-run on a toy repo against criteria 1–9.
