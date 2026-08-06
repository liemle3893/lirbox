# Task image for loom__scaffold-runtime-fanout.
#
# BUILD INPUT: the `COPY skill` below installs a PRUNED copy of this skill for the agent, from
# environment/skill/ in this directory. That copy is derived, not tracked — generate it with
#     node scripts/harbor-prep.mjs loom/scaffold-runtime-fanout
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

# A real (tiny) service to plan against, whose table modules are GENERATED — the count is a
# property of the repo, not of the instruction, which is the whole point of this task. Five of
# them, so a model that hard-codes "three lanes" is visibly wrong and one that authors a bounded
# template is visibly right.
RUN mkdir -p /app/src/tables
WORKDIR /app

RUN for t in orders invoices shipments refunds sessions; do \
      printf '%s\n' \
        "import datetime" \
        "" \
        "TABLE = \"$t\"" \
        "" \
        "def stamp():" \
        "    # naive local time — the thing being migrated" \
        "    return datetime.datetime.now()" \
        "" \
        "def write(row):" \
        "    row[\"created_at\"] = stamp()" \
        "    return row" \
        > "/app/src/tables/$t.py"; \
    done

RUN printf '%s\n' \
  'import pkgutil, importlib' \
  '' \
  'def all_tables():' \
  '    import src.tables as pkg' \
  '    return [m.name for m in pkgutil.iter_modules(pkg.__path__)]' \
  > /app/src/registry.py
RUN touch /app/src/tables/__init__.py /app/src/__init__.py

# loom's Setup node runs git and expects a working tree.
RUN git init -q /app \
 && git -C /app config user.email harbor@local \
 && git -C /app config user.name harbor \
 && git -C /app add -A \
 && git -C /app commit -q -m "init: generated table modules with naive timestamps"
