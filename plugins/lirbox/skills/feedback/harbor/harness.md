/feedback sequence-diagram

Invoke the skill as the slash command above. The Skill tool CANNOT launch it — `feedback` is
`disable-model-invocation: true`, so `Skill(skill: "feedback")` returns "cannot be used with Skill
tool due to disable-model-invocation". Do not call "feedback" as a tool directly either; it is not
one. The skill name is passed as the slash-command argument (it declares
`argument-hint: [ <skill> | <free-text concern> ]`), so do not ask which skill — you have been told
it is `sequence-diagram`.

This session is headless and non-interactive. There is NO human present to approve anything and NO
network access, so `gh` is unavailable. Stop at the skill's mandatory confirmation gate: prepare the
artefact, then stop. Do NOT upload, and do NOT emit a prefilled issue URL — an unapproved filing is
a failure, not a partial success.

Write exactly two files before you finish:

- `/app/title.txt`    — the issue title, one line, no trailing prose.
- `/app/scrubbed.md`  — the scrubbed issue body, exactly as it would be filed.
