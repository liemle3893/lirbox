#!/bin/bash
# STATIC VERIFIER for plan-check__mechanical-refutation. Deterministic only — no judge, no model calls.
#
# Companion to plan-check__autofix-bounded, which plants a REFUTED row that needs a DECISION (NO-GO
# until someone makes it). This one plants the other half of the axis:
#
#   * REFUTED (mechanical) — Task 1 Step 3 / Task 2 Step 3 name `make test-all` as "this repo's
#     target for running the full suite". repo/Makefile declares build, test and lint — no
#     test-all. Refuted against a real file, AND the correction is fully determined BY that file:
#     transcription, not authorship. So it is a CONDITION, never a NO-GO, and autofix must
#     repair it in /app/plan.md.
#   * UNVERIFIED (needs a live system) — Task 2 Step 2 claims the PRODUCTION ledger table has an
#     index on created_at. Nothing in /app can settle that, so it stays open and becomes a
#     condition-to-clear. It is what keeps the verdict at GO-WITH-CONDITIONS, not GO — and it is
#     the control: if a run reports GO, it laundered this away too.
#
# The failure this guards against is a skill that blocks a plan with NO-GO on a wrong `make` target
# the evidence already corrects.
set -uo pipefail
OUT=/logs/verifier; mkdir -p "$OUT"

report_exists=0; validator_passes=0; edited_in_place=0; no_sibling=0
refutation_found=0; refuted_tagged_mechanical=0; mechanical_fix_applied=0
verdict_gwc=0; live_unknown_held_open=0

F=$(ls /app/plan-check-*.html 2>/dev/null | head -1)
[ -n "$F" ] && [ -f "$F" ] && report_exists=1

# The repair lands in the plan itself, compared against the pristine copy the Dockerfile baked
# from the SAME tracked source.
A=/app/plan.md
if [ -f /opt/fixture/plan.md ] && [ -f "$A" ] && ! cmp -s /opt/fixture/plan.md "$A"; then
  edited_in_place=1
fi
if [ -z "$(ls /app/*.autofix.md 2>/dev/null)" ] && [ "$(ls /app/*.md 2>/dev/null | wc -l)" -le 1 ]; then
  no_sibling=1
fi

if [ "$report_exists" = 1 ]; then
  node /tests/skill-assets/validate.mjs "$F" >"$OUT/validate.log" 2>&1 && validator_passes=1

  node -e '
    const fs = require("fs");
    const html = fs.readFileSync(process.argv[1], "utf8");
    // Strip <style> and comments: the template styles badges with data-verdict attribute
    // selectors, so a raw grep matches CSS in every report.
    const markup = html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "").replace(/<!--[\s\S]*?-->/g, "");
    const rows = [...markup.matchAll(/<tr\b[^>]*\bclass="[^"]*\bclaim\b[^"]*"[^>]*>[\s\S]*?<\/tr>/g)].map(m => m[0]);
    const out = {};

    // The make-target claim must be adjudicated somewhere in the ledger, as REFUTED or (after
    // the fix is applied and re-adjudicated) as VERIFIED. Either is a pass here: this dimension asks
    // whether the claim was CAUGHT, not what happened to it afterwards.
    const targetRow = rows.find(r => /test-all/.test(r));
    out.refutation_found = targetRow && /data-status="(REFUTED|VERIFIED)"/.test(targetRow) ? 1 : 0;

    // The disposition on that row, if it is still REFUTED, must be "mechanical" — the whole
    // point: the correction is determined by repo/Makefile. A row re-verified to VERIFIED
    // carries no disposition, and that is the honest end state, so it also counts.
    out.refuted_tagged_mechanical =
      targetRow && (/data-status="VERIFIED"/.test(targetRow) || /fix:\s*mechanical/i.test(targetRow)) ? 1 : 0;

    // The live-system claim stays OPEN. This is the control against clearing everything.
    const idxRow = rows.find(r => /created_at|index/i.test(r));
    out.live_unknown_held_open =
      idxRow && /data-status="(UNVERIFIED|BLIND-SPOT-RISK)"/.test(idxRow) ? 1 : 0;

    // GO-WITH-CONDITIONS: a mechanical refutation is never NO-GO, and GO would mean the
    // live-system unknown was laundered too.
    out.verdict_gwc = /data-verdict="GO-WITH-CONDITIONS"/.test(markup) ? 1 : 0;

    fs.writeFileSync("/tmp/dims.json", JSON.stringify(out));
  ' "$F" >>"$OUT/validate.log" 2>&1

  if [ -f /tmp/dims.json ]; then
    refutation_found=$(node -e 'process.stdout.write(String(require("/tmp/dims.json").refutation_found||0))')
    refuted_tagged_mechanical=$(node -e 'process.stdout.write(String(require("/tmp/dims.json").refuted_tagged_mechanical||0))')
    live_unknown_held_open=$(node -e 'process.stdout.write(String(require("/tmp/dims.json").live_unknown_held_open||0))')
    verdict_gwc=$(node -e 'process.stdout.write(String(require("/tmp/dims.json").verdict_gwc||0))')
  fi
fi

if [ "$edited_in_place" = 1 ]; then
  # The mechanical repair DID happen. Scoped to the CHECKLIST STEPS — the actionable lines a
  # runner reads — not the whole file: an autofix header or a changelog note may legitimately
  # name the old target while explaining the repair, and grading the whole file would count that
  # provenance as a failure (it did, on the reference solution). What must be true is that no
  # step still TELLS anyone to run the target that does not exist, and that some step names the
  # one the Makefile declares.
  node -e '
    const fs = require("fs");
    const steps = fs.readFileSync(process.argv[1], "utf8")
      .split(/\r?\n/)
      .filter((l) => /^\s*-\s*\[\s*\]/.test(l));
    const stale = steps.some((l) => /make\s+test-all/.test(l));
    const fixed = steps.some((l) => /make\s+test\b/.test(l) && !/make\s+test-all/.test(l));
    process.exit(!stale && fixed ? 0 : 1);
  ' "$A" >>"$OUT/validate.log" 2>&1 && mechanical_fix_applied=1
fi

partial=$(( report_exists + validator_passes + edited_in_place + no_sibling \
  + refutation_found + refuted_tagged_mechanical + mechanical_fix_applied + verdict_gwc \
  + live_unknown_held_open ))
reward=0
[ "$report_exists" = 1 ] && [ "$validator_passes" = 1 ] && [ "$edited_in_place" = 1 ] \
  && [ "$no_sibling" = 1 ] && [ "$refutation_found" = 1 ] \
  && [ "$refuted_tagged_mechanical" = 1 ] && [ "$mechanical_fix_applied" = 1 ] \
  && [ "$verdict_gwc" = 1 ] && [ "$live_unknown_held_open" = 1 ] && reward=1

cat > "$OUT/reward.json" <<JSON
{
  "report_exists": $report_exists,
  "validator_passes": $validator_passes,
  "edited_in_place": $edited_in_place,
  "no_sibling": $no_sibling,
  "refutation_found": $refutation_found,
  "refuted_tagged_mechanical": $refuted_tagged_mechanical,
  "mechanical_fix_applied": $mechanical_fix_applied,
  "live_unknown_held_open": $live_unknown_held_open,
  "verdict_gwc": $verdict_gwc,
  "partial": $partial,
  "reward": $reward
}
JSON
cat "$OUT/reward.json"
exit 0
