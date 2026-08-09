"""Deterministic checks on an authored loom graph's PROMPTS. The graph is never executed.

WHY THIS TASK EXISTS (2026-08-09). loom's three other Harbor tasks grade graph SHAPE — back-edges,
fan-out, runtime fan-out — and all three sit at reward 1.000. None reads what a node's `prompt`
says, so all three stay green on a graph wired perfectly and instructed uselessly.

That is the expensive gap. A loom worker is a fresh subagent and the node prompt is the entire
context it will ever have: it does not see the graph, the plan, its siblings' prompts, or the
conversation that produced them. The shipped delivery seed's Implement node reads, in full,
"Implement the goal in the worktree. Commit your work on the branch." — no file, no interface, no
completion condition. Every worker therefore opens by re-deriving the decomposition from the
repository, and the next worker derives it again.

THE DISCRIMINATOR is that neither seed can be copied into a pass. Both ship exactly ONE work node
between planning and the first gate, so `implementation_decomposed` fails at >= 3; and the stock
prompts name no repository file, so `prompts_name_real_files` fails as well.

SCOPE. This grades the authoring half only. The conductor's run brief is built at runtime and
Harbor never runs the graph, so nothing here observes it — that half is held by
evals/checks/worker-prompt-carries-the-run-brief.check.mjs.

Same split as loom's other tasks: this directory is `reward` (the scalar Harbor gates on); the
semantic judge lives in ../quality/ under its own key.
"""

import json
import re
from pathlib import Path

from rewardkit import criterion

# A prompt shorter than this cannot carry a file, an interface and a completion condition, whatever
# it says. Set well below the reference solution's shortest prompt so it measures substance rather
# than verbosity.
MIN_PROMPT_CHARS = 200

# The node prompt must say how its worker knows it is finished. Deliberately broad: what a
# completion condition LOOKS like varies, and this is checking that one is present at all.
DONE_PATTERNS = [
    r"\bdone\b", r"\bcomplete[ds]?\b", r"\bacceptance\b", r"\bcriteri", r"\bverif",
    r"\bpasses?\b", r"\bmust return\b", r"\bso that\b", r"\bsucceeds?\b", r"\bassert",
    r"\btest", r"\bexpect", r"\bfinished\b",
]


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


def _repo_files(workspace: Path):
    """Every tracked source path under src/, as posix strings relative to the workspace."""
    out = set()
    src = workspace / "src"
    if not src.is_dir():
        return out
    for p in src.rglob("*.py"):
        out.add(p.relative_to(workspace).as_posix())
    return out


def _graded_nodes(g):
    """The IMPLEMENTATION nodes: work nodes between planning and the first enforced gate.

    Graded in isolation rather than grading every work node, because Setup and the PR node are
    genuine plumbing — a prompt for "create the worktree" has no repository file to name, and
    demanding one would measure compliance with this grader instead of prompt quality.

    Position uses the nodes-array order, the same convention loom's other reward graders use.
    """
    nodes = g.get("nodes") or []
    order = {n.get("id"): i for i, n in enumerate(nodes)}
    must = set((g.get("invariants") or {}).get("mustCross") or [])

    # Lower bound: the plan node if there is one, else the start node.
    plan_ix = next((i for i, n in enumerate(nodes) if n.get("kind") == "plan"), None)
    if plan_ix is None:
        plan_ix = order.get(g.get("start"), -1)

    # Upper bound: the first ENFORCED gate. Falling back to any kind=="gate" would let a graph with
    # a decorative gate placed early shrink the graded window to nothing and pass by vacancy.
    gate_ixs = [i for i, n in enumerate(nodes) if n.get("id") in must]
    if not gate_ixs:
        gate_ixs = [i for i, n in enumerate(nodes) if n.get("kind") == "gate"]
    gate_ix = min(gate_ixs) if gate_ixs else len(nodes)

    return [
        n for i, n in enumerate(nodes)
        if plan_ix < i < gate_ix and n.get("kind") == "work"
    ]


@criterion(description="a parseable loom graph was authored under .loom/")
def graph_exists(workspace: Path) -> bool:
    g = _graph(workspace)
    return bool(g and g.get("start") and g.get("terminal") and g.get("nodes") and g.get("edges"))


@criterion(description="the implementation is decomposed into three or more work nodes")
def implementation_decomposed(workspace: Path) -> bool:
    """Three or more work nodes between planning and the first enforced gate.

    Neither shipped seed can satisfy this: both carry exactly one (Implement).
    """
    g = _graph(workspace)
    if not g:
        return False
    return len(_graded_nodes(g)) >= 3


@criterion(description="every implementation prompt names a file that actually exists in the repo")
def prompts_name_real_files(workspace: Path) -> bool:
    """EVERY graded prompt names at least one real path under src/.

    Every, not some: one specific prompt among four vague ones still leaves three workers
    re-surveying the codebase. A named path that does not exist is worse than none — it sends the
    worker looking for a file that was never there — so membership is tested against the real tree
    rather than against a path-shaped regex.
    """
    g = _graph(workspace)
    if not g:
        return False
    files = _repo_files(workspace)
    nodes = _graded_nodes(g)
    if not files or not nodes:
        return False
    return all(
        any(f in (n.get("prompt") or "") for f in files)
        for n in nodes
    )


@criterion(description="no implementation prompt is too short to carry an actionable instruction")
def prompts_are_substantive(workspace: Path) -> bool:
    """The seed's "Implement the goal in the worktree." is 67 characters. This is the floor a
    goal-shaped prompt cannot clear."""
    g = _graph(workspace)
    if not g:
        return False
    nodes = _graded_nodes(g)
    if not nodes:
        return False
    return all(len((n.get("prompt") or "").strip()) >= MIN_PROMPT_CHARS for n in nodes)


@criterion(description="every implementation prompt states how its worker knows it is done")
def prompts_state_completion(workspace: Path) -> bool:
    """A prompt that names files but never says what finished looks like leaves the worker to
    invent the acceptance condition — and the gate to disagree with whatever it invented."""
    g = _graph(workspace)
    if not g:
        return False
    nodes = _graded_nodes(g)
    if not nodes:
        return False
    return all(
        any(re.search(p, (n.get("prompt") or ""), re.I) for p in DONE_PATTERNS)
        for n in nodes
    )


@criterion(description="the implementation prompts are distinct from one another")
def prompts_are_distinct(workspace: Path) -> bool:
    """Guards the cheapest way to satisfy everything above: write one good prompt and paste it into
    every node. Identical prompts mean the decomposition is nominal — three workers doing the same
    undifferentiated work."""
    g = _graph(workspace)
    if not g:
        return False
    nodes = _graded_nodes(g)
    if not nodes:
        return False
    seen = [" ".join((n.get("prompt") or "").split()).lower() for n in nodes]
    return len(set(seen)) == len(seen)
