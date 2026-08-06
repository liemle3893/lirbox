"""Deterministic checks for an authored loom graph with a concurrent region. Never executed.

WHY THIS TASK EXISTS (2026-08-06). Issue #67: loom's graph was a single-cursor state machine, so
"these three are independent" could not be expressed. `fork`/`join` fixes that. The tier-2 floor
proves the region rules hold and that the emitted conductor really runs branches under parallel(),
but those are artifact-level and stay green with SKILL.md trimmed to nothing. This grades whether a
model GIVEN the skill reaches for the mechanism on a goal it has never seen — the instruction says
only that the work is independent and must happen at the same time; it never says "fork".

THE CRITERIA SPLIT, AND THE SPLIT IS THE POINT:

  PRE-EXISTING CONTRACT  graph_exists, gate_enforced, failure_edge_routes_back,
                         back_edge_carries_findings
      The baseline (loom at git HEAD, no fork support) can score all four. This is the only half
      where comparing two arms means anything — it answers "no worse".

  NEW CAPABILITY         declares_a_fork, region_is_a_dag, dependencies_not_serialised,
                         region_has_one_exit, no_gate_inside_the_region
      The baseline cannot express a fork at all, so a 0 here measures the feature's absence rather
      than the model. Read the AFTER arm absolute. A "lift" on these four is arithmetic.

Reachability is reimplemented below rather than imported from the skill's graph-core.mjs on
purpose: grading the code under test with the code under test proves only that it agrees with
itself. If both are wrong in the same way, only an independent implementation notices.

Same split as loom's other task: this directory is `reward` (the scalar Harbor gates on); the
semantic judge lives in ../quality/ under its own key.
"""

import json
from pathlib import Path

from rewardkit import criterion


def _graph(workspace: Path):
    """The authored graph, wherever the agent put it under .loom/."""
    for pat in ("*.graph.json", "*graph*.json"):
        hits = sorted(p for p in (workspace / ".loom").glob(pat) if p.is_file())
        if hits:
            try:
                return json.loads(hits[0].read_text())
            except Exception:
                return None
    return None


def _must(g):
    return set((g.get("invariants") or {}).get("mustCross") or [])


def _out(g, node):
    return [e for e in (g.get("edges") or []) if e.get("from") == node]


def _reachable(g, start, skip=()):
    """Ids reachable from `start`, treating every id in `skip` as deleted.

    Independent reimplementation of graph-core's `reachable` — iterative with a visited set, so a
    cyclic graph (which every loom graph is) terminates instead of recursing forever.
    """
    skip = set(skip)
    if start in skip:
        return set()
    seen, stack = set(), [start]
    while stack:
        cur = stack.pop()
        if cur in seen or cur in skip:
            continue
        seen.add(cur)
        for e in _out(g, cur):
            if e.get("to") not in skip:
                stack.append(e.get("to"))
    return seen


def _forks(g):
    return [n for n in (g.get("nodes") or []) if n.get("kind") == "fork"]


def _region(g, f):
    """Nodes strictly inside a fork's region: reachable from its targets, join deleted."""
    join = f.get("join")
    out = set()
    for e in _out(g, f["id"]):
        out |= _reachable(g, e.get("to"), skip=[join])
    return out


def _topo_order(g, region):
    """Kahn over the region's internal edges. None when the region has a dependency cycle."""
    indeg = {n: 0 for n in region}
    succ = {n: [] for n in region}
    seen = set()
    for e in g.get("edges") or []:
        a, b = e.get("from"), e.get("to")
        if a not in region or b not in region or (a, b) in seen:
            continue
        seen.add((a, b))
        succ[a].append(b)
        indeg[b] += 1
    ready = [n for n in region if indeg[n] == 0]
    order = []
    while ready:
        n = ready.pop()
        order.append(n)
        for m in succ[n]:
            indeg[m] -= 1
            if indeg[m] == 0:
                ready.append(m)
    return order if len(order) == len(region) else None


def _fail_edges(g, gate):
    """Out-edges of `gate` that fire on a FAILING verdict (a dict `when` with eq false)."""
    return [
        e
        for e in (g.get("edges") or [])
        if e.get("from") == gate
        and isinstance(e.get("when"), dict)
        and e["when"].get("eq") is False
    ]


# --------------------------------------------------------------------------------------
# PRE-EXISTING CONTRACT — the baseline can score every one of these.
# --------------------------------------------------------------------------------------


@criterion(description="a parseable loom graph was authored under .loom/")
def graph_exists(workspace: Path) -> bool:
    g = _graph(workspace)
    return bool(g and g.get("start") and g.get("terminal") and g.get("nodes") and g.get("edges"))


@criterion(description="a gate node exists and is listed in invariants.mustCross")
def gate_enforced(workspace: Path) -> bool:
    """A gate that exists but is absent from mustCross is decoration — nothing enforces it."""
    g = _graph(workspace)
    if not g:
        return False
    gates = {n["id"] for n in g["nodes"] if n.get("kind") == "gate"}
    return bool(gates and (_must(g) & gates))


@criterion(description="the enforced gate's failing edge goes back into work, never to the terminal")
def failure_edge_routes_back(workspace: Path) -> bool:
    """A gate whose only failing path is forward cannot send the run back into real work."""
    g = _graph(workspace)
    if not g:
        return False
    must = _must(g)
    if not must:
        return False
    order = {n["id"]: i for i, n in enumerate(g["nodes"])}
    terminal = g.get("terminal")
    for gate in must:
        fails = _fail_edges(g, gate)
        if not fails:
            return False
        for e in fails:
            to = e.get("to")
            if to == terminal or to not in order:
                return False
            if order[to] >= order.get(gate, -1):
                return False
    return True


@criterion(description="the back-edge carries the gate's findings forward")
def back_edge_carries_findings(workspace: Path) -> bool:
    """A back-edge with no `carry` loops blind — the re-entered node never learns why it failed."""
    g = _graph(workspace)
    if not g:
        return False
    backs = [e for gate in _must(g) for e in _fail_edges(g, gate)]
    return bool(backs) and all(e.get("carry") for e in backs)


# --------------------------------------------------------------------------------------
# NEW CAPABILITY — the baseline cannot express any of this. Read the after arm absolute.
# --------------------------------------------------------------------------------------


@criterion(description="a fork node declares a join and opens at least two independent entries")
def declares_a_fork(workspace: Path) -> bool:
    """The instruction says the three exporters must be worked on AT THE SAME TIME.

    Sequential nodes satisfy every other criterion in this file while taking three times as long,
    which is exactly the shape this task exists to distinguish.
    """
    g = _graph(workspace)
    if not g:
        return False
    ids = {n["id"] for n in g["nodes"]}
    for f in _forks(g):
        join = f.get("join")
        if isinstance(join, str) and join in ids and join != f["id"] and len(_out(g, f["id"])) >= 2:
            return True
    return False


@criterion(description="the region is an acyclic dependency graph, not a set of parallel lanes")
def region_is_a_dag(workspace: Path) -> bool:
    """Inside a region an edge means DEPENDS ON, so the region must be a DAG.

    Two things are graded here. It must be ACYCLIC — a dependency cycle is a deadlock, each
    node waiting on the other with no verdict able to break it. And every edge into or
    inside it must be unconditional: a dependency is not a choice, and "every region node
    runs" is the premise the gate reasoning rests on.

    Note what is NOT required: that the region's nodes be disjoint. A node depending on two
    others is the whole point of a DAG, and rejecting it would be rejecting the feature.
    """
    g = _graph(workspace)
    if not g or not _forks(g):
        return False
    for f in _forks(g):
        join = f.get("join")
        if not isinstance(join, str):
            return False
        region = _region(g, f)
        if not region:
            return False
        # Unconditional: entry edges and every edge inside the region.
        edges = _out(g, f["id"]) + [e for n in region for e in _out(g, n)]
        for e in edges:
            when = e.get("when")
            if when not in (None, "always"):
                return False
        if _topo_order(g, region) is None:
            return False
    return True


@criterion(description="every path out of the fork crosses its join — the region has one exit")
def region_has_one_exit(workspace: Path) -> bool:
    """A node that escapes the region would walk the rest of the graph concurrently with
    itself. Proof by deletion: remove the join; the terminal must become unreachable from
    the fork. Every region node must also actually arrive there.
    """
    g = _graph(workspace)
    if not g or not _forks(g):
        return False
    terminal = g.get("terminal")
    for f in _forks(g):
        join = f.get("join")
        if not isinstance(join, str):
            return False
        if terminal in _reachable(g, f["id"], skip=[join]):
            return False
        # ...and every region node must actually arrive there, rather than dead-ending.
        for n in _region(g, f):
            if join not in _reachable(g, n):
                return False
    return True


@criterion(description="no enforced gate hides inside the concurrent region")
def no_gate_inside_the_region(workspace: Path) -> bool:
    """The instruction states this one in plain words: the privacy review must see all three
    exporters together, because a redaction bug lives BETWEEN formats.

    A gate inside the region would have seen one exporter. It also could not route its own
    failure anywhere legal — backwards inside the region is a dependency cycle, and outside
    it breaks the single exit.
    """
    g = _graph(workspace)
    if not g or not _forks(g):
        return False
    must = _must(g)
    if not must:
        return False
    for f in _forks(g):
        join = f.get("join")
        if not isinstance(join, str):
            return False
        if _region(g, f) & must:
            return False
    return True


@criterion(description="a real dependency is declared — not a chain, and not three isolated lanes")
def dependencies_not_serialised(workspace: Path) -> bool:
    """The DAG discriminator, and the one the instruction spells out.

    Regenerating the golden fixtures needs the csv AND xlsx work finished, and nothing from the
    pdf work. So a correct region contains a node with TWO in-region dependencies, and at least
    one region node that is NOT one of its ancestors — the exporter it must not wait for.

    Three isolated lanes fail the first half (no node ever waits on two). A chain that
    serialises all three fails the second (everything is an ancestor of everything downstream),
    which is the shape a model reaches for when it cannot express a dependency and settles for
    an order instead.
    """
    g = _graph(workspace)
    if not g or not _forks(g):
        return False
    for f in _forks(g):
        region = _region(g, f)
        if not region:
            continue
        for node in region:
            preds = {e["from"] for e in (g.get("edges") or [])
                     if e.get("to") == node and e.get("from") in region}
            if len(preds) < 2:
                continue
            ancestors = {n for n in region if node in _reachable(g, n, skip=[f.get("join")])}
            if region - ancestors - {node}:
                return True
    return False
