#!/bin/bash
# Reference solution. Does the REAL work the task asks for — invokes the conductor generator with
# prompts as data, exactly as the skill's own procedure prescribes — rather than writing a
# pre-baked file. That is the point of the oracle: if this drives the verifier to reward 1, the
# task is solvable and test.sh agrees with the instruction. If it does not, one of the two is wrong.
set -uo pipefail

GEN=/root/.claude/skills/conductor/scripts/scaffold-workflow.cjs
NAME=unhandled-rejection-audit

if [ ! -f "$GEN" ]; then
  echo "solve.sh: generator not found at $GEN — the task image did not vendor the skill" >&2
  exit 1
fi

# Work-phase prompts travel as DATA (--prompts-file), never hand-edited into the emitted script.
cat > /solution/prompts.json <<'JSON'
{
  "Audit": "Find every unhandled promise rejection in the service. Enumerate each one with its file, line and the awaited call that can reject. Write the ledger to audit/unhandled-rejections.json with one entry per finding.",
  "Fix": "For every entry in audit/unhandled-rejections.json, attach proper rejection handling on the path that can reject, and record the disposition ('fixed' or 'wontfix' plus a reason) back onto that entry.",
  "RegressionTests": "For every ledger entry with disposition 'fixed', add a regression test that fails without the fix and passes with it, asserting the rejection is handled rather than that the process survives."
}
JSON

mkdir -p /app/.workflows

node "$GEN" \
  --name "$NAME" \
  --phases "Audit,Fix,RegressionTests" \
  --prompts-file /solution/prompts.json \
  --out "/app/.workflows/${NAME}.js" \
  --force

echo "solve.sh: generated /app/.workflows/${NAME}.js"
