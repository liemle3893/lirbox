# Task image for plan-check__goal-coverage.
#
# BUILD INPUT: `COPY skill` installs a PRUNED copy of this skill (environment/skill/, derived, not
# tracked). Generate with: node scripts/harbor-prep.mjs plan-check/goal-coverage
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      git ca-certificates curl ripgrep \
    && rm -rf /var/lib/apt/lists/*
COPY skill /root/.claude/skills/plan-check
# One tracked source, two destinations: the agent's input and the pristine copy the verifier diffs.
COPY plan.md /app/plan.md
COPY plan.md /opt/fixture/plan.md
RUN mkdir -p /app
WORKDIR /app
