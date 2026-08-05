#!/bin/bash
# Reference solution: what a correct authored graph looks like for THIS goal.
#
# Real derivation, not a pre-baked drop: it starts from the shipped delivery seed and patches it
# the way the instruction requires, so the oracle stays honest if the seed changes shape.
#
# The patch that matters: the seed routes BOTH gates back to Implement. The instruction says a
# security finding is a design problem, so the security gate must re-enter at the PLANNING node.
set -euo pipefail

# Overridable so the graders can be dry-run on the host before paying for a container build.
SKILL="${SKILL:-/root/.claude/skills/loom}"
cd "${WORKSPACE:-/app}"
mkdir -p .loom

python3 - "$SKILL/scripts/seeds/delivery.json" <<'PY'
import json, sys

seed = json.load(open(sys.argv[1]))

ids = [n["id"] for n in seed["nodes"]]
plan = next(n["id"] for n in seed["nodes"] if n.get("kind") == "plan")
# The IMPLEMENTATION node specifically — not merely "the first work node that isn't Setup", which
# picks up DoDBaseline and would route a compatibility failure back into baseline measurement.
gate_ix = min(i for i, n in enumerate(seed["nodes"]) if n.get("kind") == "gate")
plan_ix = next(i for i, n in enumerate(seed["nodes"]) if n.get("kind") == "plan")
work = next(
    n["id"]
    for i, n in enumerate(seed["nodes"])
    if n.get("kind") == "work" and plan_ix < i < gate_ix
)

# The seed's two gates, in graph order.
gates = [n["id"] for n in seed["nodes"] if n.get("kind") == "gate"]
assert len(gates) >= 2, f"seed no longer ships two gates: {gates}"
security, compat = gates[0], gates[1]

# Rename them to what this goal actually needs, keeping kind/prompt/schema intact.
rename = {security: "SecurityReview", compat: "CompatGate"}
for n in seed["nodes"]:
    if n["id"] in rename:
        n["id"] = rename[n["id"]]
for e in seed["edges"]:
    if e.get("from") in rename:
        e["from"] = rename[e["from"]]
    if e.get("to") in rename:
        e["to"] = rename[e["to"]]
seed["invariants"]["mustCross"] = [rename.get(g, g) for g in seed["invariants"]["mustCross"]]

# THE PATCH: the security gate's failing edge re-enters at planning, not implementation.
for e in seed["edges"]:
    if e.get("from") == "SecurityReview" and isinstance(e.get("when"), dict) and e["when"].get("eq") is False:
        e["to"] = plan
        e["carry"] = ["findings"]
    if e.get("from") == "CompatGate" and isinstance(e.get("when"), dict) and e["when"].get("eq") is False:
        e["to"] = work
        e["carry"] = ["unmetCriteria"]

seed["name"] = "jwt-migration"
seed["goal"] = "Migrate cookie-session auth to signed JWTs, keeping the /login response shape byte-identical."
# lockedHash describes the SEED's frozen shape; this graph is deliberately not that shape.
seed["invariants"].pop("lockedHash", None)

json.dump(seed, open(".loom/jwt-migration.graph.json", "w"), indent=2)
print("authored .loom/jwt-migration.graph.json")
print("  mustCross:", seed["invariants"]["mustCross"])
for e in seed["edges"]:
    if isinstance(e.get("when"), dict) and e["when"].get("eq") is False:
        print(f"  fail edge: {e['from']} -> {e['to']} carry={e.get('carry')}")
PY
