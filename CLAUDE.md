# lirbox — repo guide for Claude

Personal Claude Code **plugin marketplace**. One plugin, `lirbox`, under `plugins/lirbox/`:

- `skills/<name>/SKILL.md` (+ optional `scripts/`, `references/`, `assets/`) — one skill each.
- `agents/<name>.md` — subagents (the default enforcement gates for `conductor`, usable standalone).
- `.claude-plugin/marketplace.json` — marketplace manifest (skills are auto-discovered, not listed here).

Full skill catalog → [README.md](./README.md). Adding a skill/agent/plugin → [CONTRIBUTING.md](./CONTRIBUTING.md).

## Two skill families (and the conventions that matter)

**HTML-artifact skills** (`codewalk`, `flowchart`, `component-diagram`, `sequence-diagram`, `plan-deck`, `pr-writeup`) emit one self-contained HTML
file. `flowchart` ships a headless `assets/validate.mjs` — run it on output
(`node .../validate.mjs <file>.html`); it catches Mermaid label-escaping bugs. `deep-understanding` is an
interactive tutor (no artifact).

**Orchestration / loop skills** (`conductor`, `prospector`, `whetstone`, `arena`) share one backbone: a deterministic
JS *conductor* (the generated `.js`) driving full-tool *worker* subagents. Hard rules when editing them:

- **The conductor layer is restricted — pure JS only: NO `fs`/`git`/`require`/`Date.now()`/`Math.random()`.**
  Every side-effect lives inside an `agent()` worker prompt. Their `test-*.cjs` enforce this with a string scan.
- **Never hand-edit a generated loop script.** They come from `scripts/scaffold-*.cjs` — change the generator
  and regenerate with `--force`. Hand-edits reintroduce drift.
- **Run the regression net after touching a generator:**
  `node plugins/lirbox/skills/<skill>/scripts/test-*.cjs` (asserts loop/phase structure + the no-fs scan +
  unit helpers). `conductor` → `test-scaffold.cjs`, `prospector` → `test-optimize.cjs`, `whetstone` → `test-improve.cjs`,
  `arena` → `test-arena.cjs`.
- **Non-destructive default:** these never auto-**merge**. `prospector`/`whetstone` finalize by
  auto-opening a **PR** (never a merge) with the run report as the body — the human reviews and
  merges; fall back to leaving the branch when there's no remote. Run branches are per-run and
  timestamped (`opt/<goal>-<ts>`, `improve/<skill>-<ts>`) so concurrent runs never collide — the
  run slug (not the skill/goal) keys the state/config/report/branch/worktree; the whetstone backlog
  stays keyed by skill (`feedback/<skill>.jsonl`). `conductor` still leaves a `wf/` branch.

## Runtime artifacts are gitignored — never commit them

`.workflows/` (conductor), `.optimize/` (prospector), `.improve/` (whetstone), `.arena/` (arena), `.worktrees/`, generated
`*-flowchart/codewalk/plan-deck.html`, and `implementation-notes/` (worker build-scratch).

**Exception — arena delivery artifacts ARE committed.** arena's `Finalize` phase promotes the leaderboard
(`leaderboard.html` + `report.md`) into `docs/arena/<name>/`, which `.gitignore` un-ignores (`!docs/arena/**`)
so it rides the PR — the same pattern as conductor's `docs/changes/**`.

**Exception — conductor delivery artifacts ARE committed.** conductor's `Writeup` phase *promotes* the
worktree's kept `implementation-notes/*.html` plus a generated `writeup.html` + `design.html` + DocsGate
`summary.md` into `docs/changes/<name>/`, which `.gitignore` un-ignores (`!docs/changes/**`) so they ride
the PR. So `implementation-notes/` itself stays scratch, but its promoted copies under `docs/changes/` are
tracked.

## Validate

- `claude plugin validate .` — validate the marketplace + plugin before pushing.
- A skill's frontmatter `description` is its **trigger** — keep it specific; it decides when Claude invokes it.
- Skills resolve under the `lirbox:` namespace (e.g. `lirbox:conductor`).

## Changing a skill — the rule

> **Every skill change lands behind a discrimination-gated frozen check and a green floor.**
> Whether a `whetstone` loop or a human executes the change is a **cost decision**, not a rule.

The check must be **proven RED on the baseline** before the fix
(`node plugins/lirbox/skills/whetstone/scripts/check-baseline.cjs "<check cmd>"` → `DISCRIMINATING`),
registered in that skill's `evals/checks-manifest.json`, and the floor must stay green. A check that
was never seen failing is not a gate.

Keep it measuring, too: `node scripts/prove-checks.mjs --skill <skill>` mutation-tests the frozen
checks — it breaks the invariant each one claims to guard and requires it to go RED. Declare
`mutations` on a check's manifest entry; undeclared checks are reported `UNPROVEN`, not assumed good.
This exists because both failure modes have shipped here: a check that kept passing after the
behaviour it described was replaced (**false green**), and one that reported a regression in an
untouched file after a refactor moved its anchor (**false red**). Both were anchored to incidental
structure — a variable name, a nearby token — instead of an invariant.

**When to spend a `whetstone` run** rather than editing directly: unattended/overnight work, a
backlog large enough that per-item revert will actually fire, or a fixer you don't trust to
self-police the surface. At small N, attended, it is mostly overhead — and note the loop **cannot fix
a stale check**, because `evals/**` is locked to it, so a wrong check silently shapes the fix.
If you do run it, **push the frozen checks first**: the worktree is cut from the pushed remote tip,
so locally-committed checks are invisible and the floor silently runs a smaller set.

After an improve-PR merges: **prune** resolved items from `feedback/<skill>.jsonl` (it is the queue of
OPEN concerns only). Do *not* bother promoting green checks into `evals/floor/` — `floor/06-checks-manifest.test.mjs`
already runs every check on every floor run and enforces its expected state.

## Shipping a skill — the three tiers (full detail in [CONTRIBUTING.md](./CONTRIBUTING.md#testing))

**Tier 1** validate + smoke-test + `skill-lint`. **Tier 2** evals — `evals/floor/`, `evals/checks/`,
`evals/checks-manifest.json`, green under `node scripts/evals-all.mjs --fast`. **Tiers 1–2 are
required**; a skill with no floor is ungated forever *and* can never be improved by `whetstone`,
whose keep-rule has nothing to tunnel-proof against without one.

**Tier 3 — Harbor (containerised behavioural test): ASK THE USER, never assume.** Tier 2 is
artifact-level only — swap the model and every tier-2 check stays green. When implementing a skill,
offer tier 3 and state the cost split honestly: building the task and running the discrimination
gate (`-a nop` / `-a oracle`) is **free** (no model calls, ~30s/task); a real behavioural run
(`-a claude-code -m <model>`) is **~$5–15 per task**. Declined → skip it and say so in the summary.
Accepted → write the task and run the free gate; the paid run is a separate ask.

Tasks are declared per skill under `plugins/lirbox/skills/<skill>/harbor/tasks/<id>/` —
`instruction.md` plus a grader (`verify.sh`, or a whole `tests/` tree when grading has more than one
dimension) — and that declaration is the tracked source. To run one you assemble it by hand into
Harbor's on-disk layout under `.harbor/` (gitignored, per-machine); there is no builder script.
Layout, the assembly steps, and the Reward Kit rules for multi-dimension grading:
[CONTRIBUTING.md](./CONTRIBUTING.md#tier-3--harbor-containerised-behavioural-test--offer-it-do-not-assume-it).

Four things that bite. **Never inject `plugins/lirbox/skills` into a container** — skills keep eval
material inside their own dir, so an unpruned inject hands the agent the graders it is scored
against; strip every skill's `evals/`, `harbor/` and `arena/` first. A grader that runs a
skill's own validator needs a **copy** of it inside the task; that copy is manual, so re-copy it
whenever the skill's `assets/` change or you will score against a stale validator. **Editing the
declaration does not change what runs** — `.harbor/` is a copy, so re-sync it before every run or
you will pay for a run that scored the old grader. And always run `-a nop` alongside `-a oracle`:
a green oracle proves the grader is *satisfiable*, only `nop` proves it is not passing on nothing.

Two more, learned the expensive way. **The oracle bar is `== 1.0` per dimension, not `> 0`** — an
oracle that cannot max its own grader means the rubric is broken and every score is read against a
false denominator. **A judged dimension is advisory, never a gate**: Harbor averages an *absent*
reward key as 0, so a judge that dies mid-run is indistinguishable from a bad verdict — read
per-trial values from `stats.evals.<arm>.reward_stats`, and keep each dimension in its own
`rewardkit` process so one dying cannot take the deterministic score with it. Before assembling a
task, read `plugins/lirbox/skills/<skill>/harbor/harness.md` — it is the tracked instruction preamble
(bare skill name, headless, any scaffold-only constraint) that gets prepended to `instruction.md`.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
