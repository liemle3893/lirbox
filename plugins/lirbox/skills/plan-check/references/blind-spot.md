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
- **No definition of done** — the plan never states verifiable success criteria (what would be
  checked, how, and what result proves it worked). Without a DoD, "done" is unfalsifiable and
  partial failure is invisible. Flag as `BLIND-SPOT-RISK`; the report must still derive and emit
  a DoD (see SKILL.md step 8), but the plan's silence itself blocks a clean GO.

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

### Execution shape — is the declared task graph honest?

An agentic runner dispatches from the plan's dependency declarations *literally*. A
graph that under-declares its edges does not merely run slowly — it runs concurrently
what must not be, and the damage arrives as a merge conflict or as a test that passed
against a half-built base. Build the file → tasks table from the plan's own `Files:`
lists before judging any of this; the table is the evidence.

- **Undeclared dependency edges** — an edge stated in step prose ("run this after Task 1
  has landed") while the task's own dependency block says it consumes nothing. The block
  is what a runner reads; the prose is invisible to it. `UNSTATED-ASSUMPTION`.
- **A file claimed by more than one task** — invert the `Files:` lists. Any file with two
  or more owning tasks is a serialization point the plan never declared, and two tasks
  editing one *function* is a guaranteed conflict, not a risk. Report the table, not a
  verdict — the fix (merge the tasks, or state they are serial) is the author's call.
- **Ordering prose that hides a graph** — an "implementation order" section flattens a DAG
  into a line, making independent work indistinguishable from dependent work. Ask which of
  those edges are real; the ones that aren't are cost the plan pays for nothing.
- **Repo rules that force collisions** — a convention obliging one change to touch N files
  (env var → every consumer, a locale pair, a generated client) makes every task obeying it
  collide with every other. Batched into one task it is zero conflicts; scattered across
  three it is three.
- **Vertical slices are chains** — schema → writer → API → UI is serial by data contract:
  each layer's test needs the layer below to exist. Legitimate, but it must be *declared*,
  not discovered at layer three.
- **Cross-plan contention** — when two plans are meant to run together, check them as one
  program. Shared files and a "supersedes task X" note mean they are one plan with an
  unresolved merge, not two that can proceed in parallel.
