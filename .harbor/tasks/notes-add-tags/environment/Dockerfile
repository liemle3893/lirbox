FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      git ca-certificates curl ripgrep \
    && rm -rf /var/lib/apt/lists/*

# The fixture arrives as a git bundle pinned to a sha, mirroring the arena
# suite. Cloning from a local bundle keeps the commit frozen and fetches
# nothing from the network at build time.
COPY data/repo.bundle /tmp/repo.bundle
RUN git clone /tmp/repo.bundle /app && rm /tmp/repo.bundle
WORKDIR /app
