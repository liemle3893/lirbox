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
| **`deep-understanding`** | Interactive tutor: teaches you to deeply understand a PR/change/subsystem, incrementally — assesses what you know, fills gaps, quizzes you (problem → solution → impact), and doesn't stop until mastery is verified. Not a document — a guided session. |
| **`conductor`** | Drive the Workflow tool with durable on-disk state, crash/restart resume, worktree isolation, opt-in enforcement gates, and a cost report. For long or interruptible multi-subagent runs (migrations, audits, staged delivery). |
| **`prospector`** | Sequential keep-or-discard optimization loop on conductor's durable backbone: auto-proposes a numeric metric + hard correctness gate from a goal (confirm once), then hill-climbs ONE code surface — keeping a change only when it strictly beats the metric **and** passes the gate — on an isolated branch, never auto-merged. For objective scalars: hot-path perf, bundle/binary size, memory, test-suite speed, eval score, LLM cost. |
| **`whetstone`** | Overnight, feedback-driven skill improver on the same backbone: works a backlog of filed concerns through a deterministic floor + per-item acceptance-check (fail-before/pass-after), keeping only changes a check confirms, on a branch never auto-merged. For sharpening skills (or other deterministic-output targets) from accumulated suggestions/concerns. |

### Agents

Generic, public-ready subagents (in `plugins/lirbox/agents/`) — the default enforcement-gate
agents for `conductor`, also usable standalone:

| Agent | Role |
|-------|------|
| **`lirbox-test-writer`** | Test-first (RED): writes failing tryve-E2E/unit tests from acceptance criteria before implementation. |
| **`lirbox-tryve-enhancer`** | Hardens coverage from the engineering perspective — error paths, boundaries, auth, concurrency — from the diff. |
| **`lirbox-code-reviewer`** | Reviews changed code (correctness/security/rules/quality) **and fixes** Critical/High, keeping the build green. |
| **`lirbox-docs-writer`** | Writes a concise implementation summary into `docs/changes/` from the diff + goal + notes. |

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
help me deeply understand PR 1059   # deep-understanding (interactive, quizzes you)
implement <plan/spec> with resume   # conductor (durable, crash-safe multi-subagent run)
make the /search endpoint faster    # prospector (proposes a metric + gate, confirms once)
improve the flowchart skill         # whetstone (overnight, eval-gated, from a backlog)
```

Skills resolve under the `lirbox:` namespace (e.g. `lirbox:pr-writeup`, `lirbox:plan-deck`, `lirbox:codewalk`, `lirbox:flowchart`, `lirbox:deep-understanding`, `lirbox:conductor`, `lirbox:prospector`, `lirbox:whetstone`).

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

## Extending

See [CONTRIBUTING.md](./CONTRIBUTING.md) for how to add a new skill, a new agent, or a
whole new plugin to this marketplace.

## License

MIT — see [LICENSE](./LICENSE).
