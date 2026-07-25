# Run planning — triage, DoD acquisition, decomposition (SKILL.md steps 1b / 1c / 2)

SKILL.md keeps the DECISION for each of these steps (which tier, which flag, the hard rules).
This file holds the HOW: the long-form probes, formats, precedence rules and worked examples.
Read it while working a NEW run's steps 1b → 1c; a resume skips both (its profile and DoD are
already frozen in `state.json` / `.workflows/<name>.dod.json`, and the decomposition — which the
loop, not you, decides — is checkpointed per phase).

---

## 1. Triage detail (SKILL.md step 1b)

Classify the goal and pick ONE tier. Bias **down** — do not reach for a bigger profile than the
work earns.

- **decline** — trivial / one-shot / single-file; finishes in one pass and won't span sessions.
  Conductor is overkill: say so, do it inline or call the Workflow tool directly, and **STOP**.
  This applies **even if conductor was invoked explicitly** (e.g. `/lirbox:conductor <goal>` or
  by name) — explicit invocation selects the skill, it does not license skipping triage or
  jumping straight to scaffold/launch. Regardless of how directly conductor was called, when
  triage lands on decline you must still surface the cost/overkill caveat and offer to do the
  work inline **before** generating or launching anything.
- **bare** — multi-step but low-risk, no PR/ticket/gates → generator with just `--phases` (or
  the default single `Work`).
- **lite** — routine delivery, small/low-risk PR → `--profile lite`.
- **delivery** — substantial or risky: broad surface, migration, behavioral change, must not
  regress → `--profile delivery`.

Signals that push **up** a tier: spans sessions · losing progress is costly · many files
touched · behavioral/endpoint change · needs review/tests/docs/PR/ticket. With none present,
pick the lowest tier. When the signals are genuinely ambiguous, ask the user **one**
`AskUserQuestion` (decline / bare / lite / delivery) rather than guessing big.

---

## 2. DoD acquisition detail (SKILL.md step 1c)

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

---

## 3. Decomposition — the loop's job, not the caller's (SKILL.md step 2)

**You declare the GOAL (step 1) and the DEFINITION OF DONE (step 1c). The loop decides the
SPLIT.** There is no caller-facing decomposition step: writing down work items and their edges
before generating means guessing at a shape nothing has read the code to confirm, and a wrong edge
does not fail loudly — it produces a clean merge over semantically broken work.

### 3a. Planner fan-out (runtime — work inside a phase is not serial)

By default each work phase first runs a **planner** worker (`plan:<Phase>`) that reads the repo and
returns its items plus each item's `dependsOn`; the conductor then dispatches them **by dependency
level** — every ready item in ONE `parallel()` batch, each worker in its own worktree/branch, each
level integrated back into the run branch before the next level branches off it, so a dependent item
always starts from a base carrying what it needs. Phase ORDER is untouched. The plan is
checkpointed before the first item runs, so a resume reuses that decomposition instead of
re-planning a different one, and a one-item plan is just today's single worker. Pass
`--no-plan-fanout` to turn a phase back into one serial worker.

### 3b. What the caller still controls

- **The prompt.** If you already know the items, name them in the phase prompt — the planner reads
  it and returns them, with the edges it derives from the code rather than from your guess.
- **`--phases`.** Genuinely staged, human-visible stages (e.g. `Analyze,Implement`) — each stage
  gets its own planner. Not a way to spell out work items.
- **`--no-plan-fanout`.** The single escape hatch: force ONE serial worker for the phase.

`--independent` (caller-declared items, fanned out at scaffold time) has been **removed** and now
hard-errors; its per-worker worktree isolation lives on in the planner fan-out.

---

## 4. Finalize detail (SKILL.md step 5)

When the Workflow returns, stamp `status` + `finishedAt` from the main session (the conductor
cannot — it has no filesystem). **If the Workflow threw** (a hard-fail gate), set
`status: "failed"` not `complete` — the last checkpoint's state is preserved, so a later `resume`
re-runs only the failed gate onward, and you should report the throwing gate's message to the user.

```
# success
node -e "const f='.workflows/state/<name>.json';const s=JSON.parse(require('fs').readFileSync(f,'utf8'));s.status='complete';s.finishedAt=new Date().toISOString();require('fs').writeFileSync(f,JSON.stringify(s,null,2))"
# on Workflow error → status:failed
node -e "const f='.workflows/state/<name>.json';const s=JSON.parse(require('fs').readFileSync(f,'utf8'));s.status='failed';s.finishedAt=new Date().toISOString();require('fs').writeFileSync(f,JSON.stringify(s,null,2))"
```

Then generate the run report (duration/tokens/cost) and report to the user: the report summary
(`.workflows/reports/<name>.md`), the final `results`, and the **branch** (`wf/<name>`) +
**worktree** (`.worktrees/<name>`) holding the committed work, to review and merge.

```
node <skill-dir>/scripts/workflow-report.cjs <name>
```

**Do NOT auto-merge or auto-remove the worktree** — the human's call (non-destructive default;
clean up after merge with `git worktree remove`). The state file + report are the audit trail.
