# conductor — HANDOFF (audit / edit / improve)

For the next maintainer taking over this skill. Read `README.md` first for architecture; this
doc is the **operational handoff**: what's true now, what you must not break, how to change it
safely, the landmines already hit, why things are the way they are, and what's still open.

---

## 1. Current status

Complete and validated. Files:
```
SKILL.md                       runtime instructions (agent-facing)
README.md                      architecture / maintainer guide
HANDOFF.md                     this file
scripts/scaffold-workflow.cjs  GENERATOR — single source of truth for conductor boilerplate
scripts/list-workflows.cjs     list mode
scripts/workflow-report.cjs    duration + tokens + est. cost report
references/workflow-runtime.md  conductor constraints, state schema, resume, mistakes
references/delivery-phases.md   internals of optional PR/ticket/gate phases
```
Validated via `claude plugin validate .` (passes). Dog-fooded on a real task — that run
surfaced and fixed the duration bug.

**Capabilities:** generic durable harness · worktree isolation · JSON state + resume ·
list/report · optional `--ticket/--pr` · enforcement gates (`--enforce-code/-tests/-docs`) ·
full TDD cycle (`--cycle`: RED→GREEN→Verify→PathGap→IMPROVE/SIMPLIFY→ReVerify) · swappable gate
agents (`--agent-*`, `none`=generic).

---

## 2. Invariants — do NOT break these

1. **Conductor purity.** The generated `.workflows/<name>.js` must stay pure JS: no `fs`, no
   git, no `Date.now()`/`Math.random()`. Every side-effect goes through an `agent()` worker.
   If you add logic to the conductor, it must be pure compute + dispatch.
2. **Scripts are `.cjs`.** `~/.claude/package.json` has `"type":"module"`; `.js` there is ESM
   and `require()` throws. Keep helper scripts `.cjs`.
3. **Generator is the only source of truth.** There is intentionally NO static template asset.
   All conductor boilerplate is emitted by `scaffold-workflow.cjs`. Never reintroduce a
   hand-maintained template (it will drift).
4. **`startedAt` is preserved across checkpoints.** The checkpoint merges (reads prev file
   before the heredoc clobber). Duration/report depend on this. Don't revert to a plain
   `cat >` + `if(!startedAt)`.
5. **Notes files are per-worker unique** (`implementation-notes/<slot>.html`). Never collapse
   back to a single hardcoded filename — parallel workers clobber it.
6. **Gates hard-fail by `throw`.** An unmet gate throws → run `failed`, state preserved for
   resume. Don't swallow gate failures.
7. **State lives in the main repo** (`.workflows/state/`), NOT the worktree (survives
   `git worktree remove`).
8. **Non-destructive.** Open PRs, never auto-merge; never auto-remove a worktree.

---

## 3. Safe-edit procedure (the generator is the tricky file)

The generator builds conductor source via **nested template literals**. The escaping rule:
- **Conductor-runtime refs** → escape: `\${WORKTREE}`, `\`backtick\``. These appear literally
  in the generated file and evaluate when the conductor runs.
- **Generation-time values** → do NOT escape: `${SCHEMA(...)}`, `${at(agentCode)}`,
  `${withCycle ? ... : ''}`. These evaluate while generating.

To add/modify a gate or phase:
1. Add any flag to the flag-parsing block near the top.
2. Add/modify a `*Block` template const (mirror an existing one: skip-if-done guard → work →
   `throw` on failure → `checkpoint`).
3. Wire it into `coreOrder`/`phaseOrder` AND `coreBlocks` (cycle vs non-cycle branches).
4. Use `${at(agentX)}` for any `agentType` so it stays swappable + `none`-able.

**Always regenerate** (`--force`) to change boilerplate; never hand-edit a generated conductor
except the `TODO:` work-phase prompts.

---

## 4. Verification (run after ANY change — this is the audit gate)

```bash
SK=plugins/lirbox/skills/conductor/scripts   # from the plugin repo root
# 1. syntax
node --check "$SK"/*.cjs
# 2. no stale undefined refs in the generator
grep -n "IN_WORKTREE" "$SK/scaffold-workflow.cjs"   # must be empty
# 3. generate every mode and RUN under mocked agents (catches ReferenceError that --check misses)
T=$(mktemp -d); cd "$T"
for f in "--phases A,B" "--cycle --phases Impl" "--profile delivery --phases Impl" "--cycle --agent-code x --agent-docs none --enforce-docs --phases Impl"; do
  node "$SK/scaffold-workflow.cjs" --name t --force $f >/dev/null
  node -e "const fs=require('fs');let s=fs.readFileSync('.workflows/t.js','utf8').replace(/^export const/m,'const');const agent=async()=>({red:true,green:true,closed:true,gatePassed:true,written:true,ready:true,summary:''});const parallel=async a=>Promise.all(a.map(f=>f()));const pipeline=async()=>[];const phase=()=>{};const log=()=>{};new Function('args','agent','parallel','pipeline','phase','log','return(async()=>{'+s+'})()')({},agent,parallel,pipeline,phase,log).then(r=>console.log('ok:',r.phasesDone.join(','))).catch(e=>{console.error('FAIL',e.message);process.exit(1)})"
done
# 4. plugin validation
claude plugin validate .
```

> `node --check` only checks **syntax** — it will NOT catch an undefined reference (that's how a
> stray `IN_WORKTREE` slipped through once). Step 3 (run under mocked agents) is mandatory.

---

## 5. Landmines already hit (don't repeat)

| Bug | Symptom | Fix in place |
|---|---|---|
| `.js` under `~/.claude` | `require is not defined in ES module scope` | scripts are `.cjs` |
| `cat >` clobbers `startedAt` | duration wrong (33s vs 219s) | checkpoint merges prev before clobber |
| Single `implementation-notes.html` | parallel workers overwrite | per-worker `implementation-notes/<slot>.html` |
| Hardcoded agent types | can't swap agents | `--agent-*` flags + `at()` helper |
| Stray `${IN_WORKTREE}` after refactor | runtime `ReferenceError`, syntax-check passed | run-under-mock test (§4 step 3) |
| `mktemp` symlink on macOS | report shows 0 tokens in tests | use `--project-dir`; real repo path has no symlink |
| YAML `>-` in description | packager "angle brackets" error | plain quoted scalar |

---

## 6. Decision log (why it is the way it is)

- **Generic harness, not a delivery flow.** Delivery (PR/ticket/gates/cycle) is opt-in via
  flags. Keeps it reusable for migrations/audits/etc.
- **Attended, not headless.** The Workflow tool runs only in a live session — cannot be
  cron/sbx-triggered. autoflow-deliver remains the headless option. (If headless is ever
  required, this skill can't provide it without a separate Node runner driving the agent SDK.)
- **Generator over template.** Eliminates LLM "author boilerplate and hope" drift; LLM only
  writes the `TODO:` prompts.
- **Bundled gate agents by default, but overridable.** Good quality out of the box;
  `--agent-*` / `none` swaps or removes them for portability.
- **Hard-fail gates.** "Enforce" means stop, not warn.
- **Tests triaged, not blind.** TestGate / RED decide `tryve-e2e | unit | none` — a
  non-behavioral change isn't failed for lacking E2E.
- **PathGap exists because code paths > ACs.** AC-derived tests miss branches the spec never
  named; PathGap derives obligations from branch-coverage ∩ diff (decide-or-justify).

---

## 7. Open items / where to improve next

- **PathGap rigor is JS/Jest-centric.** Branch-coverage intersection is strongest for unit
  code; cross-service integration paths still lean on the tryve triage. Improving integration
  path-coverage is the highest-value next step.
- **Token attribution is time-window based** (`workflow-report.cjs`) — a concurrent unrelated
  session in the same window inflates it. A per-run subagent-transcript-id filter would be
  tighter if the Workflow runtime exposes those ids.
- **Pricing is a static table** (`DEFAULT_RATES`) — update on rate changes or wire `RATES_JSON`.
- **Finalize (status + report) is manual** in SKILL.md step 5. Consider a small wrapper so it
  can't be skipped.
- **Linear support is conditional** (only Jira MCP is connected here) — delivery-phases.md
  notes where to substitute a Linear MCP.
- **Clean up run artifacts** after a workflow: a finished run leaves `.worktrees/<name>` (branch
  `wf/<name>`) and `.workflows/<name>.*` in the target repo. Remove with
  `git worktree remove .worktrees/<name>` once the branch is merged or discarded.

---

## 8. How to extend — quick recipes

- **New work phase:** `--phases "A,B,C"` (no code change).
- **New gate:** add flag → add `*Block` const (mirror a gate) → wire into `coreOrder` +
  `coreBlocks` → use `${at(agentX)}` for the agent → run §4.
- **Change the cycle order:** edit `coreOrder` (cycle branch) and `coreBlocks` together — keep
  them in sync or phases/meta will mismatch the emitted code.
- **Change notes behavior:** edit the generated `inWorktree(slot)` function string.
- **Change report/pricing:** `workflow-report.cjs` (`DEFAULT_RATES`, window logic).
