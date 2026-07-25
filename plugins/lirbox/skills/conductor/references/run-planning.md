# Run planning — triage, DoD acquisition, decomposition (SKILL.md steps 1b / 1c / 1d)

SKILL.md keeps the DECISION for each of these steps (which tier, which flag, the hard rules).
This file holds the HOW: the long-form probes, formats, precedence rules and worked examples.
Read it while working a NEW run's steps 1b → 1c → 1d; a resume skips all three (its profile,
DoD and decomposition are already frozen in `state.json` / `.workflows/<name>.dod.json`).

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

## 3. Decomposition detail (SKILL.md step 1d)

Item titles in the table become the `--phases` entries and the `--prompts-file` keys.

| id | work item | depends on |
|----|-----------|------------|
| w1 | migrate `/users` handler | none |
| w2 | migrate `/orders` handler | none |
| w3 | delete the legacy adapter | w1, w2 |

`depends on` is a comma-list of item ids or the literal `none` — never blank, never prose. An edge
means the item needs another item's **output** to exist first (its decision, API, or code).
Touching the same file is **NOT** an edge: per-item worktrees + the integrate step handle that.

Corollaries of the hard rule (every no-edge item in ONE `--independent` fan-out):

- exactly one no-edge item → a single plain phase, no fan-out;
- every item carrying an edge → strictly linear, now justified by the table rather than by default.

This table is the **coarse** cut — the items you can name before reading the repo. Each resulting
work phase is decomposed AGAIN at runtime by its own planner worker (SKILL.md step 2), so a phase
you could only write as one line here still fans out inside itself once a worker has read the code.
Table entries a driver can already see as independent belong in the `--independent` fan-out anyway:
declaring them costs nothing and skips a planner round-trip.

### 3a. `--independent` fan-out (declared, generation time)

≥2 items declared `depends on: none` → pass `--independent` with exactly those items as `--phases`.
They fan out **concurrently** in one `Work` phase via `parallel()` instead of N sequential phases —
each worker in its OWN worktree/branch off the run branch, merged back by an integrate step — with
the gates verifying the combined diff once. Items carrying a declared dependency edge stay
sequential `--phases`, ordered after the fan-out.

### 3b. Planner fan-out (dynamic, runtime — work inside a phase is not serial)

By default each work phase first runs a **planner** worker (`plan:<Phase>`) that reads the repo and
returns its items plus each item's `dependsOn`; the conductor then dispatches them **by dependency
level** — every ready item in ONE `parallel()` batch, each worker in its own worktree/branch, each
level integrated back into the run branch before the next. Phase ORDER is untouched. The plan is
checkpointed before the first item runs, so a resume reuses that decomposition instead of
re-planning a different one, and a one-item plan is just today's single worker. Pass
`--no-plan-fanout` to turn a phase back into one serial worker.

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
