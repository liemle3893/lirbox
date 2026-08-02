# Task image for conductor__scaffold-multiphase.
#
# BUILD INPUT: the `COPY skill` below installs a PRUNED copy of this skill for the agent, from
# environment/skill/ in this directory. That copy is derived, not tracked — generate it with
#     node scripts/harbor-prep.mjs conductor/<task-id>
# before running the task. The prune strips evals/, harbor/ and arena/; shipping those would hand
# the container the graders it is scored against.
#
# python3 is present for rewardkit (installed at verify time by tests/test.sh via uvx, never baked
# into the image — test-only deps stay out of the image per Harbor convention).
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      git ca-certificates curl ripgrep python3 \
    && rm -rf /var/lib/apt/lists/*

# Installed as a PERSONAL skill so the Skill tool resolves it by the bare name "conductor",
# which is what harness.md instructs the agent to use.
COPY skill /root/.claude/skills/conductor

# The agent scaffolds into a git repo: conductor's own Setup phase runs `git rev-parse`, and a
# scaffold-only run still expects /app to be a working tree.
RUN mkdir -p /app \
 && git init -q /app \
 && git -C /app config user.email harbor@local \
 && git -C /app config user.name harbor \
 && git -C /app commit -q --allow-empty -m init

WORKDIR /app
