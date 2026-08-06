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

  NEW CAPABILITY         declares_a_fork, branches_are_disjoint, region_has_one_exit,
                         no_gate_inside_a_branch
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


@criterion(description="a fork node declares a join and opens at least two concurrent branches")
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


@criterion(description="the fork's branches are node-disjoint")
def branches_are_disjoint(workspace: Path) -> bool:
    """Two branches sharing a node means two concurrent workers racing it.

    It is also what makes visit accounting per-branch and exact rather than an approximation over
    a shared counter.
    """
    g = _graph(workspace)
    if not g or not _forks(g):
        return False
    for f in _forks(g):
        join = f.get("join")
        if not isinstance(join, str):
            return False
        regions = [_reachable(g, e.get("to"), skip=[join]) for e in _out(g, f["id"])]
        if len(regions) < 2:
            return False
        for i in range(len(regions)):
            for j in range(i + 1, len(regions)):
                if regions[i] & regions[j]:
                    return False
    return True


@criterion(description="every path out of the fork crosses its join — the region has one exit")
def region_has_one_exit(workspace: Path) -> bool:
    """A branch that escapes the region would walk the rest of the graph concurrently with its
    own sibling. Proof by deletion: remove the join; the terminal must become unreachable from
    the fork.
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
        # ...and each branch must actually arrive there, rather than dead-ending.
        for e in _out(g, f["id"]):
            if join not in _reachable(g, e.get("to")):
                return False
    return True


@criterion(description="no enforced gate hides inside a concurrent branch")
def no_gate_inside_a_branch(workspace: Path) -> bool:
    """THE dominance question for concurrency, and the one the instruction states in plain words:
    the privacy review must see all three exporters together.

    A gate inside one branch is not a gate on the run — the sibling branches reach the join, and
    so the terminal, without ever crossing it. It also would not have seen the other two
    exporters, which is where a redaction inconsistency actually lives.
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
        for e in _out(g, f["id"]):
            if _reachable(g, e.get("to"), skip=[join]) & must:
                return False
    return True
