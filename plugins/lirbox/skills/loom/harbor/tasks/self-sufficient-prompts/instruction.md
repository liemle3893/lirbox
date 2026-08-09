Invoke the Skill tool with skill: "loom" — that exact bare value, not "lirbox:loom". Do not call
"loom" as a tool directly; it is not one. The skills list advertises names, it does not create
tools.

This session is headless and non-interactive. You cannot ask the operator anything, and there is no
browser — where the skill says to confirm a choice or wait for approval in the graph editor, pick
the sensible default and proceed. Do not start the graph server and do not wait on it.

AUTHOR THE GRAPH ONLY. Write the run's graph and STOP. Do NOT launch it: do not call the Workflow
tool, do not generate or run the conductor script, do not create a worktree, do not execute any
node. The graph file is the deliverable.

Work in /app. Leave the graph at /app/.loom/<name>.graph.json.

---

Set up a delivery run for the following job.

The job: this service takes money. `POST /orders` and `POST /payments` are both non-idempotent —
a client that retries after a timeout double-charges the customer. Add idempotency keys so a
retried request returns the original result instead of performing the work twice.

Read the code before you decide anything. The relevant modules are under `/app/src/`.

The decomposition is knowable NOW, from the repository, so make it explicit: author the
implementation work nodes yourself rather than leaving a single "implement it" node for the run to
figure out later. Three or more distinct work nodes sit between planning and the first gate.

Author the graph only. Do not run it.
