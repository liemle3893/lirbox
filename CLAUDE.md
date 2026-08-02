# lirbox — repo guide for Claude

Personal Claude Code **plugin marketplace**. One plugin, `lirbox`, under `plugins/lirbox/`:
`skills/<name>/SKILL.md` (+ optional `scripts/`, `references/`, `assets/`), `agents/<name>.md`
(subagents; the default gates for `conductor`), `.claude-plugin/marketplace.json` (skills are
auto-discovered, not listed).

Skill catalog → [README.md](./README.md). Adding a skill/agent/plugin, and all testing detail →
[CONTRIBUTING.md](./CONTRIBUTING.md).

## Two skill families

**HTML-artifact** (`codewalk`, `flowchart`, `component-diagram`, `sequence-diagram`, `plan-deck`,
`pr-writeup`, `c4-model`) — one self-contained HTML file. `flowchart` ships a headless
`assets/validate.mjs`; run it on output (`node .../validate.mjs <file>.html`) — it catches Mermaid
label-escaping bugs. `deep-understanding` is an interactive tutor (no artifact).

**Orchestration loops** (`conductor`, `loom`, `prospector`, `whetstone`, `arena`) — a deterministic
JS *conductor* (the generated `.js`) driving full-tool *worker* subagents. Hard rules:

- **The conductor layer is pure JS: NO `fs`/`git`/`require`/`Date.now()`/`Math.random()`.** Every
  side effect lives inside an `agent()` worker prompt; `test-*.cjs` enforces this with a string scan.
- **Never hand-edit a generated loop script** — change `scripts/scaffold-*.cjs`, regenerate `--force`.
- After touching a generator, run its net: conductor → `test-scaffold.cjs`, prospector →
  `test-optimize.cjs`, whetstone → `test-improve.cjs`, arena → `test-arena.cjs`.
- **Never auto-merge.** prospector/whetstone finalize by opening a **PR** with the run report as the
  body (fall back to leaving the branch when there's no remote); conductor leaves a `wf/` branch.
  Run branches are per-run and timestamped (`opt/<goal>-<ts>`, `improve/<skill>-<ts>`) — the run slug
  keys state/config/report/branch/worktree, so concurrent runs never collide. whetstone's backlog
  stays keyed by skill (`feedback/<skill>.jsonl`).

## Runtime artifacts are gitignored — never commit them

`.workflows/`, `.optimize/`, `.improve/`, `.arena/`, `.worktrees/`, generated
`*-flowchart/codewalk/plan-deck.html`, `implementation-notes/` (worker scratch).

**Two exceptions, un-ignored on purpose so they ride the PR:** arena's `Finalize` promotes
`leaderboard.html` + `report.md` into `docs/arena/<name>/`; conductor's `Writeup` promotes the kept
`implementation-notes/*.html` plus `writeup.html` + `design.html` + DocsGate `summary.md` into
`docs/changes/<name>/`.

## Validate

`claude plugin validate .` before pushing. A skill's frontmatter `description` is its **trigger** —
keep it specific; it decides when Claude invokes it. Skills resolve as `lirbox:<name>`.

## Changing a skill — the rule ([why](./CONTRIBUTING.md#changing-a-shipped-skill--the-check-gate))

> **Every skill change lands behind a discrimination-gated frozen check and a green floor.**
> Whether `whetstone` or a human executes it is a **cost decision**, not a rule.

- Prove the check RED on the baseline *first*:
  `node plugins/lirbox/skills/whetstone/scripts/check-baseline.cjs "<check cmd>"` → `DISCRIMINATING`.
  A check never seen failing is not a gate.
- Register it in the skill's `evals/checks-manifest.json` **with `mutations`**, and keep it
  measuring: `node scripts/prove-checks.mjs --skill <skill>` breaks the invariant each check claims
  to guard and requires RED. Undeclared checks report `UNPROVEN`, not good. Anchor checks to the
  invariant, never to incidental structure (a variable name, a nearby token).
- Floor stays green: `node scripts/evals-all.mjs --fast`.
- Running `whetstone`? **Push the frozen checks first** — its worktree is cut from the pushed remote
  tip, so local-only checks are invisible and the floor silently runs a smaller set. It also
  **cannot fix a stale check** (`evals/**` is locked to it). After the improve-PR merges, prune
  resolved items from `feedback/<skill>.jsonl` — it is the queue of OPEN concerns only.

## Shipping a skill — three tiers (detail: [CONTRIBUTING.md](./CONTRIBUTING.md#testing))

**Tier 1** validate + smoke-test + `skill-lint`. **Tier 2** evals (`evals/floor/`, `evals/checks/`,
`evals/checks-manifest.json`, green under `node scripts/evals-all.mjs --fast`). **Tiers 1–2 are
required** — a skill with no floor is ungated forever *and* unimprovable by `whetstone`.

**Tier 3 — Harbor (containerised behavioural test): REQUIRED for a skill change, not offered.**
Tier 2 is artifact-level only; swap the model and every tier-2 check stays green. **A new feature or
a change to a shipped skill is not done until a Harbor run shows it BETTER or NO WORSE than the
baseline.** A frozen check proves the text changed; only this proves the behaviour did.

Run it **paired** — same task, same model, two skill trees (baseline = the skill at `git HEAD`,
pruned the same way; after = the working tree). **Report the lift, not the score:** a bare "1.000"
says nothing without the arm it is being compared against. One task can answer both halves when its
dimensions split into pre-existing contract (→ *no worse*) and new capability (→ *better*).

Build + the discrimination gate (`-a nop` / `-a oracle`) is **free** and is a precondition, never
the deliverable. The paired behavioural run costs **~$5–15 per task** — state the estimate and
proceed; do not stall on permission already given. Ask only to *skip* it, and if it is skipped say
so in the summary and treat the change as **unverified behaviourally**, never as done.

A task **is** its declaration: `plugins/lirbox/skills/<skill>/harbor/tasks/<id>/`. Harbor runs that
directory — there is no staging copy, so the thing you edit is the thing that runs. Its one derived
build input is `environment/skill/` (gitignored); generate it first:

```
node scripts/harbor-prep.mjs <skill>/<task-id>       # or --all
harbor run -p plugins/lirbox/skills/<skill>/harbor/tasks/<id> -a nop    -y   # must be 0
harbor run -p plugins/lirbox/skills/<skill>/harbor/tasks/<id> -a oracle -y   # must be 1.0
```

**Before proposing ANY paid run, read `jobs/` first.** Job output lands in `<repo-root>/jobs/`
(harbor's `--jobs-dir` default, relative to cwd) — gitignored, so a **worktree has none; always read
the main repo root's `jobs/`**. Prior `reward`/`quality`/`cost_usd` are there and the read is free.
If the metric is already saturated on that task, a before/after run cannot show a lift — say so
instead of spending. Never assert a path from a directory merely existing: `ls` its contents.

Detail → [CONTRIBUTING.md § Tier 3](./CONTRIBUTING.md#tier-3--harbor-containerised-behavioural-test--offer-it-do-not-assume-it).
The rules that bite: never hand the container a skill tree with `evals/`/`harbor/`/`arena/` in it
(that is its answer key — `harbor-prep.mjs` prunes them and refuses if any survive); re-run
`harbor-prep.mjs` after touching the skill; re-copy a skill's validator when its `assets/` change;
always run `-a nop` alongside `-a oracle`; the oracle bar is `== 1.0` **per dimension**; a judged
dimension is advisory, never a gate.

## graphify

Knowledge graph at `graphify-out/`.

- Codebase questions: run `graphify query "<question>"` first (also `graphify path "<A>" "<B>"`,
  `graphify explain "<concept>"`) — returns a scoped subgraph, far smaller than grep or the report.
- `graphify-out/wiki/index.md` for broad navigation; `GRAPH_REPORT.md` only when query/path/explain
  don't surface enough.
- After modifying code, `graphify update .` (AST-only, no API cost).
