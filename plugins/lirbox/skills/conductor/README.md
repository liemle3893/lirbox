# conductor — developer & maintainer guide

> This README is for **developing and understanding the skill itself**. It is NOT the runtime
> instruction set — that's `SKILL.md` (loaded into Claude's context when the skill triggers).
> Read this to extend, debug, or reason about the skill.

## What it is

A skill that produces **durable, resumable, deterministic, multi-subagent workflows** by
driving the built-in **Workflow tool** and adding the things the Workflow tool lacks:
on-disk JSON state (survives session restarts), a resume protocol, worktree isolation,
optional enforcement gates, and a token/cost/duration report.

It is the synthesis of two existing approaches:
- **Workflow tool** — deterministic JS conductor + native subagent fan-out, but in-memory and
  same-session-only resume.
- **autoflow-deliver** — durable on-disk state + enforcement gates + agent-agnostic, but a
  fixed pipeline.

conductor keeps the Workflow tool's ergonomics and adds autoflow's durability +
enforcement, expressed as **generated, inspectable JS**.

## The one mental model that matters: two layers

| Layer | Code | Capabilities |
|---|---|---|
| **Conductor** | the generated `.workflows/<name>.js` | Restricted: pure JS only. **No fs, no git, no `Date.now()`/`Math.random()`.** Computes + dispatches. |
| **Workers** | every subagent spawned by `agent()`/`parallel()`/`pipeline()` | Full Claude Code tools (`Read`/`Write`/`Edit`/`Bash`) + MCP via ToolSearch. Do ALL side-effects. |

Consequence that drives the whole design: **the conductor cannot write files or read the
clock** — so `state.json`, timestamps, git, and code edits are all done by worker subagents.
This is why state is written by a "checkpoint" worker and why `startedAt` is stamped by the
skill (main session) before launch.

## File map

```
SKILL.md                          Runtime instructions for Claude (the agent-facing guide)
README.md                         This file (maintainer-facing)
scripts/
  scaffold-workflow.cjs           GENERATOR — single source of truth for conductor boilerplate
  list-workflows.cjs              `list` mode: scan .workflows/state/*.json
  workflow-report.cjs             duration + tokens + estimated cost → .workflows/reports/<name>.md
references/
  workflow-runtime.md             conductor constraints, state schema, resume protocol, mistakes
  delivery-phases.md              internals of the optional PR / ticket / gate phases
```

Note: `.cjs`, not `.js`, because `~/.claude/package.json` sets `"type":"module"` — `.js` there
is treated as ESM and `require()` would throw.

## Lifecycle (end to end)

1. **Resolve `$ARGUMENTS`** (SKILL.md step 1): empty/`list` → list; matches a state file →
   resume; looks like a ticket (`ISS-101`) → ticket-sourced; else → new goal.
2. **Generate** the conductor with `scaffold-workflow.cjs` (never hand-author boilerplate).
3. **Stamp `startedAt`** + launch via the Workflow tool.
4. Each phase: **skip-if-done guard → work → checkpoint** (a worker merges `state.json`,
   preserving `startedAt`).
5. **Finalize** (main session): stamp `status` (`complete`/`failed`) + `finishedAt`, then run
   `workflow-report.cjs`.

Runtime artifacts live in the **target repo** (not in the skill):
```
.workflows/<name>.js               generated conductor
.workflows/state/<name>.json       durable state (main repo — survives worktree removal)
.workflows/reports/<name>.md       run report
.worktrees/<name>/                 isolated worktree (branch wf/<name>); code + implementation-notes/
```

## The generator (the heart of the skill)

`scaffold-workflow.cjs` emits a correct conductor from flags so the LLM only writes the
task-specific bit (the `TODO:` agent prompts).

```
node scripts/scaffold-workflow.cjs --name <slug> [--phases "A,B"] \
  [--ticket] [--pr] [--merge-gates] [--enforce-code] [--enforce-tests] [--enforce-docs] \
  [--writeup|--no-writeup] [--model-mode default|balanced] [--model-think <m>] [--model-work <m>] \
  [--profile lite|delivery] [--base <ref>] [--desc "..."] [--out <path>] [--force]
```

Phase order it emits: `Setup → [Brief] → <work phases> → [CodeGate] → [TestGate] → [DocsGate]
→ [Writeup] → [PR] → [TicketUpdate]`.

**Size it to the task.** `--merge-gates` collapses CodeGate + TestGate into ONE **Review**
phase (review+fix+build, ensure warranted tests green, ≤3 loop). `--profile lite`
(= `--ticket --pr --merge-gates`, single work phase) is the ~6-phase path for small/low-risk
delivery: `Setup → Brief → <work> → Review → PR → TicketUpdate`. Reserve `--profile delivery`
(full cycle + every gate) for substantial work — don't default every task to 12 steps.

With **`--cycle`** (implied by `--profile delivery`) the core reorders into a true TDD loop:
`Setup → [Brief] → RED → <work=GREEN> → Verify → PathGap → CodeGate(IMPROVE+SIMPLIFY) →
ReVerify → [DocsGate] → [Writeup] → [PR] → [TicketUpdate]`. **PathGap** is the step that closes the
"code paths > ACs" gap: it intersects branch coverage with the diff and hard-fails unless every
uncovered changed branch is tested or justified — derives test obligations from the *control
flow*, not just the spec. RED/Verify/PathGap/ReVerify replace the standalone TestGate in cycle mode.

**Writeup phase (artifacts ride the PR).** With a PR phase present (default; `--no-writeup` to
suppress), a **Writeup** phase runs just before PR and hard-fails if it can't produce: it promotes
the worktree's `implementation-notes/*.html` into `docs/changes/<name>/notes/`, generates a
reviewer `writeup.html` (via `lirbox:pr-writeup`) and a `design.html` diagram (via
`lirbox:flowchart`, validated), and commits them. `.gitignore` un-ignores `docs/changes/**` so
they're tracked and ride the PR; the PR body links them. This is why DocsGate's `summary.md` now
lands in the same `docs/changes/<name>/` directory.

**Model selection (`--model-mode`).** `default` emits no `model:` opt (every worker inherits the
session model — byte-identical to before). `balanced` tiers each `agent()` call by phase class:
**haiku** for mechanical work (Setup/checkpoint/Verify/ReVerify/PR/TicketUpdate), `--model-think`
(default **opus**) for reasoning (Brief/RED/PathGap/CodeGate/Review/TestGate/DocsGate/Writeup), and
`--model-work` (default **sonnet**) for the work phases. The `mdl(class)` helper mirrors `at(agent)`
— it emits the `model: '…',` fragment or `''`. Invalid model values are rejected at generation time.

What is generated (do NOT hand-edit) vs what the LLM fills:
- **Generated/deterministic**: meta, NAME/STATE/BRANCH/BASE/WORKTREE consts, `inWorktree(slot)`,
  the `startedAt`-preserving `checkpoint()`, Setup (worktree + `node_modules` symlink), resume
  guards, gate blocks, finalize return.
- **Hand-edited**: only the `TODO:` agent prompts (and their schemas) in the work phases.

To change the boilerplate, edit the generator and **regenerate** (`--force`) — there is no
separate static template (deliberately, to avoid drift).

## State & resume

`state.json` schema is documented in `references/workflow-runtime.md`. Resume is **auto-detected**
(SKILL.md step 1) from the file's `status`; the skill feeds `{ phasesDone, results }` back as
the Workflow `args`, and the conductor's `if (done.has('X'))` guards skip completed phases.
`startedAt` is preserved across checkpoints (a checkpoint reads the prev file before the
heredoc clobber — see the merge node one-liner in the generated `checkpoint()`).

## Reporting & listing

- `list-workflows.cjs [--all]` — table of workflows (in-progress by default).
- `workflow-report.cjs <name> [--project-dir <dir>]` — sums transcript `usage` within
  `[startedAt, finishedAt]`, applies the editable `DEFAULT_RATES` (override via `RATES_JSON`),
  writes `.workflows/reports/<name>.md`. Both run in the **main session** (plain Node — the
  clock/fs restrictions only apply to the conductor).

## Enforcement gates

Opt-in, **hard-fail** (conductor `throw` → run `failed`, state preserved → resume re-runs the
failed gate onward). They use the **agents bundled with this plugin** (`agents/`), referenced by
their **plugin-namespaced** type via `agent({ agentType })`:
- CodeGate → `lirbox:lirbox-code-reviewer` (review+fix loop ≤3). With `--merge-gates` this becomes
  a single **Review** phase that also ensures warranted tests are green.
- TestGate → **triages first** (`tryve-e2e`/`unit`/`none` — never enforces blindly) →
  `lirbox:lirbox-tryve-enhancer` (loop ≤3).
- DocsGate → `lirbox:lirbox-docs-writer` (summary → `docs/changes/<name>/summary.md`).

**Swappable.** Each gate agent is a flag — `--agent-red`/`--agent-code`/`--agent-tests`/
`--agent-docs` — defaulting to the bundled agents above. Pass your own `agentType`, or `none`
to drop `agentType` so the gate runs on a generic built-in subagent. The generator's `at(a)`
helper emits the `agentType: '…',` fragment or `''` when `none`. So the bundled agents are the
default, not a hard requirement — override or `none` removes the dependency.

Work/gate workers keep a per-worker `implementation-notes/<slot>.html` (design decisions,
deviations, tradeoffs, open questions) — unique slot so parallel agents never clobber — but only
when there's something a reviewer genuinely needs. Mechanical steps (e.g. the PR push) write no
notes; no-decision work skips the file instead of emitting boilerplate. The **Writeup** phase
promotes these into the committed `docs/changes/<name>/notes/` so they reach the reviewer (they
were previously dropped after DocsGate folded their decisions into the summary).

## Design decisions & boundaries

- **Generic harness, not a delivery flow.** Delivery (PR/ticket/gates) is opt-in via flags, not
  baked in. Keeps the harness reusable for migrations, audits, anything multi-step.
- **Generator is the single source of truth.** No static template → no drift.
- **Attended, not headless.** The Workflow tool runs only inside a live session — this skill
  cannot be cron/sbx-triggered. For unattended enforced delivery, autoflow-deliver is the tool.
- **Non-destructive.** Worktree isolation; PRs may open but **never auto-merge**; cleanup
  (`git worktree remove`) is the human's call.

## Developing / extending

- **Add a work phase**: `--phases "A,B,C"` — no code change.
- **Add a new gate**: add a flag in the flag-parsing block, a `*GateBlock` template const, wire
  it into `phaseOrder` and the `src` assembly. Mirror an existing gate (bounded loop + `throw`).
- **Change pricing**: edit `DEFAULT_RATES` in `workflow-report.cjs` (or pass `RATES_JSON`).
- **Change a phase's model tier**: flip the `mdl('<class>')` arg on that descriptor's `build()`
  (`mechanical`/`think`/`work`); Setup + `checkpoint()` use `mechFrag` in the template tail.
- **Change notes behavior**: edit the `inWorktree(slot)` generated function in the generator.
- Watch the **nested template-literal escaping** in the generator: conductor-runtime refs are
  `\${...}` (literal in output); generation-time values like `${SCHEMA(...)}` are not escaped.

## Testing the skill (how changes are verified)

1. `node --check scripts/*.cjs` — syntax.
2. Generate a conductor and **run it under mocked `agent`/`parallel`/`phase`/`log`** to catch
   *runtime* `ReferenceError`s (syntax-check alone misses undefined refs — this is how a stray
   `IN_WORKTREE` was caught):
   ```
   node -e "const fs=require('fs');let s=fs.readFileSync('.workflows/x.js','utf8').replace(/^export const/m,'const');const agent=async()=>({written:true,gatePassed:true,level:'none',ready:true});const parallel=async a=>Promise.all(a.map(f=>f()));const pipeline=async()=>[];const phase=()=>{};const log=()=>{};new Function('args','agent','parallel','pipeline','phase','log','return(async()=>{'+s+'})()')({},agent,parallel,pipeline,phase,log).then(r=>console.log('ran',r.phasesDone))"
   ```
3. Smoke-test `list-workflows.cjs` / `workflow-report.cjs` against a fixture state + transcript
   (verify window filtering + pricing against a hand calc).
4. Validate the package: `python3 <skill-creator>/scripts/package_skill.py <skill-dir> /tmp/x`.

## Known limitations

- Token attribution is by **time window** over the project's transcripts — a concurrent
  unrelated session in the same window inflates it (normally just the active session).
- Pricing is a static editable table, not a live feed.
- Enforcement quality is bounded by the bundled gate agents; some tryve E2E suites need external
  integration envs and can't pass locally.
