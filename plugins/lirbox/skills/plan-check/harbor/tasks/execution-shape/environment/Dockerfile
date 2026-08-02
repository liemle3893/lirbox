# Task image for plan-check__execution-shape.
#
# BUILD INPUT: the `COPY skill` below installs a PRUNED copy of this skill for the agent, from
# environment/skill/ in this directory. That copy is derived, not tracked — generate it with
#     node scripts/harbor-prep.mjs plan-check/execution-shape
# before running the task. The prune strips evals/, harbor/ and arena/; shipping those would hand
# the container the graders it is scored against.
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      git ca-certificates curl ripgrep \
    && rm -rf /var/lib/apt/lists/*

# Installed as a PERSONAL skill so the Skill tool resolves it by the bare name "plan-check",
# which is what instruction.md tells the agent to use.
COPY skill /root/.claude/skills/plan-check

# The plan under test. It lives HERE, in the build context, not in a sibling files/ directory:
# harbor 0.20 has no files/ convention (nothing in the package reads that path), and the docker
# build context is this directory anyway, so a `COPY files/plan.md` fails outright.
#
# ONE tracked source, TWO destinations. /app/plan.md is the agent's input; /opt/fixture/plan.md
# is the pristine copy the verifier diffs against to prove the agent did not edit the plan it
# was asked to check (plan-check is read-only by contract). Copying the same file twice keeps
# byte-equality checkable with no second tracked copy to drift.
COPY plan.md /app/plan.md
COPY plan.md /opt/fixture/plan.md
WORKDIR /app
