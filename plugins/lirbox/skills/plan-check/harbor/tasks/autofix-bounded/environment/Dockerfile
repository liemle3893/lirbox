# Task image for plan-check__autofix-bounded.
#
# BUILD INPUT: `COPY skill` installs a PRUNED copy of this skill for the agent, from
# environment/skill/ in this directory — derived, not tracked. Generate it with
#     node scripts/harbor-prep.mjs plan-check/autofix-bounded
# The prune strips evals/, harbor/ and arena/; shipping those hands the container its answer key.
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      git ca-certificates curl ripgrep \
    && rm -rf /var/lib/apt/lists/*

COPY skill /root/.claude/skills/plan-check

# The plan and the code it makes claims about. harbor 0.20 has no files/ convention (nothing in
# the package reads that path) and the build context is this directory, so both come in here.
#
# ONE tracked source, TWO destinations for the plan: /app/plan.md is the agent's input,
# /opt/fixture/plan.md is the pristine copy the verifier diffs against to prove autofix wrote a
# sibling instead of mutating what it audited.
COPY plan.md /app/plan.md
COPY plan.md /opt/fixture/plan.md
COPY repo /app/repo

RUN git init -q /app \
 && git -C /app config user.email harbor@local \
 && git -C /app config user.name harbor \
 && git -C /app add -A && git -C /app commit -q -m init

WORKDIR /app
