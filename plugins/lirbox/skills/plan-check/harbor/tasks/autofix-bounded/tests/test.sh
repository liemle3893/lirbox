#!/bin/bash
# STATIC VERIFIER for plan-check__autofix-bounded. Deterministic only — no judge, no model calls.
#
# The plan under test plants one of each class:
#   * REFUTED (needs-decision) — Task 1 Step 1 claims Run "already calls w.recordDelivery(...)
#     immediately after the finalize UPDATE". repo/internal/schedules/worker.go contains no such
#     call at all. Refutable against real files, so the verdict must be NO-GO.
#   * MECHANICAL — Task 2 declares "Consumes: nothing" while its own Step 2 says to do it only
#     after Task 1 has landed. The edge is already stated by the plan; declaring it is
#     transcription, not authorship.
#
# What is actually being graded is the BOUNDARY, not the repair:
#   the input is never mutated · the mechanical row IS fixed · the REFUTED row is NOT
#   (a laundered REFUTED makes the plan read as verified when its model of the code is wrong).
set -uo pipefail
OUT=/logs/verifier; mkdir -p "$OUT"

report_exists=0; validator_passes=0; verdict_no_go=0
original_untouched=0; autofix_emitted=0; refuted_not_laundered=0; mechanical_fixed=0

F=$(ls /app/plan-check-*.html 2>/dev/null | head -1)
[ -n "$F" ] && [ -f "$F" ] && report_exists=1

# The input plan is evidence, not a workspace. Byte-compared against the pristine copy the
# Dockerfile baked from the SAME tracked source, so there is no second copy to drift.
if [ -f /opt/fixture/plan.md ] && cmp -s /opt/fixture/plan.md /app/plan.md; then
  original_untouched=1
fi

# The repair lands in a sibling. Any *.autofix.md counts — the skill names it
# <plan>.autofix.md but the slug is not worth pinning.
A=$(ls /app/*.autofix.md 2>/dev/null | head -1)
[ -n "$A" ] && [ -f "$A" ] && autofix_emitted=1

if [ "$report_exists" = 1 ]; then
  node /tests/skill-assets/validate.mjs "$F" >"$OUT/validate.log" 2>&1 && validator_passes=1
  # Strip <style> before matching: the template styles the badge with
  # .verdict[data-verdict="..."] attribute selectors, so a raw grep matches CSS in every report.
  node -e '
    const html = require("fs").readFileSync(process.argv[1], "utf8");
    const markup = html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "").replace(/<!--[\s\S]*?-->/g, "");
    process.exit(/data-verdict="NO-GO"/.test(markup) ? 0 : 1);
  ' "$F" >>"$OUT/validate.log" 2>&1 && verdict_no_go=1
fi

if [ "$autofix_emitted" = 1 ]; then
  # THE anti-laundering assertion. The refuted sentence must survive VERBATIM in the autofixed
  # plan: autofix may not quietly rewrite a claim whose model of the code was wrong, because the
  # result reads as a verified plan and nothing re-checked it. Matched as a fixed string.
  grep -qF 'already calls `w.recordDelivery(ctx, tg, status)` for every target' "$A" \
    && refuted_not_laundered=1

  # The mechanical repair DID happen: Task 2's own Interfaces block now names Task 1, instead of
  # leaving the edge stranded in step prose. Scoped to the Task 2 section so a mention anywhere
  # else in the document cannot satisfy it.
  node -e '
    const fs = require("fs");
    const md = fs.readFileSync(process.argv[1], "utf8");
    const sec = md.split(/^###\s+/m).find((s) => /^Task 2\b/.test(s)) || "";
    const iface = (sec.split(/^\s*-\s*\[\s*\]/m)[0] || "");
    // The edge must be declared where a runner reads it, and must name Task 1.
    process.exit(/consumes/i.test(iface) && /task\s*1/i.test(iface) ? 0 : 1);
  ' "$A" >>"$OUT/validate.log" 2>&1 && mechanical_fixed=1
fi

partial=$(( report_exists + validator_passes + verdict_no_go + original_untouched + autofix_emitted + refuted_not_laundered + mechanical_fixed ))
reward=0
[ "$report_exists" = 1 ] && [ "$validator_passes" = 1 ] && [ "$verdict_no_go" = 1 ] \
  && [ "$original_untouched" = 1 ] && [ "$autofix_emitted" = 1 ] \
  && [ "$refuted_not_laundered" = 1 ] && [ "$mechanical_fixed" = 1 ] && reward=1

cat > "$OUT/reward.json" <<JSON
{
  "report_exists": $report_exists,
  "validator_passes": $validator_passes,
  "verdict_no_go": $verdict_no_go,
  "original_untouched": $original_untouched,
  "autofix_emitted": $autofix_emitted,
  "refuted_not_laundered": $refuted_not_laundered,
  "mechanical_fixed": $mechanical_fixed,
  "partial": $partial,
  "reward": $reward
}
JSON
cat "$OUT/reward.json"
exit 0
