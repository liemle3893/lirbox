#!/bin/bash
# Reference implementation. Shared byte-for-byte by both variants: the graders are behavioural and
# name-agnostic, so one correct implementation satisfies either prompt.
set -euo pipefail
cd "${WORKSPACE:-/app}"

python3 - <<'PY'
import re, pathlib

db = pathlib.Path("src/store/db.py")
db.write_text(db.read_text() + '''

_IDEMPOTENT = {}

def get_idempotent(scope, key):
    if key is None:
        return None
    return _IDEMPOTENT.get((scope, key))

def put_idempotent(scope, key, response):
    if key is None:
        return None
    _IDEMPOTENT[(scope, key)] = response
    return None
''')

http = pathlib.Path("src/api/http.py")
http.write_text(http.read_text() + '''

def idempotency_key(request):
    headers = getattr(request, "headers", None) or {}
    for name, value in headers.items():
        if str(name).lower() == "idempotency-key":
            value = (value or "").strip()
            return value or None
    return None
''')

for path, fn, scope, store in (
    ("src/api/orders.py", "create_order", "orders", "put_order"),
    ("src/api/payments.py", "create_payment", "payments", "put_payment"),
):
    p = pathlib.Path(path)
    t = p.read_text()
    t = t.replace(
        "from src.api.http import json_response",
        "from src.api.http import json_response, idempotency_key",
    )
    t = t.replace(
        "from src.store.db import next_id, %s" % store,
        "from src.store.db import next_id, %s, get_idempotent, put_idempotent" % store,
    )
    # Insert the replay guard as the first statement of the handler body, after its docstring.
    m = re.search(r'(def %s\(request\):\n(?:    """.*?"""\n)?)' % fn, t, re.S)
    assert m, path
    guard = (
        '    _key = idempotency_key(request)\n'
        '    _hit = get_idempotent("%s", _key)\n'
        '    if _hit is not None:\n'
        '        return _hit\n' % scope
    )
    t = t[:m.end()] + guard + t[m.end():]
    # Store the response under the key on the way out.
    t = re.sub(r'\n    return json_response\((.*?)\)\n?$',
               '\n    _resp = json_response(\\1)\n'
               '    put_idempotent("%s", _key, _resp)\n'
               '    return _resp\n' % scope, t, flags=re.S)
    p.write_text(t)
print("implemented idempotency keys")
PY

git add -A && git commit -q -m "feat: idempotency keys on order and payment creation" || true
