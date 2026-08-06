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

The job: this service exports reports in three formats. `src/exporters/csv_export.py`,
`src/exporters/pdf_export.py` and `src/exporters/xlsx_export.py` share no code with each other —
each one reads `src/report.py` and writes its own format, and each has its own quirks.

Add a redaction mode. Every exporter must be able to omit the PII columns (`email`, `phone`,
`ssn`) from its output, driven by a `redact=True` argument threaded down from `src/report.py`.

How the run has to behave:

- The three exporters are genuinely independent of one another. Work on them **at the same time**,
  not one after another — the run should not be three times as long as it needs to be. Whatever
  the run does to one exporter must not be able to disturb the other two while it happens.

- There is one piece of work that is NOT independent: the golden-file fixtures in
  `tests/golden/` cover the csv and xlsx outputs only (the pdf layout is not snapshotted).
  Regenerating them needs BOTH of those exporters finished, and nothing about the pdf one — so
  it must not be left waiting on pdf work that has nothing to do with it.

- Once everything is done it must come back together into a single step that reconciles the
  three exporters, before anything is judged. They must not be signed off one at a time.

- A privacy review must happen over the finished, reconciled result — there must be no way for the
  run to reach the end without it. It has to see all three exporters together: a redaction bug is
  usually an inconsistency *between* formats, and something that only ever looked at one exporter
  would miss it entirely.

- If that review finds a problem, the run must go back and re-do the work rather than patching the
  review or failing out, and it must take the reviewer's findings with it.

Author the graph only. Do not run it.
