Invoke the Skill tool with skill: "conductor" — that exact bare value, not "lirbox:conductor". Do
not call "conductor" as a tool directly; it is not one. The skills list advertises names, it does
not create tools.

This session is headless and non-interactive. You cannot ask the operator anything — where the
skill says to confirm a choice, pick the sensible default and proceed.

SCAFFOLD ONLY. Generate the conductor script and STOP. Do NOT launch it: do not call the Workflow
tool, do not create a worktree, do not run any phase. The generated file is the deliverable.

Work in /app. Leave the generated script where the generator puts it (/app/.workflows/<name>.js).

---

Set up a durable, resumable multi-phase workflow for the following job, so it can survive a session
restart and be picked up later.

The job: audit a mid-sized Node service for unhandled promise rejections, then fix what the audit
finds, then add regression tests covering each fixed path. It spans several sittings, and losing
progress partway through is expensive.

There is no ticket and no pull request to open — this run stays local.

Generate the workflow script only. Do not run it.
