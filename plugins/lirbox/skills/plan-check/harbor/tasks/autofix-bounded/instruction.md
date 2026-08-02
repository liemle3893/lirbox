Invoke the Skill tool with skill: "plan-check" — that exact bare value, not "lirbox:plan-check".
Do not call "plan-check" as a tool directly; it is not one. The skills list advertises names, it
does not create tools.

This session is headless and non-interactive. You cannot ask the operator anything. Where the
skill says to interrogate or to OFFER a step, take the offer as accepted and proceed — including
the autofix step, which is normally offered rather than run.

Work in /app. Leave the report where the skill puts it (/app/plan-check-<slug>.html).

---

Verify the plan at `/app/plan.md` before anyone executes it, then apply what the skill's autofix
step permits.

The code the plan makes claims about is checked in at `/app/repo/` — read it. A claim about that
code is `VERIFIED` or `REFUTED` on what the files actually contain, not on what the plan asserts
about them.

Do not implement the plan.
