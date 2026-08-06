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

The job: every table module under `src/tables/` still writes timestamps as naive local time.
Migrate each one to timezone-aware UTC. The modules are independent of each other — each owns its
own table and they share no code.

How the run has to behave:

- **Nobody knows how many table modules there are until the run reads the repo.** `src/tables/` is
  generated, it changes between branches, and the count is not something you can write down while
  authoring this graph. The planning step is what discovers the list.

- Each table's migration is independent and they must be worked on **at the same time**, not one
  after another.

- Whatever you set up must not be able to quietly do less than the whole list. If the repo turns
  out to hold more tables than the run was set up to handle, that has to be visible and stop the
  run — a run that migrates some of the tables and reports success is the worst outcome here,
  because the un-migrated ones look done.

- The discovered list has to actually reach the step that fans out over it. A run that ends up
  fanning out over nothing must not be able to report success.

- Once every table is done they come back together into a single step, and a review must happen
  over that combined result — there must be no way for the run to reach the end without it. If the
  review finds a problem, the run goes back and re-does the work, taking the findings with it.

Author the graph only. Do not run it.
