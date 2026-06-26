#!/usr/bin/env bash
# whetstone Task 6 — DETERMINISTIC dry-run acceptance test (flowchart dogfood target).
#
# Deviation 2 (see implementation-notes/floordryrun.html): this script is run by a SUBAGENT
# that cannot invoke the Workflow tool, so it does NOT run the whetstone loop end-to-end.
# It asserts ONLY the deterministic, no-Workflow pieces — all of which must pass NOW:
#   (a) the FLOOR passes on the unmodified baseline;
#   (b) the Item-A acceptance-check is DISCRIMINATING (fails on baseline);
#   (c) the loop generates and parses (scaffold-improve --name flowchart → node --check);
#   (d) the full whetstone regression net is green.
#
# These four prove every piece the live loop depends on, EXCEPT the live fix/keep/revert
# orchestration itself — which is gated behind the Workflow tool and is therefore deferred
# to the MANUAL top-level step documented at the bottom of this file. We deliberately do NOT
# fix validate.mjs here: leaving the gap is the whole point of the dogfood — a future
# top-level whetstone run drives Item A green on its own.
#
# Run from the repo root:  bash plugins/lirbox/skills/whetstone/scripts/test-dryrun.sh
set -euo pipefail

# Resolve repo root from this script's location so it works from any cwd.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../../../../.." && pwd)"
cd "$ROOT"

FLOOR="plugins/lirbox/skills/flowchart/evals/run.mjs"
CHECK="plugins/lirbox/skills/flowchart/evals/checks/node-nonascii.check.mjs"
CHECK_BASELINE="plugins/lirbox/skills/whetstone/scripts/check-baseline.cjs"
SCAFFOLD="plugins/lirbox/skills/whetstone/scripts/scaffold-improve.cjs"
TEST_IMPROVE="plugins/lirbox/skills/whetstone/scripts/test-improve.cjs"
GEN_OUT="/tmp/wh-flowchart.js"

pass() { echo "  ok  — $1"; }
fail() { echo "  FAIL — $1" >&2; exit 1; }

echo "whetstone dry-run (deterministic pieces only):"

# (a) FLOOR passes on the unmodified baseline → exit 0.
echo "(a) floor passes on baseline:"
if node "$FLOOR" >/tmp/wh-floor.out 2>&1; then
  pass "node $FLOOR exited 0"
else
  cat /tmp/wh-floor.out >&2
  fail "floor did not pass on baseline (node $FLOOR exited non-zero)"
fi

# (b) Item-A acceptance-check is DISCRIMINATING (fails on the baseline skill) → exit 0 + DISCRIMINATING.
echo "(b) Item-A check is discriminating:"
if out="$(node "$CHECK_BASELINE" "node $CHECK" 2>&1)" && printf '%s' "$out" | grep -q '^DISCRIMINATING'; then
  pass "check-baseline printed DISCRIMINATING for the node-nonascii check"
else
  printf '%s\n' "$out" >&2
  fail "Item-A check is NOT discriminating (it must FAIL on baseline)"
fi

# (c) the loop generates + parses.
echo "(c) loop generates + parses:"
if node "$SCAFFOLD" --name flowchart --out "$GEN_OUT" --force >/tmp/wh-gen.out 2>&1 && node --check "$GEN_OUT"; then
  pass "scaffold-improve generated $GEN_OUT and node --check parsed it"
else
  cat /tmp/wh-gen.out >&2
  fail "loop did not generate/parse"
fi

# (d) the full regression net is green.
echo "(d) regression net is green:"
if node "$TEST_IMPROVE" >/tmp/wh-net.out 2>&1; then
  pass "node $TEST_IMPROVE exited 0"
else
  cat /tmp/wh-net.out >&2
  fail "regression net failed"
fi

echo
echo "DRY-RUN OK (deterministic pieces verified)."

# ---------------------------------------------------------------------------
# MANUAL — LIVE END-TO-END LOOP (top-level only; needs the Workflow tool).
# ---------------------------------------------------------------------------
# A subagent cannot invoke the Workflow tool, so the live fix→floor+check→keep/revert
# run is NOT executed here. To run it at the top level (a human / a top-level Claude
# session with the Workflow tool), do the following from the repo root:
#
#   1. Author the run config from the frozen backlog + checks (whetstone SKILL.md "setup"):
#        .improve/config/flowchart.json  with shape:
#          {
#            "skill": "flowchart",
#            "skillPath": "plugins/lirbox/skills/flowchart",
#            "editable": "plugins/lirbox/skills/flowchart/**",
#            "locked": ["plugins/lirbox/skills/flowchart/evals/**", "feedback/flowchart.jsonl"],
#            "floor": { "cmd": "python3 <skill-creator>/quick_validate.py plugins/lirbox/skills/flowchart && node plugins/lirbox/skills/flowchart/evals/run.mjs" },
#            "items": <the parsed lines of feedback/flowchart.jsonl>,
#            "budgets": { "agentCapSec": 600, "checkRetries": 2, "total": { "items": 2 } },
#            "baseline": null
#          }
#
#   2. Generate the loop (already proven by step (c) above):
#        node plugins/lirbox/skills/whetstone/scripts/scaffold-improve.cjs \
#          --name flowchart --out .improve/flowchart.js --force
#
#   3. Launch via the Workflow tool (NOT bash — this is the line a subagent cannot run):
#        Workflow({ scriptPath: ".improve/flowchart.js",
#                   args: { config: <contents of .improve/config/flowchart.json> } })
#
#   4. After it finishes, assert the verdicts on .improve/state/flowchart.json:
#        node -e "const s=require('./.improve/state/flowchart.json'); \
#          const v=id=>s.items.find(i=>i.id===id).verdict; \
#          if(v('node-nonascii')!=='kept')throw 'node-nonascii != kept'; \
#          if(!s.humanOnly.includes('prettier'))throw 'prettier not human-only'; \
#          console.log('LIVE DRY-RUN OK')"
#
#      Expected:
#        items[node-nonascii].verdict == "kept"  (validate.mjs now flags node labels; floor still green)
#        the floor-breaker control    == "reverted" (it must not break the edge characterization floor)
#        humanOnly == ["prettier"]    (excluded from the autonomous loop, reported)
#        branch improve/flowchart holds the kept validate.mjs node-label fix; main is byte-unchanged.
# ---------------------------------------------------------------------------
