# loom — a graph runtime for lirbox orchestration skills

**Date:** 2026-07-27
**Status:** design approved, not yet planned
**Supersedes:** nothing. `conductor` is untouched by this work.

---

## 1. Problem

`conductor` executes a **fixed, linear list of phases**. Three consequences:

1. **No loop-backs.** A gate cannot send the run back to an earlier phase. Every gate therefore
   hand-rolls a local retry: `gateLoop()` has an attempt loop, `DoDGate` has a nested
   attempt×round loop with `replan`/`execute`/`fix` workers plus bespoke stall detection
   (`prevUnmetKey`, `dodStalled`), `FrontendGate` has another. The same idea is implemented ~4
   times with different escape-hatch semantics.
2. **Retry is local and narrow.** When `DoDGate` fails it spawns a fix worker whose entire world
   is "make these unmet criteria pass". It cannot re-enter planning, cannot re-decompose, cannot
   fan out. A DoD failure needing real re-implementation gets patched by a narrow worker instead
   of going back through `planner → level dispatch → integrate`.
3. **The shape is invisible.** The runtime DAG (planner-returned items plus their dependency
   edges, dispatched by level) exists only in memory. A human never sees it, before or during a
   run.

The same pressure produced drift across the family. Four generators,
**2,895 lines, zero shared code** — `scaffold-optimize.cjs` forked from conductor,
`scaffold-improve.cjs` forked from that ("forked from scaffold-optimize.cjs" is in the source
comment), `scaffold-arena.cjs` forked again. Every one is loop-shaped — prospector's
keep-or-discard generations, whetstone's per-item RED→GREEN, arena's match matrix — and each
hand-rolls its own cycle because the backbone cannot express one.

Separately, `checkable` DoD criteria are weaker than they look. A criterion carries a `check`
shell string in `dod.json`, and `DoDBaseline` measures it pre-work. But:

- a **baseline-green** check is only *flagged in the report*, never a hard failure — a
  non-discriminating check silently passes the run;
- the `check` is a string, so it is not reviewable in the PR, not re-runnable by the human after
  merge, and subject to JSON/shell quoting mangling;
- **DoDGate's fix loop can edit the very thing its check runs.** Weakening the check is currently
  the cheapest path to a green gate.

## 2. Solution overview

A new skill, **`loom`**, built parallel to `conductor`. `conductor` keeps working untouched
throughout. If loom proves out, the other three migrate onto its runtime later and ~2k lines of
fork collapse; if it does not, one skill is lost rather than four.

Three mechanisms, which turn out to be one:

- **The graph is the execution spec** — nodes and conditional edges replace `PHASES[]`; the
  conductor becomes a small interpreter. Retry is an edge, a stall is a visit cap, a fix-loop is
  a back-edge.
- **The graph is dynamic, and bounded by invariants** — a human shapes it pre-flight through a
  comment→replan→approve loop; workers patch it at runtime. Gates are frozen at approval and
  every patch is validated so no path can reach the terminal without crossing every gate.
- **DoD checks are locked artifacts** — files on disk, hash-locked, baseline-RED enforced, and a
  failure routes back through real planning rather than into a narrow fix worker.

## 3. The graph spec

`.workflows/<name>.graph.json` is the source of truth, replacing the generator's `PHASES[]`:

```json
{ "name": "add-oauth", "goal": "...", "version": 3, "approved": true,
  "start": "Setup", "terminal": "PR",
  "nodes": [
    { "id": "Implement", "kind": "work", "prompt": "...", "schema": {},
      "model": "work", "fanout": true },
    { "id": "DoDGate", "kind": "gate", "prompt": "...", "locked": true }
  ],
  "edges": [
    { "from": "Implement", "to": "Review",    "when": "always" },
    { "from": "Review",    "to": "Implement", "when": {"field":"passed","eq":false},
      "carry": ["findings"] },
    { "from": "Review",    "to": "DoDGate",   "when": {"field":"passed","eq":true} },
    { "from": "DoDGate",   "to": "Implement", "when": {"field":"passed","eq":false},
      "carry": ["unmetCriteria"], "locked": true },
    { "from": "DoDGate",   "to": "PR",        "when": {"field":"passed","eq":true},
      "locked": true }
  ],
  "invariants": {
    "mustCross": ["Review", "DoDGate"],
    "lockedHash": "sha256:...",
    "visitCaps": { "*": 3, "Implement": 4 },
    "nodeBudget": 40 } }
```

Node `kind` is one of `work` | `gate` | `plan` | `terminal`. Edge conditions are **declarative
predicates over the node's result object** — never code strings. They must survive JSON, be
editable in the UI, and never be `eval`'d in the conductor layer. Ordered edge evaluation:
the first matching edge wins; `"always"` is the fallthrough.

Visit caps live **only** in `invariants.visitCaps` — a `"*"` default plus per-node overrides —
so there is one authoritative source the validator can check against. Nodes carry no `visitCap`
field of their own. The editor's per-node cap control writes through to `invariants.visitCaps`.

## 4. The interpreter

The generated conductor collapses to:

```js
let node = graph.start
while (node !== graph.terminal) {
  if (++visits[node] > cap(node)) throw new Error(`visit cap: ${node}`)
  const r = await runNode(node, carryInto(node))
  if (r.graphPatch) applyPatch(graph, r.graphPatch)   // validated — §5
  await checkpoint(`${node}#${visits[node]}`)
  node = pickEdge(graph, node, r)
}
```

`gateLoop()`, the `DoDGate` attempt×round nest, `dodStalled`, `prevUnmetKey` and `FrontendGate`'s
loop are all deleted.

The interpreter obeys the repo's standing rule unchanged: **pure JS only — no `fs`, `git`,
`require`, `Date.now()`, `Math.random()`.** Every side effect lives in an `agent()` worker.
Graph patch validation is pure graph math, so it fits this constraint exactly, and — unlike the
gate loops it replaces — it is unit-testable without spawning a single agent.

## 5. Invariants and patch validation

Frozen at approval.

**Where the invariants are read from is itself load-bearing.** They are taken from the
*previously approved* graph, never from the graph being validated. Reading them from the
submitted graph is a complete bypass: a caller supplies `mustCross: []` together with an
unlocked `Implement → terminal` edge, the locked-subgraph fingerprint still matches (that edge
is not locked), no dominance check runs because the gate list is empty, and validation returns
clean. Every gate is skipped with nothing reported. A submitted graph whose invariants differ
from the approved ones is itself a violation. Only before approval, when no prior graph exists,
may a graph declare its own invariants.

`applyPatch` rejects a patch unless **all** hold:

1. no locked node or edge removed or mutated (re-hash locked subgraph, compare to `lockedHash`)
2. `terminal` still reachable from `start` — a patch may not make the run unfinishable
3. node count ≤ `nodeBudget`, no id collisions, no orphaned nodes
4. **every `mustCross` node still dominates `terminal`**

Rule 4 is the one that matters, and cycles make the naive version wrong, so it is two checks:

- **Structural**, from `start`: delete gate *G* from the graph; if `terminal` is still reachable
  from `start`, *G* does not dominate it → reject. O(V+E) per gate.
- **Positional**, from the current node, over the set of gates whose last verdict is not PASS.
  Required because a back-edge can produce `start → DoDGate → Implement → terminal`:
  structurally dominated, yet the remaining path never re-crosses the gate that just failed.

Worked example. `DoDGate` fails:

| proposed patch | verdict |
|---|---|
| `{removeNode: "DoDGate"}` | **rejected** — structural dominance |
| `{addEdge: ["Implement","PR","always"]}` | **rejected** — bypass edge, dominance |
| `{addNode:"Spike", addEdge:["DoDGate","Spike","fail"], addEdge:["Spike","Implement"]}` | accepted |

The workflow can reshape itself but cannot route around the thing judging it.

**Dominance guarantees a patch is *safe*, never that it is *sensible*.** Visit caps and
`nodeBudget` are the only backstop against a chatty replanner.

## 6. Pre-flight loop

```
loom <goal>
  1  triage + DoD acquisition          inherited from conductor; §8 hardens the checks
  2  seed graph_v1 from the profile    lite/delivery → known node + gate sets
  3  Setup worker                      → worktree .worktrees/<name>, branch wf/<name>
  4  Bootstrap planner worker          reads the repo → patches graph_v1 (adds work nodes,
                                       splits stages, declares dependency edges)
  5  serve + open editor  ◀──────────┐
  6  human: drag / draw / comment     │
  7  Save    → POST /graph            │  validated server-side, version++
     Replan  → replan worker consumes (graph, comments) → graph_v(n+1) ──┘
     Approve → freeze locks + invariants, then run
  8  run, unattended; the same tab shows live state
```

Steps 3–4 precede human review deliberately: a graph planned without reading the repo is a
guess. This is the same reasoning already recorded in conductor's SKILL.md about work-item
tables — the human declares the goal and DoD, and the loop grounds the decomposition in code
before anyone reviews it.

## 7. Server and editor

### 7.1 `scripts/graph-server.mjs` — zero-dep node `http`

Bound to `127.0.0.1` only. Port chosen free and recorded in `state.json`. Started by the skill
as a background Bash process; killed at finalize.

| route | behavior |
|---|---|
| `GET /` | editor HTML |
| `GET /graph` | current `graph.json`; browser polls for version bumps |
| `POST /graph` | validate → write, version++ → `200`, or `422 {violations:[…]}` |
| `GET /state` | `state.json` — cursor, visits, per-node status, trace |
| `POST /action` | `{replan}` or `{approve}` → writes `<name>.action.json` |

The server cannot spawn agents — agents exist only inside the session. Replan is therefore a
handoff: the browser writes the action file, the skill picks it up in a bounded poll loop, runs
the replan worker, writes graph v(n+1); the browser's poll sees the version bump and re-renders.
Approve follows the same path, and the **skill** freezes the locks, not the server.

**One validator module is imported by both the browser and the generated conductor** — same
rules, same failure messages, both sides. The server re-validates every `POST`; the UI's lock
badges are a courtesy, never the enforcement.

### 7.2 Editor

React Flow loaded from CDN — localhost, so network is available; this matches the existing
precedent of `flowchart`'s Mermaid CDN. Vendoring the bundle is the fallback.

- drag nodes, draw/delete edges; node kind by color (`work` / `gate` / `plan` / `terminal`)
- locked nodes carry a lock badge and refuse edit/delete
- click a node → panel: prompt (editable for `work` nodes only), model tier, visit cap, comments
- a rejected Save renders its violations inline on the offending node, e.g.
  *"DoDGate no longer dominates PR"*
- **live mode** during the run: per-node status ring, visit-count badge, current-node highlight,
  polling `/state` every 2s

**During the run the editor is read-only.** Gates are locked and the run is unattended after
approval. Mid-run comments are filed to `feedback/conductor.jsonl` for whetstone to pick up
later; they do not steer the live run, because the moment they do the overnight property that
justifies the skill is gone.

## 8. State and resume under cycles

This is where the model diverges from conductor, and it is the riskiest part of the build.

```json
{ "workflow": "add-oauth", "status": "running", "startedAt": "…",
  "graphVersion": 7,
  "graph": { "…": "the FULL patched graph, not the approved one" },
  "cursor": "Implement",
  "visits": { "Setup":1, "Plan":1, "Implement":3, "Review":2, "DoDGate":1 },
  "trace":  [ {"node":"DoDGate","visit":1,"verdict":"fail","unmet":["c3","c5"]},
              {"node":"Implement","visit":3,"via":"DoDGate:fail"} ],
  "results": { "Implement#3": {} },
  "carry":   { "Implement": { "unmetCriteria": ["c3","c5"] } },
  "port": 7391 }
```

Three consequences:

- **The patched graph is persisted, not the approved one.** Conductor resumes *progress*; loom
  must resume *structure*. Missing this makes a resumed run silently replay the original
  topology — the worst bug available in this design.
- **Result keys are `<node>#<visit>`.** A `phasesDone` set cannot express "Implement ran three
  times."
- **Every skip-if-done guard disappears.** Resume is `node = cursor; visits = visits` and the
  loop continues. Conductor's per-phase `done.has(...)` guards, and their whole bug class, go
  away.

At-least-once is unchanged: a crash between `runNode` and `checkpoint` re-runs that visit, so
nodes must remain idempotent. New wrinkle — a re-run may produce a different verdict and take a
different edge. This is accepted, and is more correct than replaying a stale one.

`status` gains `awaiting-approval` alongside `running` / `complete` / `failed`.

## 9. DoD checks as locked artifacts

```json
{ "id": "c3", "text": "OAuth callback rejects mismatched state",
  "tier": "checkable",
  "checkFile": ".workflows/checks/c3-callback-state.sh",
  "checkSha": "sha256:9f2a…",
  "baseline": "red" }
```

Four changes, in order of importance:

1. **Hash lock.** DoDGate re-hashes `checkFile` before running; a mismatch is a hard failure.
   Today the fix worker can edit the test its own check runs, making a weakened check the
   cheapest route to green. Now that is detected rather than rewarded.
2. **Baseline-green hard-fails.** A criterion already met at baseline cannot discriminate this
   run's work. The escape hatch is `"baseline": "green-ok"`, for genuine regression guards
   ("existing suite still passes"), declared at freeze time inside the same one-shot
   confirmation — a deliberate human act, never a silent default.
3. **Checks are files, committed to the branch.** Reviewable in the PR, re-runnable by the human
   after merge, immune to JSON/shell quoting mangling, and free to span multiple lines.
4. **Failure routes somewhere real.** `DoDGate --fail--> Implement`, carrying `unmetCriteria`,
   re-entering planner → fanout → integrate. The narrow fix worker is deleted.

These four are one mechanism, and it is the same mechanism as §5: *the check is an artifact, the
check is locked, failing it has somewhere to go — and the graph cannot delete the gate to
escape.*

## 10. Verification

`scripts/test-loom.cjs`, entirely agent-free:

- the repo's mandated no-`fs` / `git` / `require` / `Date.now()` / `Math.random()` string scan
  over the generated conductor
- **interpreter units** — edge selection order, visit caps, carry propagation, cursor restore
- **validator units against malicious-patch fixtures** — remove a gate, add a bypass edge,
  orphan the terminal, exceed `nodeBudget`, collide an id, mutate a locked prompt. Every one
  must reject. Conductor's current gate loops have no equivalent.
- **resume units** — simulate a crash at each node visit; assert graph, cursor and visits restore

Run-level success criteria:

1. a real run where `DoDGate` fails once, the back-edge re-enters `Implement` with
   `unmetCriteria` in `carry`, `trace` records the revisit, and the run then reaches PR
2. session killed after a mid-run patch → resume restores the **patched** graph and finishes
3. a patch removing `DoDGate` is rejected and logged in `trace`
4. a check file modified mid-run hard-fails `DoDGate`
5. a baseline-green checkable criterion without `green-ok` hard-fails `DoDBaseline`

## 11. Out of scope

- migrating `prospector` / `whetstone` / `arena` onto the runtime — deferred until loom earns it;
  that deferral is the reason for building a parallel skill rather than rewriting conductor
- mid-run human steering of a live run
- auth, remote access, or multi-user support on the server
- a graph version-diff UI

## 12. Risks

| risk | mitigation |
|---|---|
| React Flow CDN is a network dependency at plan time | vendor the bundle as a fallback asset |
| a valid patch may still be a bad patch — dominance proves safety, not sense | visit caps + `nodeBudget`; `trace` makes every patch auditable |
| a dead session orphans the server process | port recorded in `state.json`; `loom list` surfaces and kills stale ports |
| resume must restore structure, not just progress | dedicated resume unit tests (§10); the patched graph is checkpointed with every node |
| loom diverges from conductor, adding a 5th fork | explicitly time-boxed: loom either absorbs the other three or is deleted |

## 13. Build path

Spec → implementation plan → dogfood the build through `conductor` itself with a real DoD.
Conductor building its own successor is a genuine test of the current one.

Note: the standing rule that lirbox skill changes go through `whetstone` does not apply here.
Whetstone requires one deterministic RED→GREEN check per filed concern against an existing
skill; this is a new runtime, not a filed concern.
