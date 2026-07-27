# Why gates cannot be bypassed

This is the argument behind `validateGraph()` and `dominates()` in `scripts/graph-core.mjs`. It
is written from the code, not from the design intent — where the two disagree, the code wins,
and any such divergence is called out inline.

## Dominance, and why deletion-reachability computes it

A node `G` **dominates** a node `T` (from a starting point `S`) when every path from `S` to `T`
passes through `G`. That is the property loom needs a `mustCross` gate to have over the
`terminal`: if `DoDGate` dominates `Done`, no run can reach `Done` without visiting `DoDGate` at
least once — a fixed graph-theoretic guarantee, not a hope about how workers behave.

`dominates(graph, gate, target, from)` computes this by **deletion, not by enumerating paths**:

```js
function dominates(graph, gate, target, from) {
  if (gate === target) return true;
  return !reachable(graph, from, [gate]).has(target);
}
```

Delete `gate` from the graph (`reachable(..., [gate])` treats every id in the skip set as
removed) and ask whether `target` is still reachable from `from`. If it is, some path avoided
`gate` — `gate` does not dominate. If it is not, then *every* path from `from` to `target` must
have gone through `gate`, because removing the one node that was supposedly load-bearing broke
every route. This is a proof by contradiction, not a heuristic, and it is `O(V+E)` per gate
because `reachable` is a single iterative traversal (visited-set based, so a cycle terminates
instead of recursing forever).

The code deliberately does **not** special-case this to "immediate predecessors of `target`": a
gate two hops from the terminal (`Review -> DoDGate -> PR`) dominates just as strongly as one
hop away, and restricting the check to direct predecessors would report a false violation on
every multi-hop gate.

## Structural dominance alone is not enough

`validateGraph` first checks each `mustCross` gate structurally, from `start`:

```js
for (const gate of inv.mustCross || []) {
  if (!dominates(next, gate, next.terminal, next.start)) {
    v.push(gate + ' no longer dominates ' + next.terminal);
  }
}
```

This proves every run **visits** the gate. It does not prove the gate was **satisfied** — a run
can visit a gate, fail it, and still reach the terminal, and structural dominance from `start`
stays completely silent about that, because dominance is a property of the graph's shape, not of
which edge out of the gate actually gets walked.

**Worked counter-example**, in the shape the brief names — `start → DoDGate → Implement →
terminal`:

```
start ----always---> DoDGate
DoDGate --pass(eq:true)--> terminal
DoDGate --fail(eq:false)--> Implement
Implement ----always---> terminal
```

Delete `DoDGate` from this graph: `Implement` is now unreachable (its only inbound edge came from
`DoDGate`), so `terminal` is unreachable too. By the deletion test, `DoDGate` **does** dominate
`terminal` — every path from `start` crosses it. And yet a run that fails `DoDGate` walks
`DoDGate --fail--> Implement --always--> terminal` and arrives at the terminal having never
passed the gate. The structural check reports nothing wrong, because nothing *is* wrong about
whether the gate is visited — the defect is entirely about what happens *after* a non-passing
visit. This is the literal historical bug the code's own comments describe: an earlier draft of
the `lite` seed had `DoDGate`'s pass and fail edges both routing to `Done`, and the verdict became
fully inert — `pickEdge` returned `Done` for **both** `{passed: true}` and `{passed: false}`,
while structural dominance from `start` reported the graph as fine.

## The fix: dominance from every non-passing edge, not just from `start`

`validateGraph`'s second `mustCross` loop re-runs the *same* `dominates()` function, but not from
`start` — from the target of every edge leaving the gate that is not its locked, `eq: true`
passing edge:

```js
for (const gate of inv.mustCross || []) {
  for (const e of next.edges) {
    if (e.from !== gate) continue;
    if (e.locked && e.when && e.when.eq === true) continue;   // the one exemption
    if (!dominates(next, gate, next.terminal, e.to)) {
      v.push(gate + ' non-passing edge -> ' + e.to + ' can reach ' + next.terminal
        + ' without re-crossing ' + gate);
    }
  }
}
```

Applied to the counter-example above: is `terminal` reachable from `Implement` (the fail edge's
target) with `DoDGate` deleted? Yes — `Implement --always--> terminal` needs no help from
`DoDGate` at all. So `dominates(graph, DoDGate, terminal, Implement)` is `false`, and this loop
rejects the graph with exactly the message shown above. Structural dominance asks "is the gate on
every path from the start?" Positional dominance-per-edge asks "having left the gate on a
non-passing branch, can this path still get to the terminal without coming back?" A gate needs
both to be unbypassable — that is why `back-edges` matter to this argument at all: it is
specifically the gate's failure edge routing to an earlier, still-productive node (`Implement`)
that reopens a path toward the terminal, and only a second dominance check anchored at that edge's
target closes it.

The exemption is narrow and deliberate: **only** an edge that is both `locked` and carries
`when.eq === true` is skipped. Checking `eq === true` alone is not enough — a minted edge could
declare `{ field: 'anythingAtAll', eq: true }` or even reuse the real field name and still pass
that test. Requiring `locked` too ties the exemption to the edge frozen at approval, because a
newly minted edge cannot carry `locked: true` without changing `lockedFingerprint()` and tripping
the separate lock check. All five bypass shapes below are rejected by this loop for exactly that
reason.

Locking a gate's *failure* edge instead (to "protect" it the same way) is the wrong fix, not a
stronger one: `applyPatchTo` appends new edges and `pickEdge` takes the **first** matching edge in
declaration order, so a planner splicing a node into a locked failure path would add a *parallel*
edge that validates cleanly and is simply never selected — a silent no-op, which is worse than an
outright rejection. This is why the seeds lock only the passing edge of each gate and leave the
failure edge open for legitimate reshaping (splice a node in, reroute to an earlier stage,
self-loop bounded by `visitCaps`) — all of which validate cleanly, because none of them changes
whether the gate still dominates the terminal from that edge's target.

## The cursor check: fail-closed at runtime

A third check runs only when a `cursor` is supplied (mid-run, evaluating a patch a worker just
proposed):

```js
if (cursor && cursor.node) {
  if (!idSet.has(cursor.node)) {
    v.push('cursor node ' + cursor.node + ' was removed by this patch — ...');
  } else {
    for (const gate of cursor.unsatisfiedGates || []) {
      if (!dominates(next, gate, next.terminal, cursor.node)) {
        v.push(gate + ' is unsatisfied but no longer dominates ' + next.terminal + ' from ' + cursor.node);
      }
    }
  }
}
```

This exists for a case the two structural checks above cannot see at all: a patch that renames or
deletes the specific node the run is *currently standing on*. Renaming a mid-graph node (delete
`C`, add `C2` with identical shape and edges) leaves every path from `start` intact and leaves
every gate's non-passing-edge target intact — both earlier checks stay silent — because neither
one has any notion of "where the run actually is right now." Without an anchor, positional
dominance has nothing to evaluate against, so the code **fails closed**: if `cursor.node` is
missing from the patched graph, that is treated as the patch erasing the run's identity, not as
"nothing to check."

## Accept / reject table

Pulled directly from `scripts/test-loom.cjs`'s fixtures against `graph-core.mjs`. `LOCKED` there
is the same shape as `delivery.json`'s `Review`/`DoDGate` pair, freshly fingerprinted.

| Patch | Rule | Verdict |
|---|---|---|
| Remove the failing gate node (`removeNodes: ['DoDGate']`) | `mustCross` gate missing from the graph | REJECT — `mustCross node missing: DoDGate` |
| Add `Implement -> PR` on `"always"` | Structural dominance (loop 1) | REJECT — `DoDGate no longer dominates PR` |
| Edit a locked node's `prompt` | `lockedFingerprint` mismatch | REJECT — `locked nodes/edges were modified or removed` |
| Delete a locked edge (`DoDGate -> PR`) | `lockedFingerprint` mismatch | REJECT — `locked ...` (also breaks reachability to the terminal) |
| Reroute the fail edge itself onward (`DoDGate -> Implement` fail removed, `DoDGate -> PR` added with `eq: false`) | Non-passing-edge dominance (loop 2) | REJECT — `DoDGate non-passing edge -> PR can reach PR without re-crossing DoDGate` |
| Append an unconditional `DoDGate -> PR` edge (`when: "always"`) | Same as above — an off-shape result now falls through to this edge too, defeating the "no silent fallback" rule as a side effect | REJECT — `non-passing edge` |
| Append `DoDGate -> PR` on an unrelated field (`{ field: 'anythingAtAll', eq: true }`) | Not `locked`, so not exempt | REJECT — `non-passing edge` |
| Append `DoDGate -> PR` reusing the real field (`{ field: 'passed', eq: true }`) but unlocked | `eq === true` alone is not the exemption; `locked` is required too | REJECT — `non-passing edge` |
| Splice a `Spike` node into the fail path (`DoDGate -> Spike -> Implement`) | Legitimate reshaping; `Spike` still returns to `DoDGate`'s territory via `Implement` | ACCEPT |
| Self-loop the fail edge (`DoDGate -> DoDGate` on `eq: false`) | The edge's target *is* the gate, so `dominates(next, 'DoDGate', 'PR', 'DoDGate')` skips `DoDGate` as both the gate and the starting point — `reachable()` treats the start as already-removed and returns the empty set, so `PR` is trivially unreachable and dominance holds | ACCEPT |
| Add a node with no outgoing edge, reachable via a real predicate | Dead-end check | REJECT — `dead-end node(s) with no outgoing edge` |
| Add a node with no inbound edge at all | Reachability / orphan check | REJECT — `orphaned node(s)` |
| Add enough nodes to exceed `nodeBudget` (checked against `prev`'s budget, `10`) | Node budget | REJECT — `node budget exceeded` |
| Add a node reusing an existing `id` | Duplicate id | REJECT — `duplicate node id` |
| Add an edge to a nonexistent node | Unknown endpoint | REJECT — `edge to unknown node` |
| Splice a node into the fail path *and* wire it in correctly (worked example from the spec) | Validates cleanly | ACCEPT — `[]` |
| Empty `next.invariants.mustCross` while adding an unlocked bypass edge | Invariants are read from `prev`, never `next` — see below | REJECT — both `... no longer dominates ...` (from `prev`'s `mustCross`) **and** `invariants were modified — they are frozen at approval` |
| Raise `next.invariants.nodeBudget` to `9999` while padding nodes past `prev`'s real budget (`10`) | Same principle: `prev` governs | REJECT — `node budget exceeded` (using `10`, not the submitted `9999`) |
| Validate a fresh graph against itself with no `prev` (`validateGraph(g, null, null)`) | Pre-approval seeding — nothing is frozen yet, so a graph may declare its own `invariants` | ACCEPT — `[]` |
| Cursor at `Implement` with `unsatisfiedGates: ['DoDGate']`, patch adds `Implement -> PR` always | Positional dominance from the cursor (and, in this shape, also caught structurally) | REJECT |
| Cursor sits past a gate on an unlocked fail branch (`Gate -> B -> C -> PR`, all unlocked past the gate); patch renames the cursor's node `C` to `C2` with identical shape/edges | Fail-closed: neither structural check can see a same-shaped rename, so the cursor's own identity is the only anchor | REJECT — `cursor node C was removed by this patch — a run may not delete or rename the node it is currently executing` |
| Cursor at `DoDGate` with `unsatisfiedGates: []` (the gate already passed) | An already-satisfied gate is not required to dominate from the cursor's current position | ACCEPT — `[]` |

## Why invariants are read from `prev`, never from `next`

Every check above depends on `mustCross`, `lockedHash`, and `nodeBudget` meaning what they meant
at approval — and `validateGraph` enforces that literally:

```js
const inv = (prev && prev.invariants) ? prev.invariants : (next.invariants || {});
```

If invariants were read from the graph being validated, a submitted patch could declare
`mustCross: []` in the same breath as adding an unlocked bypass edge. The locked fingerprint would
still match (the bypass edge isn't locked), zero dominance checks would run (there is nothing left
in `mustCross` to check), and `validateGraph` would return `[]` — the full bypass, achieved by
simply un-declaring the invariant rather than defeating it. Reading `inv` from `prev` closes this:
the *previously approved* `mustCross` list still governs, so the missing gate is still checked and
still fails to dominate. The code additionally flags the substitution itself
(`invariants were modified — they are frozen at approval`) so a UI that lets this drift gets a
readable error rather than a silently ignored edit.
