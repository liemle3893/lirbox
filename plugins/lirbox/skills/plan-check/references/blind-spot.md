# Blind-spot pass — hunting unknown unknowns

The plan tells you what its author thought about. This pass finds what they
didn't. Go beyond the plan's claims; use web + repo + domain knowledge to ask:
**what could this road have that the plan never names?** Anything found here is a
`BLIND-SPOT-RISK` row (unknown-unknown quadrant).

Run the checklist for the plan's class. These are prompts to reason from, not a
form to rubber-stamp — the goal is to generate risks the plan is silent on.

## Any plan

- **Preconditions never stated** — the start-state the plan silently assumes.
- **Ordering hazards** — a step that's only safe after another that isn't sequenced.
- **Partial failure** — if step N dies mid-way, what state is left, and does the
  rollback actually work *from there* (not just from a clean start)?
- **Blast radius / reversibility** — worst realistic outcome; is it undoable?
- **Idempotency** — safe to re-run after an interruption, or does re-running corrupt?
- **Concurrency** — anything else touching the same resource during the window?
- **The rollback is itself an unverified plan** — has it ever been exercised?

## Ops / infra (e.g. Ceph, k8s, DB, network)

- **Version-specific behavior & known bugs** — search release notes / issue
  trackers / CVEs for the *stated* version. Does a command behave differently there?
- **Cluster state the plan never checks** — health, quorum, PG/replica states,
  in-flight recovery/backfill, capacity/`nearfull`, running scrubs.
- **Flags left set** — `noout`/`norebalance`/maintenance/drain flags set for the
  procedure but not cleared after (or the reverse).
- **Client/traffic impact** — behavior while clients are connected; timeouts,
  reconnect storms, cache invalidation.
- **Ordering across nodes** — one-at-a-time vs parallel; quorum loss if too many
  down at once.
- **Time & watchdogs** — steps that exceed a lease/timeout/health-check window.

## Code / repo

- **Missed callers / blast radius** — grep every caller of a changed symbol; the
  plan usually names one site and misses the rest.
- **Type & contract fit** — does the change actually compile against the real
  types, not the plan's mental model?
- **Data & migrations** — schema/format changes: backfill, nullability, rollback of
  data (not just code), forward/backward compatibility during deploy.
- **Concurrency & idempotency** — races, retries, at-least-once delivery.
- **Auth / permissions / trust boundary** — who can now do what.
- **Observability gaps** — if this breaks in prod, would anyone see it?
- **Tests that don't exist** — the plan claims "add tests"; do they cover the
  actual failure mode or just the happy path?
