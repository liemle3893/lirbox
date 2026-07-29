# Finalize detail (SKILL.md step 5)

SKILL.md keeps the DECISION (which tier, which flag, the hard rules); this file holds the HOW —
long-form probes, formats, precedence and worked examples. Split out of the old `run-planning.md`
so a run loads only the step it is on.

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
