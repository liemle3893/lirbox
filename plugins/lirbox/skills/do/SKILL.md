---
name: do
description: Single entrypoint for "do this", "take this task", "handle this", "what should I do with X" — routes a task through intake.mjs (reject/scope/inline/lane) and acts on the answer in the same turn. Use whenever a task is handed over without the caller having already decided how big it is.
---

<purpose>
One door. Every task goes through `intake.mjs` before anything happens to it — never through a
human guess at size. This skill is the handle: run intake, say the route out loud, then act on it.
It replaces nothing intake/route-guard/board/orch-lane already do; it is the thing that calls them.
</purpose>

<flow>
1. **Run intake first. Ask the user nothing before this.**
   ```
   echo "<task text>" | node ${CLAUDE_PLUGIN_ROOT}/scripts/intake.mjs --task - --run <slug>
   ```
   Pick `<slug>` yourself (short, kebab-case, from the task). Intake always exits 0 and writes
   `.orchestration/<slug>/route.json` even when it cannot reach a model — there is no "intake
   failed" case that skips routing.
2. **Announce the route in ONE line**: the route, the reason `route.json` gives, and — for
   `scope` — the missing done-criterion. Nothing more before acting.
3. **Act**, per the table below.
</flow>

<routes>
| route | action |
|---|---|
| `reject` | Say no. State intake's reason verbatim. **STOP.** Do not implement, do not offer a smaller version. |
| `scope` | Hand off to `lirbox-planner` for exactly ONE slice. A handoff, not an interrogation — you do not ask the user clarifying questions yourself. |
| `inline` | Do it now, this session. No plan step, no "should I proceed?", no approval round-trip. |
| `lane` | Print the exact `orch-lane.sh start` command and **ask before running it.** |

### reject
Not a negotiation. The failure mode this route exists to catch is turning a rejected task into a
smaller one that slips through — that defeats the only route here whose answer can be "no". If the
user pushes back, that is a new conversation, not a retry of this one with the scope shaved down.

### scope
`done_stateable` came back false: nobody can say what finishing looks like as a command plus an
expected value. The fix is not five questions to the user — it is `lirbox-planner`, which reads the
code and comes back with **one slice** (what it delivers, criteria as `command :: expected`, what it
touches) plus the open questions it could not resolve from the repo. Hand it the task text and the
route reason; let it ask what only a human can answer.

### inline
Already routed as small and contained — one sitting, no coordination. Asking "should I go ahead?"
here is exactly the latency intake exists to remove: the routing decision already *is* the
permission. Implement it, verify it against whatever the task states as done, report the result.

### lane
The only route whose cost is irreversible-ish: a branch, a worktree, an agent running for hours.
```
${CLAUDE_PLUGIN_ROOT}/scripts/orch-lane.sh start <name> --profile <p> --run <slug>
```
Print that command with `<name>`/`<p>` filled in, then ask. `route-guard.sh` will refuse the start
anyway if `route.json` doesn't say `lane` — but asking first is this route's own rule, not a
backstop for the hook.
</routes>

<hard-rules>
- **Never interrogate.** If "done" can't be stated as a command plus an expected value, that's the
  `scope` route — hand off to the planner. Don't paper over it by asking the user questions in this
  skill instead.
- **`inline` executes immediately.** No confirmation step; the route already is the approval.
- **`lane` always asks**, even though the command was already printed — printing isn't starting.
- **A `reject` is not a negotiation.** No softened re-scope, no smaller version offered.
</hard-rules>

<multi-slice>
For work that needs more than one slice: `lirbox-planner` plans slice 1 only. `board.mjs` records
it (`--set <id> --status ... --by <who>`); a self-report never sets `verified_by` — that column
only fills from someone other than the implementor. Once the slice lands, re-invoke the planner
with the **actual** result (exit codes, what the verifier saw), not the plan you predicted. Never
ask the planner for the whole breakdown up front — it refuses that on purpose, and this skill
doesn't work around the refusal.
</multi-slice>
