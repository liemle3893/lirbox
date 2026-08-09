"""Behavioural checks on an implemented idempotency feature. Shared byte-for-byte by both
`worker-prompt-vague` and `worker-prompt-specific`.

WHY THIS PAIR EXISTS (2026-08-10). Measuring loom's cost showed it is dominated by
`turns x accumulated context`, and that an agent's own output is the largest accumulating term.
That raised a question the skill's design rests on but nobody had measured: does handing a worker a
SELF-SUFFICIENT node prompt — files, signatures, completion condition — make it cheaper than the
shape loom's seed actually ships ("Implement the goal in the worktree.")?

The two tasks are identical in every respect except `instruction.md`: same image, same repo, same
graders, same oracle. So a difference in turns, tokens or reward is attributable to prompt
specificity alone.

FAIRNESS RULE, and the reason this file drives only the public handlers: the specific prompt names
exact helper functions (get_idempotent / put_idempotent / idempotency_key) while the vague one
cannot. Asserting those names would hand the specific arm a free win and measure compliance rather
than capability. Every criterion below calls `create_order` / `create_payment` and counts records —
behaviour any correct implementation exhibits, whatever it named its internals.

EVERY CRITERION MUST FAIL ON THE UNTOUCHED REPO. An earlier draft split these into positive checks
(a repeat creates one record) and guard checks (two distinct keys create two). The guards passed on
the shipped non-idempotent code — nothing had to be built for "two different keys create two
records" to hold — which floored `-a nop` at 0.571 and would have let a do-nothing agent bank most
of the score. Each guard is therefore FOLDED INTO the positive case it guards: every criterion now
mixes repeated and unrepeated keys in one sequence, so a non-idempotent implementation overshoots
the expected count and a return-the-first-response-always implementation undershoots it.
"""

import json
import subprocess
import sys
from pathlib import Path

from rewardkit import criterion

# Each probe runs in a FRESH interpreter: the store is module-level state, so importing once and
# reusing it across criteria would let an earlier probe's records leak into a later one's counts.
PROBE = r"""
import sys, json
sys.path.insert(0, {ws!r})
from src.api.http import Request
from src.api.orders import create_order
from src.api.payments import create_payment
from src.store.db import count_orders, count_payments
out = {{}}
try:
{body}
except Exception as e:
    out["error"] = "%s: %s" % (type(e).__name__, e)
print("@@" + json.dumps(out))
"""


def _probe(workspace: Path, body: str):
    src = PROBE.format(ws=str(workspace), body=body)
    try:
        p = subprocess.run([sys.executable, "-c", src], capture_output=True, text=True,
                           timeout=60, cwd=str(workspace))
    except Exception:
        return None
    for line in (p.stdout or "").splitlines():
        if line.startswith("@@"):
            try:
                return json.loads(line[2:])
            except Exception:
                return None
    return None


@criterion(description="a repeated order with the same key is deduplicated, a different key is not")
def orders_deduplicate_by_key(workspace: Path) -> bool:
    """k1, k1, k2 -> exactly 2 orders.

    Non-idempotent code produces 3. Code that returns the first response for everything produces 1.
    """
    r = _probe(workspace, """
    create_order(Request({"items": ["a"]}, {"Idempotency-Key": "k1"}))
    create_order(Request({"items": ["a"]}, {"Idempotency-Key": "k1"}))
    create_order(Request({"items": ["b"]}, {"Idempotency-Key": "k2"}))
    out["orders"] = count_orders()
""")
    return bool(r and not r.get("error") and r.get("orders") == 2)


@criterion(description="the replay returns the ORIGINAL response, and a fresh key does not")
def orders_replay_returns_original(workspace: Path) -> bool:
    """Counting records is not enough: an implementation that suppresses the second write but
    returns a fresh or empty response still misleads any client that trusts the reply."""
    r = _probe(workspace, """
    h = {"Idempotency-Key": "k1"}
    a = create_order(Request({"items": ["a"]}, h))
    b = create_order(Request({"items": ["a"]}, h))
    c = create_order(Request({"items": ["a"]}, {"Idempotency-Key": "k2"}))
    out["replay_same"] = (a == b)
    out["fresh_differs"] = (a != c)
""")
    return bool(r and not r.get("error")
                and r.get("replay_same") is True and r.get("fresh_differs") is True)


@criterion(description="payments deduplicates too, not only orders")
def payments_deduplicate_by_key(workspace: Path) -> bool:
    r = _probe(workspace, """
    h = {"Idempotency-Key": "p1"}
    a = create_payment(Request({"amount": 10}, h))
    b = create_payment(Request({"amount": 10}, h))
    create_payment(Request({"amount": 20}, {"Idempotency-Key": "p2"}))
    out["payments"] = count_payments()
    out["same"] = (a == b)
""")
    return bool(r and not r.get("error") and r.get("payments") == 2 and r.get("same") is True)


@criterion(description="keyless requests are unaffected while keyed ones deduplicate")
def keyless_requests_unaffected(workspace: Path) -> bool:
    """k1, k1, no-key, no-key -> exactly 3 orders.

    Idempotency must not leak into requests that supplied no key: those still create every time.
    Non-idempotent code produces 4; code that dedupes keyless requests together produces 2.
    """
    r = _probe(workspace, """
    h = {"Idempotency-Key": "k1"}
    create_order(Request({"items": ["a"]}, h))
    create_order(Request({"items": ["a"]}, h))
    create_order(Request({"items": ["a"]}))
    create_order(Request({"items": ["a"]}))
    out["orders"] = count_orders()
""")
    return bool(r and not r.get("error") and r.get("orders") == 3)


@criterion(description="the same key on both endpoints does not collide across them")
def scopes_do_not_collide(workspace: Path) -> bool:
    """A single flat key->response map passes every criterion above and then serves an ORDER
    response to a payment retry — the subtlest way to get this wrong."""
    r = _probe(workspace, """
    h = {"Idempotency-Key": "shared"}
    o1 = create_order(Request({"items": ["a"]}, h))
    o2 = create_order(Request({"items": ["a"]}, h))
    p1 = create_payment(Request({"amount": 10}, h))
    p2 = create_payment(Request({"amount": 10}, h))
    out["orders"] = count_orders()
    out["payments"] = count_payments()
    out["o_dedup"] = (o1 == o2)
    out["p_dedup"] = (p1 == p2)
    out["cross"] = (o1 != p1)
""")
    return bool(r and not r.get("error")
                and r.get("orders") == 1 and r.get("payments") == 1
                and r.get("o_dedup") is True and r.get("p_dedup") is True
                and r.get("cross") is True)
