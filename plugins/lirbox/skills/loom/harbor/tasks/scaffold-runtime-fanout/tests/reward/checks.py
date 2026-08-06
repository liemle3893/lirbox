"""Deterministic checks for an authored loom graph that fans out over a runtime list.

WHY THIS TASK EXISTS (2026-08-06). Issue #70: a fork's region was declared statically, so "one
branch per thing, and the number of things is not knowable yet" could not be expressed at all.
`fanOut: { field, max }` fixes it — the region becomes a template instantiated once per item,
under a bound the human approves in place of a node count.

The tier-2 floor proves the RUNTIME honours that bound (`runtime-fanout-honours-its-bound`
executes the emitted conductor and watches instances run). This grades the half no artifact check
can see: whether a model given the skill reaches for a bounded fan-out on a goal whose N genuinely
is not knowable while authoring, and wires the list so it cannot arrive empty.

THE CRITERIA SPLIT:

  PRE-EXISTING CONTRACT  graph_exists, gate_enforced, failure_edge_routes_back,
                         back_edge_carries_findings
      The baseline scores all four. Only this half supports comparing two arms — it answers
      "no worse".

  NEW CAPABILITY         declares_bounded_fanout, fanout_list_is_guaranteed, gate_outside_region
      The baseline cannot express fanOut at all, so a 0 here measures the feature's absence
      rather than the model. Read the AFTER arm absolute.

`fanout_list_is_guaranteed` is deliberately not satisfiable by knowing the keyword. The array has
to be carried on the edge INTO the fork and listed in the source node's `schema.required`; miss
either and the region instantiates zero times while the run reports success — the same defect as
a back-edge carrying an optional field.

Reachability is reimplemented here rather than imported from the skill's graph-core.mjs: grading
the code under test with the code under test proves only that it agrees with itself.
"""

import json
from pathlib import Path

from rewardkit import criterion


def _graph(workspace: Path):
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


def _into(g, node):
    return [e for e in (g.get("edges") or []) if e.get("to") == node]


def _reachable(g, start, skip=()):
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


def _fanning(g):
    """Forks that declare a fan-out spec at all — well-formed or not."""
    return [f for f in _forks(g) if isinstance(f.get("fanOut"), dict)]


def _region(g, f):
    join = f.get("join")
    out = set()
    for e in _out(g, f["id"]):
        out |= _reachable(g, e.get("to"), skip=[join])
    return out


def _node(g, nid):
    for n in g.get("nodes") or []:
        if n.get("id") == nid:
            return n
    return None


def _fail_edges(g, gate):
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
    g = _graph(workspace)
    if not g:
        return False
    gates = {n["id"] for n in g["nodes"] if n.get("kind") == "gate"}
    return bool(gates and (_must(g) & gates))


@criterion(description="the enforced gate's failing edge goes back into work, never to the terminal")
def failure_edge_routes_back(workspace: Path) -> bool:
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
    g = _graph(workspace)
    if not g:
        return False
    backs = [e for gate in _must(g) for e in _fail_edges(g, gate)]
    return bool(backs) and all(e.get("carry") for e in backs)


# --------------------------------------------------------------------------------------
# NEW CAPABILITY — the baseline cannot express any of this.
# --------------------------------------------------------------------------------------


@criterion(description="a fork fans out over a runtime list under an explicit bound")
def declares_bounded_fanout(workspace: Path) -> bool:
    """N is not knowable while authoring, so the shape has to be a TEMPLATE plus a ceiling.

    `max` is not decoration: it is what a human approves in place of a node count, and it is
    what lets the run refuse rather than silently migrate a subset. A fanOut without it is a
    fan-out nobody bounded.
    """
    g = _graph(workspace)
    if not g:
        return False
    ids = {n["id"] for n in g["nodes"]}
    for f in _fanning(g):
        spec = f["fanOut"]
        field, mx = spec.get("field"), spec.get("max")
        if not isinstance(field, str) or not field:
            continue
        if not isinstance(mx, int) or isinstance(mx, bool) or mx < 1:
            continue
        join = f.get("join")
        if isinstance(join, str) and join in ids and join != f["id"] and _out(g, f["id"]):
            return True
    return False


@criterion(description="the list driving the fan-out is guaranteed to arrive, not merely hoped for")
def fanout_list_is_guaranteed(workspace: Path) -> bool:
    """Carried on the edge INTO the fork, and REQUIRED by the node that produces it.

    Miss either and the array arrives undefined: the region instantiates zero times and the run
    reports success for a migration it never performed. This is the fan-out spelling of the
    back-edge carry rule — a channel that is allowed to be empty will eventually be empty.
    """
    g = _graph(workspace)
    if not g:
        return False
    fanning = _fanning(g)
    if not fanning:
        return False
    for f in fanning:
        field = (f.get("fanOut") or {}).get("field")
        if not isinstance(field, str) or not field:
            return False
        feeds = _into(g, f["id"])
        if not feeds:
            return False
        for e in feeds:
            carry = e.get("carry")
            if not isinstance(carry, list) or field not in carry:
                return False
            src = _node(g, e.get("from"))
            schema = (src or {}).get("schema") or {}
            if field not in (schema.get("required") or []):
                return False
    return True


@criterion(description="the enforced gate sits outside the fanned region, over the combined result")
def gate_outside_region(workspace: Path) -> bool:
    """A gate inside the region would see one table, and could not route its own failure
    anywhere legal — backwards inside the region is a dependency cycle, outside it breaks the
    single exit. The instruction asks for a review over the combined result, which is the join
    or later.
    """
    g = _graph(workspace)
    if not g:
        return False
    fanning = _fanning(g)
    must = _must(g)
    if not fanning or not must:
        return False
    for f in fanning:
        if _region(g, f) & must:
            return False
    return True
