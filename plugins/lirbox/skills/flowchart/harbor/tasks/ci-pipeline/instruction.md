Invoke the Skill tool with skill: "flowchart" — that exact bare value, not "lirbox:flowchart". Do
not call "flowchart" as a tool directly; it is not one. The skills list advertises names, it does
not create tools.

This session is headless and non-interactive — do not end your turn until the HTML file is written
to disk. Write the output to /app/out.html (exactly that path).

---

Diagram this deployment pipeline as an interactive flowchart, written to `/app/out.html`.

A push to `main` runs lint and typecheck. If either fails the pipeline stops and the commit is
marked failed. If both pass, the unit and integration suites run. A failure there also stops the
pipeline. On success a container image is built and pushed, then rolled out to 10% of traffic as a
canary. Error rate and latency are watched for ten minutes: if either breaches its budget the
canary is rolled back automatically; otherwise the rollout ramps to 100%.

Every decision point should be a decision node with labelled branches, and both failure paths must
be shown rather than flattened away.
