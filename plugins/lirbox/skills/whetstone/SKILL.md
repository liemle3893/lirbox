---
name: whetstone
description: "Overnight, feedback-driven, EVAL-GATED skill improver: works a fixed backlog of filed concerns through a deterministic FLOOR plus a per-item, baseline-failing, human-confirmed acceptance-check — keeping a fix ONLY when the floor passes AND the item's frozen check turns green AND the surface-lock holds (editable = skill MINUS evals + backlog), reverting otherwise — on an isolated branch that is NEVER auto-merged. Forks prospector's two-layer Workflow loop (durable resumable ledger, worktree isolation) but swaps the scalar hill-climb for a binary GREEN loop. USE WHEN you have a skill, a backlog of concerns (feedback jsonl), each concern can become ONE deterministic check that is RED before the fix and GREEN after (proven by a discrimination gate), and a floor (quick_validate plus characterization tests) the loop can't tunnel under. NOT WHEN concerns are subjective taste (no deterministic check, so human-only), the skill has no floor, or you need auto-merge (it never merges; a human reviews the branch)."
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Workflow
  - AskUserQuestion
  - Task
---

$ARGUMENTS

<arguments>
`$ARGUMENTS` (top of file) is ONE free-text field — no flags, auto-detected four ways:

1. **empty / `list`** → list mode: `node <skill-dir>/scripts/list-improvements.cjs` (`--all` for
   finished). Launch nothing.
2. **`init <skill>`** → scaffold the eval FLOOR that makes `<skill>` whetstone-ready
   (`scripts/scaffold-readiness.cjs`), print next steps, and stop. Launch nothing.
3. **matches `.improve/state/<arg>.json`** → resume that run from its ledger.
4. **anything else** → a target skill to improve: derive a kebab `<skill>` slug, tell the user, run
   **setup** (the attended half), and — only if confirmed — launch the loop.

`<skill>` drives everything and is the resume key. Namespace (mirrors prospector's `.optimize/`):

```
.improve/
  config/<skill>.json   # approved run config: editable, locked, floor, items, budgets, baseline (setup)
  state/<skill>.json    # durable ledger + run state: items, baseline, humanOnly  (schema: loop-runtime.md §3)
  <skill>.js            # generated loop conductor (Workflow script)              (setup)
  reports/<skill>.md    # run report: baseline→verdicts, kept/reverted/unresolved/human-only (finalize)
feedback/<skill>.jsonl  # the INPUT backlog (one {id,type,text,acceptanceCheck?} per line)
```

`config/` and `state/` live in the **main repo** (survive worktree removal; resume needs only the
name). Edits happen on branch `improve/<skill>` in worktree `.worktrees/improve-<skill>`; **main is
never touched** until the human merges.

Examples: `flowchart` → reads `feedback/flowchart.jsonl`, drafts+freezes checks, confirm, run ·
`flowchart` (after a state file exists) → resume · `list` → show in-progress.
</arguments>

<execution-model>
Whetstone works a **fixed backlog** of concerns against a skill (repeat-until-backlog-done,
keep/revert per item) — contrast prospector, which hill-climbs a scalar against `best`: shared
two-layer Workflow infrastructure, different signal (binary check vs. metric). Read
`references/loop-runtime.md` before authoring/debugging the loop. A Workflow has two layers —
confusing them is the #1 bug source:

- **Conductor** = the loop `.js` — pure JS, NO filesystem/git/`Date.now()`/`Math.random()`. It only
  iterates the backlog and makes the keep-or-revert *decision* from values workers return.
- **Workers** = the subagents it spawns — full tools. They do every side-effect: create the
  worktree, run floor + check, edit the skill, commit/revert, write the ledger.

So the durable ledger is written by a **checkpoint worker** after every item, never by the
conductor. The trust boundary: a fix is auto-KEPT **iff** floor passes AND the item's frozen check
passes AND surface-lock holds — the `fixer` may NEVER edit any check (`evals/**`) or the backlog.
</execution-model>

<procedure>

<step n="1" name="Resolve $ARGUMENTS">
- **empty / `list`** → run `list-improvements.cjs` (`--all` for finished), show the table, stop.
- **`init <skill>`** (arg begins with `init `) → run
  `node <skill-dir>/scripts/scaffold-readiness.cjs --name <skill>` to write the eval floor
  scaffolding (idempotent — `run.mjs`, a lenient `floor/00-structure.test.mjs`, `checks/`, README,
  empty `feedback/<skill>.jsonl`). Relay its printed next-steps (add ≥1 behavior characterization
  floor test, file concerns, then `whetstone <skill>`) and **stop** — do NOT draft checks or launch
  the loop. Full recipe: `docs/whetstone-ready.md`. (`--skill-path` if the skill isn't at
  `plugins/lirbox/skills/<skill>`.)
- else read `.improve/state/<arg>.json` directly (the skill runs in the main session):
  - `running` / `stopped` / `failed` → **resume** (step 3); config + items come from `config/`. Don't
    regenerate the loop script if it exists unchanged.
  - no file → **new run**: derive the slug from the target skill, tell the user, run step 2 (setup);
    if confirmed → launch.
  - `complete` → tell the user it's done (offer `improve-report.cjs <skill>`); start fresh only if
    they meant a new run.
</step>

<step n="2" name="Setup — draft + discriminate + freeze checks, confirm once, then launch" note="new runs only — the attended half; full rules in references/checks.md">
The heart of the attended half. Full derivation, the discrimination gate, floor/locked-set rules,
and the DECLINE rule are in `references/checks.md`. The flow:

1. **Read the backlog** `feedback/<skill>.jsonl` (one `{id, type, text, acceptanceCheck?}` per
   line). Partition by whether a concern is verifiable. Items that already carry an
   `acceptanceCheck` use it; items with a verifiable concern but no check go to the drafter; items
   that are inherently subjective go straight to **human-only**.

2. **RED-draft a check per verifiable concern** — dispatch the `lirbox-test-writer` agent (via
   `Task`) as a *check-drafter*, once per item, feeding it the item `text` and the target skill. It
   is the RED step of TDD: it authors a runnable, deterministic `*.test.mjs` (under
   `<skill>/evals/`, with any fixtures under `evals/fixtures/`) that asserts the concern and
   confirms it fails for the right reason. (Do NOT let it write implementation — it never does.)

3. **Discrimination gate per drafted check** — from a clean baseline, run
   `node <skill-dir>/scripts/check-baseline.cjs "<acceptanceCheck>"`. Exit 0 / `DISCRIMINATING` =
   the check FAILS on the unmodified skill (good — fail-before/pass-after). Exit 1 /
   `NON-DISCRIMINATING` = it passes on baseline → **reject or strengthen**; never freeze a check
   that is already green. A concern whose check can't be made to discriminate becomes human-only or
   is reported as already-resolved.

4. **Measure the floor on the baseline** — run
   `python3 <skill-creator>/quick_validate.py <skillPath> && node <skillPath>/evals/run.mjs` on the
   unmodified skill. It **MUST exit 0** (a broken base can't be improved). If there is no
   establishable floor → **DECLINE** (checks.md §7).

5. **Confirm once** via `AskUserQuestion` — present: the drafted+discriminated checks (item → check
   command, all RED on baseline), the **human-only** list (concerns excluded, to be done by hand),
   and the budgets (`agentCapSec`, `checkRetries` = 2, the wallclock/token overnight caps). This is
   the only human gate. If declined, stop.

6. **Freeze + write config** — on confirmation, write the `*.test.mjs` files into `<skill>/evals/`
   (immutable for the run), then write `.improve/config/<skill>.json` with:
   ```jsonc
   {
     "skill": "<skill>", "skillPath": "<skillPath>",
     "editable": "<skillPath>/**",
     "locked":  ["<skillPath>/evals/**", "feedback/<skill>.jsonl"],
     "floor":   { "cmd": "python3 <skill-creator>/quick_validate.py <skillPath> && node <skillPath>/evals/run.mjs" },
     "items": [ { "id": "...", "type": "concern", "text": "...", "acceptanceCheck": "node <skillPath>/evals/<id>.test.mjs" } ],
     "budgets": { "agentCapSec": 600, "checkRetries": 2, "total": { "items": <N> },
                  "maxDiffLines": 0 },              // >0 → per-fix edit-size budget (lines in+out); oversized ⇒ revert
     "consolidate": false,                          // true → one final compress-the-skill pass (kept iff floor + all kept checks + surface hold AND the skill strictly shrinks)
     "baseline": "origin/main"
   }
   ```
   `items[]` is FROZEN — every entry's check passed the discrimination gate. Human-only concerns are
   carried with `acceptanceCheck: null` (the loop filters them out and reports them).

7. **Generate the loop conductor** — config as data, never hand-edit:
   ```
   node <skill-dir>/scripts/scaffold-improve.cjs --name <skill>     # --force to overwrite; --out to redirect
   ```
   Writes `.improve/<skill>.js` (slug drives state/branch/worktree paths). The config is **not**
   baked in — it is passed at launch via `args.config` (step below), so resume re-passes it
   unchanged (the conductor can't read the filesystem). To change structure, re-run with `--force` —
   never hand-edit (reintroduces drift).

8. **Launch (fresh)** — stamp the ledger so duration is true wall-clock (checkpoints preserve
   `startedAt`):
   ```
   node -e "const fs=require('fs');fs.mkdirSync('.improve/state',{recursive:true});const f='.improve/state/<skill>.json';if(!fs.existsSync(f))fs.writeFileSync(f,JSON.stringify({name:'<skill>',status:'running',startedAt:new Date().toISOString()},null,2))"
   ```
   Then launch with the config as args:
   ```
   Workflow({ scriptPath: ".improve/<skill>.js", args: { config: <config JSON> } })
   ```
   The conductor runs Setup → Baseline (floor MUST pass) → the per-item fix → floor+check+surface →
   keep/revert loop → optional Consolidate (only when `config.consolidate: true`) → stop. Each
   item's checkpoint worker appends to the ledger.
</step>

<step n="3" name="Launch (resume)">
Pass the persisted ledger so the conductor **skips already-done items** and continues the backlog:
```
Workflow({ scriptPath: ".improve/<skill>.js",
           args: { config: <config/<skill>.json>, items: <state.items>, baseline: <state.baseline> } })
```
**Pass `config` AND `baseline`** — `config` carries the frozen items/floor/editable/locked the
conductor can't reconstruct; `baseline` lets it skip the Baseline phase (when `floorPassed`) and
re-persist the baseline at each checkpoint (omitting it overwrites the saved baseline with null).
The loop rebuilds the ledger from `args.items`, skips any item whose id is already recorded, and
runs the rest. KEPT commits are already on `improve/<skill>`.
</step>

<step n="4" name="Finalize, report, overnight note">
When the Workflow returns, stamp `status` + `finishedAt` (the conductor can't — the main session
does). Status by why it stopped: `complete` (backlog exhausted / budget reached), `stopped`
(kill-switch), or `failed` (Workflow threw, e.g. the baseline floor failed). Last checkpoint's
ledger is preserved → resume continues correctly.
```
node -e "const f='.improve/state/<skill>.json';const s=JSON.parse(require('fs').readFileSync(f,'utf8'));s.status='complete';s.finishedAt=new Date().toISOString();require('fs').writeFileSync(f,JSON.stringify(s,null,2))"
node <skill-dir>/scripts/improve-report.cjs <skill>
```
Report: the summary (`.improve/reports/<skill>.md` — per-item kept/reverted/unresolved + the
human-only list), branch `improve/<skill>` + worktree `.worktrees/improve-<skill>` holding the KEPT
commits, and `git diff <baseline>..improve/<skill>` as the review artifact. **Do NOT auto-merge or
auto-remove the worktree** — the human reviews and merges. `main` is byte-unchanged.

**Overnight (schedule-ready, not scheduled in v1):** the committed config + frozen checks + durable
ledger let a `/schedule` routine or a standalone Agent SDK runner resume the loop (step 3)
overnight; you review the branch + report in the morning. v1 does not wire cron — the Workflow tool
can't run headless in a live session.
</step>

</procedure>

<gotchas>
Full rules in `references/loop-runtime.md` (keep/revert §4, surface lock §4, resume §5, mistakes §6)
and `references/checks.md` (discrimination gate §3, floor §4, locked set §5, DECLINE §7).

- **The floor is the floor — checks are frozen.** A fix is KEPT **iff** the floor passed AND the
  item's frozen check went green AND the surface-lock held; else reverted. Checks are authored at
  setup, pass the discrimination gate (RED on baseline), are human-confirmed, and are **immutable**
  for the run. The loop can never win by breaking correctness or by editing its own check.
- **Surface lock = editable MINUS locked.** Every changed path (incl. new untracked files —
  `git status --porcelain --untracked-files=all`) must match `editable` AND match no `locked` glob
  (`evals/**` + `feedback/<skill>.jsonl`). ANY locked/out-of-surface path, or an empty diff, reverts
  the item. This is the anti-gaming fence — it stops the loop editing the check that judges it.
- **Discrimination gate is mandatory.** A frozen check MUST fail on the baseline
  (`check-baseline.cjs` → `DISCRIMINATING`). A check that's already green proves nothing; a later
  pass would not be caused by the fix.
- **`unresolved` ≠ `reverted`.** `unresolved` = floor + surface ok but the check never went green
  after `checkRetries` (= 2) — an open concern for a human, not a failure. `reverted` = floor broke
  or a locked/out-of-surface file was touched. Both reset the worktree; the distinction is reporting.
- **Human-only concerns are excluded, not faked.** A concern with no deterministic, discriminating
  check (`acceptanceCheck: null`) never enters the loop — it's recorded in `humanOnly[]` and
  reported. Don't invent a weak proxy to drag it in.
- **Baseline floor must be green.** The loop throws if the floor fails on the unmodified skill — you
  can't tell a real fix from a pre-existing pass. Fix the skill first or DECLINE.
- **Consolidate (opt-in) can only shrink.** With `config.consolidate: true`, one final compress/
  dedupe pass runs after the backlog — kept **iff** floor + EVERY check a kept item turned green +
  surface-lock hold AND the skill entrypoint got **strictly smaller** (`skillTokens`, measured by
  the eval workers). Equal size or any red check ⇒ reverted. It fights the accretion a
  fix-only loop causes; the per-fix `maxDiffLines` budget deliberately does not apply to it.
- **`maxDiffLines` bounds edit SIZE (opt-in), the surface bounds edit LOCATION.** When set (>0),
  a fix whose diff exceeds it (insertions+deletions, incl. new files) is reverted even if the
  check went green — small bounded steps keep diffs reviewable. Unset/0 = unbounded (default).
- **Non-destructive revert.** A non-keep resets the WHOLE worktree (`git reset --hard HEAD && git
  clean -fd`). Prior KEPT commits are on the branch; only the uncommitted candidate drops. The
  branch is **never auto-merged**.
- **Conductor can't write files/timestamps/randomness** — push all into workers; vary worker labels
  by item id, never `Math.random()`.
- **Durable ≠ unattended** — see the overnight note (step 4).
</gotchas>

<resources>
- `scripts/scaffold-readiness.cjs --name <skill> [--skill-path <dir>]` — **`init` mode** (step 1):
  scaffolds the eval FLOOR that makes a skill whetstone-ready — `evals/run.mjs`, a lenient
  `floor/00-structure.test.mjs` (real, green-on-baseline; stands in for `quick_validate` when the
  skill uses `argument-hint`), `checks/`, README, empty `feedback/<skill>.jsonl`. Idempotent;
  detects `argument-hint`/`disable-model-invocation` → custom floor. Recipe: `docs/whetstone-ready.md`.
- `scripts/scaffold-improve.cjs --name <skill>` — **generates** the loop conductor from the approved
  config (SoT for all loop boilerplate: baseline → backlog loop → fix → floor+check+surface →
  keep/revert → checkpoint → stop). Use instead of hand-authoring. Setup step 7.
- `scripts/check-baseline.cjs "<acceptanceCheck>"` — the discrimination gate: exit 0 iff the check
  FAILS on a clean baseline (fail-before/pass-after). Setup step 3.
- `scripts/harvest-feedback.cjs <skill> [--skill-path <dir>] [--dry-run]` — SkillOpt-style
  reflection: runs the skill-train TRAIN tasks (`evals/tasks/train/`, from
  `scaffold-readiness.cjs --scored`) and files each FAILURE into `feedback/<skill>.jsonl` with the
  task itself as the `acceptanceCheck` — RED-on-baseline by construction, already in the locked
  `evals/**` set. Idempotent; refuses the held-out val split. Run it, then `whetstone <skill>`.
- `scripts/list-improvements.cjs [--all]` — list runs from `.improve/state/` (in-progress by
  default; `--all` for finished). List mode (step 1).
- `scripts/improve-report.cjs <skill>` — per-item verdict table + kept/reverted/unresolved/human-only
  counts + branch/worktree + the `git diff <baseline>..improve/<skill>` pointer →
  `.improve/reports/<skill>.md`. Finalize (step 4).
- `scripts/test-improve.cjs` — regression net for the generators + helpers (unit + structure +
  no-fs scan + discrimination + report + the `scaffold-readiness` floor scaffold). Run after any
  change to `scaffold-improve.cjs` or `scaffold-readiness.cjs`.
- `references/loop-runtime.md` — two-layer constraints, `items[]` ledger schema, keep/revert,
  surface-lock (editable−locked), unresolved-after-N, resume protocol, common mistakes. Load before
  authoring the loop.
- `references/checks.md` — acceptance-check derivation (RED-draft via `lirbox-test-writer`), the
  discrimination gate, the floor (`quick_validate.py` + `evals/run.mjs`), the locked set
  (`evals/**` + backlog), the human-only path, the DECLINE rule. Load before setup.
- agent `lirbox-test-writer` — the check-drafter (RED step of TDD; authors the baseline-failing
  acceptance-checks). Dispatched in setup step 2.
</resources>
