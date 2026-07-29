FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      git ca-certificates curl ripgrep python3 \
    && rm -rf /var/lib/apt/lists/*
# The conductor skill under test, installed as a personal skill so the Skill tool
# resolves it by the bare name "conductor" inside the sandbox.
COPY skill /root/.claude/skills/conductor
RUN mkdir -p /app && git init -q /app \
 && git -C /app config user.email harbor@local && git -C /app config user.name harbor \
 && git -C /app commit -q --allow-empty -m init
WORKDIR /app
