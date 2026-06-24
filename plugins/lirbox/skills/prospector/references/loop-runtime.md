# Loop Runtime — Constraints, Ledger Schema, Keep/Discard, Resume

Reference for the prospector skill. Load when authoring or debugging the optimization
loop conductor (`.optimize/<name>.js`). Prospector reuses conductor's two-layer Workflow
backbone; this is the prospector-specific recap plus the ledger schema, the keep-or-discard
+ surface-lock + two-clock-budget rules, and the resume protocol.

---

## 1. The two-layer execution model (the key mental model)

A Workflow run has two distinct execution contexts. Confusing them causes most mistakes.

| Layer | What runs there | Capabilities |
|---|---|---|
| **Conductor** | the loop `.js` script (`meta`, `phase()`, the experiment `for` loop, the pure decision helpers `isBetter`/`shouldStop`/`deriveEvalCap`/`surfaceAllows`, control flow) | **Restricted.** Pure JS only — NO filesystem, NO Node APIs, NO network, NO git. `Date.now()` / `new Date()` / `Math.random()` are **blocked**. `JSON`, `Array`, `Math` (non-random) are fine. |
| **Workers** | every subagent spawned by `agent()` (setup, baseline, propose, eval, keep, revert, checkpoint) | **Full Claude Code tools** — `Read`, `Write`, `Edit`, `Bash`, `Grep`, etc. Run in the real environment. Do all side-effects here. |

Consequences specific to the loop:
- The conductor **cannot write the ledger** — the **checkpoint worker** does it after every experiment.
- The conductor **cannot run the gate or metric** — the baseline/eval workers do, then return structured `{gatePassed, metric, diffFiles, sec, tokens}`; the conductor makes the keep-or-discard **decision** from those values.
- The conductor **cannot create the worktree, commit, or revert** — those are workers (setup, keep, revert).
- The conductor **cannot generate timestamps or randomness** — vary worker labels by experiment index (`propose:${g}`), never `Math.random()`; timestamps are injected by the checkpoint worker.
- The conductor **cannot read a wall-clock or token counter** — so `shouldStop`'s `elapsedMin`/`tokensUsed` are supplied via resume `args` (and are `undefined` on a fresh in-session run, where only the count + plateau stops apply live).

This restriction exists so the conductor is **deterministic and replayable** — required for
resume to be correct.

**Division of labor that makes the loop safe:** the worker only **measures** (it never decides
keep), and the conductor only **decides** (it never touches the filesystem). The keep-or-discard
verdict is therefore pure JS over plain values returned by the worker — auditable and replayable.

---

## 2. Native subagent capabilities (do NOT reimplement these)

The Workflow tool already provides subagent orchestration; prospector uses only `agent()`:
- `agent(prompt, opts)` — spawn one subagent. With `schema` (JSON Schema) it **forces validated
  structured JSON** back (retries on mismatch). Returns `null` if the agent dies after retries —
  guard every result (`if (!evalRes || !evalRes.gatePassed) …`).
- `opts`: `label` (vary by experiment index), `phase` (`Setup`/`Baseline`/`Experiments`), `schema`.
- The loop is **sequential** by design (spec §2): each experiment depends on the prior `best`, so
  there is **no** `parallel()`/`pipeline()` in v1. Do not add concurrency — keep-or-discard is a
  hill-climb against the single running `best`.

Prospector adds **only** the metric-driven keep-or-discard loop + a durable ledger + a resume
protocol on top of this. It does not replace dispatch.

---

## 3. Ledger / state-file schema (spec §2)

**Path:** `.optimize/state/<name>.json` (relative to repo root).

The state file is the durable **ledger** (autoresearch "generations") merged with conductor's
run state. It drives both **resume** (re-read → continue from `best`) and the **morning review**.

**Schema:**
```jsonc
{
  "name": "search-speed",                 // matches meta.name; the resume key
  "status": "running | complete | failed | stopped",
  "branch": "opt/search-speed",           // isolated branch holding the KEPT commits
  "worktree": ".worktrees/opt-search-speed",
  "goal": "make the /search endpoint faster",
  "surface": "src/search/**",             // the ONLY files the loop may edit (surface lock)
  "baseline": { "metric": 41.2, "sha": "...", "evalSec": 62 },  // measured once at setup
  "best":     { "metric": 33.8, "sha": "...", "experiment": 27 },// the running champion
  "experiments": [                        // one entry per experiment, in order (the generations)
    { "g": 1, "change": "cache compiled regex", "metric": 39.9, "gate": "pass", "kept": true,  "sha": "...", "sec": 188, "tokens": 5123 },
    { "g": 2, "change": "swap sort algo",       "metric": 42.1, "gate": "pass", "kept": false, "sha": null,  "sec": 201, "tokens": 4880 }
  ],
  "startedAt": "ISO-8601 — set once, then preserved by every checkpoint",
  "updatedAt": "ISO-8601 — refreshed by every checkpoint worker",
  "finishedAt": "ISO-8601 — set by the SKILL (main session) at finalize, else null"
}
```

Field notes:
- `baseline.evalSec` is the wall-clock the gate+metric took at setup — it **derives** the
  per-experiment eval cap (`deriveEvalCap`, ~3× `evalSec`) when `budgets.evalCapSec` is `null`.
- `best.experiment` is the generation index that produced the champion (`0` = baseline). On resume
  the conductor rejects a `best.experiment` greater than `experiments.length` as a corrupt/forged
  ledger.
- Each `experiments[]` entry: `metric` is `null` when the metric failed to parse or timed out;
  `gate` is `"pass"`/`"fail"`; `kept` is the keep-or-discard verdict; `sha` is the commit on the
  branch (only set when `kept`); `sec`/`tokens` are per-experiment cost (may be `null`).
- `direction` (`min`/`max`) lives in `config/<name>.json`, **not** in the state file. The report
  reads the config to compute "% improvement" with the correct sign.

**Provenance / who writes what:**
- Written by a **checkpoint subagent** after each experiment. The generated `checkpoint()` does a
  `startedAt`-preserving merge: read prev `startedAt`/`finishedAt` → write the canonical payload +
  fresh `updatedAt`. The conductor serializes the bytes; the worker only writes them and stamps the
  timestamps.
- `status` is `running` during checkpoints; the **skill** (main session) flips it to
  `complete` (budget reached cleanly), `stopped` (plateau / kill-switch), or `failed` (the
  Workflow threw, e.g. the baseline gate failed) after the run returns.

The state file lives in the **main repo** (`.optimize/state/`), NOT in the worktree — so it
survives `git worktree remove` and stays readable for resume.

---

## 4. The loop rules: keep-or-discard, surface lock, two-clock budget

### Keep-or-discard (spec §2/§4)
After each experiment the conductor keeps the change **iff ALL THREE hold**, else reverts:

1. **Gate passes** — the deterministic gate exited 0 (the correctness **floor**; nothing is kept
   if it breaks correctness). `gatePassed === true`.
2. **Metric strictly better by ≥ `minDelta`** — `isBetter(metric, best.metric, direction, minDelta)`:
   - `min` → keep iff `best - metric >= minDelta`.
   - `max` → keep iff `metric - best >= minDelta`.
   - A non-finite metric (failed parse / timeout) **never** beats best.
   - `minDelta` is the noise guard: metric moves below it are ignored.
3. **Surface lock holds** — every changed path is within the `surface` glob
   (`surfaceAllows(diffFiles, surface)`). The eval worker lists changed paths with
   `git status --porcelain --untracked-files=all` (NOT `git diff --name-only`, which misses new
   untracked files — an out-of-surface new file would otherwise slip the lock).

KEEP → a worker stages the change (`git add -A`, safe because the surface lock already verified
every changed path is ⊆ the surface) and commits on `opt/<name>`; the conductor advances `best` and
resets the plateau counter. DISCARD → a worker resets the WHOLE worktree to HEAD
(`git reset --hard HEAD` + `git clean -fd`, NOT a surface-scoped checkout — the candidate may have
touched files outside the surface, which is itself a discard reason, and those must not survive;
prior KEPT commits are on the branch, so only the uncommitted candidate is dropped) so `git status`
is clean for the next experiment, and the plateau counter increments. **A KEPT ledger entry exists
iff all three held.**

### Surface lock (spec §4 — the anti-metric-gaming fence)
The loop may only ever edit the declared `surface`. If the propose agent touched the
metric/gate/harness/config or anything **outside** the surface glob, the experiment is **discarded**
— otherwise the loop could "win" by editing the benchmark or weakening the gate. The glob matcher
supports `**`/`*`/`?` and **allows new matching files** (so a legitimate new file inside the surface
is permitted). An empty diff (no files touched) also fails the lock — an experiment must change the
surface to count.

### Two-clock budget (spec §3 — every experiment is bounded)
Each experiment has **two independent caps, each bounding a discard**:
- **`agentCapSec`** bounds the **propose/edit** step — a stuck agent can't stall the night.
- **`evalCapSec`** bounds the **eval** (gate then metric). It is **derived, not fixed**:
  `deriveEvalCap(evalSec, factor)` ≈ `factor × baseline evalSec` (default factor ~3 — generous
  enough to measure a change that legitimately got slower, tight enough to kill an infinite loop),
  floored at 30s. A pinned `budgets.evalCapSec` overrides the derived value.
- Either timeout ⇒ **discard**, recorded in the ledger.

Because every experiment is bounded, the whole run is **measurable**: throughput
≈ `nightBudget / (agentCapSec + evalCapSec)` is reported up front, not assumed.

### Stop conditions (spec §3)
`shouldStop` returns the **first** hit reason (or `null`):
- **Total** — first of `{ experiments, wallclockMin, tokens }` (`wallclockMin`/`tokens` need the
  worker-supplied `elapsedMin`/`tokensUsed`; count is always live).
- **Plateau** — no KEPT in the last `plateauStop` experiments ⇒ stop. Sequential keep-or-discard
  means **plateau = stop, not widen** (there is no exploration to broaden).

---

## 5. Resume protocol (spec §2)

The prospector **skill runs in the main Claude Code session**, which has full tools — so the skill
reads the ledger and config directly (only the *conductor* is restricted).

On (re)entry with an arg that matches an existing `.optimize/state/<name>.json`:
1. **Read** `.optimize/state/<name>.json` (the ledger) and `.optimize/config/<name>.json` (the
   approved metric/gate/surface/budgets).
2. If absent → it is a **new goal**, not a resume (run §1b auto-propose instead).
3. If `status: "complete"` → tell the user it's done (offer the report); start fresh only if they
   meant a new run.
4. If `status` ∈ {`running`, `failed`, `stopped`} → **resume**: re-launch the same loop script,
   passing the persisted ledger as `args` so the conductor **continues from `best`**:
   ```
   Workflow({ scriptPath: ".optimize/<name>.js",
              args: { config: <config/<name>.json>,
                      experiments: <state.experiments>,
                      best: <state.best>,
                      baseline: <state.baseline> } })
   ```
   The conductor:
   - rebuilds `ledger` from `args.experiments`, restores `best` from `args.best`, and restores the
     measured `baseline` from `args.baseline` (so it re-derives the eval cap from `baseline.evalSec`
     and re-persists `baseline` at every checkpoint — omitting it overwrites the saved baseline with
     null and the report loses baseline→best);
   - reconstructs the plateau counter `sinceKept` by scanning back from the ledger tail;
   - **skips the Baseline phase** (best is already set) and continues numbering generations from
     `experiments.length + 1` — so **no idea is repeated** (the propose agent is fed the ledger
     digest);
   - validates **resume reachability**: `best.metric` must be finite and `best.experiment` must not
     exceed `experiments.length`, else it throws (corrupt/forged ledger).
   - All KEPT commits are already on `opt/<name>` (durable on the branch even if the worktree dir
     was removed) — the setup phase reuses the existing worktree/branch idempotently.

**Why pass the ledger via `args` (not let the conductor read it):** the conductor cannot read the
filesystem. The main session re-passes the ledger so the loop is reproducible across sessions,
machines, and crashes. The state file is the single source of truth; resume needs only the `<name>`.

**At-least-once semantics:** the checkpoint is written **after** the commit-or-revert, so a crash
between them re-runs that experiment. Every experiment body is idempotent (the revert makes a
re-run safe), so re-running a half-done experiment is harmless.

---

## 6. Common mistakes

- ❌ Calling `fs`/`git`/`Date.now()`/`Math.random()` in the conductor → runtime error. Move to a worker; vary worker labels by experiment index, not randomness.
- ❌ Letting the eval worker decide keep-or-discard → the worker only **measures** (`{gatePassed, metric, diffFiles}`); the **conductor** decides (pure `isBetter` + `surfaceAllows`). Splitting this differently breaks replay.
- ❌ Skipping the surface lock → the loop edits the benchmark/gate and "wins" by gaming the metric. Every touched file must be ⊆ `surface`; an empty diff also fails.
- ❌ Keeping on a tie or sub-`minDelta` move → noise gets locked in as "progress". Keep only on a **strict** improvement of ≥ `minDelta`.
- ❌ Not reverting after a DISCARD → the next experiment starts from a dirty tree and the diff is meaningless. `git status` must be clean after every discarded experiment.
- ❌ Re-measuring the baseline on resume → it would change `best`. On resume, `best` comes from `args`; the Baseline phase is skipped.
- ❌ Repeating a discarded idea on resume → the propose agent must be fed the ledger digest (`change` + `kept` per generation) so it does not retry what failed.
- ❌ Building the ledger from scratch in a worker → drift. The conductor serializes the canonical ledger; the checkpoint worker only writes the bytes + `startedAt`-preserving timestamps.
- ❌ Writing the state file inside the worktree → lost on `git worktree remove`. Keep it in the main repo `.optimize/state/`.
- ❌ Treating plateau as "widen" → sequential keep-or-discard has nothing to widen; plateau = **stop**.
- ❌ Auto-merging the `opt/<name>` branch → prospector is non-destructive; the human reviews `git diff <baseline>..opt/<name>` and merges. `main` is byte-unchanged after a run.
