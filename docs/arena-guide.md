# Running the arena

`lirbox:arena` answers **"did a change actually improve conductor's delivered output?"** by running
conductor against frozen fixture tasks under multiple configs, judging the **delivered diffs**
pairwise, and emitting a Bradley-Terry / win-rate **leaderboard**. It's the "no single scalar to
hill-climb" sibling of `prospector` (scalar) and `whetstone` (RED→GREEN).

**New here? Read [arena-handoff.md](./arena-handoff.md) first** — system state, proven claims, gaps.

This guide covers both ways to run it: the **skill** (the durable Workflow loop) and a **manual
orchestration** for a controlled, observable run — plus the real-world gotchas a live run surfaces.

---

## TL;DR

```
lirbox:arena                       # list in-progress runs
lirbox:arena compare conductor     # new run: build config from the committed suite, confirm once, launch
lirbox:arena arena-<ts>            # resume a run by name
```

Output lands in the **tracked** path `docs/arena/<name>/` (`leaderboard.html` + `report.md`); the PR
carries it. Runtime scratch is gitignored under `.arena/`.

---

## 1. The fixture suite (the reproducible contract)

Committed under `plugins/lirbox/skills/conductor/arena/`:

```
suite.json                         # budget + configs + tasks
tasks/<id>/task.md                 # the change request + acceptance criteria
tasks/<id>/repo.bundle             # hermetic git bundle of the fixture repo
tasks/<id>/repo.ref                # { bundle, sha }
```

**Add a task:**

```bash
node plugins/lirbox/skills/arena/scripts/make-fixture.cjs --task <id> --dir /tmp/fx
# → prints SHA=… ; edit the generated multi-module app if needed, then:
#   - write tasks/<id>/task.md   (the change request + acceptance)
#   - write tasks/<id>/repo.ref  { "bundle": "repo.bundle", "sha": "<SHA>" }
#   - add the task to suite.json
```

> **Size the task so conductor actually engages.** The #1 way a cell goes wrong: on a *small* task,
> headless claude implements the change **directly** and never spins up conductor's durable workflow.
> That run is a **forfeit** (see §4). Make `task.md` genuinely multi-step / multi-module — a one-file
> feature will be bypassed. Verify with `npm test` on the bundle before committing it.

`suite.json`:

```jsonc
{
  "budget": { "runs": 3, "judges": 4, "cellCapSec": 3600 },
  "configs": [ { "model": "opus", "mode": "auto", "effort": "high" },
               { "model": "opus", "mode": "auto", "effort": "medium" } ],
  "tasks": [ { "id": "<id>", "taskFile": "…/task.md", "bundle": "…/repo.bundle", "sha": "<SHA>" } ]
}
```

---

## 2. Running it as the skill (the durable loop)

Invoke `lirbox:arena` with a goal. It builds `.arena/config/<name>.json` from the suite, shows the
**cell count** (`tasks × configs × runs`) + a cost estimate, and asks **once** to confirm. On approval
it scaffolds `.arena/<name>.js` and launches the Workflow. Each cell clones the fixture, runs conductor
headless under `cellCapSec`, captures the `wf/`-branch diff, and forfeits non-engagement. Judge phase
runs `judges` position-swapped pairwise passes per config-pair; Score computes Bradley-Terry + the
win-rate matrix; Finalize promotes the leaderboard to `docs/arena/<name>/` and opens a PR (never
merges). A crash resumes from `.arena/state/<name>.json`.

> **This is overnight-scale.** Each cell is a full conductor run (~10–15 min) that spawns its own
> subagent fleet. `3 tasks × 2 configs × 3 runs = 18` conductor runs. Start small.

---

## 3. Comparing conductor VERSIONS (the baseline axis)

The v1 config axis is `{model, mode, effort}` — real `claude -p` flags. To compare **conductor
versions** ("did my conductor edit help?"), point headless claude at a specific checkout with
`--plugin-dir` (skills otherwise load from the global plugin cache, not a git ref):

```bash
git worktree add --detach /tmp/lirbox-old <old-commit>
claude -p "<task>" --plugin-dir /tmp/lirbox-old --model claude-opus-4-8 --effort high \
        --permission-mode auto --output-format stream-json --verbose
```

The current version loads from the cache (no `--plugin-dir`) or via `--plugin-dir <current-checkout>`.
Hold the model constant and vary the version to isolate the conductor delta.

> **Coverage matters.** A backend task won't exercise frontend-gate or content-verification changes —
> the version delta only shows for changes that affect *that* task's delivery. Pick (or write) a task
> that touches the pipeline you changed.

---

## 3b. SWE-bench-style grading (rung 1 — "know for sure")

Every `graded: true` task in `suite.json` also ships a **hidden `grader/` dir** (never shown to the
agent — the cell passes the task *content*, not the file path, into the sub-claude prompt):

```
tasks/<id>/grader/fail_to_pass/*.test.cjs   # RED on the base commit, GREEN iff the feature is correct
# PASS_TO_PASS = the fixture's own `npm test` — must STAY green after the diff
```

The harness mirrors SWE-bench's FAIL_TO_PASS / PASS_TO_PASS verdict:

```bash
# grade a delivered diff → { p2p, f2p, resolved } ; exit 0 iff resolved
node plugins/lirbox/skills/arena/scripts/swe-grade.mjs --task <id> --diff <path.diff>
# or grade a wf/ branch in an existing clone
node plugins/lirbox/skills/arena/scripts/swe-grade.mjs --task <id> --repo <clone> --ref wf/<branch>
# discrimination gate: F2P must be RED on the unmodified base (run by test-arena.cjs for every graded task)
node plugins/lirbox/skills/arena/scripts/swe-grade.mjs --task <id> --validate
```

**How it layers with judging:** `resolved` is the hard, deterministic gate — an unresolved delivery
**forfeits** (cannot win, no matter how good it looks). Pairwise judging then ranks quality *among the
resolved*. First real-data validation: all 3 committed evidence diffs (opus-new ×2, opus-old ×1)
**resolve** — so the judge's 3–0 preference for the new conductor measured quality *beyond*
correctness (coverage, thoroughness), exactly the intended layering.

**Authoring a grader:** write F2P tests ONLY against interfaces `task.md` explicitly names (any correct
implementation must pass); resolve modules via `process.cwd()`; one concern per file; then prove
discrimination with `--validate` (all F2P RED on base). `test-arena.cjs` re-proves this for every
graded task on every run.

## 3c. Absolute scoring — independent runs, compare scores (SWE-bench mode)

The pairwise arena answers "which of these two is better" but needs both configs run together. For
**"benchmark the new version alone, compare against recorded scores"** use the absolute scorecard:

```bash
# one command: run the whole frozen suite for ONE config → scorecard + scoreboard row
node plugins/lirbox/skills/arena/scripts/swe-run.mjs --name conductor-v2 --model claude-opus-4-8 \
     --effort high [--plugin-dir /tmp/lirbox-at-some-commit] [--runs 3]

cat docs/arena/scores/README.md      # the scoreboard — every recorded run, one row each
```

- **Score = resolution rate** (`resolved cells / total cells`) over the frozen suite — deterministic
  (rung 1), so it's absolute and comparable across time. F2P partial credit + engagement rate are
  reported alongside; a cell that times out or bypasses conductor **counts in the denominator**.
- **Suite fingerprint = the comparability contract.** Every scorecard embeds a hash of `suite.json` +
  each graded task's `task.md`/`repo.ref`/graders. **Only same-hash rows are comparable**; the
  scoreboard flags ⚠️stale-suite rows automatically. Changing any task/grader starts a new era.
- **Wilson 95% CI is always shown** — 2/2 is "100%" with an honest 34%–100% interval. Overlapping
  intervals = "not distinguished yet"; raise `--runs` to tighten.
- **What the score does NOT capture:** quality beyond correctness (coverage, clarity, thoroughness).
  That is inherently relative — use the pairwise judge layer among resolved runs when you need it.
  Absolute score for "did it get better at delivering correct work"; pairwise for taste.

## 4. How a cell is scored (and forfeited)

Only the **delivered diff** is judged. A run is a **forfeit** (cannot win, flagged in the report,
never silently dropped) when:

- conductor did **not** engage — no `wf/` branch / `.workflows/` dir / `Workflow` tool_use in the
  trace (the plain-claude fallback);
- its gates failed, it errored, timed out against `cellCapSec`, or produced no diff;
- the delivery is **unresolved** under the task's hidden SWE grader (§3b) — functionally incorrect
  deliveries can't win on style.

Whole-pair resolution: one config with zero valid runs loses the pair; both zero → tie; both valid →
judged. Per pair: `judges` blinded, position-swapped passes (**keep it EVEN** — an odd count turns a position-biased judge into a fake winner; proven live, see the swe-graded-effort run); ties count 0.5. Aggregate → Bradley-Terry
rating (headline) + win-rate matrix (the legible number the report leads with).

**Capture the diff from conductor's `wf/` branch, not the working tree** — conductor delivers on
`wf/<name>` and leaves the main checkout clean, so a working-tree diff is empty.

---

## 5. Real-world gotchas (from live runs)

- **Some models bypass conductor.** In the first real run, **sonnet implemented the task directly on
  both runs** (no `wf/` branch) → forfeited; **opus engaged conductor both times**. A model/task that
  won't drive the durable workflow scores as a forfeit, not a loss — read the forfeit reasons.
- **Conductor delivers on a `wf/` branch.** Diff `git diff <sha> <wf/branch>`.
- **Long runs can be killed.** A backgrounded baseline arm was killed mid-run by the environment; the
  completed cell's work was **recovered from its `wf/` branch**. Keep parallelism low (2 cells at a
  time), bound each with `timeout`, and you can always recover a finished cell's diff from `wf/`.
- **Headless plumbing:** run `claude -p` **backgrounded on real disk** — the foreground shell caps at
  10 min and the sandbox discards writes between calls. Write the run log **outside** the fixture repo.
- **Interpret directionally.** With small `runs`, a leaderboard is a *signal*, not proof. Raise `runs`
  for confidence; the win-rate CI widens with few samples.

---

## 6. Worked example

`docs/arena/real-conductor-opus-vs-baseline/` — the first real run: current conductor (`7a2c5ee`, opus)
vs baseline conductor (`455ff36`, opus) vs current+sonnet, on `notes-add-tags`. Current-opus swept the
baseline **3–0** in blinded pairwise judging (and delivered 114/141 lines vs the baseline's 47); sonnet
forfeited both runs by bypassing conductor. `evidence/` holds the actual delivered diffs + judge
verdicts. See its `report.md` for the full matrix and the small-n caveats.

---

## 7. Reading the output

- `report.md` / `leaderboard.html` — ranking (Bradley-Terry), the win-rate matrix, per-run breakdown,
  and **forfeited cells flagged**.
- `state.json` — the durable ledger (`runs`, `judges`, `ratings`, `matrix`, `tallies`); the resume anchor.
- Re-render any time: `node plugins/lirbox/skills/arena/scripts/arena-report.cjs <name>`.
