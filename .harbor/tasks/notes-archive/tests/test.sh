#!/bin/bash
set -uo pipefail
OUT=/logs/verifier
mkdir -p "$OUT"
cd /app || exit 1

if npm test >"$OUT/p2p.log" 2>&1; then P2P=1; else P2P=0; fi

PASSED=0
TOTAL=0
CRITERIA=""
for t in /tests/fail_to_pass/*.test.cjs; do
  [ -e "$t" ] || continue
  TOTAL=$((TOTAL + 1))
  key=$(basename "$t" .test.cjs)
  if node "$t" >>"$OUT/f2p.log" 2>&1; then
    PASSED=$((PASSED + 1))
    CRITERIA="$CRITERIA  \"f2p_${key}\": 1,"$'\n'
  else
    CRITERIA="$CRITERIA  \"f2p_${key}\": 0,"$'\n'
  fi
done

if [ "$TOTAL" -gt 0 ] && [ "$PASSED" -eq "$TOTAL" ] && [ "$P2P" -eq 1 ]; then
  RESOLVED=1
else
  RESOLVED=0
fi

if [ "$TOTAL" -gt 0 ]; then
  FRACTION=$(awk "BEGIN{printf \"%.4f\", $PASSED/$TOTAL}")
else
  FRACTION=0
fi

{
  echo "{"
  printf '%s' "$CRITERIA"
  echo "  \"p2p\": $P2P,"
  echo "  \"f2p_passed\": $PASSED,"
  echo "  \"f2p_total\": $TOTAL,"
  echo "  \"f2p_fraction\": $FRACTION,"
  echo "  \"reward\": $RESOLVED"
  echo "}"
} >"$OUT/reward.json"

cat "$OUT/reward.json"
exit 0
