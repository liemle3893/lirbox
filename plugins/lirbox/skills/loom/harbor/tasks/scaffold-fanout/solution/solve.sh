#!/bin/bash
# Reference solution: what a correct authored graph looks like for THIS goal.
#
# Real derivation, not a pre-baked drop: it starts from the shipped delivery seed and patches it
# the way the instruction requires, so the oracle stays honest if the seed changes shape.
#
# The patch that matters: the seed's single Implement node becomes a concurrent region — one
# branch per exporter, joined at a reconcile node — and both gates re-enter at that join rather
# than inside a branch, so the privacy review sees all three exporters together.
set -euo pipefail

# Overridable so the graders can be dry-run on the host before paying for a container build.
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
# The IMPLEMENTATION node specifically — the work node between planning and the first gate, not
# merely "the first work node that isn't Setup", which picks up DoDBaseline.
impl_ix, impl = next(
    (i, n) for i, n in enumerate(nodes)
    if n.get("kind") == "work" and plan_ix < i < gate_ix
)
IMPL = impl["id"]

FAN, JOIN = "FanExporters", "Reconcile"
BRANCHES = [
    ("CsvRedact", "src/exporters/csv_export.py", "the header row is emitted separately from the body"),
    ("PdfRedact", "src/exporters/pdf_export.py", "column widths are precomputed, so dropping a column shifts the layout"),
    ("XlsxRedact", "src/exporters/xlsx_export.py", "cells are addressed by absolute column index"),
]

fork = {"id": FAN, "kind": "fork", "join": JOIN}
branch_nodes = [
    {
        "id": bid,
        "kind": "work",
        "prompt": (
            f"Thread `redact=True` from src/report.py into {path} so the PII columns "
            f"(email, phone, ssn) are omitted from its output.\n\n"
            f"This exporter's quirk: {quirk} — the redacted output must stay well-formed for THIS "
            f"format, not merely have the columns deleted.\n\n"
            f"Touch ONLY {path} (plus the shared signature in src/report.py if it is not already "
            f"threaded). The other two exporters are being changed CONCURRENTLY by sibling "
            f"branches of this run: editing them here would collide with work in flight."
        ),
        "schema": {
            "type": "object",
            "properties": {"exporter": {"type": "string"}, "notes": {"type": "string"}},
            "required": ["exporter", "notes"],
        },
    }
    for bid, path, quirk in BRANCHES
]
join_node = {
    "id": JOIN,
    "kind": "work",
    "prompt": (
        "All three exporters have been redacted concurrently. Reconcile them: confirm the three "
        "outputs agree on WHICH columns are dropped and that each remains valid for its own "
        "format, and resolve any inconsistency between them.\n\n"
        "Your carry arrives keyed by branch — read every branch's notes before deciding, since a "
        "redaction bug in this codebase is usually a disagreement BETWEEN formats rather than a "
        "fault in any one of them."
    ),
    "schema": {
        "type": "object",
        "properties": {"reconciled": {"type": "boolean"}, "notes": {"type": "string"}},
        "required": ["reconciled", "notes"],
    },
}

# Splice the region in where Implement was, preserving node ORDER: every back-edge target must
# still sort before the gate that routes to it.
nodes[impl_ix:impl_ix + 1] = [fork] + branch_nodes + [join_node]

rewired = []
for e in edges:
    if e["from"] == IMPL:            # Implement's onward edge now leaves the join
        e = {**e, "from": JOIN}
    elif e["to"] == IMPL:            # everything that fed Implement now enters the fork...
        # ...except a GATE's failing edge, which must land on the join: a gate re-entering a
        # branch would re-run one exporter in isolation, and re-entering the fork would redo all
        # three blindly. The join is where a cross-format finding can actually be acted on.
        e = {**e, "to": JOIN if kinds.get(e["from"]) == "gate" else FAN}
    rewired.append(e)

# The fork's own out-edges: unconditional, one per branch. Every branch always runs.
rewired += [{"from": FAN, "to": b["id"], "when": "always"} for b in branch_nodes]
# ...and each branch closes into the join, carrying what it did so the join can reconcile.
rewired += [{"from": b["id"], "to": JOIN, "when": "always", "carry": ["exporter", "notes"]}
            for b in branch_nodes]

seed["nodes"], seed["edges"] = nodes, rewired
seed["goal"] = "Add a redaction mode to the csv/pdf/xlsx exporters, concurrently, then reconcile."
seed["name"] = "redact"
caps = seed.setdefault("invariants", {}).setdefault("visitCaps", {})
for b in branch_nodes:
    caps[b["id"]] = 3
caps[JOIN] = 4

json.dump(seed, open(".loom/redact.graph.json", "w"), indent=2)
print("wrote .loom/redact.graph.json")
PY

# Self-check: the oracle must not teach a shape the validator rejects. `prev=null` because this
# graph has not been through the approval freeze — the run's own step 3 stamps lockedHash.
node --input-type=module -e "
import { validateGraph } from '${SKILL}/scripts/graph-core.mjs';
import { readFileSync } from 'node:fs';
const g = JSON.parse(readFileSync('.loom/redact.graph.json', 'utf8'));
const v = validateGraph(g, null, null);
if (v.length) { console.error('ORACLE GRAPH IS INVALID:\n  - ' + v.join('\n  - ')); process.exit(1); }
console.log('oracle graph validates clean');
"
