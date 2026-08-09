# Task image for loom__worker-prompt-{vague,specific}. NO skill is installed: the agent plays the
# WORKER role, receiving one node prompt exactly as loom's conductor would hand it over. The two
# variants share this image byte-for-byte so the only variable is instruction.md.
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      git ca-certificates ripgrep python3 \
    && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /app/src/api /app/src/store /app/tests
WORKDIR /app

RUN printf '%s\n' \
  '"""In-memory persistence. No request-level deduplication of any kind."""' \
  '_ORDERS = {}' \
  '_PAYMENTS = {}' \
  '_SEQ = {"n": 0}' \
  '' \
  'def next_id(prefix):' \
  '    _SEQ["n"] += 1' \
  '    return "%s_%d" % (prefix, _SEQ["n"])' \
  '' \
  'def put_order(order_id, payload):' \
  '    _ORDERS[order_id] = payload' \
  '    return _ORDERS[order_id]' \
  '' \
  'def put_payment(payment_id, payload):' \
  '    _PAYMENTS[payment_id] = payload' \
  '    return _PAYMENTS[payment_id]' \
  '' \
  'def count_orders():' \
  '    return len(_ORDERS)' \
  '' \
  'def count_payments():' \
  '    return len(_PAYMENTS)' \
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
  '    """POST /orders. Retried by the client on timeout, creating a NEW order every time."""' \
  '    order_id = next_id("ord")' \
  '    record = put_order(order_id, {"items": request.body["items"]})' \
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
  '    record = put_payment(payment_id, {"amount": request.body["amount"]})' \
  '    return json_response(201, {"id": payment_id, "payment": record})' \
  > /app/src/api/payments.py

RUN touch /app/src/__init__.py /app/src/api/__init__.py /app/src/store/__init__.py
RUN git init -q /app && git -C /app config user.email h@l && git -C /app config user.name h \
 && git -C /app add -A && git -C /app commit -q -m "init: non-idempotent write endpoints"
