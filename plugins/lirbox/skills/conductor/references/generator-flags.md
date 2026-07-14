# Generator flag reference — `scripts/scaffold-workflow.cjs`

The full public surface of the conductor generator. SKILL.md step 2 points here; read this before
generating anything non-trivial. **Pass prompts as DATA; never hand-edit the emitted script.**

## Invocation

Generate the conductor deterministically from params — never copy/author it by hand (that
reintroduces drift). The generator emits all mechanical boilerplate correctly (NAME/STATE/BRANCH
consts, the `startedAt`-preserving `checkpoint()`, the Setup worktree + `node_modules` symlink,
per-phase resume guards, optional Brief/PR/TicketUpdate, finalize):

```
node <skill-dir>/scripts/scaffold-workflow.cjs --name <name> --phases "Analyze,Implement" \
  --prompts-file <prompts.json> \
  [--ticket] [--pr] [--merge-gates] [--base <ref>] [--desc "..."]
```

## Size the workflow to the task — do NOT default to the full profile

More phases = more subagent round-trips; reserve them for work that warrants them:

- **Small / one-shot change** → bare (`--name x`, default single `Work` phase) or just a couple of
  `--phases`. Merge related steps into one phase rather than splitting mechanically.
- **Routine delivery (small/low-risk PR)** → `--profile lite` (= `--ticket --pr --merge-gates`, one
  work phase, gates collapsed into a single **Review** phase): ~6 phases, not ~12.
- **Substantial / risky work** → `--profile delivery` (full TDD cycle + every gate). Only here.

## Phase / prompt flags

- `--phases` — comma-list of work phase titles.
- `--independent` — declare the work items **independent** (no shared files/state): they fan out
  **concurrently** in ONE `Work` phase via `parallel()` — one worker per item, per-item prompts/spec
  overrides preserved, downstream gates verify the combined diff **once**. Use for wide decomposable
  tasks (N unrelated bugs/items) so the run doesn't pay N× worker spin-up + per-item verification;
  keep sequential `--phases` for genuinely dependent steps. Each worker's prompt carries the shared-
  worktree concurrency rules (touch only your item's files, retry on `index.lock`, no repo-wide git
  ops). Resume granularity is the whole `Work` phase (a crash mid-fan-out re-runs all items).
- `--prompts-file <json>` — `{ "<PhaseTitle>": "<prompt text>", … }`; fills each work phase's prompt
  from **data** so you never read back or hand-edit the generated script. A phase with no entry keeps
  a `TODO:` stub (fill it by regenerating, not by editing).
- `--spec <json>` — superset of the flags for **per-phase overrides** (file or inline JSON):
  `{ "phases": { "<Title>": "<prompt>", "<Title>.schema": "<schema source>", "<Title>.agent": "<id|none>" } }`.
  Every flag keeps working unchanged; `--spec` only *adds* per-phase customization (a richer return
  `schema`, a phase-specific `agent`, or the prompt). Reach for it only when a phase needs a return
  shape beyond the default `{ summary }`; otherwise `--prompt`/`--prompts-file` suffice.

## Delivery / gate flags

- `--ticket` — adds a **Brief** phase (fetch the ticket → goal) and a **TicketUpdate** phase.
- `--pr` — adds a **PR** phase (push branch + `gh pr create`).
- `--merge-gates` — collapse CodeGate + TestGate into ONE **Review** phase (review+fix+build, ensure
  warranted tests green, ≤3 loop, hard-fail). Fewer steps for small tasks. Ignored under `--cycle`.
  Implied by `--profile lite`.
- `--writeup` / `--no-writeup` — a **Writeup** phase (before PR, hard-fail) that promotes the
  worktree's `implementation-notes/*.html` into `docs/changes/<name>/notes/`, generates a reviewer
  `writeup.html` via `lirbox:pr-writeup` and a `design.html` diagram via `lirbox:flowchart`
  (validated), and commits them — so **every delivery PR carries reviewer artifacts**. Defaults **ON
  whenever a PR phase exists**; `--no-writeup` opts out; `--writeup` forces it on without `--pr`. The
  PR body links the artifacts. (DocsGate's `summary.md` lands in the same `docs/changes/<name>/` dir.)
- `--base` — worktree branch point (default: the remote's default branch, fetched fresh from `origin`
  so it's never stale; don't hardcode across projects).
- `--enforce-code` — adds a **CodeGate**: review+fix loop (≤3) via `lirbox:lirbox-code-reviewer`;
  **hard-fails** (conductor throws → run `failed`) on unresolved Critical/High.
- `--enforce-tests` — adds a **TestGate** that first *assesses* whether the change needs `tryve-e2e` /
  `unit` / `none` (it does NOT enforce blindly — a non-behavioral change passes with no new tests),
  then enforces+loops (≤3) via `lirbox:lirbox-tryve-enhancer`; hard-fails if not green.
- `--enforce-docs` — adds a **DocsGate**: writes an implementation summary to `docs/changes/` via
  `lirbox:lirbox-docs-writer`, folding in the `implementation-notes/` fragments; hard-fails if missing.
- `--dod-file <json>` — the run's **definition of done**, frozen in as DATA:
  `{ "criteria": [{ "id", "text", "tier": "checkable"|"judged", "check"? }] }` (`check` required
  for `checkable`). Emits **DoDBaseline** (pre-work honesty measurement of every checkable
  criterion — one already met at baseline is flagged as non-discriminating) and **DoDGate**
  (before Writeup/PR: verify every criterion — checkable = run the command, judged =
  evidence-cited MET/UNMET/PARTIAL — then fix-loop ≤3 and hard-fail; the PR body carries the
  scorecard). **Required** under `--profile lite`/`delivery`; providing the file is the opt-in
  for bare runs. Changing the DoD = regenerate with `--force`.
- `--no-dod` — explicit opt-out: suppress DoDBaseline/DoDGate even under a profile.
- `--review-panel` / `--no-review-panel` — swap the CodeGate's single review+fix agent for a
  **panel**: a diff guard (docs/config-only changes skip the gate), 4 parallel read-only
  dimension reviewers (bugs, security, reuse, conventions; + git-history under delivery),
  per-finding confidence scoring (0–100 rubric, drop <80), then a lead adjudicator+fixer
  (default `lirbox:lirbox-code-reviewer`, ≤3 rounds, hard-fail). Default ON under
  `--profile delivery`; the collapsed Review phase (lite / `--merge-gates`) always stays
  single-agent.
- `--frontend <web|mobile|both>` — adds a **FrontendGate** phase, positioned **after** the
  code-quality gate (CodeGate/ReVerify under `--cycle`; the merged Review phase under lite) and
  **before** DoDGate/Writeup so DoDGate can cite the evidence. A diff guard (same pattern as the
  review-panel guard) skips the gate when the diff touches no UI files; otherwise each target runs
  a verifier fix-loop (≤3 rounds, then hard-fail) that writes runnable E2E specs where assertion
  is possible and an evidence manifest at `implementation-notes/frontend-evidence/manifest.json`
  (plus screenshots/logs) where it is not — the Writeup phase promotes that directory into
  `docs/changes/<name>/evidence/`. The frozen engine chain + viewport matrix come from the DoD
  file's `frontend` block as **DATA** (see SKILL.md step 1c) — the generator never probes the
  machine. If the verifier agentType is unavailable at dispatch, the gate degrades gracefully:
  the same prompt reruns on a generic subagent with a logged warning.
- `--cycle` — enforces the full TDD cycle, reordering the core to
  **RED → GREEN(work) → Verify → PathGap → IMPROVE/SIMPLIFY(CodeGate) → ReVerify**:
  - **RED** (`lirbox:lirbox-test-writer`) writes AC tests first and confirms they fail.
  - work phases implement to **GREEN**; **Verify** requires the suite green.
  - **PathGap** closes coverage for code paths the ACs never specified: branch coverage ∩ the diff →
    every uncovered changed branch must be **tested or explicitly justified** (in
    `implementation-notes/pathgap.html`) — hard-fail on any silent gap.
  - **CodeGate** then improves/simplifies; **ReVerify** re-runs the suite to catch refactor
    regressions. (Supersedes the standalone TestGate.)
- `--profile delivery` — shorthand for `--cycle --ticket --pr --enforce-docs` (full, big tasks).
  Requires `--dod-file` (or an explicit `--no-dod`).
- `--profile lite` — shorthand for `--ticket --pr --merge-gates` (routine, small tasks).
  Requires `--dod-file` (or an explicit `--no-dod`).

## Model selection (`--model-mode`)

Orthogonal to the phase flags; does not change phase structure.

- `--model-mode default` (default) — emit no `model:` opt; every worker inherits the session model
  (today's behavior, byte-for-byte).
- `--model-mode auto` — tier each worker by phase class: **haiku** for mechanical work (Setup, every
  checkpoint, Verify/ReVerify, PR, TicketUpdate), the **think** model for reasoning (Brief, RED,
  PathGap, CodeGate/Review, TestGate, DocsGate, Writeup), and the **work** model for the `--phases`
  tasks. Tune with `--model-think <sonnet|opus|haiku|fable>` (default `opus`) and `--model-work <…>`
  (default `sonnet`).

## Swapping the gate agents

Each gate defaults to an agent bundled with this plugin (in `agents/`), referenced by its
**plugin-namespaced** type, and is overridable: `--agent-red` (default `lirbox:lirbox-test-writer`),
`--agent-code` (default `lirbox:lirbox-code-reviewer`), `--agent-tests` (default
`lirbox:lirbox-tryve-enhancer`), `--agent-docs` (default `lirbox:lirbox-docs-writer`), `--agent-web`
(default `lirbox:lirbox-web-verifier`), `--agent-mobile` (default `lirbox:lirbox-mobile-verifier`).
Pass your own
`agentType`, or `none` to drop the `agentType` so that gate uses a **generic built-in subagent** (the
prompt still runs — no agent dependency at all). Example: `--agent-code my-team-reviewer --agent-docs none`.

**Agent dependency.** The default gate agents (`lirbox:lirbox-test-writer`,
`lirbox:lirbox-code-reviewer`, `lirbox:lirbox-tryve-enhancer`, `lirbox:lirbox-docs-writer`) ship with
this plugin, so the gates work out of the box once the plugin is installed. Override any gate with
your own agent (`--agent-*`) or pass `--agent-*=none` to run it on a generic built-in subagent — no
bundled-agent dependency.

## Per-worker implementation notes

Work/gate workers may keep a per-worker `implementation-notes/<slot>.html` in the worktree (unique per
slot so parallel agents never clobber) — but only **when there's something a reviewer genuinely
needs**: a non-trivial design decision, an intentional deviation, a real tradeoff, or an open
question. Mechanical steps (e.g. the PR push) make no notes at all; no-decision work skips the file
rather than emitting boilerplate. When a `Writeup` phase runs it **promotes** these notes into the
committed `docs/changes/<name>/notes/` (alongside the generated `writeup.html` + `design.html`), so
they reach the reviewer instead of being dropped.

## Prompts as DATA — never hand-edit the emitted script

**Pass the work-phase prompts as DATA via `--prompt` / `--prompts-file` — do NOT read the generated
script back and edit it by hand.** The prompt text is the one task-specific part; write it straight
into the generator inputs and it splices each into the matching work phase, emitting a launch-ready
script. You authored the prompts, so there's no need to re-ingest the boilerplate — glance at the
printed phase order to confirm structure, then launch. To change structure (or fill a prompt left
empty), re-run the generator with `--force`; never hand-edit. (Work phases return `{ summary }` by
default; if a phase needs a richer return shape or a phase-specific agent, pass it via `--spec` — not
by editing the generated file.)
