#!/bin/bash
# STATIC VERIFIER for plan-check__mechanical-refutation. Deterministic only — no judge, no model calls.
#
# Companion to plan-check__autofix-bounded, which plants a REFUTED row that needs a DECISION and
# asserts the verdict does NOT move. This one plants the other half of the axis:
#
#   * REFUTED (mechanical) — Task 1 Step 3 / Task 2 Step 3 name `make test-all` as "this repo's
#     target for running the full suite". repo/Makefile declares build, test and lint — no
#     test-all. Refuted against a real file, AND the correction is fully determined BY that file:
#     transcription, not authorship. So autofix must repair it, re-verification must clear it,
#     and the verdict must move off NO-GO honestly.
#   * UNVERIFIED (needs a live system) — Task 2 Step 2 claims the PRODUCTION ledger table has an
#     index on created_at. Nothing in /app can settle that, so it stays open and becomes a
#     condition-to-clear. It is what keeps the cleared verdict at GO-WITH-CONDITIONS, not GO —
#     and it is the control: if a run reports GO, it laundered this away too.
#
# The failure this guards against is a skill that treats REFUTED as un-repairable by status,
# leaving a plan blocked on a wrong `make` target that the evidence already corrected.
set -uo pipefail
OUT=/logs/verifier; mkdir -p "$OUT"

report_exists=0; validator_passes=0; original_untouched=0; autofix_emitted=0
refutation_found=0; refuted_tagged_mechanical=0; mechanical_fix_applied=0
verdict_moved=0; live_unknown_held_open=0

F=$(ls /app/plan-check-*.html 2>/dev/null | head -1)
[ -n "$F" ] && [ -f "$F" ] && report_exists=1

# The input plan is evidence, not a workspace. Byte-compared against the pristine copy the
# Dockerfile baked from the SAME tracked source, so there is no second copy to drift.
if [ -f /opt/fixture/plan.md ] && cmp -s /opt/fixture/plan.md /app/plan.md; then
  original_untouched=1
fi

A=$(ls /app/*.autofix.md 2>/dev/null | head -1)
[ -n "$A" ] && [ -f "$A" ] && autofix_emitted=1

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
    // an applied fix is re-verified) as VERIFIED. Either is a pass here: this dimension asks
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

    // The verdict moved off NO-GO. validate.mjs derives the verdict from the rows, so this can
    // only be reached by actually flipping the refuted row on re-verification — not by editing
    // the badge. GO would mean the live-system unknown was laundered too, so it does not count.
    out.verdict_moved = /data-verdict="GO-WITH-CONDITIONS"/.test(markup) ? 1 : 0;

    fs.writeFileSync("/tmp/dims.json", JSON.stringify(out));
  ' "$F" >>"$OUT/validate.log" 2>&1

  if [ -f /tmp/dims.json ]; then
    refutation_found=$(node -e 'process.stdout.write(String(require("/tmp/dims.json").refutation_found||0))')
    refuted_tagged_mechanical=$(node -e 'process.stdout.write(String(require("/tmp/dims.json").refuted_tagged_mechanical||0))')
    live_unknown_held_open=$(node -e 'process.stdout.write(String(require("/tmp/dims.json").live_unknown_held_open||0))')
    verdict_moved=$(node -e 'process.stdout.write(String(require("/tmp/dims.json").verdict_moved||0))')
  fi
fi

if [ "$autofix_emitted" = 1 ]; then
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

partial=$(( report_exists + validator_passes + original_untouched + autofix_emitted \
  + refutation_found + refuted_tagged_mechanical + mechanical_fix_applied + verdict_moved \
  + live_unknown_held_open ))
reward=0
[ "$report_exists" = 1 ] && [ "$validator_passes" = 1 ] && [ "$original_untouched" = 1 ] \
  && [ "$autofix_emitted" = 1 ] && [ "$refutation_found" = 1 ] \
  && [ "$refuted_tagged_mechanical" = 1 ] && [ "$mechanical_fix_applied" = 1 ] \
  && [ "$verdict_moved" = 1 ] && [ "$live_unknown_held_open" = 1 ] && reward=1

cat > "$OUT/reward.json" <<JSON
{
  "report_exists": $report_exists,
  "validator_passes": $validator_passes,
  "original_untouched": $original_untouched,
  "autofix_emitted": $autofix_emitted,
  "refutation_found": $refutation_found,
  "refuted_tagged_mechanical": $refuted_tagged_mechanical,
  "mechanical_fix_applied": $mechanical_fix_applied,
  "live_unknown_held_open": $live_unknown_held_open,
  "verdict_moved": $verdict_moved,
  "partial": $partial,
  "reward": $reward
}
JSON
cat "$OUT/reward.json"
exit 0
