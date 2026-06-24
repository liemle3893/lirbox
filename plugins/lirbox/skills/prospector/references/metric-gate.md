# Metric + Gate — Auto-Proposing the Run Config

Reference for the prospector skill's **§1b auto-propose step** (the heart of the skill and the
entire human-in-config step). Load before proposing a config. Covers: how to derive the metric
(`cmd`/`parse`/`direction`) AND a hard gate from a goal + repo; the **DECLINE** rule; the
**baseline-measurement** step; the **surface-lock** rule; and a ready-to-use **setup-agent prompt
template**.

The deal prospector offers: it only earns its keep when you can hand it **a dial it can read
automatically and a fence it can't climb over**. The whole job of this step is to find that pair —
or to say **no**.

---

## 1. What the config must contain (spec §1)

```jsonc
// .optimize/config/<name>.json
{
  "goal": "make the /search endpoint faster",
  "surface": "src/search/**",          // the train.py analog — the ONLY files the loop may edit
  "metric": { "cmd": "node bench/search.mjs", "parse": "p95=([0-9.]+)", "direction": "min" },
  "gate":   { "cmd": "npm test && npm run build" },   // MUST exit 0 or the candidate is discarded
  "budgets": {
    "evalCapSec": null,        // null → MEASURED at setup (~3× baseline gate+metric time); a number pins it
    "agentCapSec": 600,        // bound the propose/edit step so a stuck agent can't stall the night
    "total": { "experiments": 100 },  // OR { "wallclockMin": 480 } OR { "tokens": N } — first to hit stops
    "plateauStop": 15,
    "minDelta": 0.5            // ignore metric moves below this (noise guard)
  },
  "baseline": "origin/main"
}
```

The metric and gate are the load-bearing fields. The rest are throughput/safety knobs derived or
left at sane defaults.

---

## 2. Deriving the metric — `cmd`, `parse`, `direction`

A metric is an **automatable command that emits one comparable scalar**, plus how to extract it and
which way is "better".

### `cmd` — find a command that already exists, or the cheapest one to add
Inspect, in order: `package.json` scripts, `Makefile` / `justfile`, `bench/` or `benchmarks/`,
test dirs, CI config (`.github/workflows`, `.gitlab-ci.yml`), README. Prefer a command the repo
**already runs** (a bench script, a size report, a coverage run). Only propose a tiny new harness
when none exists and the goal clearly needs one — and put that harness **outside** the surface so
the loop can't edit it (surface lock).

### `parse` — extract the scalar from stdout
Three forms (the eval worker applies the rule to the command's stdout):
- **Regex with one capture group** — e.g. `"p95=([0-9.]+)"` pulls `41.2` from `p95=41.2 ...`.
- **`json:<dot.path>`** — e.g. `"json:metrics.p95"` reads a field from JSON stdout.
- **`lastnumber`** — the last number printed (a robust default when the command prints a single
  summary line). Use when the tool's output format is stable but un-regexable.

The parse rule MUST yield a **finite number**; the baseline step proves it does before the loop runs.

### `direction` — `min` or `max`
`min` = lower is better (latency, bytes, RSS, $/request, wall-clock). `max` = higher is better
(throughput, coverage %, accuracy, recall@k, pass-rate). This sign drives both the keep rule
(`isBetter`) and the report's "% improvement".

---

## 3. Deriving the hard gate — `gate.cmd`

The gate is the **correctness floor**: a deterministic command that MUST exit 0 or the candidate is
discarded, no matter what the metric did. Its job is to make the metric **un-gameable** — it must
fail on exactly the behavior the metric would otherwise tempt the loop to destroy.

- Start from the repo's test command (`npm test`, `pytest`, `go test ./...`, `cargo test`).
- **Strengthen it to close the specific exploit of this metric**, e.g.:
  - metric = built bytes (`min`) → gate = build **+** tests **+** a smoke E2E (so the loop can't
    delete shipped behavior to shrink the bundle).
  - metric = coverage % (`max`) → gate = tests pass **+ a coverage floor on a curated subset** (so
    the loop can't add assertion-free tests to inflate the number).
  - metric = wall-clock of the test suite (`min`) → gate = same tests pass **+ a coverage floor**
    (so the loop can't speed the suite up by deleting tests).
- The gate is run **twice per experiment context**: once at baseline (must pass — a broken base
  can't be optimized) and once per experiment (fail → discard before the metric is even measured).

---

## 4. Good-fit examples (spec "Use cases")

The auto-propose step is on solid ground when the goal maps onto one of these. Strongest fits —
**performance, size, eval-score**: cheap, trustworthy numbers, gameable only if the gate is weak.

| Use case | metric (direction) | gate | surface |
|---|---|---|---|
| Hot-path performance (canonical) | bench p95 / ops-sec (min/max) | tests green | the hot module |
| Bundle / binary size | built artifact bytes (min) | build + tests + smoke E2E | source + build config |
| Memory / allocations | peak RSS from a profile harness (min) | tests | the allocating module |
| Test-suite speedup | suite wall-clock (min) | same tests pass + **coverage floor** | test config / parallelism |
| Eval-score quality (the true autoresearch analog) | accuracy / recall@k / eval pass-rate (max) | smoke tests | heuristic / model / chunking / ranking code |
| LLM pipeline cost | $ or tokens per request (min) | quality-eval ≥ threshold | prompt / pipeline code |
| Compiler / flag / config tuning | runtime under config (min) | correctness tests | build flags / config |

Quick mappings the inspector can reuse: "reduce bundle size" → metric = built bytes (`min`), gate =
build + tests; "raise coverage" → metric = coverage % (`max`), gate = tests green + curated floor.

---

## 5. The DECLINE rule (spec §1 — the anti-pattern guard)

**Proceed only when you can propose BOTH (a) an automatable numeric metric AND (b) a hard gate the
metric cannot be gamed against.** If you cannot find a defensible pair, **DECLINE** (or ask one
`AskUserQuestion`) — do **not** invent one. A loop optimizing a gameable metric behind a weak gate
will exploit it: it will delete needed code, add assertion-free tests, or edit the benchmark.

Decline these (they fail the fit test):
- **No objective metric** — UI "niceness", API "ergonomics", "cleaner code". Nothing to hill-climb;
  use conductor or a human reviewer.
- **Gameable metric + only a weak gate available** — "reduce lines" with no behavioral gate, or
  "raise coverage %" behind a thin gate. If you can't strengthen the gate to close the exploit,
  decline; prospector is only as safe as its gate.
- **One-shot change** — a single feature with nothing to climb. That's conductor.
- **Eval costs hours each** — throughput too low to converge overnight (`nightBudget / evalSec` is
  a handful of experiments).

When declining, name **which half is missing** (no defensible metric, or no gate that closes the
exploit) so the user can either supply it or pick a different tool.

---

## 6. Baseline measurement (spec §1/§3) — measure once, before the loop

After proposing the config, **measure the baseline exactly once** (the loop's setup/baseline phase
does this; the proposer should describe it so the user knows what will run):

1. **Run the gate — it MUST exit 0.** A broken base cannot be optimized; if it fails, stop and fix
   the base (or the gate) first.
2. **Run the metric and parse it.** This proves `metric.cmd` actually runs and `metric.parse` yields
   a finite number on this repo — the single most common config bug, caught before 100 experiments.
3. **Record `evalSec`** = the wall-clock the gate+metric took. This **derives** the per-experiment
   `evalCapSec` (~3× `evalSec`) when it was left `null`, and feeds the up-front throughput estimate
   `≈ nightBudget / (agentCapSec + evalCapSec)` → tell the user "~N experiments tonight" *before*
   launching.

The baseline metric becomes `best` (experiment `0`); every later experiment is judged against it.

---

## 7. Surface lock (spec §4)

`surface` is the **train.py analog**: a file or glob (`src/search/**`, or a comma/newline-separated
list) that is the **ONLY** thing the loop may edit. After each experiment, every changed path
(tracked edits **and** new untracked files — the eval worker uses `git status --porcelain
--untracked-files=all`, not bare `git diff --name-only`) must be a subset of `surface`; any file
outside ⇒ **discard** (the anti-metric-gaming fence — it stops the loop from editing the benchmark,
the gate, the harness, or unrelated code).

When proposing `surface`:
- Make it **tight enough** that the metric+gate genuinely fence the change (don't include the
  metric harness, the gate's test files, or build config the loop shouldn't touch — unless the goal
  *is* config tuning, in which case the config IS the surface and the gate is the correctness tests
  outside it).
- Make it a **glob that allows new matching files** (`src/search/**`, not a fixed file list) so a
  legitimate new file inside the surface is permitted.
- Keep the **metric harness and gate outside the surface** so the loop can never edit what judges it.

---

## 8. Setup-agent prompt template (ready to use)

The skill dispatches a setup agent with this prompt to inspect the repo and emit the proposed
config. The agent runs in the main repo (full tools), inspects, and returns a structured config the
skill presents for the one confirmation. Fill `<GOAL>` and `<NAME>`.

```
You are proposing a prospector optimization run config. The user's goal is:

    <GOAL>

Prospector runs a sequential keep-or-discard hill-climbing loop over ONE declared code surface,
behind a hard correctness gate, optimizing a single numeric metric. Your job: inspect this repo and
propose a DEFENSIBLE config, or DECLINE if no defensible metric+gate pair exists.

STEP 1 — Inspect (read only; do not edit):
  - package.json scripts, Makefile/justfile, bench/ or benchmarks/, test dirs, CI config
    (.github/workflows, .gitlab-ci.yml), README. Identify:
    (a) an AUTOMATABLE command that emits ONE comparable scalar (latency, bytes, RSS, coverage %,
        accuracy, $/req, wall-clock, …) — prefer a command the repo ALREADY runs;
    (b) a HARD GATE command (exits 0/non-0) that fails on exactly the behavior the metric would
        tempt the loop to destroy (tests, build, smoke E2E, coverage floor as needed);
    (c) a BOUNDED surface (file/glob) where many small changes plausibly move the metric, with the
        metric harness and gate tests OUTSIDE it.

STEP 2 — Decide:
  - If you can propose BOTH a numeric metric AND a gate that closes the metric's exploit → propose
    the config (STEP 3) with decline=false.
  - If EITHER half is missing (no objective metric; or no gate that makes the metric un-gameable;
    or this is a one-shot change with nothing to climb; or each eval costs hours) → DECLINE:
    decline=true, and in `reason` name WHICH half is missing and suggest the alternative
    (conductor, a human reviewer, or a metric the user could supply). Do NOT invent a gameable
    metric behind a weak gate.

STEP 3 — If not declining, propose the config:
  - metric.cmd: the command to run.  metric.parse: a regex with ONE capture group, OR `json:<dot.path>`,
    OR `lastnumber`.  metric.direction: `min` (lower better) or `max` (higher better).
  - gate.cmd: the hard gate command (may chain with `&&`).
  - surface: the file/glob the loop may edit (glob that allows new matching files).
  - baseline: the ref to branch from (e.g. `origin/main`).
  - Note (in `summary`) the gate+metric you'd run to MEASURE THE BASELINE once, and roughly how long
    you expect it to take (drives the per-experiment eval cap and the throughput estimate).

Return ONLY the structured config (or the decline). Do not run the gate/metric yet and do not edit
any files — the baseline measurement and confirmation happen after the user approves.
```

Suggested structured-output schema for the agent:

```jsonc
{
  "type": "object", "additionalProperties": false,
  "required": ["decline"],
  "properties": {
    "decline": { "type": "boolean" },
    "reason":  { "type": "string" },            // required-in-spirit when decline=true
    "goal":    { "type": "string" },
    "surface": { "type": "string" },
    "metric":  { "type": "object", "properties": {
      "cmd": { "type": "string" }, "parse": { "type": "string" },
      "direction": { "type": "string", "enum": ["min", "max"] } } },
    "gate":    { "type": "object", "properties": { "cmd": { "type": "string" } } },
    "baseline": { "type": "string" },
    "summary": { "type": "string" }             // the baseline plan + expected eval time
  }
}
```

After the agent returns: if `decline` → relay the reason and stop. Else write
`.optimize/config/<name>.json` (filling `budgets` with the defaults above unless the user pins
them), present it + the measured baseline + the up-front throughput estimate, and take the single
`AskUserQuestion` confirmation before generating and launching the loop.
