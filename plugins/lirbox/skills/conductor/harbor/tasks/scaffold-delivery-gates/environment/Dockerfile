# Task image for conductor__scaffold-multiphase.
#
# ASSEMBLY REQUIREMENT: the `COPY skill` below needs a pruned copy of
# plugins/lirbox/skills/conductor/ at environment/skill/ in the build context. That copy is DERIVED,
# so it is not tracked — create it when you assemble .harbor/ (see CONTRIBUTING.md tier 3), and
# strip evals/, harbor/ and arena/ from it. Shipping those would hand the container the graders it
# is scored against.
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
