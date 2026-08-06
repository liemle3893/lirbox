/*
 * loom graph math — the SINGLE source of truth, with THREE consumers:
 *   1. the generated conductor  (INLINED as source: that layer forbids require/import)
 *   2. graph-server.mjs         (import)
 *   3. the browser editor       (import)
 *
 * Therefore this file must stay pure: no imports, no Node built-ins, no Date.now(),
 * no Math.random(), no crypto. Only function declarations, then a single trailing
 * `export { ... }` line — the generator strips exactly that last line when inlining,
 * and test-loom.cjs asserts the inlined copy matches byte-for-byte.
 */

function outEdges(graph, from) {
  const out = [];
  for (const e of graph.edges) if (e.from === from) out.push(e);
  return out;
}

// Node ids reachable from `from`, treating every id in `skip` as deleted.
// Iterative + visited-set, so cycles terminate rather than recurse forever.
function reachable(graph, from, skip) {
  const skipSet = new Set(skip || []);
  const seen = new Set();
  if (skipSet.has(from)) return seen;
  const stack = [from];
  while (stack.length) {
    const cur = stack.pop();
    if (seen.has(cur) || skipSet.has(cur)) continue;
    seen.add(cur);
    for (const e of outEdges(graph, cur)) if (!skipSet.has(e.to)) stack.push(e.to);
  }
  return seen;
}

// True when EVERY path from `from` to `target` crosses `gate`.
// Proof by deletion: remove the gate; if the target is still reachable, some path
// avoided it. O(V+E) per gate.
//
// This is the WHOLE definition. Do not add heuristics on top of it — in particular,
// do not restrict it to immediate predecessors of `target`: a gate two hops from the
// terminal (Review -> DoDGate -> PR) dominates just as strongly as one hop, and such
// a restriction makes every multi-hop gate report a false violation.
// Dominance is a property of the GRAPH, never of execution history. "This gate was
// already passed" is expressed by leaving it out of `unsatisfiedGates` at the call
// site (see validateGraph in Task 3) — never by weakening this function.
function dominates(graph, gate, target, from) {
  if (gate === target) return true;
  return !reachable(graph, from, [gate]).has(target);
}

// Declarative edge predicates. NEVER code strings — these travel through JSON,
// are edited in the browser, and are evaluated inside the restricted conductor
// layer, so `eval`/`new Function` are out of the question.
// Unknown shapes fail CLOSED: an unrecognised operator must not silently open a path.
function matches(pred, result) {
  if (pred === 'always' || pred === undefined || pred === null) return true;
  if (typeof pred !== 'object') return false;
  const v = result ? result[pred.field] : undefined;
  if ('eq' in pred) return v === pred.eq;
  if ('neq' in pred) return v !== pred.neq;
  if ('gt' in pred) return typeof v === 'number' && v > pred.gt;
  if ('lt' in pred) return typeof v === 'number' && v < pred.lt;
  if ('exists' in pred) return (v !== undefined && v !== null) === pred.exists;
  return false;
}

// First matching out-edge wins; declaration order IS the priority order.
// NOT for a `fork` node — a fork takes EVERY out-edge, so asking which one wins is the
// wrong question. The interpreter branches on `kind` before it ever gets here.
function pickEdge(graph, from, result) {
  for (const e of outEdges(graph, from)) if (matches(e.when, result)) return e;
  return null;
}

// ---- fork / join --------------------------------------------------------------------
//
// A `fork` node's out-edges are ALL taken, CONCURRENTLY. That is the one place in this
// model where two workers run at the same time, and it is the only construct that can
// express "these are independent" instead of "pick one".
//
// Everything about a fork is built so that concurrency costs nothing in provability:
//
//   * A fork's out-edges must be UNCONDITIONAL. Every branch always runs, so "which
//     branch" is never a runtime question — and that is exactly what keeps the reasoning
//     below sound rather than probabilistic.
//   * The region has ONE exit: the `join`. `dominates(join, terminal, fork)` says every
//     path leaving the fork crosses it, so a branch can never escape into the rest of the
//     graph and start running it concurrently.
//   * Branches are NODE-DISJOINT. This is what makes visit accounting per-branch and
//     EXACT: each branch counts in its own map and the merge cannot collide, so no
//     max/sum approximation is needed and no two workers ever race the same node.
//
// The nodes strictly inside one branch: everything reachable from the branch entry once
// the join is deleted. The join is the boundary, so it is never a member.
function branchRegion(graph, entry, join) {
  return reachable(graph, entry, [join]);
}

// Visit caps live ONLY in invariants.visitCaps so the validator has one source
// to check. Per-node override, else the "*" default, else 3.
function capFor(graph, id) {
  const caps = (graph.invariants && graph.invariants.visitCaps) || {};
  if (Object.prototype.hasOwnProperty.call(caps, id)) return caps[id];
  if (Object.prototype.hasOwnProperty.call(caps, '*')) return caps['*'];
  return 3;
}

// Lift exactly the fields an edge declares — a back-edge feeds the failing gate's
// findings forward so the retry CONVERGES instead of restarting blind.
function carryFor(edge, result) {
  const out = {};
  for (const k of (edge && edge.carry) || []) {
    if (result && result[k] !== undefined) out[k] = result[k];
  }
  return out;
}

// Key-sorted JSON so a fingerprint depends on CONTENT, not on property order.
function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  return '{' + Object.keys(v).sort()
    .map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}

// FNV-1a, 32-bit. Pure JS because the conductor layer has no `crypto`.
// This is a DRIFT DETECTOR, not a security boundary: it catches a replanner
// quietly rewriting a locked gate, not an adversary hunting collisions.
// (DoD check files use real sha256 — computed by a worker, which has full tools.)
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return ('00000000' + h.toString(16)).slice(-8);
}

// STRIP `pos` before hashing. The locked CONTRACT is ids, prompts, schemas and
// predicates — never canvas coordinates. `pos` is documented (graph-spec.md) as "purely a
// layout hint... never read by graph-core.mjs" — but lockedFingerprint stringified whole
// node objects, so it read it anyway. The editor writes `pos` onto every node (including
// locked gates) on every save, so a plain open-and-save of an already-approved graph moved
// the hash and 422'd — the human approval gate the whole design rests on could not be
// passed through the UI for either stock seed, with zero user edits.
function lockedFingerprint(graph) {
  const stripPos = (n) => { const { pos, ...rest } = n; return rest; };
  const nodes = graph.nodes.filter((n) => n.locked).map(stripPos)
    .slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const edges = graph.edges.filter((e) => e.locked).slice()
    .sort((a, b) => {
      const x = stableStringify(a), y = stableStringify(b);
      return x < y ? -1 : x > y ? 1 : 0;
    });
  return 'fnv1a:' + fnv1a(stableStringify({ nodes, edges }));
}

// PURE: deep-clones, applies, returns a new graph. Order matters —
// removals first, then updates, then additions, so a patch can replace a node
// id in one step without colliding with itself.
function applyPatchTo(graph, patch) {
  const g = JSON.parse(JSON.stringify(graph));
  const p = patch || {};

  // Patch fields arrive as JSON produced by a worker or a browser. A non-array here (a
  // bare string, say) would be iterated character-by-character by for...of, manufacturing
  // garbage entries. Anything that isn't an array becomes empty.
  const arr = (x) => (Array.isArray(x) ? x : []);
  // Every value taken FROM the patch is deep-cloned on the way in. A shallow merge leaves
  // the returned graph aliasing the caller's patch object, so a caller that later reuses
  // or mutates that object would silently mutate an already-approved graph without it
  // ever passing back through validateGraph.
  const clone = (x) => JSON.parse(JSON.stringify(x));

  const rmN = new Set(arr(p.removeNodes));
  if (rmN.size) {
    g.nodes = g.nodes.filter((n) => !rmN.has(n.id));
    g.edges = g.edges.filter((e) => !rmN.has(e.from) && !rmN.has(e.to));
  }
  const rmE = new Set(arr(p.removeEdges).map((e) => e.from + '→' + e.to));
  if (rmE.size) g.edges = g.edges.filter((e) => !rmE.has(e.from + '→' + e.to));

  for (const u of arr(p.updateNodes)) {
    const i = g.nodes.findIndex((n) => n.id === u.id);
    if (i >= 0) g.nodes[i] = Object.assign({}, g.nodes[i], clone(u));
  }
  for (const n of arr(p.addNodes)) g.nodes.push(clone(n));
  for (const e of arr(p.addEdges)) g.edges.push(clone(e));
  return g;
}

// Returns violation messages; [] means the graph is acceptable.
// `prev` supplies the frozen lockedHash (null pre-approval).
// `cursor` = { node, unsatisfiedGates } during a run, null pre-flight.
function validateGraph(next, prev, cursor) {
  const v = [];
  const ids = next.nodes.map((n) => n.id);
  const idSet = new Set(ids);

  const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dup.length) v.push('duplicate node id: ' + [...new Set(dup)].join(', '));

  for (const e of next.edges) {
    if (!idSet.has(e.from)) v.push('edge from unknown node: ' + e.from);
    if (!idSet.has(e.to)) v.push('edge to unknown node: ' + e.to);
  }

  if (!idSet.has(next.start)) v.push('start node missing: ' + next.start);
  if (!idSet.has(next.terminal)) v.push('terminal node missing: ' + next.terminal);

  // INVARIANTS ARE THE APPROVED CONTRACT — they are read from `prev`, never from the
  // graph being validated. Reading them from `next` is a full bypass: a caller submits
  // a graph declaring `mustCross: []` plus an unlocked Implement -> terminal edge, the
  // locked fingerprint is untouched (that edge isn't locked), zero dominance checks run,
  // and validation returns []. The run then walks straight past every gate.
  // `next.invariants` governs ONLY pre-approval, when there is no prior graph yet.
  const inv = (prev && prev.invariants) ? prev.invariants : (next.invariants || {});

  // A gate lock nothing stamped is not a lock: without invariants.lockedHash the
  // exempt-locked-edge rule has nothing behind it and a patch can MINT locked:true.
  // Only once `prev` exists — a graph pre-approval has not been frozen yet.
  if (prev && (inv.mustCross || []).length && !inv.lockedHash) {
    v.push('invariants.mustCross is set but invariants.lockedHash was never stamped — '
      + 'the freeze did not happen, so locked flags are unenforceable');
  }

  // And say so out loud, so a UI that drifts them gets a readable error rather than
  // silently having its edits ignored.
  if (prev && prev.invariants
      && stableStringify(next.invariants || {}) !== stableStringify(prev.invariants)) {
    v.push('invariants were modified — they are frozen at approval');
  }

  if (inv.nodeBudget && ids.length > inv.nodeBudget) {
    v.push('node budget exceeded: ' + ids.length + ' > ' + inv.nodeBudget);
  }

  const lockedHash = prev && prev.invariants && prev.invariants.lockedHash;
  if (lockedHash && lockedFingerprint(next) !== lockedHash) {
    v.push('locked nodes/edges were modified or removed');
  }

  // Everything below needs a well-formed skeleton; bail out rather than
  // pile confusing secondary errors onto a graph that is already broken.
  if (!idSet.has(next.start) || !idSet.has(next.terminal)) return v;

  const live = reachable(next, next.start, []);
  if (!live.has(next.terminal)) {
    v.push('terminal ' + next.terminal + ' unreachable from ' + next.start);
  }
  const orphans = ids.filter((id) => !live.has(id));
  if (orphans.length) v.push('orphaned node(s): ' + orphans.join(', '));

  // A reachable non-terminal node with no outgoing edge is a dead end — the interpreter
  // would arrive there with nowhere legal to go and (correctly) throw at runtime. Catch
  // it here instead, before a run ever starts.
  const deadEnds = ids.filter((id) => id !== next.terminal && live.has(id)
    && outEdges(next, id).length === 0);
  if (deadEnds.length) {
    v.push('dead-end node(s) with no outgoing edge: ' + deadEnds.join(', '));
  }

  // ---- fork / join regions ----------------------------------------------------------
  // See the block comment above branchRegion for WHY each of these rules exists. In short:
  // a fork is the only construct that runs two workers at once, and these rules are what
  // buy that concurrency without weakening a single dominance proof below.
  const regionOf = new Map(); // node id -> "<fork>/<branch entry>", for the gate rule
  for (const f of next.nodes.filter((n) => n.kind === 'fork')) {
    if (typeof f.join !== 'string' || !idSet.has(f.join)) {
      v.push('fork ' + f.id + ' must declare `join` naming an existing node (got '
        + JSON.stringify(f.join) + ')');
      continue;
    }
    if (f.join === f.id) { v.push('fork ' + f.id + ' cannot join to itself'); continue; }

    // A fork spawns no worker: it routes. A prompt or schema on one is a modelling error
    // that would silently never run.
    if (f.prompt !== undefined || f.schema !== undefined) {
      v.push('fork ' + f.id + ' must not declare a prompt or schema — a fork spawns no '
        + 'worker, it only routes concurrently; put the work in a branch node');
    }

    const branches = outEdges(next, f.id);
    if (branches.length < 2) {
      v.push('fork ' + f.id + ' has ' + branches.length + ' out-edge(s) — a fork needs at '
        + 'least 2 concurrent branches; one branch is a plain edge, not a fork');
    }
    for (const e of branches) {
      if (!(e.when === undefined || e.when === null || e.when === 'always')) {
        v.push('fork ' + f.id + ' -> ' + e.to + ' carries a predicate — every branch of a '
          + 'fork always runs, so a predicate here reads as a choice that is never made');
      }
    }

    // ONE EXIT. Without this a branch could route back into the main line and the run
    // would walk the rest of the graph concurrently with its own sibling.
    if (!dominates(next, f.join, next.terminal, f.id)) {
      v.push('fork ' + f.id + ' can reach ' + next.terminal + ' without crossing its join '
        + f.join + ' — a branch that escapes the region would run the rest of the graph '
        + 'concurrently with itself');
    }

    const regions = [];
    for (const e of branches) {
      if (!idSet.has(e.to)) continue;
      if (!reachable(next, e.to, []).has(f.join)) {
        v.push('fork ' + f.id + ' branch ' + e.to + ' never reaches its join ' + f.join);
      }
      const region = branchRegion(next, e.to, f.join);
      for (const id of region) {
        for (const oe of outEdges(next, id)) {
          if (oe.to === f.join || region.has(oe.to)) continue;
          v.push('fork ' + f.id + ' branch node ' + id + ' -> ' + oe.to + ' leaves the '
            + 'branch without passing through the join ' + f.join);
        }
      }
      regions.push({ entry: e.to, region });
    }

    for (let i = 0; i < regions.length; i++) {
      for (let j = i + 1; j < regions.length; j++) {
        const shared = [...regions[i].region].filter((id) => regions[j].region.has(id));
        if (shared.length) {
          v.push('fork ' + f.id + ' branches ' + regions[i].entry + ' and ' + regions[j].entry
            + ' share node(s): ' + shared.join(', ') + ' — concurrent branches must be '
            + 'node-disjoint, so that visit accounting is per-branch and exact and no two '
            + 'workers ever race the same node');
        }
      }
    }
    for (const { entry, region } of regions) {
      for (const id of region) if (!regionOf.has(id)) regionOf.set(id, f.id + '/' + entry);
    }
  }

  // A mustCross gate inside a branch is NOT a gate on the run: its sibling branch reaches
  // the join — and so the terminal — without ever crossing it, which `dominates` below
  // reports as a bare "no longer dominates". Say what it actually is, and what to do,
  // rather than leaving the author to work out why their gate is rejected inside a fork.
  for (const gate of inv.mustCross || []) {
    if (!regionOf.has(gate)) continue;
    v.push('mustCross gate ' + gate + ' sits inside fork branch ' + regionOf.get(gate)
      + ' — a gate that guards one branch does not gate the run, because the sibling '
      + 'branches reach the join without it. Move it to the join or after it.');
  }

  // Structural dominance — from `start`, over EVERY declared gate. Position-independent,
  // so it holds for the whole run and cannot be invalidated by later progress.
  for (const gate of inv.mustCross || []) {
    if (!idSet.has(gate)) { v.push('mustCross node missing: ' + gate); continue; }
    if (!dominates(next, gate, next.terminal, next.start)) {
      v.push(gate + ' no longer dominates ' + next.terminal);
    }
  }

  // Positional dominance — from the CURSOR, over gates not yet satisfied.
  // Required because a back-edge admits start -> DoDGate -> Implement -> terminal:
  // structurally dominated, yet the remaining path never re-crosses the failed gate.
  // ONLY a gate's PASSING edge may lead onward. Every other edge out of a gate must
  // return through that gate.
  //
  // Structural dominance proves every path VISITS a gate. It does NOT prove a gate was
  // SATISFIED: `DoDGate --fail--> Done` puts DoDGate on every path and still reaches the
  // terminal with the gate failing. In `lite` this made the verdict fully inert —
  // pickEdge returned `Done` for BOTH {passed:true} and {passed:false}.
  //
  // The rule must cover EVERY non-passing edge, not just `eq:false` ones. An appended
  // `when:"always"` edge is the same bypass wearing a different predicate: pickEdge takes
  // the first match, so pass/fail still route correctly, but every OFF-SHAPE result
  // ({passed:'yes'}, {}, null) falls through to it — which also defeats Task 4's
  // hard-fail, because an edge did match and pickEdge never returns null.
  //
  // Permits all legitimate reshaping (splice a Spike in, loop back to Plan, self-loop
  // bounded by visitCaps); forbids exactly the shape where not-passing leads forward.
  //
  // This is a VALIDATION rule, not a locking rule. Locking these edges instead would
  // silently shadow spliced nodes — applyPatchTo appends and pickEdge takes the first
  // match, so a parallel edge validates and is never selected.
  for (const gate of inv.mustCross || []) {
    if (!idSet.has(gate)) continue;
    for (const e of next.edges) {
      if (e.from !== gate) continue;
      // ONLY THE LOCKED passing edge is exempt. Testing `eq === true` alone is not
      // enough: it checks the VALUE of the predicate and never which FIELD it reads, so
      // a patch could mint `{field:'anythingAtAll', eq:true}` — or even reuse the real
      // field name — and have it exempted. Requiring `locked` ties the exemption to the
      // edge frozen at approval: a minted edge cannot carry `locked: true`, because
      // adding one changes lockedFingerprint and the lock check rejects it.
      if (e.locked && e.when && e.when.eq === true) continue;
      if (!idSet.has(e.to)) continue;
      if (!dominates(next, gate, next.terminal, e.to)) {
        v.push(gate + ' non-passing edge -> ' + e.to + ' can reach ' + next.terminal
          + ' without re-crossing ' + gate);
      }
    }
  }

  if (cursor && cursor.node) {
    // FAIL CLOSED. A cursor node missing from `next` is not "nothing to check" — it is the
    // patch erasing the very identity this check needs. Rename the node the run is standing
    // on (same shape, same reachability, nothing locked touched) and a permissive guard
    // skips positional dominance entirely, letting the run's real position reach the
    // terminal without recrossing the gate that just failed. Structural dominance does NOT
    // catch it, because renaming a mid-graph node leaves every path from `start` intact.
    if (!idSet.has(cursor.node)) {
      v.push('cursor node ' + cursor.node + ' was removed by this patch — a run may not '
        + 'delete or rename the node it is currently executing');
    } else {
      for (const gate of cursor.unsatisfiedGates || []) {
        if (!idSet.has(gate)) continue;
        if (!dominates(next, gate, next.terminal, cursor.node)) {
          v.push(gate + ' is unsatisfied but no longer dominates ' + next.terminal
            + ' from ' + cursor.node);
        }
      }
    }
  }
  return v;
}

export { outEdges, reachable, dominates, matches, pickEdge, branchRegion, capFor, carryFor, stableStringify, fnv1a, lockedFingerprint, applyPatchTo, validateGraph };
