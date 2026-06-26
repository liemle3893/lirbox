# Loop Runtime — Constraints, Ledger Schema, Keep/Revert, Resume

Reference for the whetstone skill. Load when authoring or debugging the improver loop
conductor (`.improve/<skill>.js`). Whetstone reuses prospector's two-layer Workflow backbone
(forked from conductor); this is the whetstone-specific recap plus the `items[]` ledger schema,
the keep-or-revert + surface-lock rules, and the resume protocol. The genuinely-new part vs.
prospector: there is **no scalar and no `best`** — each item is a **binary** keep/revert against a
frozen acceptance-check, and the surface is **editable minus locked**.

---

## 1. The two-layer execution model (the key mental model — verbatim from prospector)

A Workflow run has two distinct execution contexts. Confusing them causes most mistakes.

| Layer | What runs there | Capabilities |
|---|---|---|
| **Conductor** | the loop `.js` script (`meta`, `phase()`, the item `for` loop, the pure decision helpers `surfaceAllows`/`verdictOf`/`shouldStop`, control flow) | **Restricted.** Pure JS only — NO filesystem, NO Node APIs, NO network, NO git. `Date.now()` / `new Date()` / `Math.random()` are **blocked**. `JSON`, `Array`, `Math` (non-random) are fine. |
| **Workers** | every subagent spawned by `agent()` (setup, baseline, fix, eval, keep, revert, checkpoint) | **Full Claude Code tools** — `Read`, `Write`, `Edit`, `Bash`, `Grep`, etc. Run in the real environment. Do all side-effects here. |

Consequences specific to the loop:
- The conductor **cannot write the ledger** — the **checkpoint worker** does it after every item.
- The conductor **cannot run the floor or the check** — the baseline/eval workers do, then return
  structured `{floorPassed, checkPassed, diffFiles}`; the conductor makes the keep-or-revert
  **decision** from those values.
- The conductor **cannot create the worktree, commit, or revert** — those are workers (setup, keep,
  revert).
- The conductor **cannot generate timestamps or randomness** — vary worker labels by item id
  (`fix:${item.id}`), never `Math.random()`; timestamps are injected by the checkpoint worker.
- The conductor **cannot read a wall-clock or token counter** — so `shouldStop`'s
  `elapsedMin`/`tokensUsed` are supplied via resume `args` (and are `undefined` on a fresh
  in-session run, where only the item-count stop applies live).

This restriction exists so the conductor is **deterministic and replayable** — required for resume
to be correct.

**Division of labor that makes the loop safe:** the worker only **measures** (it never decides
keep), and the conductor only **decides** (it never touches the filesystem). The keep-or-revert
verdict is therefore pure JS over plain values returned by the worker — auditable and replayable.

---

## 2. Native subagent capabilities (do NOT reimplement these)

The Workflow tool already provides subagent orchestration; whetstone uses only `agent()`:
- `agent(prompt, opts)` — spawn one subagent. With `schema` (JSON Schema) it **forces validated
  structured JSON** back (retries on mismatch). Returns `null` if the agent dies after retries —
  guard every result (`if (!evalRes || !evalRes.floorPassed) …`).
- `opts`: `label` (vary by item id), `phase` (`Setup`/`Baseline`/`Items`), `schema`.
- The loop is **sequential** by design: items share the worktree, so each must start from a clean
  tree (the revert guarantees it). There is **no** `parallel()` in v1 — do not add concurrency.

Whetstone adds **only** the fixed-backlog GREEN keep-or-revert loop + a durable ledger + a resume
protocol on top of this. It does not replace dispatch.

---

## 3. Ledger / state-file schema

**Path:** `.improve/state/<skill>.json` (relative to repo root).

The state file is the durable **ledger** merged with run state. It drives both **resume**
(re-read → skip done items) and the **morning review**. Unlike prospector there is no `best` and no
`metric` — items are kept/reverted independently.

**Schema:**
```jsonc
{
  "name": "flowchart",                       // matches meta.name; the resume key
  "status": "running | complete | failed | stopped",
  "branch": "improve/flowchart",             // isolated branch holding the KEPT commits
  "worktree": ".worktrees/improve-flowchart",
  "skill": "flowchart",
  "skillPath": "plugins/lirbox/skills/flowchart",
  "baseline": { "floorPassed": true },       // the floor passed on the unmodified skill (measured once)
  "items": [                                 // one entry per ATTEMPTED item, in backlog order
    { "id": "node-nonascii", "type": "concern", "change": "flag non-ASCII in node labels too",
      "floor": "pass", "check": "pass", "verdict": "kept",     "sha": "abc123…" },
    { "id": "floor-breaker", "type": "suggestion", "change": "deleted the edge check",
      "floor": "fail", "check": "pass", "verdict": "reverted", "sha": null }
  ],
  "humanOnly": ["prettier"],                 // backlog items with no acceptanceCheck — reported, never attempted
  "startedAt": "ISO-8601 — set once, then preserved by every checkpoint",
  "updatedAt": "ISO-8601 — refreshed by every checkpoint worker",
  "finishedAt": "ISO-8601 — set by the SKILL (main session) at finalize, else null"
}
```

Field notes:
- `baseline.floorPassed` replaces prospector's `baseline.metric` — there is no scalar; the only
  baseline fact is "the floor was green before we started" (a red base cannot be improved).
- Each `items[]` entry: `floor`/`check` are `"pass"`/`"fail"` (what the eval worker observed);
  `verdict` ∈ {`kept`, `reverted`, `unresolved`}; `sha` is the commit on the branch (set only when
  `kept`). There is **no** `metric` field.
- `humanOnly[]` lists backlog item ids that had **no** `acceptanceCheck` — they never enter the
  loop (no way to verify a fix), so they are surfaced in the report for a human, not attempted.

**Provenance / who writes what:**
- Written by a **checkpoint subagent** after each item. The generated `checkpoint()` does a
  `startedAt`-preserving merge: read prev `startedAt`/`finishedAt` → write the canonical payload +
  fresh `updatedAt`. The conductor serializes the bytes; the worker only writes them and stamps the
  timestamps.
- `status` is `running` during checkpoints; the **skill** (main session) flips it to
  `complete` (backlog exhausted / budget reached cleanly), `stopped` (kill-switch), or `failed`
  (the Workflow threw, e.g. the baseline floor failed) after the run returns.

The state file lives in the **main repo** (`.improve/state/`), NOT in the worktree — so it survives
`git worktree remove` and stays readable for resume.

---

## 4. The loop rules: keep-or-revert, surface lock

### Keep-or-revert (the trust boundary)
After each item the conductor keeps the change **iff ALL THREE hold**, else reverts —
`verdictOf(floorPassed, checkPassed, surfaceOk)`:

1. **Floor passes** — the deterministic floor exited 0 (the correctness **floor**:
   `quick_validate.py <skill>` + `node <skill>/evals/run.mjs`). Nothing is kept if it breaks the
   skill's validity or any characterization test. `floorPassed === true`.
2. **The item's acceptance-check passes** — the **frozen, human-confirmed, baseline-failing** check
   for THIS item exited 0. `checkPassed === true`. This is the binary that replaces prospector's
   "metric strictly better"; there is no delta and no `best`.
3. **Surface lock holds** — every changed path is within `editable` **and** matches no `locked` glob
   (`surfaceAllows(diffFiles, editable, locked)`). The eval worker lists changed paths with
   `git -c core.quotepath=false status --porcelain --untracked-files=all` (NOT `git diff
   --name-only`, which misses new untracked files — an out-of-surface new file would otherwise slip
   the lock).

KEEP → a worker stages the change (`git add -A`, safe because the surface lock already verified
every changed path is editable-and-not-locked) and commits on `improve/<skill>`; the conductor
records `verdict: 'kept'` + the sha. REVERT → a worker resets the WHOLE worktree to HEAD
(`git reset --hard HEAD` + `git clean -fd`, NOT a path-scoped checkout — the candidate may have
touched files outside the surface, which is itself a revert reason, and those must not survive;
prior KEPT commits are on the branch, so only the uncommitted candidate is dropped) so `git status`
is clean for the next item. **A KEPT ledger entry exists iff all three held.**

### `unresolved` vs `reverted` (the unresolved-after-N rule)
The `fixer` gets up to `N + 1` attempts (`N` = `budgets.checkRetries`, default **2**) to turn the
frozen check green. When the verdict is not `kept`, the conductor distinguishes:
- **`unresolved`** — `floor` passed AND surface held AND the **check never went green** after the
  retries. The fix was well-behaved but the concern remains open; flagged for a human, not a
  failure of the loop. (`floorPassed && surfaceOk && !checkPassed`.)
- **`reverted`** — anything else: the floor broke, or the fix touched a locked/out-of-surface file.
  A genuine rejection.

Both are reverted on disk (worktree reset); the distinction is **reporting only** — `unresolved`
means "we tried and could not", `reverted` means "the attempt was unsafe/wrong".

### Surface lock — editable MINUS locked (the anti-gaming fence)
Whetstone's surface is **two** globs, not one: `editable` (what may change — the skill, e.g.
`plugins/lirbox/skills/flowchart/**`) **minus** `locked` (what must NEVER change — `evals/**` and
the backlog `feedback/<skill>.jsonl`). A path is allowed **iff** it matches `editable` AND matches
no `locked` glob; ANY locked or out-of-`editable` path in the diff reverts the whole item. This is
what stops the loop "winning" by editing the very check that judges it — the `fixer` must improve
the **skill**, never weaken the test. An empty diff (no files touched) also fails the lock: a fix
must change something. (`surfaceAllows` supports `**`/`*`/`?` and allows new matching files inside
`editable`.)

### Stop conditions
`shouldStop(itemsDone, total, elapsedMin, tokensUsed)` returns the **first** hit reason (or `null`):
- **`items`** — `itemsDone >= total.items` (the backlog is finite; this is the normal exit).
- **`wallclock`** — `elapsedMin >= total.wallclockMin` (overnight safety; needs worker-supplied
  `elapsedMin`).
- **`tokens`** — `tokensUsed >= total.tokens` (overnight safety; needs worker-supplied
  `tokensUsed`).

There is **no plateau stop** — the backlog is a fixed list, not an open search. `wallclock`/`tokens`
exist only as overnight kill-switches; with no budget set, the loop runs the whole backlog.

---

## 5. Resume protocol

The whetstone **skill runs in the main Claude Code session**, which has full tools — so the skill
reads the ledger and config directly (only the *conductor* is restricted).

On (re)entry with an arg that matches an existing `.improve/state/<skill>.json`:
1. **Read** `.improve/state/<skill>.json` (the ledger) and `.improve/config/<skill>.json` (the
   approved editable/locked/floor/items/budgets/baseline).
2. If absent → it is a **new run**, not a resume (run setup instead).
3. If `status: "complete"` → tell the user it's done (offer the report); start fresh only if they
   meant a new run.
4. If `status` ∈ {`running`, `failed`, `stopped`} → **resume**: re-launch the same loop script,
   passing the persisted ledger as `args` so the conductor **skips already-done items**:
   ```
   Workflow({ scriptPath: ".improve/<skill>.js",
              args: { config:   <config/<skill>.json>,
                      items:    <state.items>,
                      baseline: <state.baseline> } })
   ```
   The conductor:
   - rebuilds `ledger` from `args.items` and the `doneIds` set, so any item already in the ledger is
     **skipped** (no item re-attempted);
   - restores the measured `baseline` from `args.baseline` (so it **skips the Baseline phase** when
     `baseline.floorPassed` is already true, and re-persists `baseline` at every checkpoint —
     omitting it would overwrite the saved baseline with null);
   - continues the backlog from the first item not in `doneIds`.
   - All KEPT commits are already on `improve/<skill>` (durable on the branch even if the worktree
     dir was removed) — the setup phase reuses the existing worktree/branch idempotently.

**Why pass the ledger via `args` (not let the conductor read it):** the conductor cannot read the
filesystem. The main session re-passes the ledger so the loop is reproducible across sessions,
machines, and crashes. The state file is the single source of truth; resume needs only the
`<skill>` name. **Always re-pass `config`** — it carries the frozen `items` (with their
acceptance-checks), the floor, and editable/locked; the conductor cannot reconstruct them.

**At-least-once semantics:** the checkpoint is written **after** the commit-or-revert, so a crash
between them re-runs that item. Every item body is idempotent (the revert makes a re-run safe), so
re-running a half-done item is harmless.

---

## 6. Common mistakes

- ❌ Calling `fs`/`git`/`Date.now()`/`Math.random()` in the conductor → runtime error. Move to a worker; vary worker labels by item id, not randomness.
- ❌ Letting the eval worker decide keep-or-revert → the worker only **measures** (`{floorPassed, checkPassed, diffFiles}`); the **conductor** decides (pure `verdictOf` + `surfaceAllows`). Splitting this differently breaks replay.
- ❌ Letting the `fixer` edit a check / `evals/` file / the backlog → the surface lock reverts it, but the real fix is to keep `evals/**` and the backlog in `locked`. A loop allowed to edit its own check is worthless.
- ❌ Treating `unresolved` as a failure → it means "floor + surface ok, but the check never went green after N retries". Report it as an open concern, not a revert-for-cause.
- ❌ Not reverting after a non-keep → the next item starts from a dirty tree and its diff is meaningless. `git status` must be clean (whole-worktree reset) after every non-kept item.
- ❌ Re-measuring the baseline on resume → unnecessary work and risk. On resume, `baseline` comes from `args`; the Baseline phase is skipped when `baseline.floorPassed`.
- ❌ Re-attempting a done item on resume → the conductor must skip any item whose id is already in the re-passed ledger (`doneIds`).
- ❌ Building the ledger from scratch in a worker → drift. The conductor serializes the canonical ledger; the checkpoint worker only writes the bytes + `startedAt`-preserving timestamps.
- ❌ Writing the state file inside the worktree → lost on `git worktree remove`. Keep it in the main repo `.improve/state/`.
- ❌ Running with a red baseline floor → you cannot tell whether a later green came from your fix or from the base; the loop **throws** if the baseline floor fails (fix the skill first).
- ❌ Auto-merging the `improve/<skill>` branch → whetstone is non-destructive; the human reviews `git diff <baseline>..improve/<skill>` and merges. `main` is byte-unchanged after a run.
