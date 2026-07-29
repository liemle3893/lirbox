Set up a durable, resumable multi-phase workflow for the following job, so it can survive a session
restart and be picked up later.

The job: audit a mid-sized Node service for unhandled promise rejections, then fix what the audit
finds, then add regression tests covering each fixed path. It spans several sittings, and losing
progress partway through is expensive.

There is no ticket and no pull request to open — this run stays local.

Generate the workflow script only. Do not run it.
