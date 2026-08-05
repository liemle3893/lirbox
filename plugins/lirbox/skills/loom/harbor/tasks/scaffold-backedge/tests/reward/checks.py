"""Deterministic checks for an authored loom graph. The graph is never executed.

WHY THIS TASK EXISTS (2026-08-06). loom's tier-2 floor already proves `graph-core.mjs` traverses
back-edges (`evals/checks/gate-failure-edges-return.check.mjs`) and that `validateGraph` keeps gates
un-bypassable (`gate-dominance-not-bypassable.check.mjs`). Those are artifact-level: they test the
interpreter, and they stay green with SKILL.md trimmed to nothing. This task grades the behaviour
they cannot see — whether a model GIVEN the skill authors a graph that actually uses the mechanism
for a goal it has never seen.

THE DISCRIMINATOR is `distinct_back_targets`. The stock `scripts/seeds/delivery.json` seed already
ships two `mustCross` gates whose failing edges route backwards and carry findings, so a bare `cp`
of the seed satisfies every other criterion here. That seed routes BOTH gates back to `Implement`.
The instruction requires the security gate to route back to the PLANNING node instead — a
requirement no seed copy can meet, and one that can only be met by reading the goal.

Same split as conductor's tasks: this directory is `reward` (the scalar Harbor gates on); the
semantic judge lives in ../quality/ under its own key.
"""

import json
from pathlib import Path

from rewardkit import criterion

PLAN_KINDS = {"plan"}


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


def _fail_edges(g, gate):
    """Out-edges of `gate` that fire on a FAILING verdict (a dict `when` with eq false)."""
    return [
        e
        for e in (g.get("edges") or [])
        if e.get("from") == gate
        and isinstance(e.get("when"), dict)
        and e["when"].get("eq") is False
    ]


@criterion(description="a parseable loom graph was authored under .loom/")
def graph_exists(workspace: Path) -> bool:
    """A parseable graph with a start, a terminal, nodes and edges."""
    g = _graph(workspace)
    return bool(g and g.get("start") and g.get("terminal") and g.get("nodes") and g.get("edges"))


@criterion(description="two gate nodes exist and both are listed in invariants.mustCross")
def two_gates_enforced(workspace: Path) -> bool:
    """Both required gates exist as kind=gate AND are listed in invariants.mustCross.

    Names are the agent's choice; the count and the enforcement are not. A gate that exists but is
    absent from mustCross is decoration — validateGraph will happily route around it.
    """
    g = _graph(workspace)
    if not g:
        return False
    gates = {n["id"] for n in g["nodes"] if n.get("kind") == "gate"}
    return len(gates) >= 2 and len(_must(g) & gates) >= 2


@criterion(description="every enforced gate's failing edge targets an earlier node, never the terminal")
def failure_edges_route_back(workspace: Path) -> bool:
    """Every enforced gate has a failing out-edge, and it targets an EARLIER node, never the terminal.

    A gate whose only failing path is forward (or into Done) cannot send the run back into real
    work — which is the entire reason to use loom instead of conductor.
    """
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
            if e.get("to") == terminal:
                return False
            if e.get("to") not in order:
                return False
            if order[e["to"]] >= order.get(gate, -1):
                return False
    return True


@criterion(description="the two gates re-enter at DIFFERENT stages, one of them at planning")
def distinct_back_targets(workspace: Path) -> bool:
    """The two gates must NOT re-enter at the same place, and one must re-enter at PLANNING.

    This is the criterion the stock delivery.json seed fails: it routes both Review and DoDGate
    back to Implement. The instruction states a security finding is a design problem and must go
    back to planning, while a compatibility failure goes back to implementation. Satisfying this
    requires reading the goal, not copying a seed.
    """
    g = _graph(workspace)
    if not g:
        return False
    must = _must(g)
    if len(must) < 2:
        return False
    kind = {n["id"]: n.get("kind") for n in g["nodes"]}
    targets = {gate: {e.get("to") for e in _fail_edges(g, gate)} for gate in must}
    if any(not t for t in targets.values()):
        return False
    # Not all gates re-enter at the same single node.
    flat = [t for s in targets.values() for t in s]
    if len(set(flat)) < 2:
        return False
    # At least one gate re-enters at a planning node.
    return any(kind.get(t) in PLAN_KINDS for t in flat)


@criterion(description="every back-edge carries the gate's findings forward")
def back_edges_carry_findings(workspace: Path) -> bool:
    """A back-edge with no `carry` loops blind — the re-entered node never learns why it failed.

    loom's whole convergence story is edge.carry lifting the gate's findings onto the re-entry.
    Without it the run re-does the same work and fails the same gate until it hits the visit cap.
    """
    g = _graph(workspace)
    if not g:
        return False
    backs = [e for gate in _must(g) for e in _fail_edges(g, gate)]
    return bool(backs) and all(e.get("carry") for e in backs)
