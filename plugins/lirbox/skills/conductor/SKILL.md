---
name: conductor
description: Single entrypoint for "do this", "take this task", "handle this", "what should I do with X", "run this to done" — routes a task through intake.mjs (reject/scope/inline/lane), then drives non-trivial work in ONE session loop against a definition of done frozen before the code is touched, held by a deterministic DoD gate (3 rounds, then escalate), an independent verifier for judged criteria, and enforced docs/changes. Use whenever a task is handed over without the caller having already decided how big it is.
---

<purpose>
One door, one loop, one gate. Intake decides whether work happens and how big it is; non-trivial
work runs in this session against a definition of done (DoD) frozen before any code changes, held
by a script, with one context-isolated verifier for what a command cannot decide.
</purpose>

<flow>
1. **Run intake first. Ask the user nothing before this.**
   ```
   echo "<task text>" | node ${CLAUDE_PLUGIN_ROOT}/scripts/intake.mjs --task - --run <slug>
   ```
   Pick `<slug>` yourself (short, kebab-case). Intake always exits 0.
2. **Announce the route in ONE line**: route, reason, and for `scope` the missing done-criterion.
   **Read `decided_by` and say which it is.** `jev` means the route was measured; `fallback` means
   nothing was. Both print `inline`, so a dead API key and a confident go-ahead are the same word on
   the same line unless you say so.
3. **Act**, per the table below.
</flow>

<routes>
| route | action |
|---|---|
| `reject` | Say no. State intake's reason verbatim. **STOP.** Do not implement, do not offer a smaller version. |
| `scope` | Hand off to `lirbox-planner` for exactly ONE slice; its criteria seed the gated run. |
| `inline` | Triage, then do it now, this session. No "should I proceed?", no approval round-trip. |
| `lane` | Print the exact `orch-lane.sh start` command and **ask before running it.** |

### reject
Not a negotiation. The failure mode this route exists to catch is turning a rejected task into a
smaller one that slips through. If the user pushes back, that is a new conversation, not a retry of
this one with the scope shaved down.

### scope
`done_stateable` came back false. The fix is not five questions to the user — it is `lirbox-planner`,
which returns **one slice** with criteria as `command :: expected` plus the questions only a human
can answer. Those criteria become the slice's DoD for the gated run.

### inline
Triage, biased **down**: one obvious edit with nothing worth gating → implement it, verify it
against what the task states as done, report the result. Anything more → the gated run. Invoking
this skill by name selects it; it does not skip triage.

### lane
```
${CLAUDE_PLUGIN_ROOT}/scripts/orch-lane.sh start <name> --profile <p> --run <slug>
```
Print that command with `<name>`/`<p>` filled in, then ask. `route-guard.sh` refuses the start
anyway unless `route.json` says `lane` — asking is this route's own rule, not a backstop.
</routes>

<gated-run>
`GATE` = `node "${CLAUDE_PLUGIN_ROOT}/skills/conductor/scripts/dod-gate.mjs"`; `<slug>` is intake's.

1. **Branch.** On the default branch, `git switch -c conductor/<slug>`. Never push, never merge.
2. **Freeze the DoD before touching code.** No cap on criteria; never drop a ticket or planner
   criterion. Each is `checkable` (`check`: a command, exit 0 = met; fold any expected value in) or
   `judged` (`text` a verifier can rule on from the diff alone). Write
   `{"criteria":[{"id","tier","text","check"?}]}`, run `GATE freeze --run <slug> --dod <file> --by main`,
   show the criteria and proceed. Replace any `WARN … non-discriminating` check unless it guards a
   regression. A frozen DoD is never edited — if it is wrong, say so and stop.
3. **Work in this session.** Write the plan to `implementation-notes/<slug>.md` first and revise it
   as results arrive — decisions, deviations, what failed. No phase workers: handing your own
   context to a subagent is the cost this design removed.
4. **Docs.** `docs/changes/<slug>/summary.md` (frontmatter title/date/branch; what changed, why,
   tradeoffs, open questions) and `docs/changes/<slug>/implementation-notes.md` (the notes, promoted).
5. **Commit, then verify.** Commit on the branch. If any criterion is `judged`, spawn ONE
   `lirbox-verifier` with the SHA, the base ref, and the judged criteria — not your notes, not this
   conversation. It records each ruling itself:
   `GATE verdict --run <slug> --id <id> --met yes|no --evidence "<what it ran or read>" --by lirbox-verifier`.
6. **Gate.** `GATE gate --run <slug>`.

| exit | meaning | do |
|---|---|---|
| 0 | passed | commit `docs/changes/<slug>/dod.json` (the scorecard); report it, the branch and the SHA |
| 1 | unmet, rounds left | fix only the unmet rows, then step 5 again — each round consumes its verdicts |
| 3 | escalated: 3 rounds spent | **STOP.** Report the unmet rows verbatim; do not start round 4 |
| 2 | refused (tampered DoD, bad args) | stop and report the message |

**Resume** later: `GATE status --run <slug>`, re-read `implementation-notes/<slug>.md`, go to step 3.
</gated-run>

<hard-rules>
- **Never interrogate.** An unstateable "done" is the `scope` route — hand off to the planner.
- **`inline` executes immediately.** No confirmation step; the route already is the approval.
- **`lane` always asks**, even though the command was already printed — printing isn't starting.
- **A `reject` is not a negotiation.** No softened re-scope, no smaller version offered.
- **An unmeasured route says so.** `decided_by: fallback` is not a verdict.
- **Only gate exit 0 is done.** Not "tests pass", not the verifier's prose. Exit 3 is reported as
  escalated, never as nearly done.
- **You never write a verdict.** The verifier records its own; it never sees your build history.
</hard-rules>

<multi-slice>
More than one slice: `lirbox-planner` plans slice 1 only — one slug, one gated run per slice. When
its gate passes: `board.mjs --run <run> --set <id> --status delivered --by main --verified-by <lirbox-verifier|dod-gate>`.
Re-invoke the planner with the **actual** result (gate rounds, unmet rows), never the predicted plan.
Never ask it for the whole breakdown — it refuses that on purpose.
</multi-slice>
