# Task image for loom__scaffold-backedge.
#
# BUILD INPUT: the `COPY skill` below installs a PRUNED copy of this skill for the agent, from
# environment/skill/ in this directory. That copy is derived, not tracked — generate it with
#     node scripts/harbor-prep.mjs loom/scaffold-backedge
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

# A real (tiny) service to plan against. loom's Plan node reads the repo, and a graph authored
# against an empty directory is authored against nothing — the instruction names route modules and
# a session store, so they have to exist.
RUN mkdir -p /app/src/routes /app/src/auth
WORKDIR /app

RUN printf '%s\n' \
  'from src.auth.session import load_session' \
  '' \
  'def me(request):' \
  '    session = load_session(request.cookies.get("sid"))' \
  '    return {"user": session["user"]} if session else (401, "unauthorized")' \
  > /app/src/routes/profile.py

RUN printf '%s\n' \
  'from src.auth.session import load_session' \
  '' \
  'def list_orders(request):' \
  '    session = load_session(request.cookies.get("sid"))' \
  '    if not session:' \
  '        return (401, "unauthorized")' \
  '    return {"orders": [], "user": session["user"]}' \
  > /app/src/routes/orders.py

RUN printf '%s\n' \
  '# Deprecated cookie-backed session store. Every route still reads through this.' \
  '_SESSIONS = {}' \
  '' \
  'def load_session(sid):' \
  '    return _SESSIONS.get(sid)' \
  '' \
  'def create_session(sid, user):' \
  '    _SESSIONS[sid] = {"user": user}' \
  '    return _SESSIONS[sid]' \
  > /app/src/auth/session.py

RUN printf '%s\n' \
  'from src.auth.session import create_session' \
  '' \
  'def login(request):' \
  '    user = request.form["user"]' \
  '    create_session(request.sid, user)' \
  '    return {"ok": True, "user": user}' \
  '' \
  'def refresh(request):' \
  '    return {"ok": True}' \
  > /app/src/routes/login.py

# loom's Setup node runs git and expects a working tree.
RUN git init -q /app \
 && git -C /app config user.email harbor@local \
 && git -C /app config user.name harbor \
 && git -C /app add -A \
 && git -C /app commit -q -m "init: cookie-session auth service"
