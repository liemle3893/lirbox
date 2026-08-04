#!/bin/bash
# STATIC VERIFIER for plan-check__goal-coverage. Deterministic only — no judge, no model calls.
#
# The fixture plans a real latency fix whose DoD is FULLY CHECKABLE and does not achieve the
# stated goal: the goal is end-to-end checkout responsiveness against a ~2s threshold, while every
# DoD criterion measures two Go microbenchmarks, the test suite and lint. Both benchmarks can
# improve 40%, everything can be green, and checkout can still take 4s. Green tests, wrong feature.
#
# DIMENSION DESIGN — the thing this task exists to get right. Three of the dimensions below are
# gated on the new feature existing (a baseline with no goal concept scores 0 by construction), so
# their lift measures the `if`, not the model. `gap_identified` is deliberately NOT gated: it asks
# only whether the report NAMES the mismatch anywhere in its ledger, which a baseline run can do
# in ordinary prose. That is the dimension carrying real evidence; read it first.
set -uo pipefail
OUT=/logs/verifier; mkdir -p "$OUT"

report_exists=0; report_valid_legacy=0; goal_stated=0
goal_coverage_adjudicated=0; gap_identified=0; plan_untouched=0

F=$(ls /app/plan-check-*.html 2>/dev/null | head -1)
[ -n "$F" ] && [ -f "$F" ] && report_exists=1

if [ -f /opt/fixture/plan.md ] && cmp -s /opt/fixture/plan.md /app/plan.md; then
  plan_untouched=1
fi

if [ "$report_exists" = 1 ]; then
  # NOT-WORSE dimension: the PRE-goal report contract, which both arms can satisfy. Grading the
  # baseline against the new validator would just re-measure "the baseline predates the change".
  node /tests/skill-assets/validate-legacy.mjs "$F" >"$OUT/validate-legacy.log" 2>&1 && report_valid_legacy=1

  node -e '
    const fs = require("fs");
    const html = fs.readFileSync(process.argv[1], "utf8");
    const markup = html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "").replace(/<!--[\s\S]*?-->/g, "");

    // GATED: needs the feature to exist at all.
    const goalEl = markup.match(/<([a-zA-Z]+)[^>]*\bid="goal"[^>]*>([\s\S]*?)<\/\1>/);
    const goalStated = !!goalEl && goalEl[2].replace(/<[^>]+>/g, "").replace(/goal:/i, "").trim().length > 15;
    const goalRow = /<tr\b[^>]*data-goal-coverage[^>]*>/.test(markup);

    // NOT GATED — the real evidence. Did the report NAME the mismatch, anywhere in the ledger?
    // A baseline run can satisfy this in ordinary prose; it needs no new markup.
    const rows = [...markup.matchAll(/<tr\b[^>]*\bclass="[^"]*\bclaim\b[^"]*"[^>]*>([\s\S]*?)<\/tr>/g)]
      .map((m) => m[0].replace(/<[^>]+>/g, " "));
    const gap = rows.some((t) =>
      /benchmark|micro|BenchmarkTaxLookup|BenchmarkReserve/i.test(t) &&
      /2 ?s\b|two seconds|end.to.end|abandon|checkout latency|user-visible|confirm button/i.test(t)
    );

    const out = { goalStated, goalRow, gap };
    fs.writeFileSync("/tmp/c.json", JSON.stringify(out));
    console.log(JSON.stringify(out));
  ' "$F" >>"$OUT/validate-legacy.log" 2>&1

  if [ -f /tmp/c.json ]; then
    grep -q '"goalStated":true' /tmp/c.json && goal_stated=1
    grep -q '"goalRow":true'    /tmp/c.json && goal_coverage_adjudicated=1
    grep -q '"gap":true'        /tmp/c.json && gap_identified=1
  fi
fi

partial=$(( report_exists + report_valid_legacy + goal_stated + goal_coverage_adjudicated + gap_identified + plan_untouched ))
reward=0
[ "$report_exists" = 1 ] && [ "$report_valid_legacy" = 1 ] && [ "$goal_stated" = 1 ] \
  && [ "$goal_coverage_adjudicated" = 1 ] && [ "$gap_identified" = 1 ] && [ "$plan_untouched" = 1 ] && reward=1

cat > "$OUT/reward.json" <<JSON
{
  "report_exists": $report_exists,
  "report_valid_legacy": $report_valid_legacy,
  "goal_stated": $goal_stated,
  "goal_coverage_adjudicated": $goal_coverage_adjudicated,
  "gap_identified": $gap_identified,
  "plan_untouched": $plan_untouched,
  "partial": $partial,
  "reward": $reward
}
JSON
cat "$OUT/reward.json"
exit 0
