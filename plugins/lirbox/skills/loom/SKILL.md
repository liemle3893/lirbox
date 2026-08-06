---
name: loom
argument-hint: "[ <goal to start> | <name to resume> | list ]"
description: "This skill should be used to run a multi-subagent delivery workflow whose SHAPE can change — where a gate failure must send the run back to an earlier stage rather than into a local retry, where the run should be able to add stages once it has read the code, and where a human wants to review and edit that shape in a browser before launch. It drives the Workflow tool with a node/edge graph the conductor interprets, validates every runtime graph patch so no path can reach the terminal without crossing every gate, and persists the patched graph so a resume restores structure, not just progress. Do NOT use for a fixed linear pipeline (use conductor) or a quick one-shot (call Workflow directly)."
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Workflow
  - AskUserQuestion
---

$ARGUMENTS

# loom

<purpose>
`conductor` executes a fixed phase list, so every gate hand-rolls its own retry and a
failure can only be patched locally. loom makes the **graph** the execution spec: a gate
failure is an **edge** back to an earlier node, and the graph can rewrite itself at runtime
under invariants that keep every gate un-bypassable.
</purpose>

<when-to-use>
All of: multi-step with subagents; a gate failure should re-enter real work rather than a
narrow fix worker; the decomposition is not knowable up front. Otherwise use `conductor`
(fixed pipeline) or call `Workflow` directly (one-shot).

**Not for concurrency.** The graph is a single-cursor state machine: `pickEdge` returns one
edge, the walk is sequential, and independent nodes cannot be declared or overlapped. What
loom buys is the reshapeable failure path, not scheduling — see
`references/graph-spec.md` § *What this graph is, and what it is not*.
</when-to-use>

<core-model>
Three layers — confusing them causes every bug in this system:
- **Graph** (`.loom/<name>.graph.json`) — nodes, conditional edges, invariants. DATA.
- **Conductor** (the generated `.js`) — several hundred lines total (`graph-core.mjs`
  **inlined** verbatim, plus the graph itself spliced in as data), but the loom-specific
  interpreter logic — everything besides the inlined math and the embedded graph — is about
  140 lines, and its `while` loop is the ~80 lines that actually walk the graph. **Pure JS: no
  `fs`, `git`, `require`, `import`, `Date.now()`, `Math.random()`, `crypto`.**
- **Workers** — the subagents it spawns. Full tools. Every side effect.

**One shared worktree** `.worktrees/<name>` on `wf/<name>` holds every edit; `state.json`
stays in the main repo.

Spec → [`references/graph-spec.md`](references/graph-spec.md).
The dominance argument → [`references/invariants.md`](references/invariants.md).
</core-model>

<procedure>

### 1. Resolve `$ARGUMENTS`

| `$ARGUMENTS` | do |
|---|---|
| empty or `list` | `node <skill-dir>/scripts/list-runs.cjs` (add `--all` to include `complete` runs), show the table, stop |
| a state file, `running`/`failed` | run `loom-report.cjs <name>` first — if its RESUME section says `NOT AVAILABLE` (the cursor is not in the stored graph, e.g. a bad patch renamed it out from under a live run), it is **not** resumable; fix the cursor or the graph before touching step 5. Otherwise **resume** → step 5 |
| a state file, `awaiting-approval` | restart the server, reopen the editor → step 3 |
| a state file, `complete` | say so; offer `loom-report.cjs <name>` |
| anything else — a goal | fresh run → step 2 |

### 2. Triage, DoD, seed

Same triage tiers as conductor — **bias down, and decline is a hard STOP.** A fixed linear
pipeline is conductor's job, not loom's; loom earns its cost only when the shape can change.

Acquire the DoD (3–7 criteria, ticket ACs verbatim), then write each `checkable` criterion's
**script** into the DoD file and freeze it:

```
node <skill-dir>/scripts/dod-freeze.mjs --dod .loom/<name>.dod.json \
  --checks-dir .loom/<name>.checks
```

Every check becomes an executable file with a frozen `sha256`. A criterion defaults to
`baseline: "red"` — **it must FAIL before the work starts**, or it cannot discriminate this
run and DoDBaseline fails the run. Use `"green-ok"` only for genuine regression guards, and
confirm that waiver in the same one-shot `AskUserQuestion` as the criteria.

Copy the seed: `scripts/seeds/lite.json` or `scripts/seeds/delivery.json` →
`.loom/<name>.graph.json`, setting `name` and `goal`.

### 3. Pre-flight — plan, review, approve

Serve the editor on the seed graph. (The human is reviewing the *shape* — which gates exist
and where failures route — not repo-specific detail. The graph's own planner node refines it
during the run, under the invariants frozen here. There is no separate pre-flight runner: the
only launch path is step 4, which starts at `graph.start`.)

```
node <skill-dir>/scripts/graph-server.mjs --name <name> --root . --port 0
```

Read `LOOM_SERVER_PORT=<port>` from stdout, record it in `.loom/state/<name>.json`, and give
the user `http://127.0.0.1:<port>`. Set `status: "awaiting-approval"`.

Then poll `.loom/<name>.action.json`:
- `replan` → run a replan worker over `(graph, comments)`, write the new graph, keep polling
- `approve` → freeze. Lock every gate node, and of its edges lock **only the passing one**:

  ```js
  for (const n of g.nodes)
    if (g.invariants.mustCross.includes(n.id)) n.locked = true;
  for (const e of g.edges)
    if (g.invariants.mustCross.includes(e.from)      // OUT-edges of a gate, only
        && e.when && e.when.eq === true)             // and only the PASSING one
      e.locked = true;
  ```

  Then stamp `invariants.lockedHash` and set `approved: true`.

  **Verification that the freeze is correct: on a stock seed it must change NOTHING.**
  Both seeds already ship in the frozen shape, so a correct freeze touches 0 nodes and 0
  edges and `lockedFingerprint` is unchanged (`fnv1a:21e7419e` for lite, `fnv1a:51d7641c`
  for delivery). **If the hash moves on a stock seed, the freeze is wrong — do not
  re-stamp it.** A moving hash here is the symptom, and re-stamping is how the symptom
  gets hidden.

  **Never lock a gate's failing edge.** `applyPatchTo` appends and `pickEdge` takes the first
  match, so a locked fail edge permanently shadows anything a later patch splices onto the
  fail path: the patch validates clean and the spliced node is never selected. Reshaping the
  failure path is the whole reason loom exists. `validateGraph` does **not** catch this — it
  exempts only `locked && when.eq === true` from the dominance rule, so an over-locked graph
  passes validation and then fails silently at runtime. To confirm: over-lock `delivery.json`,
  splice `DoDGate -> Spike -> Implement`, and `pickEdge(g, "DoDGate", {passed:false})` still
  returns `Implement`.

### 4. Generate and launch

```
node <skill-dir>/scripts/scaffold-loom.cjs --name <name> \
  --graph .loom/<name>.graph.json --force
Workflow({ scriptPath: ".loom/<name>.js" })
```

**Never hand-edit the generated script** — change the generator and regenerate.

**Headless (`claude -p`): launch in the FOREGROUND (`run_in_background: false`) and do not
end your turn while it runs.** The blocking call IS the wait. Afterwards re-read
`state.json` and confirm `status` is no longer `running`.

### 5. Resume

```
Workflow({ scriptPath: ".loom/<name>.js", args: {
  graph, visits, results, carry, trace, cursor } })
```

taken from `.loom/state/<name>.json` — that exact path, never `.loom/<name>.graph.json`,
which is the *approved* graph and is stale the moment the first patch lands.

**`args.graph` MUST be the persisted patched graph, not the seed.** Resume restores
*structure*, not just progress — replaying the approved topology silently discards every
runtime patch, and nothing will tell you it happened. `loom-report.cjs` prints this same
warning at the top of its RESUME block; the two must not drift.

### 6. Finalize

Stamp `status` + `finishedAt` in `.loom/state/<name>.json` (the conductor cannot — it has no
`fs` and no clock), `failed` if it threw. Kill the editor
server. Run `loom-report.cjs <name>` and hand over the report, the branch and the worktree.
**Never auto-merge and never auto-remove the worktree** — that is the human's call.
</procedure>

<gotchas>
- Nodes are **at-least-once** and must be **idempotent**; a re-run may return a different
  verdict and take a different edge. That is accepted.
- A rejected patch is **logged, not fatal** — check `trace` for `patch: 'rejected'`.
- `invariants.lockedHash` is FNV-1a: a **drift detector**, not a cryptographic guarantee.
  DoD `checkSha` is real sha256.
- Visit caps live only in `invariants.visitCaps`. Never add a `visitCap` field to a node.
- A dead session orphans the editor server; `list-runs.cjs` shows the stale port.
</gotchas>

<resources>
- `scripts/` — `graph-core.mjs` (all graph math; **the one source**) · `scaffold-loom.cjs`
  (step 4) · `graph-server.mjs` + `editor/` (step 3) · `dod-freeze.mjs` (step 2) ·
  `loom-report.cjs` / `list-runs.cjs` (steps 1, 6) · `test-loom.cjs` (regression net).
- `references/` — `graph-spec.md` (field reference) · `invariants.md` (why gates cannot be
  bypassed).
</resources>
