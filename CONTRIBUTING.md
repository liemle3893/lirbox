# Contributing to lirbox

This marketplace has two layers:

```
lirbox/                         ← the marketplace (a git repo)
├── .claude-plugin/marketplace.json     ← lists every plugin
├── plugins/
│   └── lirbox/                         ← a plugin
│       ├── .claude-plugin/plugin.json   ← plugin manifest
│       ├── skills/<name>/SKILL.md        ← auto-discovered skills
│       └── agents/<name>.md              ← auto-discovered agents
└── templates/                           ← copy-paste starters (NOT a plugin)
```

Three things you might add. Pick the matching section.

---

## A. Add a new **skill** to the `lirbox` plugin

Skills are auto-discovered from `plugins/lirbox/skills/`. No manifest edit needed.

1. Copy the template:
   ```bash
   cp -R templates/skill-template plugins/lirbox/skills/<your-skill-name>
   ```
2. Edit `plugins/lirbox/skills/<your-skill-name>/SKILL.md`:
   - `name:` must equal the directory name, kebab-case.
   - `description:` write it in the third person and be explicit about **when** to use it
     (the model reads only `name` + `description` to decide whether to trigger the skill —
     this is the single most important field).
3. Put any bundled resources alongside `SKILL.md`:
   - `scripts/` — executable code (reference as `${CLAUDE_PLUGIN_ROOT}/skills/<name>/scripts/...`).
   - `references/` — docs loaded on demand to keep `SKILL.md` lean.
   - `assets/` — templates/images/fonts used in the skill's output (not loaded into context).
4. Test, then commit. (See **Testing** below.)

Naming: kebab-case, no spaces. The skill resolves as `lirbox:<your-skill-name>`.

---

## B. Add a new **agent** to the `lirbox` plugin

Agents are auto-discovered from `plugins/lirbox/agents/` as `*.md` files with frontmatter.

1. Copy the template:
   ```bash
   cp templates/agent-template.md plugins/lirbox/agents/<your-agent-name>.md
   ```
2. Edit the frontmatter:
   - `name:` (required) — kebab-case, unique; this is how the agent is selected.
   - `description:` (required) — when to dispatch this agent; be specific.
   - `model:` (optional) — e.g. `claude-opus-4-1`, `sonnet`, `haiku`; omit to inherit.
   - `tools:` / `permissions.allowedTools` (optional) — restrict the agent's tool access.
3. Write the agent's system prompt as the markdown body — its role, method, and output contract.
4. Test, then commit.

Keep agents single-purpose: a tight role + a clear output contract beats a broad one.

---

## C. Add a brand-new **plugin** to the marketplace

Use this when the work is a coherent product of its own rather than another tool in `lirbox`.

1. Scaffold:
   ```bash
   mkdir -p plugins/<new-plugin>/.claude-plugin plugins/<new-plugin>/skills
   ```
2. Create `plugins/<new-plugin>/.claude-plugin/plugin.json` (copy `plugins/lirbox/.claude-plugin/plugin.json`
   and edit `name`, `description`, `keywords`). Omit `version` during active development so
   updates track the git SHA — otherwise you must bump it on every release or users won't see changes.
3. Add skills/agents under the plugin root (`skills/`, `agents/`) — same conventions as A and B.
4. Register it in `.claude-plugin/marketplace.json` by appending to the `plugins` array:
   ```json
   {
     "name": "<new-plugin>",
     "source": "./plugins/<new-plugin>",
     "description": "…",
     "keywords": ["…"]
   }
   ```
   `name` must match the plugin's `plugin.json` `name`. `source` is a path relative to the repo root.

---

## Layout rules (do not violate)

- `marketplace.json` lives at `.claude-plugin/marketplace.json` in the **repo root** — never under `plugins/`.
- A plugin's `.claude-plugin/` holds **only** `plugin.json`. `skills/`, `agents/`, `hooks/` go at the
  plugin **root**, not inside `.claude-plugin/` (a common mistake — they won't load otherwise).
- All names are kebab-case, no spaces.
- Reference plugin-internal files at runtime via `${CLAUDE_PLUGIN_ROOT}` (resolves to the installed
  plugin dir), never with absolute machine paths.

## Commit identity (required)

This repo enforces the **liemle3893** personal identity so a machine's work git
config can't leak into public history. After cloning, activate the hook once:

```bash
git config core.hooksPath .githooks
git config user.name  "liemle3893"
git config user.email "33980597+liemle3893@users.noreply.github.com"
```

`.githooks/pre-commit` blocks any commit whose author is the work account
(`liemlhd_msn` / crownx / masangroup) or isn't the expected personal identity.

## `main` is pull-request-only

Nothing lands on `main` by direct push — not even from an admin. The GitHub
ruleset **"main: pull requests only"** requires a PR, requires both `evals`
jobs (`floors + frozen checks`, `generator regression nets`) to be green, and
forbids force-push and deletion of `main`. Its bypass list is **empty**, so
there is no admin escape hatch; loosening it is a deliberate, visible edit to
the ruleset.

Reviews are *not* required (0 approvals) — a sole maintainer cannot approve
their own PR, so CI is the gate, not a rubber-stamp.

```bash
git switch -c <type>/<slug>     # e.g. chore/protect-main-pr-only
git push -u origin HEAD
gh pr create --fill
```

`.githooks/pre-push` refuses the same push locally, before the network call.
`--no-verify` skips the hook but not the ruleset — the server still rejects it.

Run branches from the loop skills (`improve/*`, `opt/*`, `wf/*`, `evals/*`) are
unrestricted; they already finish by opening a PR.

## Testing

Three tiers, cheapest first. **Tiers 1 and 2 are required before shipping. Tier 3 is offered,
never assumed.**

### Tier 1 — validate + smoke-test (seconds, always)

```bash
claude plugin validate .                      # schema-check marketplace + all plugins
claude --plugin-dir ./plugins/lirbox         # load the plugin in a throwaway session and try the skill/agent
```

Then run `/lirbox:skill-lint` — it audits word budget, XML structure and weak frontmatter
triggers. Advisory only: it reports, it does not edit.

### Tier 2 — evals (REQUIRED — this is the real release gate)

A skill with no floor cannot be regression-tested, and **cannot be improved by `whetstone`
later**: whetstone's keep-rule is *floor passes AND the item's check goes RED→GREEN AND the
surface-lock holds*, so with no floor there is nothing to tunnel-proof against. Skills that
shipped without one (`codewalk`, `c4-model`, `deep-understanding`, `pr-writeup`) are stuck
ungated and unimprovable — do not add to that list.

```
plugins/lirbox/skills/<name>/evals/
  floor/                 invariants that must always hold
  checks/                one frozen check per bug fixed later (empty at first)
  checks-manifest.json   declares every check — an UNLISTED check fails the whole gate
```

For an **artifact skill**, the highest-value floor runs a headless validator over the skill's
own output. `flowchart` ships `assets/validate.mjs` and its floor runs it — which is why its
label-escaping bugs are caught deterministically and `codewalk`'s are not. If your skill emits
a file, write the checker.

Confirm the gate sees it — the repo-wide run must stay green, not just your slice:

```bash
node scripts/evals-all.mjs --fast --skill <name>
node scripts/evals-all.mjs --fast
```

### Tier 3 — Harbor: containerised behavioural test — OFFER IT, DO NOT ASSUME IT

Tier 2 is **artifact-level**: it checks what a skill's text and generators *contain*. Swap the
model underneath and every tier-2 check stays green while behaviour changes completely. A
containerised run is the only layer that sees that.

**An agent implementing a skill MUST ask the user before doing any of this, and MUST state the
cost split — the two halves differ by three orders of magnitude:**

| | cost | what it buys |
|---|---|---|
| build the task + run the discrimination gate (`-a nop`, `-a oracle`) | **free** — no model calls, ~30s/task | proves the task is well-formed: hidden graders RED on base, fixture GREEN on base, a do-nothing agent scores 0 |
| a real behavioural run (`-a claude-code -m <model>`) | **~$5–15 per task** | whether the skill actually works |

- If the user **declines** — skip it and **say so in your summary**. Never silently omit it.
- If the user **accepts** — write the Harbor task and run the **free** gate. The paid run is a
  separate ask, made separately.

A skill declares its own tasks; nothing in the builder knows about any specific skill.

```
plugins/lirbox/skills/<skill>/harbor/
  harness.md              directive prepended to every instruction (optional)
  tasks/<id>/
    instruction.md        REQUIRED — what the agent is asked to do
    verify.sh             REQUIRED — the only grader; writes /logs/verifier/reward.json
    files/                optional — copied into /app before the agent runs
    task.toml             optional — hand-tuned resources/network/artifacts; merged
```

```bash
node scripts/harbor-build.mjs --skill <skill>                    # build that skill's tasks
harbor run -p .harbor/tasks/<skill>__<id> -a nop -e docker -y    # free: discrimination gate only
```

Two honest caveats. Harbor is **not adopted** — `swe-run.mjs` is still the execution engine and
no scorecard has been produced through Harbor; treat tier 3 as an available instrument, not the
default path. And when injecting the skill catalog into a container, always use the **pruned**
catalog `harbor-build.mjs` emits (`.harbor/skills`), never `plugins/lirbox/skills` — skills keep
their eval material inside their own directory, so an unpruned inject puts every task's hidden
graders in the agent's own discovery path and it can read the answer key. The prune is generic —
every skill's `evals/`, `harbor/` and `arena/` — and hard-fails if anything leaks.

#### Running against Ollama, or any Anthropic-compatible endpoint

Free (your own hardware), and the only honest way to measure the **capability floor** — which
models a skill can actually be driven by. It is *not* a cheap substitute for a paid run: a small
model failing tells you where the floor is, it does not tell you the skill is broken.

**Auth.** A subscription does not transfer into a container. Either an API key, or a token:

```bash
claude setup-token   # then: --ae CLAUDE_FORCE_OAUTH=1 --ae CLAUDE_CODE_OAUTH_TOKEN=<token>
```

**Pre-flight 1 — tool calling.** Claude Code is dead without it, so check before anything else:

```bash
curl -s $URL/v1/messages -H 'content-type: application/json' -d '{
  "model":"<model>","max_tokens":512,
  "tools":[{"name":"get_weather","description":"Get weather","input_schema":
    {"type":"object","properties":{"city":{"type":"string"}},"required":["city"]}}],
  "messages":[{"role":"user","content":"Use the tool for Hanoi."}]}'
```

Want `"stop_reason":"tool_use"` and a `tool_use` content block. The first call often times out while
the model loads — retry with a longer timeout before concluding the route is missing.

**Pre-flight 2 — container reachability.** A Tailscale/LAN host reachable from the shell is not
automatically reachable from inside a container:

```bash
docker run --rm curlimages/curl -s $URL/api/version
```

**Run:**

```bash
harbor run -p .harbor/tasks/<skill>__<id> -a claude-code -m <model> --skill .harbor/skills \
  --ae ANTHROPIC_BASE_URL=$URL --ae ANTHROPIC_AUTH_TOKEN=<any-non-empty> \
  --ae CLAUDE_CODE_AUTO_COMPACT_WINDOW=26000 --ae CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=85 \
  --ak disallowed_tools="CronCreate,CronDelete,CronList,EnterWorktree,ExitWorktree,NotebookEdit,ReportFindings,ScheduleWakeup,SendMessage,TaskCreate,TaskGet,TaskList,TaskOutput,TaskStop,TaskUpdate,ToolSearch,WebFetch,WebSearch" \
  -e docker -y
```

Why each flag, with numbers measured on this repo:

- **`CLAUDE_CODE_AUTO_COMPACT_WINDOW`** — Claude Code cannot detect a third-party context window
  and falls back to a hardcoded **200K**, so it would auto-compact at ~187K, long after a 32K
  server has already truncated. Set it *below* your real window;
  `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` is a percentage of that value.
- **`--ak disallowed_tools`** — a non-first-party base URL disables MCP tool search, so every tool
  schema ships on every request. Measured: **19,014** input tokens with the full set, **11,080**
  trimmed to conductor's seven (`Task, Bash, Edit, Read, Skill, Workflow, Write`). That ~7.9K is
  the difference between fitting and not.

**Budget floor (measured):** ~11,080 baseline + ~2,447 for conductor's `SKILL.md` + 1.5–3.3K per
reference file loaded. So **16K is structurally impossible** — the floor exceeds the window — and
**32K is marginal**, leaving ~18K of actual working room.

**Compaction cannot rescue you below that floor.** It summarises *conversation history*; it cannot
touch the system prompt, the tool schemas, or loaded skill content. Trimming tools and pruning the
injected catalog are the only levers that move the floor itself.

**Cost is fictional on a local endpoint.** Harbor reports `cost_usd` from a LiteLLM estimate,
tagged `cost_source: litellm_estimate`. A local run costs nothing — filter on that tag before any
cost figure reaches a scorecard.

**Reading the result.** A 0 is a finding, not a failure. Check *which* failure: no `wf/` branch
means the model could not drive the skill (engagement), while a branch with a wrong diff means it
drove it and got the work wrong (quality). Measured example: a 2B-class local model invoked the
conductor skill correctly, then ignored the foreground directive, backgrounded the workflow, ended
its turn — orphaning the run — and reported success. Engagement 0, and nothing to do with its
coding ability.

### Then ship

Commit with a clear message (`feat(lirbox): add <skill>` / `feat(marketplace): add <plugin>`),
push, then `/plugin marketplace update lirbox` to pull the change into an installed copy.
