You are working in /app. Do every edit there.

NODE: Implement   (visit 1 of at most 4)

THIS RUN EXISTS TO: Add idempotency keys to POST /orders and POST /payments so a retried request
returns the original result instead of performing the work twice.

Add idempotency-key handling across three files.

1. `src/store/db.py` — add a module-level dict and two functions beside the existing
   put_order/put_payment helpers:
       get_idempotent(scope, key)          -> the stored response, or None
       put_idempotent(scope, key, response) -> None
   `scope` is the string "orders" or "payments", so the same client key used against both
   endpoints cannot collide. Key the dict on the (scope, key) tuple. Store the FULL response that
   was returned, because a replay must return the original result rather than re-derive it.
   Return None when `key` is None. Leave next_id, put_order, put_payment, count_orders and
   count_payments working exactly as they do today — other code depends on their signatures.

2. `src/api/http.py` — add one function:
       idempotency_key(request) -> the header value, or None
   It reads the "Idempotency-Key" header from the Request object defined in that same file.
   `request.headers` is a plain dict and may not contain it. Match the header name
   case-insensitively, and return None when it is absent or blank. Do not change the Request
   constructor's signature: both handlers construct it today.

3. `src/api/orders.py` and `src/api/payments.py` — make create_order (scope "orders") and
   create_payment (scope "payments") idempotent. Import the three helpers above; do not
   re-implement them. Read the key first. If a key is present and already stored for that scope,
   return the stored response and do NOT call next_id, put_order or put_payment — that second call
   is the double charge this exists to remove. If the key is present and unseen, do the work as it
   works today and store the response under the key before returning it. If no key is supplied,
   behave exactly as the current code does. Keep both handlers' return shape identical:
   json_response(201, {...}).

Done when a repeated call carrying the same Idempotency-Key returns the first response and creates
no second record, and a call with no key still creates one.

Commit your work on the branch.
