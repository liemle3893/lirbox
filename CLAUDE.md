# lirbox — repo guide for Claude

Personal Claude Code **plugin marketplace**. One plugin, `lirbox`, under `plugins/lirbox/`:
`skills/<name>/SKILL.md` (+ optional `scripts/`, `references/`, `assets/`, `evals/`, `harbor/`),
`agents/<name>.md` (9 subagents), `hooks/` (1 registered hook), `scripts/` (the orchestration
runtime), `.claude-plugin/marketplace.json` (skills are auto-discovered, not listed).

**13 skills**: 12 plus `do`. There is no Workflow tool here and no `conductor` / `loom` /
`prospector` / `whetstone` / `arena` — those were deleted. Anything still referring to them is stale.

Skill catalog → [README.md](./README.md). Adding a skill/agent/plugin, and all testing detail →
[CONTRIBUTING.md](./CONTRIBUTING.md).

## Skills

**HTML-artifact** (`codewalk`, `flowchart`, `component-diagram`, `sequence-diagram`, `plan-deck`,
`pr-writeup`, `c4-model`, `plan-check`) — one self-contained HTML file. Five ship a headless
`assets/validate.mjs` (`flowchart`, `sequence-diagram`, `component-diagram`, `plan-deck`,
`plan-check`); run it on the output (`node .../validate.mjs <file>.html`) — it catches Mermaid
label-escaping bugs and structural holes.

**The rest**: `do` (entrypoint, below), `deep-understanding` (interactive tutor, no artifact),
`lane-config` (per-repo lane/harness/model config), `skill-lint` (analyzer over the SKILL.md files),
`feedback` (user-invoked only; files a scrubbed GitHub issue).

## `/do` — the single entrypoint

Every task goes through one door. `do` runs `intake.mjs`, says the route out loud, and acts on it in
the same turn. It replaces nothing the scripts already do; it is the thing that calls them.

```
echo "<task>" | node plugins/lirbox/scripts/intake.mjs --task - --run <slug>
```

**`intake.mjs`** — the only function in this repo whose answer can be **"no"**. Writes
`.orchestration/<slug>/route.json`; **always exits 0** and, when it cannot reach a model, falls back
to the cheapest route rather than failing. Four routes:

| route | meaning |
|---|---|
| `reject` | Say no, verbatim reason, stop. Not a negotiation, and never re-scoped smaller. |
| `scope` | `done` isn't stateable as a command + expected value → hand to `lirbox-planner`. |
| `inline` | Do it now. The routing decision *is* the approval — no confirmation round-trip. |
| `lane` | Print the `orch-lane.sh start` command and **ask** before running it. |

Cheapest is `inline`, not `reject` — `reject` and `scope` both *block* the lane door. Uncertainty
never buys the expensive route: a low-confidence `lane` downgrades to `inline`, a low-confidence
`reject` becomes `scope`.

**`route-guard.sh`** (PreToolUse/Bash) is the half that binds: it refuses `orch-lane.sh start` when
`route.json` is absent, or says `reject` or `scope`. It fails open, loudly, on any internal error.

> **`route-guard.sh` is the only hook.** The other five (`pane-guard`, `gate-guard`,
> `model-policy`, `lane-ledger`, `lane-gate`) gated on
> `agent_type == lirbox:lirbox-herdr-orchestrator`. From an ordinary main session that value never
> matched, so none of them could fire; they were retired with the agent rather than left registered
> against an id that no longer exists. If you re-add an enforcement hook, gate it on the tool call,
> not on who is making it.

## `jev.mjs` — typed judgment

`POST https://openrouter.ai/api/v1/systemone`, model pinned `jev-1.13` (a floating alias would
silently rescale the metric). Env is **TypeSafe's own contract**, never invented names:
`TYPESAFE_API_KEY` (via OpenRouter it holds the OpenRouter key; env, or the gitignored repo-root
`.env`) and `TYPESAFE_BASE_URL` — a **base**, default `https://openrouter.ai/api`; the client
appends `/v1/systemone`, as the SDKs do. Question types: **Choice / Score / Noul**.

**Fails CLOSED by default**: any failure writes the literal token `NOT_MEASURED` as the answer and
exits non-zero, so a caller can never confuse "scored low" with "did not score". `--fail-open`
inverts that to exit 0, still `NOT_MEASURED`. ~$0.00002/call, and the cost echoed is the API's own —
never a local estimate. Caps (64k total, 32k state+question, 2–10 score levels, 255 choice options)
are refused locally before a request is sent.

## Incremental delivery

**`lirbox-planner` plans exactly ONE slice** — the next one — and **refuses to enumerate the slice
after it**. Re-invoke it once the slice lands, with what *actually* happened (exit codes, what the
verifier saw), not the decomposition you predicted. Asking it for the whole breakdown is a refusal
by design; don't work around it.

**`board.mjs`** — one JSON per slice under `.orchestration/<slug>/slices/<id>.json`; `--set` is the
only writer; four statuses (`planned`, `in_progress`, `blocked`, `delivered`). **`verified_by` stays
null on a self-report** — only somebody other than the recorded implementor can fill it, and a
verification with no implementor is refused. `N of M delivered` counts delivered-AND-verified only.

Self-checks (deterministic, no model, no network): `jev-selfcheck.mjs`, `intake-selfcheck.mjs`,
`board-selfcheck.mjs` (plus `board-selfcheck.mjs --mutations`, which proves each assertion RED).

## Runtime artifacts are gitignored — never commit them

`.orchestration/` (per-run store), `.worktrees/`, `jobs/` (Harbor output),
`implementation-notes/` (worker scratch), generated `*-flowchart/codewalk/plan-deck/component/
sequence/c4.html`, and `plugins/lirbox/skills/*/harbor/tasks/*/environment/skill/`.

**One exception, un-ignored on purpose so it rides the PR:** `docs/changes/<name>/` — a run's
implementation summary, promoted by `lirbox-docs-writer`.

## Validate

`claude plugin validate .` before pushing. A skill's frontmatter `description` is its **trigger** —
keep it specific; it decides when Claude invokes it. Skills resolve as `lirbox:<name>`.

## Changing a skill — the rule ([why](./CONTRIBUTING.md#changing-a-shipped-skill--the-check-gate))

> **Every skill change lands behind a discrimination-gated frozen check and a green floor.**

- A check never seen failing is not a gate. Register it in the skill's `evals/checks-manifest.json`
  **with `mutations`**, and prove it measures: `node scripts/prove-checks.mjs --skill <skill>` breaks
  the invariant each check claims to guard and requires RED. Undeclared checks report `UNPROVEN`,
  not good. Anchor checks to the invariant, never to incidental structure (a variable name, a
  nearby token).
- Floor stays green: `node scripts/evals-all.mjs --fast`.

## Shipping a skill — three tiers (detail: [CONTRIBUTING.md](./CONTRIBUTING.md#testing))

**Tier 1** validate + smoke-test + `skill-lint`. **Tier 2** evals (`evals/floor/`, `evals/checks/`,
`evals/checks-manifest.json`, green under `node scripts/evals-all.mjs --fast`). **Tiers 1–2 are
required** — a skill with no floor is ungated forever.

**Tier 3 — Harbor (containerised behavioural test).** Tier 2 is artifact-level only; swap the model
and every tier-2 check stays green. A frozen check proves the text changed; only Harbor proves the
behaviour did. Run it **paired** — same task, same model, two skill trees (baseline = the skill at
`git HEAD`, pruned the same way; after = the working tree) — and **report the lift, not the score**:
a bare "1.000" says nothing without the arm it is compared against.

> **Status: nothing shipped in the `do` / `intake` / `jev` / `board` / one-slice-planner change has
> a Tier 3 Harbor run — the owner skipped it. Those behavioural claims are UNVERIFIED.** Tier 1 and
> Tier 2 are green; that is all that has been measured.

Build + the discrimination gate (`-a nop` / `-a oracle`) is **free** and is a precondition, never the
deliverable. A paired behavioural run costs **~$5–15 per task**. If it is skipped, say so and treat
the change as **unverified behaviourally**, never as done.

A task **is** its declaration: `plugins/lirbox/skills/<skill>/harbor/tasks/<id>/`. Harbor runs that
directory — there is no staging copy. Its one derived build input is `environment/skill/`
(gitignored); generate it first:

```
node scripts/harbor-prep.mjs <skill>/<task-id>       # or --all
harbor run -p plugins/lirbox/skills/<skill>/harbor/tasks/<id> -a nop    -y   # must be 0
harbor run -p plugins/lirbox/skills/<skill>/harbor/tasks/<id> -a oracle -y   # must be 1.0
```

**Before proposing ANY paid run, read `jobs/` first** — prior `reward`/`quality`/`cost_usd` are
there and the read is free. It is gitignored, so a **worktree has none; read the main repo root's
`jobs/`**. If the metric is already saturated on that task, a before/after run cannot show a lift —
say so instead of spending. Never assert a path from a directory merely existing: `ls` its contents.

Detail → [CONTRIBUTING.md § Tier 3](./CONTRIBUTING.md#tier-3--harbor-containerised-behavioural-test--required-not-offered).
The rules that bite: never hand the container a skill tree with `evals/`/`harbor/` in it (that is its
answer key — `harbor-prep.mjs` prunes them and refuses if any survive); re-run `harbor-prep.mjs`
after touching the skill; re-copy a skill's validator when its `assets/` change; always run `-a nop`
alongside `-a oracle`; the oracle bar is `== 1.0` **per dimension**; a judged dimension is advisory,
never a gate.

## graphify

Knowledge graph at `graphify-out/`.

- Codebase questions: run `graphify query "<question>"` first (also `graphify path "<A>" "<B>"`,
  `graphify explain "<concept>"`) — returns a scoped subgraph, far smaller than grep or the report.
- `graphify-out/wiki/index.md` for broad navigation; `GRAPH_REPORT.md` only when query/path/explain
  don't surface enough.
- After modifying code, `graphify update .` (AST-only, no API cost).
