#!/bin/bash
# Reference solution: what a correct authored graph looks like for THIS goal.
#
# Derived from the shipped delivery seed rather than dropped in whole, so the oracle stays
# honest if the seed changes shape.
#
# The patch that matters: the single Implement node becomes a fanning region — one template
# instantiated per discovered table, under a bound — and the plan node is made to REPORT the
# discovered list, with the edge into the fork carrying it. Without both halves the region
# instantiates zero times and the run reports success anyway.
set -euo pipefail

SKILL="${SKILL:-/root/.claude/skills/loom}"
cd "${WORKSPACE:-/app}"
mkdir -p .loom

python3 - "$SKILL/scripts/seeds/delivery.json" <<'PY'
import json, sys

seed = json.load(open(sys.argv[1]))
nodes, edges = seed["nodes"], seed["edges"]
kinds = {n["id"]: n.get("kind") for n in nodes}

gate_ix = min(i for i, n in enumerate(nodes) if n.get("kind") == "gate")
plan_ix = next(i for i, n in enumerate(nodes) if n.get("kind") == "plan")
PLAN = nodes[plan_ix]["id"]
impl_ix, impl = next(
    (i, n) for i, n in enumerate(nodes)
    if n.get("kind") == "work" and plan_ix < i < gate_ix
)
IMPL = impl["id"]

FAN, JOIN, TPL = "FanTables", "Reconcile", "MigrateTable"
FIELD, MAX = "tables", 12

# The planner must REPORT the discovered list, and be obliged to: an optional field would let
# a worker omit it, and the region would instantiate zero times.
plan = nodes[plan_ix]
plan["prompt"] = (plan.get("prompt", "") + "\n\nAlso enumerate every table module under "
                  "src/tables/ and return their names in `tables`. The number of them is a "
                  "property of the repo, not of this plan — do not assume a count.")
schema = plan.setdefault("schema", {"type": "object", "properties": {}, "required": []})
schema.setdefault("properties", {})[FIELD] = {"type": "array", "items": {"type": "string"}}
req = schema.setdefault("required", [])
if FIELD not in req:
    req.append(FIELD)

fork = {"id": FAN, "kind": "fork", "join": JOIN, "fanOut": {"field": FIELD, "max": MAX}}
template = {
    "id": TPL,
    "kind": "work",
    "prompt": (
        "Migrate ONE table module to timezone-aware UTC timestamps. The table you own arrives "
        "in your carry as `item` — touch only src/tables/<item>.py.\n\n"
        "Sibling instances of this same node are migrating the other tables CONCURRENTLY; "
        "editing theirs would collide with work in flight."
    ),
    "schema": {
        "type": "object",
        "properties": {"table": {"type": "string"}, "notes": {"type": "string"}},
        "required": ["table", "notes"],
    },
}
join_node = {
    "id": JOIN,
    "kind": "work",
    "prompt": (
        "Every table module has been migrated concurrently. Reconcile them: confirm all of them "
        "now write timezone-aware UTC and that none was missed.\n\n"
        "Your carry arrives keyed by instance — check you were handed one result per table the "
        "plan discovered, and say so if you were not."
    ),
    "schema": {
        "type": "object",
        "properties": {"reconciled": {"type": "boolean"}, "notes": {"type": "string"}},
        "required": ["reconciled", "notes"],
    },
}

nodes[impl_ix:impl_ix + 1] = [fork, template, join_node]

rewired = []
for e in edges:
    if e["from"] == IMPL:
        e = {**e, "from": JOIN}
    elif e["to"] == IMPL:
        # A gate's failure re-enters at the JOIN: re-entering the fork would redo every table
        # blindly, and a gate cannot legally re-enter the region itself.
        e = {**e, "to": JOIN if kinds.get(e["from"]) == "gate" else FAN}
    rewired.append(e)

# The list must be CARRIED on the edge into the fork, or it arrives undefined.
for e in rewired:
    if e["to"] == FAN and e["from"] == PLAN:
        e["carry"] = sorted(set(e.get("carry", []) + [FIELD]))

rewired.append({"from": FAN, "to": TPL, "when": "always"})
rewired.append({"from": TPL, "to": JOIN, "when": "always", "carry": ["table", "notes"]})

seed["nodes"], seed["edges"] = nodes, rewired
seed["goal"] = "Migrate every generated table module to timezone-aware UTC timestamps."
seed["name"] = "utcstamps"
caps = seed.setdefault("invariants", {}).setdefault("visitCaps", {})
caps[TPL] = 3
caps[JOIN] = 4

json.dump(seed, open(".loom/utcstamps.graph.json", "w"), indent=2)
print("wrote .loom/utcstamps.graph.json")
PY

# Self-check: the oracle must not teach a shape the validator rejects.
node --input-type=module -e "
import { validateGraph, messages } from '${SKILL}/scripts/graph-core.mjs';
import { readFileSync } from 'node:fs';
const g = JSON.parse(readFileSync('.loom/utcstamps.graph.json', 'utf8'));
const v = validateGraph(g, null, null);
if (v.length) { console.error('ORACLE GRAPH IS INVALID:\n  - ' + messages(v).join('\n  - ')); process.exit(1); }
console.log('oracle graph validates clean');
"
