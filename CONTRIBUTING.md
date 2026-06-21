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

## Testing

Always validate and smoke-test before pushing:

```bash
claude plugin validate .                      # schema-check marketplace + all plugins
claude --plugin-dir ./plugins/lirbox         # load the plugin in a throwaway session and try the skill/agent
```

Commit with a clear message (`feat(lirbox): add <skill>` / `feat(marketplace): add <plugin>`),
push, then `/plugin marketplace update lirbox` to pull the change into an installed copy.
