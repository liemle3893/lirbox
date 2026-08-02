Invoke the Skill tool with skill: "conductor" — that exact bare value, not "lirbox:conductor". Do
not call "conductor" as a tool directly; it is not one. The skills list advertises names, it does
not create tools.

This session is headless and non-interactive. You cannot ask the operator anything — where the
skill says to confirm a choice, pick the sensible default and proceed.

SCAFFOLD ONLY. Generate the conductor script and STOP. Do NOT launch it: do not call the Workflow
tool, do not create a worktree, do not run any phase. The generated file is the deliverable.

Work in /app. Leave the generated script where the generator puts it (/app/.workflows/<name>.js).

---

Set up a durable, resumable workflow for the following job, so it can survive a session restart and
be picked up later.

The job: migrate this service's authentication middleware off the deprecated session-cookie path and
onto signed bearer tokens. It touches every route module, the login and refresh endpoints, and the
session store. Existing clients must keep working throughout — a regression here logs every user out
in production.

This one ships: the work goes out as a pull request, it needs a proper code review before merge, the
test suite must prove the old and new paths both still authenticate, and the change has to be
documented for the team picking it up.

It will span several sittings, and losing progress partway through is expensive.

Generate the workflow script only. Do not run it.
