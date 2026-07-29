# DoD acquisition detail (SKILL.md step 1c)

SKILL.md keeps the DECISION (which tier, which flag, the hard rules); this file holds the HOW —
long-form probes, formats, precedence and worked examples. Split out of the old `run-planning.md`
so a run loads only the step it is on.

### 2a. Criteria format

Every lite/delivery run carries a **definition of done**: criteria in
`{ "criteria": [{ "id", "text", "tier": "checkable"|"judged", "check"? }] }` form — `checkable`
= a frozen command (exit 0 = met, run against the worktree), `judged` = a verdict that must cite
evidence. Guidance 3–7 criteria, **no hard cap** — never drop ticket-supplied ACs to fit; above
~10, propose splitting into independently-shippable slices in the SAME confirmation question
(run 2 starts only after run 1's PR merges — never stack branches; record the deferred slice's
goal + ACs in run 1's state so they survive scrollback).

### 2b. Source precedence

1. **Ticket / plan ACs** — fetch them now (main session) and refine into checkable form.
2. **plan-check report** — if the goal references one, read its
   `<script type="application/json" id="dod">` block as the seed.
3. **Bare goal** — derive the criteria yourself.

### 2c. Frontend / mobile probe

When the goal touches UI (web or native mobile), additionally probe the machine NOW (main
session): a Playwright config (or clean installability), `maestro`/`appium` binaries, Xcode
simulators (`xcrun simctl`) / `adb`, and browser-MCP reachability. From the probe, propose a
`frontend` block — per-target engine chain + viewport matrix, e.g.

```json
{ "web": ["playwright", "browser-mcp", "os-script"], "mobile": ["maestro"],
  "viewports": ["desktop-1440", "iphone-15", "pixel-8"] }
```

— and fold it into the SAME one-shot DoD `AskUserQuestion` (one question total, not two). On
confirm it is frozen into `.workflows/<name>.dod.json` alongside the criteria; pass
`--frontend web|mobile|both` in step 2 so the run gets a **FrontendGate**. The chain travels as
DATA in the DoD file — the generator splices it and never probes the machine.

### 2d. Content probe

When the goal is content-shaped (touches `docs/`, `*.md`, or marketing copy), additionally probe
the repo NOW (main session) for existing prose tooling — `.vale.ini`, `cspell.json`,
`.markdownlint*`, or a docs-lint npm script — and propose a **checkable criterion** in the SAME
one-shot DoD `AskUserQuestion`. This is a plain entry appended to `criteria[]`, **not** a
`dod.json` block: DoDGate reads `criteria[]` and runs each `check` inside the worktree, and there
is no content phase to consume a block.

- Repo has its own tooling → propose that command (e.g. `check: "npx vale docs/"`).
- Repo has none → propose the built-in floor `prose-lint.mjs` (a zero-dep structural linter:
  heading skips, dead local links, unbalanced fences, placeholder markers, malformed frontmatter).

Because DoDGate runs the `check` inside the target **worktree** but `prose-lint.mjs` ships in the
plugin dir, **copy it into the worktree at DoD-acquisition** (e.g. `.workflows/prose-lint.mjs`)
and reference that worktree-local path — this is resume-proof (survives a mid-run plugin update;
no absolute plugin-cache path that can move). The frozen criterion:

```json
{ "id": "prose-lint", "tier": "checkable",
  "text": "docs prose passes the structural lint (headings, local links, fences, no placeholders)",
  "check": "node .workflows/prose-lint.mjs docs/" }
```

### 2e. Freeze + verification

Whatever the source, confirm ONCE with the human (one `AskUserQuestion`: accept / edit), then
freeze: write the JSON to `.workflows/<name>.dod.json` and pass `--dod-file` in step 2. bare-tier
runs may skip the DoD entirely; lite/delivery require it (`--no-dod` is the explicit opt-out).
At the end of the run the **DoDGate** verifies every criterion (fix-loop ≤3, then hard-fail), the
PR body and run report carry the scorecard, and a criterion already met at baseline is flagged
as non-discriminating.
