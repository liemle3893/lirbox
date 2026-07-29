#!/bin/bash
# Verifier entry point. All grading logic lives in the criteria directories beside this file:
#   reward/   — deterministic checks on the GENERATED FILE  -> reward.json key "reward"
#   quality/  — claude-code agent judge, semantic           -> reward.json key "quality"
#
# Harbor scores the task on "reward", so "reward" must be the deterministic directory ALONE — a
# stochastic judge must never gate keep/revert in the whetstone loop. Deliberately NO
# tests/reward.toml: a [[reward]] aggregation would fold "quality" into "reward".
#
# Each dimension runs in its OWN rewardkit invocation, and that is load-bearing. Passing both
# directories to one invocation puts them in a single asyncio.TaskGroup, where ANY dimension raising
# aborts the whole run and no reward.json is written at all — zeroing a deterministic dimension that
# had passed. Measured twice on 2026-07-30: first via an overlayfs mount failure, then via a
# transient `API Error: 529 Overloaded` from the judge model, which cost a full paid agent run
# (reward 0.000 on a trial whose generated file was in fact correct). Directory layout separates
# SCORES; separate processes are what separate FAILURES.
#
# rewardkit writes reward.json + reward-details.json per invocation, always named that, always beside
# --output — hence one subdirectory each, merged at the end. `harbor view` renders the merged
# reward-details.json under Verifier Logs -> Rewards as a per-criterion tree with judge reasoning.
set -uo pipefail

V=/logs/verifier
mkdir -p "$V"

# Test-only dependency, installed HERE and never baked into the image (Harbor task convention).
export HOME="${HOME:-/root}"
if ! command -v uvx >/dev/null 2>&1; then
  curl -LsSf https://astral.sh/uv/0.9.7/install.sh | sh >/dev/null 2>&1
  # shellcheck disable=SC1091
  [ -f "$HOME/.local/bin/env" ] && . "$HOME/.local/bin/env"
fi

# `--from`, not `--with`: uvx resolves a --with argument as a PEP 508 requirement, where `pkg@0.1`
# means "path 0.1" and fails with "Expected path (/app/0.1) to end in a supported file extension".
# The pkg@version shorthand only works in uvx's TOOL position. --from names the distribution to
# install and `rewardkit` the entrypoint to run from it, which is what we actually want.
# Version pinned to the 0.1 line per the Harbor convention of pinning every test dependency.
rewardkit_run() { # $1 = tests subdir, $2 = output subdir
  mkdir -p "$V/$2"
  uvx --from 'harbor-rewardkit==0.1.*' rewardkit "/tests/$1" \
    --output "$V/$2/reward.json" 2>&1 | tee "$V/$2/rewardkit.log"
  return "${PIPESTATUS[0]}"
}

rewardkit_run reward deterministic
echo "deterministic dimension exit $?" >&2

# Retried, unlike the deterministic dimension: a judge failure here is usually a transient upstream
# 529 rather than a verdict, and rewardkit does not retry it itself (judges.py raises on a non-zero
# CLI exit inside its retry loop, so only PARSE failures get a second attempt). One extra attempt is
# far cheaper than discarding the agent run that produced the workspace.
for attempt in 1 2; do
  rewardkit_run quality quality
  rc=$?
  [ "$rc" -eq 0 ] && break
  echo "quality dimension attempt $attempt failed (exit $rc)" >&2
done

# Merge. A missing/failed quality run leaves the key absent rather than 0 — absent reads as "not
# measured", 0 reads as "judged bad", and conflating them is how a transient outage becomes a
# fake regression. reward defaults to 0 only if the deterministic run itself produced nothing.
python3 - <<'PY'
import json, pathlib, sys

V = pathlib.Path("/logs/verifier")

def load(sub, fname):
    try:
        return json.loads((V / sub / fname).read_text())
    except Exception:
        return None

det, qua = load("deterministic", "reward.json"), load("quality", "reward.json")
main = {"reward": (det or {}).get("reward", 0)}
if qua is not None and "reward" in qua:
    main["quality"] = qua["reward"]
else:
    print("quality dimension did not score; key omitted from reward.json", file=sys.stderr)
(V / "reward.json").write_text(json.dumps(main, indent=2))

# Both invocations name their inner key "reward" (flat layout default), so rename on the way in.
details = {}
for key, sub in (("reward", "deterministic"), ("quality", "quality")):
    d = load(sub, "reward-details.json")
    if d:
        details[key] = d.get("reward", d)
(V / "reward-details.json").write_text(json.dumps(details, indent=2))
print("merged reward.json:", json.dumps(main))
PY

# Harbor fails the trial with RewardFileNotFoundError on an empty verifier dir, which hides the
# cause. Leave a zeroed reward plus a breadcrumb instead.
if [ ! -s "$V/reward.json" ]; then
  echo "no reward.json after merge — see deterministic/rewardkit.log and quality/rewardkit.log" >&2
  printf '{"reward": 0}\n' > "$V/reward.json"
fi
exit 0
