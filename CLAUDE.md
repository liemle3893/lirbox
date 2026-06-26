# lirbox — repo guide for Claude

Personal Claude Code **plugin marketplace**. One plugin, `lirbox`, under `plugins/lirbox/`:

- `skills/<name>/SKILL.md` (+ optional `scripts/`, `references/`, `assets/`) — one skill each.
- `agents/<name>.md` — subagents (the default enforcement gates for `conductor`, usable standalone).
- `.claude-plugin/marketplace.json` — marketplace manifest (skills are auto-discovered, not listed here).
- `docs/superpowers/{specs,plans}/` — design specs + implementation plans for in-flight work.

Full skill catalog → [README.md](./README.md). Adding a skill/agent/plugin → [CONTRIBUTING.md](./CONTRIBUTING.md).

## Two skill families (and the conventions that matter)

**HTML-artifact skills** (`codewalk`, `flowchart`, `plan-deck`, `pr-writeup`) emit one self-contained HTML
file. `flowchart` ships a headless `assets/validate.mjs` — run it on output
(`node .../validate.mjs <file>.html`); it catches Mermaid label-escaping bugs. `deep-understanding` is an
interactive tutor (no artifact).

**Orchestration / loop skills** (`conductor`, `prospector`, `whetstone`) share one backbone: a deterministic
JS *conductor* (the generated `.js`) driving full-tool *worker* subagents. Hard rules when editing them:

- **The conductor layer is restricted — pure JS only: NO `fs`/`git`/`require`/`Date.now()`/`Math.random()`.**
  Every side-effect lives inside an `agent()` worker prompt. Their `test-*.cjs` enforce this with a string scan.
- **Never hand-edit a generated loop script.** They come from `scripts/scaffold-*.cjs` — change the generator
  and regenerate with `--force`. Hand-edits reintroduce drift.
- **Run the regression net after touching a generator:**
  `node plugins/lirbox/skills/<skill>/scripts/test-*.cjs` (asserts loop/phase structure + the no-fs scan +
  unit helpers). `conductor` → `test-scaffold.cjs`, `prospector` → `test-optimize.cjs`, `whetstone` → `test-improve.cjs`.
- **Non-destructive default:** these never auto-merge — they leave a branch (`wf/`, `opt/`, `improve/<name>`),
  a worktree, and a report for the human to review and merge.

## Runtime artifacts are gitignored — never commit them

`.workflows/` (conductor), `.optimize/` (prospector), `.improve/` (whetstone), `.worktrees/`, generated
`*-flowchart/codewalk/plan-deck.html`, and `implementation-notes/` (worker build-scratch — delivered only
through a docs gate, otherwise dropped).

## Validate

- `claude plugin validate .` — validate the marketplace + plugin before pushing.
- A skill's frontmatter `description` is its **trigger** — keep it specific; it decides when Claude invokes it.
- Skills resolve under the `lirbox:` namespace (e.g. `lirbox:conductor`).
