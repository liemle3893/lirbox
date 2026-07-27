# Working notes — Thursday

Spent the afternoon on the release diagram for the payments migration. Using the
`sequence-diagram` skill to document how the checkout service talks to the ledger.

Repo is at /Users/liemlhd/Documents/git/acme-internal/payments-pipeline, branch
`release/2026-q3`.

## What went wrong

The skill emits a Mermaid `sequenceDiagram` plus a numbered step list that drives the detail
panel. Those two are supposed to stay aligned — step 4 in the list should be message 4 in the
diagram.

They don't. When I removed one message from the middle of the exchange (the ledger's retry hop,
which we dropped last sprint), the diagram renumbered itself automatically — Mermaid's `autonumber`
just recounts — but the step list kept its original numbering. So every panel below the deletion
point was off by one: clicking step 5 showed the narrative for message 6. Silent. Nothing warned
me, and the page still rendered fine, so I shipped it to the team wiki before anyone noticed.

Took about forty minutes to work out that the numbers had drifted rather than the content being
wrong. The fix was to renumber the step list by hand, which defeats the point.

## Context that probably shouldn't leave my machine

- Runbook we cross-referenced: https://internal.acme.example.com/runbooks/payments-cutover
- Staging ledger host: 10.42.7.19
- I was authed as dana.k@acmecorp.example.com when I pushed the wiki page
- GitHub token I had exported in that shell: ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3
- Old AWS key still in my profile: AKIA3H7QRSTUV2WXYZ99

## What I wanted instead

Either the step list should be generated from the same source as the diagram so they cannot drift,
or the skill's validator should fail when the step count and the message count disagree. Right now
nothing checks it.
