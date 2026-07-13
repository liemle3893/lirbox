<p align="center">
  <img src="assets/logo.png" alt="lirbox logo" width="160">
</p>

# lirbox

liemle3893's personal [Claude Code](https://docs.claude.com/en/docs/claude-code) plugin marketplace.

One marketplace, growing over time. Today it ships a single plugin — **`lirbox`** — a
personal collection of skills and agents.

## Plugins

The **`lirbox`** plugin — a growing collection of skills (and agents). Skills so far:

| Skill | What it does |
|-------|--------------|
| **`pr-writeup`** | Turn any pull request into a self-contained HTML write-up (TL;DR, motivation, file-by-file tour, where-to-focus, test plan, rollout). Features, bugfixes, refactors, docs. |
| **`plan-deck`** | Turn a spec or task into a self-contained HTML implementation plan (milestone timeline, data-flow, mockups, key code, risks, open questions). Feature, backend, infra/migration, refactor. |
| **`codewalk`** | Trace one path through a real codebase into a self-contained HTML walkthrough (path diagram, numbered steps with verified `file:line` + code excerpts, key files, gotchas). For onboarding or auditing a flow/subsystem. |
| **`flowchart`** | Turn a branching process (CI/deploy pipeline, approval/OTP funnel, state machine) into an interactive HTML flowchart — Mermaid diagram with decision diamonds + clickable per-node detail panel. Note: renders via a CDN, so this one needs internet. |
| **`component-diagram`** | Draw a system's static structure as a self-contained interactive HTML component diagram — Mermaid flowchart with subgraph boundaries + typed dependency edges + a clickable per-component panel (responsibility / interface / deps). Note: renders via a CDN, so this one needs internet. |
| **`sequence-diagram`** | Draw a time-ordered interaction as a self-contained interactive HTML sequence diagram — Mermaid sequenceDiagram (autonumbered) + a numbered step list driving a clickable detail panel (who→who, sync/async, code at the call site). Note: renders via a CDN, so this one needs internet. |
| **`deep-understanding`** | Interactive tutor: teaches you to deeply understand a PR/change/subsystem, incrementally — assesses what you know, fills gaps, quizzes you (problem → solution → impact), and doesn't stop until mastery is verified. Not a document — a guided session. |
| **`conductor`** | Drive the Workflow tool with durable on-disk state, crash/restart resume, worktree isolation, opt-in enforcement gates, and a cost report. For long or interruptible multi-subagent runs (migrations, audits, staged delivery). |
| **`prospector`** | Sequential keep-or-discard optimization loop on conductor's durable backbone: auto-proposes a numeric metric + hard correctness gate from a goal (confirm once), then hill-climbs ONE surface — keeping a change only when it strictly beats the metric **and** passes the gate, within an optional edit-size budget — then opens a PR for review (never auto-merges). For objective scalars: hot-path perf, bundle/binary size, memory, test-suite speed, eval score, LLM cost — or a skill's held-out task-pass-rate (see the [`skill-train`](./plugins/lirbox/skills/prospector/references/skill-train.md) recipe). |
| **`whetstone`** | Overnight, eval-gated skill improver on the same backbone: grinds a backlog through a deterministic floor + per-item acceptance-check (fail-before/pass-after), keeping only changes a check confirms, plus an optional compaction pass that shrinks the skill — then opens a PR for review (never auto-merges). Backlog items are filed by hand **or harvested from failing eval tasks**; SkillOpt-derived controls (train/val scoring, edit-size budget) keep fixes general. For sharpening skills (or other deterministic-output targets). See the [cookbook](./docs/skill-improvement-cookbook.md). |
| **`arena`** | Reproducible pairwise **leaderboard** on the same backbone: runs `conductor` against frozen fixture tasks under multiple configs (model/mode/effort), judges the **delivered diffs** pairwise (3 runs × 5 position-swapped passes), and emits a Bradley-Terry/win-rate ranking — then opens a PR for review (never auto-merges). For answering "did this change actually improve conductor's output across a task suite?" when there's no single scalar to hill-climb. |
| **`skill-lint`** | Deterministic analyzer for the skills themselves: flags SKILL.md files that "read like a book" (over the word budget or dense with long prose), unbalanced/missing XML structural tags, weak frontmatter triggers, and oversized inline flowcharts or reference files. Reports ranked findings; does not edit. Run it or ask "which skills are too long". |

### Agents

Generic, public-ready subagents (in `plugins/lirbox/agents/`) — the default enforcement-gate
agents for `conductor`, also usable standalone:

| Agent | Role |
|-------|------|
| **`lirbox-test-writer`** | Test-first (RED): writes failing tryve-E2E/unit tests from acceptance criteria before implementation. |
| **`lirbox-tryve-enhancer`** | Hardens coverage from the engineering perspective — error paths, boundaries, auth, concurrency — from the diff. |
| **`lirbox-code-reviewer`** | Reviews changed code (correctness/security/rules/quality) **and fixes** Critical/High, keeping the build green. |
| **`lirbox-docs-writer`** | Writes a concise implementation summary into `docs/changes/` from the diff + goal + notes. |
| **`lirbox-web-verifier`** | Web half of the frontend verification gate: writes Playwright E2E specs for assertable criteria and captures per-viewport screenshot/console evidence for judged ones; engine chain playwright → browser-MCP → OS-script, tooling failure never silently passes. |
| **`lirbox-mobile-verifier`** | Mobile half of the frontend verification gate: detects RN/Flutter/native, writes Maestro/Appium E2E flows, falls back to raw `simctl`/`adb` evidence capture on simulators/emulators; raw tier is honestly flagged evidence-only. |

## Install

In Claude Code:

```text
/plugin marketplace add liemle3893/lirbox
/plugin install lirbox@lirbox
```

Then use a skill — just describe the task:

```text
write up PR 1059                    # pr-writeup
write up PR 1059 verbose            # snippet on every non-trivial file
make a plan-deck for <spec/task>    # plan-deck
codewalk the auth flow              # codewalk
flowchart the deploy pipeline       # flowchart
diagram the components of <service>  # component-diagram
sequence-diagram the login flow      # sequence-diagram
help me deeply understand PR 1059   # deep-understanding (interactive, quizzes you)
implement <plan/spec> with resume   # conductor (durable, crash-safe multi-subagent run)
make the /search endpoint faster    # prospector (proposes a metric + gate, confirms once)
improve the flowchart skill         # whetstone (overnight, eval-gated, from a backlog)
which conductor config wins         # arena (pairwise leaderboard over frozen fixtures)
which skills are too long?          # skill-lint (deterministic scan; reports, never edits)
```

Skills resolve under the `lirbox:` namespace (e.g. `lirbox:pr-writeup`, `lirbox:plan-deck`, `lirbox:codewalk`, `lirbox:flowchart`, `lirbox:component-diagram`, `lirbox:sequence-diagram`, `lirbox:deep-understanding`, `lirbox:conductor`, `lirbox:prospector`, `lirbox:whetstone`, `lirbox:arena`, `lirbox:skill-lint`).

## Test locally (no install)

Validate and run straight from a clone, without registering the marketplace:

```bash
git clone https://github.com/liemle3893/lirbox
cd lirbox
claude plugin validate .                       # validate marketplace + plugins
claude --plugin-dir ./plugins/lirbox          # load the plugin for one session
```

Or add the local checkout as a marketplace:

```text
/plugin marketplace add ./path/to/lirbox
```

## Updating

The `lirbox` plugin omits a pinned `version`, so Claude Code tracks the git commit SHA —
pushing new commits is enough for installed users to pick up updates on
`/plugin marketplace update lirbox`.

## Guides

- [Making a skill whetstone-ready](./docs/whetstone-ready.md) — the floor + acceptance-check
  scaffolding a skill needs before `whetstone` can grind it.
- [Skill-improvement cookbook](./docs/skill-improvement-cookbook.md) — the end-to-end SkillOpt-style
  flow: scored tasks (train/val) → harvest failures into a backlog → `whetstone` with a compaction
  pass → review the auto-PR. Worked example with real before/after numbers.
- [`skill-train` recipe](./plugins/lirbox/skills/prospector/references/skill-train.md) — point
  `prospector` at a skill to hill-climb its held-out task-pass-rate.
- [Running the arena](./docs/arena-guide.md) — how to run `arena` (skill + manual orchestration),
  add fixture tasks, compare conductor **versions** via `--plugin-dir`, and read the leaderboard.
  Includes a worked run (current vs baseline conductor) and the live-run gotchas.
- [SkillOpt exploration](./docs/skillopt-exploration.md) — why these controls exist (the Microsoft
  SkillOpt mapping onto `prospector`/`whetstone`) and the empirical run that validated them.

## Extending

See [CONTRIBUTING.md](./CONTRIBUTING.md) for how to add a new skill, a new agent, or a
whole new plugin to this marketplace.

## License

MIT — see [LICENSE](./LICENSE).
