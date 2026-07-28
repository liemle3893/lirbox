Diagram this deployment pipeline as an interactive flowchart, written to `/app/out.html`.

A push to `main` runs lint and typecheck. If either fails the pipeline stops and the commit is
marked failed. If both pass, the unit and integration suites run. A failure there also stops the
pipeline. On success a container image is built and pushed, then rolled out to 10% of traffic as a
canary. Error rate and latency are watched for ten minutes: if either breaches its budget the
canary is rolled back automatically; otherwise the rollout ramps to 100%.

Every decision point should be a decision node with labelled branches, and both failure paths must
be shown rather than flattened away.
