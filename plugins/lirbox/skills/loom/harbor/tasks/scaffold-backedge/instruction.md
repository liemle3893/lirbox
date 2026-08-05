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

The job: this service authenticates with cookie-backed sessions (`src/auth/session.py`), and every
route module under `src/routes/` reads through it. Migrate it onto signed JWTs. The `/login`
response shape must stay byte-identical for existing clients — changing it logs every current user
out in production.

How the run has to behave when something goes wrong:

- A security review must happen, and there must be no way for the run to finish without it.
- A compatibility check must confirm the `/login` response shape is unchanged. If it finds the shape
  changed, the run must go back and re-implement — not patch the check, and not fail out.
- If the security review finds a problem, the run must go back to **planning** rather than straight
  to implementation. A JWT problem is almost always a design problem, and re-implementing against
  the same wrong design just reproduces it.

Author the graph only. Do not run it.
