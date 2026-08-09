#!/bin/bash
# Reference solution: what a correctly-instructed graph looks like for THIS goal.
#
# Real derivation, not a pre-baked drop: it starts from the shipped delivery seed and patches it
# the way the instruction requires, so the oracle stays honest if the seed changes shape.
#
# The patch that matters: the seed carries ONE work node between planning and the first gate
# ("Implement the goal in the worktree. Commit your work on the branch." — 67 characters, naming
# no file). This replaces it with three nodes whose prompts name their own files, the interface
# crossing between them, and the condition that makes each done.
set -euo pipefail

# Overridable so the graders can be dry-run on the host before paying for a container build.
SKILL="${SKILL:-/root/.claude/skills/loom}"
cd "${WORKSPACE:-/app}"
mkdir -p .loom

python3 - "$SKILL/scripts/seeds/delivery.json" <<'PY'
import json, sys

seed = json.load(open(sys.argv[1]))
nodes, edges = seed["nodes"], seed["edges"]

plan_ix = next(i for i, n in enumerate(nodes) if n.get("kind") == "plan")
gate_ix = min(i for i, n in enumerate(nodes) if n.get("kind") == "gate")
impl = next(
    n for i, n in enumerate(nodes)
    if n.get("kind") == "work" and plan_ix < i < gate_ix
)
impl_id = impl["id"]

STORE = (
    "Add idempotency-key storage to src/store/db.py.\n\n"
    "Create two module-level functions beside the existing put_order/put_payment helpers:\n"
    "  find_by_idempotency_key(scope: str, key: str) -> dict | None\n"
    "  save_idempotency_key(scope: str, key: str, response: dict) -> None\n"
    "`scope` is the string \"orders\" or \"payments\", so the same client key used against both "
    "endpoints cannot collide. Back them with a module-level dict keyed on the (scope, key) "
    "tuple, matching how _ORDERS and _PAYMENTS already work in that file. Store the FULL response "
    "payload that was returned to the client, because a replay has to return the original result "
    "byte-for-byte rather than re-derive it.\n\n"
    "Do not touch src/api/orders.py or src/api/payments.py in this node; two later nodes consume "
    "these functions and will import them from src.store.db.\n\n"
    "Done when both functions exist in src/store/db.py with those exact names and signatures, and "
    "a save followed by a find with the same scope and key returns the stored payload."
)

EXTRACT = (
    "Add idempotency-key extraction to src/api/http.py.\n\n"
    "Add one module-level function to that file:\n"
    "  idempotency_key(request) -> str | None\n"
    "It reads the \"Idempotency-Key\" header from the Request object defined in the same file "
    "(request.headers is a plain dict and may be missing the header entirely). Match the header "
    "name case-insensitively — clients send it in several casings — and return None when it is "
    "absent or blank so callers can distinguish \"no key supplied\" from a real key.\n\n"
    "Do not change the Request class's constructor signature: both handlers construct it today "
    "and a signature change breaks them.\n\n"
    "Done when idempotency_key() exists in src/api/http.py, returns the header value regardless of "
    "its casing, and returns None for a request whose headers dict has no such entry."
)

HANDLERS = (
    "Make the two write endpoints idempotent, in src/api/orders.py and src/api/payments.py.\n\n"
    "Consume the helpers the two earlier nodes added — find_by_idempotency_key and "
    "save_idempotency_key from src.store.db, and idempotency_key from src.api.http. Do not "
    "re-implement either; import them.\n\n"
    "In create_order (scope \"orders\") and create_payment (scope \"payments\"), read the key "
    "first. When a key is present and already stored for that scope, return the stored response "
    "unchanged and do NOT call next_id, put_order or put_payment — that second call is the double "
    "charge this whole run exists to remove. When the key is present and unseen, perform the work "
    "as it works today and save the response under the key before returning it. When no key is "
    "supplied, behave exactly as the current code does.\n\n"
    "Keep both handlers' return shape identical to what they return now: "
    "json_response(201, {...}). Existing clients parse it.\n\n"
    "Done when a repeated call with the same Idempotency-Key returns the first response and "
    "creates no second record, and a call without a key still creates one."
)

new_nodes = [
    {"id": "ImplementStore", "kind": "work", "prompt": STORE},
    {"id": "ImplementExtract", "kind": "work", "prompt": EXTRACT},
    {"id": "ImplementHandlers", "kind": "work", "prompt": HANDLERS},
]

# Splice the three in where the single Implement node was, preserving order.
ix = nodes.index(impl)
nodes[ix:ix + 1] = new_nodes

# Rewire: whatever pointed at Implement now points at the first of the three; the three run in
# sequence; whatever Implement pointed at is now reached from the last.
first, last = "ImplementStore", "ImplementHandlers"
for e in edges:
    if e.get("to") == impl_id:
        e["to"] = first
    if e.get("from") == impl_id:
        e["from"] = last
edges.append({"from": "ImplementStore", "to": "ImplementExtract", "when": "always"})
edges.append({"from": "ImplementExtract", "to": "ImplementHandlers", "when": "always"})

# Visit caps are keyed by node id; the seed's Implement entry no longer names anything.
caps = seed["invariants"].get("visitCaps") or {}
if impl_id in caps:
    cap = caps.pop(impl_id)
    for n in new_nodes:
        caps[n["id"]] = cap
seed["invariants"]["visitCaps"] = caps

seed["name"] = "idempotency-keys"
seed["goal"] = ("Add idempotency keys to POST /orders and POST /payments so a retried request "
                "returns the original result instead of charging twice.")
# lockedHash describes the SEED's frozen shape; this graph is deliberately not that shape.
seed["invariants"].pop("lockedHash", None)

json.dump(seed, open(".loom/idempotency-keys.graph.json", "w"), indent=2)
print("authored .loom/idempotency-keys.graph.json")
print("  implementation nodes:", [n["id"] for n in new_nodes])
for n in new_nodes:
    print(f"    {n['id']}: {len(n['prompt'])} chars")
PY
