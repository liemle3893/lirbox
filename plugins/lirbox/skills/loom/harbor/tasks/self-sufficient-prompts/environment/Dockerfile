# Task image for loom__self-sufficient-prompts.
#
# BUILD INPUT: the `COPY skill` below installs a PRUNED copy of this skill for the agent, from
# environment/skill/ in this directory. That copy is derived, not tracked — generate it with
#     node scripts/harbor-prep.mjs loom/self-sufficient-prompts
# before running the task. The prune strips evals/, harbor/ and arena/; shipping those would hand
# the container the graders it is scored against.
#
# python3 is present for rewardkit (installed at verify time by tests/test.sh via uvx, never baked
# into the image — test-only deps stay out of the image per Harbor convention).
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      git ca-certificates curl ripgrep python3 \
    && rm -rf /var/lib/apt/lists/*

# Installed as a PERSONAL skill so the Skill tool resolves it by the bare name "loom",
# which is what instruction.md instructs the agent to use.
COPY skill /root/.claude/skills/loom

# A real (tiny) service to plan against. The graded criteria require every work-node prompt to name
# a file that actually exists, so the files have to be here and have to be worth naming: two
# non-idempotent write endpoints, a shared store, and the HTTP shim they both route through.
RUN mkdir -p /app/src/api /app/src/store
WORKDIR /app

RUN printf '%s\n' \
  '"""In-memory persistence. No request-level deduplication of any kind."""' \
  '' \
  '_ORDERS = {}' \
  '_PAYMENTS = {}' \
  '_SEQ = {"n": 0}' \
  '' \
  'def next_id(prefix):' \
  '    _SEQ["n"] += 1' \
  '    return f"{prefix}_{_SEQ[chr(110)]}"' \
  '' \
  'def put_order(order_id, payload):' \
  '    _ORDERS[order_id] = payload' \
  '    return _ORDERS[order_id]' \
  '' \
  'def put_payment(payment_id, payload):' \
  '    _PAYMENTS[payment_id] = payload' \
  '    return _PAYMENTS[payment_id]' \
  '' \
  'def get_order(order_id):' \
  '    return _ORDERS.get(order_id)' \
  > /app/src/store/db.py

RUN printf '%s\n' \
  '"""Minimal request shim. Every handler receives one of these."""' \
  '' \
  'class Request:' \
  '    def __init__(self, body, headers=None):' \
  '        self.body = body' \
  '        self.headers = headers or {}' \
  '' \
  'def json_response(status, payload):' \
  '    return (status, payload)' \
  > /app/src/api/http.py

RUN printf '%s\n' \
  'from src.api.http import json_response' \
  'from src.store.db import next_id, put_order' \
  '' \
  '' \
  'def create_order(request):' \
  '    """POST /orders. Retried by the client on timeout, and creates a NEW order every time."""' \
  '    order_id = next_id("ord")' \
  '    record = put_order(order_id, {"items": request.body["items"], "total": request.body["total"]})' \
  '    return json_response(201, {"id": order_id, "order": record})' \
  > /app/src/api/orders.py

RUN printf '%s\n' \
  'from src.api.http import json_response' \
  'from src.store.db import next_id, put_payment' \
  '' \
  '' \
  'def create_payment(request):' \
  '    """POST /payments. Charges the card. A retry charges it again."""' \
  '    payment_id = next_id("pay")' \
  '    record = put_payment(payment_id, {"order": request.body["order"], "amount": request.body["amount"]})' \
  '    return json_response(201, {"id": payment_id, "payment": record})' \
  > /app/src/api/payments.py

# loom's Setup node runs git and expects a working tree.
RUN git init -q /app \
 && git -C /app config user.email harbor@local \
 && git -C /app config user.name harbor \
 && git -C /app add -A \
 && git -C /app commit -q -m "init: non-idempotent order and payment endpoints"
