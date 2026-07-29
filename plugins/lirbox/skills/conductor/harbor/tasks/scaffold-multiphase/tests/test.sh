#!/bin/bash
# Verifier entry point. All grading logic lives in the criteria directories beside this file:
#   reward/   — deterministic checks on the GENERATED FILE  -> reward.json key "reward"
#   quality/  — claude-code agent judge, semantic           -> reward.json key "quality"
#
# Each subdirectory becomes its own reward key, which is what keeps the stochastic judge from
# gating: Harbor scores the task on "reward", and "reward" is the deterministic directory alone.
# Deliberately NO tests/reward.toml — a [[reward]] aggregation would fold "quality" into "reward"
# and make keep/revert in the whetstone loop depend on a judge's coin flip.
#
# rewardkit writes both reward.json and reward-details.json; `harbor view` renders the latter under
# Verifier Logs -> Rewards as a collapsible per-criterion tree, so a failure reads as "which check
# and why" without us hand-rolling a report.
set -uo pipefail

# Test-only dependency, installed HERE and never baked into the image (Harbor task convention).
export HOME="${HOME:-/root}"
if ! command -v uvx >/dev/null 2>&1; then
  curl -LsSf https://astral.sh/uv/0.9.7/install.sh | sh >/dev/null 2>&1
  # shellcheck disable=SC1091
  [ -f "$HOME/.local/bin/env" ] && . "$HOME/.local/bin/env"
fi

uvx --with harbor-rewardkit@0.1 rewardkit /tests
rc=$?

# rewardkit writes /logs/verifier/reward.json itself. If it could not run at all, Harbor would fail
# the trial with RewardFileNotFoundError and we would not know why — so leave a zeroed reward plus a
# breadcrumb instead of an empty directory.
if [ ! -s /logs/verifier/reward.json ]; then
  echo "rewardkit did not produce reward.json (exit $rc) — see rewardkit.log" >&2
  mkdir -p /logs/verifier
  printf '{"reward": 0}\n' > /logs/verifier/reward.json
fi
exit 0
