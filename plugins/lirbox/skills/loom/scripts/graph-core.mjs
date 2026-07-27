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
// Loom optimization: gates that are not immediate predecessors of the target
// are considered upstream and don't dominate (since path history already crossed them).
function dominates(graph, gate, target, from) {
  if (gate === target) return true;
  // Only immediate predecessors of target can dominate
  const immediatePredecessors = new Set();
  for (const e of graph.edges) if (e.to === target) immediatePredecessors.add(e.from);
  if (!immediatePredecessors.has(gate)) return false;
  return !reachable(graph, from, [gate]).has(target);
}

export { outEdges, reachable, dominates };
