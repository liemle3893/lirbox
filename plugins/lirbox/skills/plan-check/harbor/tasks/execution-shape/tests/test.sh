#!/bin/bash
# STATIC VERIFIER for plan-check__execution-shape. Deterministic only — no judge, no model calls.
#
# Grades two things the plan under test plants, both derivable from the plan's own text:
#   * a FILE COLLISION: Tasks 2 and 3 both modify server/internal/schedules/worker.go, and
#     neither declares the overlap. Task 3 says "Consumes: nothing".
#   * an UNDECLARED EDGE: Task 4's Interfaces block says "Consumes: nothing" while its own
#     Step 3 says "Run this after Task 2 has landed".
#
# Both findings must land as CLAIM ROWS, not as loose prose — a report that merely quotes the
# plan somewhere in its body has not adjudicated anything. Every content assertion below is
# scoped to the <tr class="claim"> blocks for exactly that reason.
set -uo pipefail
OUT=/logs/verifier; mkdir -p "$OUT"

report_exists=0; validator_passes=0; collision_reported=0
undeclared_edge_reported=0; fix_tags_present=0; verdict_not_go=0
plan_untouched=0

# The skill names its own report plan-check-<slug>.html; do not over-constrain the slug.
F=$(ls /app/plan-check-*.html 2>/dev/null | head -1)
[ -n "$F" ] && [ -f "$F" ] && report_exists=1

# The plan is an input, not a workspace. plan-check is read-only by contract (SKILL.md
# non-negotiable), so a run that "helpfully" repaired the plan has broken the skill's own rule
# even if the report is perfect.
#
# Byte-equality against the pristine copy the Dockerfile baked from the SAME tracked source
# (environment/plan.md -> /app/plan.md and /opt/fixture/plan.md), so there is no second copy to
# drift out of sync.
if [ -f /opt/fixture/plan.md ] && cmp -s /opt/fixture/plan.md /app/plan.md; then
  plan_untouched=1
fi

if [ "$report_exists" = 1 ]; then
  # 1. the report contract the skill ships its own validator for
  node /tests/skill-assets/validate.mjs "$F" >"$OUT/validate.log" 2>&1 && validator_passes=1

  # 2-4. content assertions, scoped to claim rows only
  node -e '
    const fs = require("fs");
    const html = fs.readFileSync(process.argv[1], "utf8");
    // Claim rows only: <tr class="claim" ...> ... </tr>. A finding must BE a row.
    const rows = [...html.matchAll(/<tr\b[^>]*\bclass="[^"]*\bclaim\b[^"]*"[^>]*>([\s\S]*?)<\/tr>/g)]
      .map((m) => m[0]);
    const text = rows.join("\n").replace(/<[^>]+>/g, " ");

    // The collided file, named in a row. Tasks 2 and 3 both modify it.
    const collision = /worker\.go/i.test(text);

    // The undeclared edge, named in a row: Task 4 depends on Task 2 despite declaring nothing.
    // Require BOTH task identifiers in ONE row, so a report listing every task somewhere in the
    // ledger cannot satisfy this by accident.
    const edge = rows.some((r) => {
      const t = r.replace(/<[^>]+>/g, " ");
      return /task\s*4/i.test(t) && /task\s*2/i.test(t);
    });

    // Open rows carry a fix disposition (SKILL.md step 7).
    const fixTags = /fix:\s*(mechanical|needs-decision)/i.test(html);

    // A plan carrying two undeclared structural defects cannot be a clean GO.
    // MUST strip <style> first: the template styles the badge with attribute selectors
    // (.verdict[data-verdict="GO"]{...}), so a raw grep matches CSS in every report ever
    // produced and this check reads 0 unconditionally — a false red that no agent can clear.
    // validate.mjs strips <style> for the same reason; keep the two in step.
    const markup = html
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "");
    const verdictNotGo = !/data-verdict="GO"/.test(markup);

    const out = { collision, edge, fixTags, verdictNotGo };
    fs.writeFileSync("/tmp/content.json", JSON.stringify(out));
    console.log(JSON.stringify(out));
  ' "$F" >>"$OUT/validate.log" 2>&1

  if [ -f /tmp/content.json ]; then
    grep -q '"collision":true' /tmp/content.json && collision_reported=1
    grep -q '"edge":true'      /tmp/content.json && undeclared_edge_reported=1
    grep -q '"fixTags":true'   /tmp/content.json && fix_tags_present=1
    grep -q '"verdictNotGo":true' /tmp/content.json && verdict_not_go=1
  fi
fi

partial=$(( report_exists + validator_passes + collision_reported + undeclared_edge_reported + fix_tags_present + verdict_not_go + plan_untouched ))
reward=0
[ "$report_exists" = 1 ] && [ "$validator_passes" = 1 ] && [ "$collision_reported" = 1 ] \
  && [ "$undeclared_edge_reported" = 1 ] && [ "$fix_tags_present" = 1 ] \
  && [ "$verdict_not_go" = 1 ] && [ "$plan_untouched" = 1 ] && reward=1

cat > "$OUT/reward.json" <<JSON
{
  "report_exists": $report_exists,
  "validator_passes": $validator_passes,
  "collision_reported": $collision_reported,
  "undeclared_edge_reported": $undeclared_edge_reported,
  "fix_tags_present": $fix_tags_present,
  "verdict_not_go": $verdict_not_go,
  "plan_untouched": $plan_untouched,
  "partial": $partial,
  "reward": $reward
}
JSON
cat "$OUT/reward.json"
exit 0
