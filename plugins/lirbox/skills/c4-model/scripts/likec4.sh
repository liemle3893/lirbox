#!/bin/sh
# LikeC4 toolchain in a throwaway container — no host installs.
# The ONLY place the image is pinned; bump it here, then re-run the smoke check
# in SKILL.md step 5 before committing.
# Mounts $PWD at /data: run this from the directory CONTAINING the model dir,
# and pass paths relative to it.
set -eu
IMAGE="ghcr.io/likec4/likec4:1.58.0"
exec docker run --rm -v "$PWD:/data" "$IMAGE" "$@"
