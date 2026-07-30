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

**Tier 3 — Harbor (containerised behavioural test): ASK THE USER, never assume.** Tier 2 is
artifact-level only; swap the model and every tier-2 check stays green. Building the task and running
the discrimination gate (`-a nop` / `-a oracle`) is **free**; a real behavioural run
(`-a claude-code -m <model>`) is **~$5–15 per task** and is a separate ask. Declined → skip it and
say so.

Tasks are declared under `plugins/lirbox/skills/<skill>/harbor/tasks/<id>/`; `.harbor/` is a
per-machine gitignored copy you assemble by hand. Before touching one, read
[CONTRIBUTING.md § Tier 3](./CONTRIBUTING.md#tier-3--harbor-containerised-behavioural-test--offer-it-do-not-assume-it)
and `<skill>/harbor/harness.md` (the tracked instruction preamble). The rules that bite: never inject
`plugins/lirbox/skills` unpruned (it hands the agent its own graders); re-copy a skill's validator
when its `assets/` change; re-sync `.harbor/` before every run; always run `-a nop` alongside
`-a oracle`; the oracle bar is `== 1.0` **per dimension**; a judged dimension is advisory, never a
gate.

## graphify

Knowledge graph at `graphify-out/`.

- Codebase questions: run `graphify query "<question>"` first (also `graphify path "<A>" "<B>"`,
  `graphify explain "<concept>"`) — returns a scoped subgraph, far smaller than grep or the report.
- `graphify-out/wiki/index.md` for broad navigation; `GRAPH_REPORT.md` only when query/path/explain
  don't surface enough.
- After modifying code, `graphify update .` (AST-only, no API cost).
