#!/bin/bash
# STATIC VERIFIER for plan-check__execution-shape. Deterministic only — no judge, no model calls.
#
# Grades what the plan under test plants, all of it derivable from the plan's own text:
#   * a FILE COLLISION: Tasks 2 and 3 both modify server/internal/schedules/worker.go, and
#     neither declares the overlap. Task 3 says "Consumes: nothing".
#   * an UNDECLARED EDGE: Task 4's Interfaces block says "Consumes: nothing" while its own
#     Step 3 says "Run this after Task 2 has landed".
#   * REAL PARALLELISM the plan denies: its "Implementation order" flattens the work into
#     1->2->3->4, but Tasks 2 and 3 have no data dependency on each other. They share a file,
#     which under a runner giving each task its own worktree is a MERGE at integration — not an
#     ordering constraint. A report that serializes them has made the plan slower than the truth.
#
# Findings must land as CLAIM ROWS, not loose prose — a report that merely quotes the plan
# somewhere has adjudicated nothing. Content assertions are scoped to <tr class="claim"> blocks.
#
# DIMENSION DESIGN. Two of the dimensions below are GATED on the taskgraph feature existing (a
# baseline emits no such block, so it scores 0 by construction and its "lift" measures the `if`,
# not the model). The ones that carry real evidence are `concurrency_claimed`,
# `contention_classified` and the two fix-disposition dimensions: each is satisfied by ORDINARY
# markup a baseline can produce — nothing about them requires a feature to exist. Read those first.
#
# `fix_tags_present` (lenient: one `fix:` anywhere) and `fix_tags_complete` (strict: EVERY open row
# carries one) are kept side by side deliberately. The lenient one measured 4/10 in both arms on
# 2026-08-04 and is frozen so that number stays comparable across runs; the strict one is the
# invariant SKILL.md step 7 actually states.
set -uo pipefail
OUT=/logs/verifier; mkdir -p "$OUT"

report_exists=0; validator_passes_legacy=0; collision_reported=0; fix_tags_complete=0
undeclared_edge_reported=0; fix_tags_present=0; verdict_not_go=0
plan_untouched=0; taskgraph_block=0; taskgraph_levels_valid=0
concurrency_claimed=0; contention_classified=0

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
  # NOT-WORSE dimension: the PRE-taskgraph report contract, frozen here on purpose so BOTH arms
  # can satisfy it. Grading a baseline against the CURRENT validator would only re-measure "the
  # baseline predates the change" — that is the `if`, not the model.
  node /tests/skill-assets/validate-legacy.mjs "$F" >"$OUT/validate.log" 2>&1 && validator_passes_legacy=1

  node -e '
    const fs = require("fs");
    const html = fs.readFileSync(process.argv[1], "utf8");
    // MUST strip <style> first: the template styles the badge with attribute selectors
    // (.verdict[data-verdict="GO"]{...}), so a raw grep matches CSS in every report ever
    // produced. validate.mjs strips <style> for the same reason; keep the two in step.
    const markup = html
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "");

    // Claim rows only: a finding must BE a row.
    const rows = [...markup.matchAll(/<tr\b[^>]*\bclass="[^"]*\bclaim\b[^"]*"[^>]*>([\s\S]*?)<\/tr>/g)]
      .map((m) => m[0]);
    const rowText = (r) => r.replace(/<[^>]+>/g, " ");
    const text = rows.map(rowText).join("\n");

    // The collided file, named in a row. Tasks 2 and 3 both modify it.
    const collision = /worker\.go/i.test(text);

    // The undeclared edge, named in a row: Task 4 depends on Task 2 despite declaring nothing.
    // Require BOTH task identifiers in ONE row, so a report listing every task somewhere in the
    // ledger cannot satisfy this by accident.
    const edge = rows.some((r) => {
      const t = rowText(r);
      return /task\s*4/i.test(t) && /task\s*2/i.test(t);
    });

    // LENIENT, kept unchanged on purpose: one `fix:` anywhere in the file scores 1. It measured
    // 4/10 in both arms on 2026-08-04, and keeping it identical is what makes that number
    // comparable across runs.
    const fixTags = /fix:\s*(mechanical|needs-decision)/i.test(html);

    // STRICT: the invariant SKILL.md step 7 actually states — EVERY open row carries a
    // disposition. The lenient test above lets one tagged row excuse ten untagged ones, which is
    // precisely how a reader loses the ability to tell what can be applied. Vacuously true for a
    // report with no open rows; every observed report carried 6-12, and a free 1 in the baseline
    // arm only shrinks the measured lift, so the bias is conservative.
    const OPEN = new Set(["UNVERIFIED", "BLIND-SPOT-RISK"]);
    const openRows = rows.filter((r) => OPEN.has((r.match(/data-status="([^"]*)"/) || [])[1]));
    const fixComplete = openRows.every((r) => /\bfix:\s*(mechanical|needs-decision)\b/i.test(r));
    const verdictNotGo = !/data-verdict="GO"/.test(markup);

    // --- the machine-readable graph (GATED: a baseline has no such concept) -------------------
    let graph = null;
    const m = markup.match(/<script[^>]*\bid="taskgraph"[^>]*>([\s\S]*?)<\/script>/);
    if (m) { try { graph = JSON.parse(m[1]); } catch (e) { graph = null; } }
    const nodes = graph && Array.isArray(graph.nodes) ? graph.nodes : [];
    const edges = graph && Array.isArray(graph.edges) ? graph.edges : [];
    const levels = graph && Array.isArray(graph.levels) ? graph.levels : [];
    // The plan has four tasks; a graph that models fewer has not modelled THIS plan.
    const taskgraphBlock = nodes.length >= 4;
    // Levels must partition the nodes and stay consistent with the needs edges — the same
    // property validate.mjs enforces, restated here so the grader does not depend on which
    // validator shipped in the container.
    const ids = new Set(nodes.map((n) => n && n.id).filter(Boolean));
    const flat = levels.flat().map(String);
    const idx = new Map();
    levels.forEach((l, i) => (Array.isArray(l) ? l : []).forEach((id) => idx.set(String(id), i)));
    const partitions = flat.length === ids.size && flat.every((id) => ids.has(id)) && new Set(flat).size === flat.length;
    const needsRespected = edges
      .filter((e) => e && e.kind === "needs")
      .every((e) => idx.has(String(e.from)) && idx.has(String(e.to)) && idx.get(String(e.from)) < idx.get(String(e.to)));
    const taskgraphLevelsValid = taskgraphBlock && levels.length > 0 && partitions && needsRespected;

    // --- the two UNGATED dimensions: satisfiable in plain prose, so a baseline can score ------
    // Did the report claim that some of this work runs CONCURRENTLY, against the plan`s own
    // "Implementation order: Task 1, then Task 2, then Task 3, then Task 4"?
    const PARALLEL = /parallel|concurrent|at the same time|independent(ly)?|need not (?:be )?(?:run )?(?:in )?(?:sequen|order)|no ordering|same level/i;
    const concurrencyInProse = rows.some((r) => {
      const t = rowText(r);
      return /task\s*2/i.test(t) && /task\s*3/i.test(t) && PARALLEL.test(t);
    });
    const concurrencyInGraph = levels.some((l) => Array.isArray(l) && l.length >= 2);
    const concurrencyClaimed = concurrencyInProse || concurrencyInGraph;

    // Was the shared file classified as a MERGE concern rather than an ordering constraint?
    const MERGE = /merge|integrat|separate worktree|own worktree|not (?:a )?(?:real )?depend|no data depend/i;
    const contentionInProse = rows.some((r) => {
      const t = rowText(r);
      return /worker\.go/i.test(t) && MERGE.test(t);
    });
    const contentionInGraph = edges.some((e) => e && e.kind === "contention");
    const contentionClassified = contentionInProse || contentionInGraph;

    const out = {
      collision, edge, fixTags, verdictNotGo,
      taskgraphBlock, taskgraphLevelsValid, concurrencyClaimed, contentionClassified, fixComplete,
    };
    fs.writeFileSync("/tmp/content.json", JSON.stringify(out));
    console.log(JSON.stringify(out));
  ' "$F" >>"$OUT/validate.log" 2>&1

  if [ -f /tmp/content.json ]; then
    grep -q '"collision":true'            /tmp/content.json && collision_reported=1
    grep -q '"edge":true'                 /tmp/content.json && undeclared_edge_reported=1
    grep -q '"fixTags":true'              /tmp/content.json && fix_tags_present=1
    grep -q '"verdictNotGo":true'         /tmp/content.json && verdict_not_go=1
    grep -q '"taskgraphBlock":true'       /tmp/content.json && taskgraph_block=1
    grep -q '"taskgraphLevelsValid":true' /tmp/content.json && taskgraph_levels_valid=1
    grep -q '"concurrencyClaimed":true'   /tmp/content.json && concurrency_claimed=1
    grep -q '"contentionClassified":true' /tmp/content.json && contention_classified=1
    grep -q '"fixComplete":true'          /tmp/content.json && fix_tags_complete=1
  fi
fi

partial=$(( report_exists + validator_passes_legacy + collision_reported + undeclared_edge_reported \
  + fix_tags_present + verdict_not_go + plan_untouched + taskgraph_block + taskgraph_levels_valid \
  + concurrency_claimed + contention_classified + fix_tags_complete ))
reward=0
[ "$report_exists" = 1 ] && [ "$validator_passes_legacy" = 1 ] && [ "$collision_reported" = 1 ] \
  && [ "$undeclared_edge_reported" = 1 ] && [ "$fix_tags_present" = 1 ] \
  && [ "$verdict_not_go" = 1 ] && [ "$plan_untouched" = 1 ] && [ "$taskgraph_block" = 1 ] \
  && [ "$taskgraph_levels_valid" = 1 ] && [ "$concurrency_claimed" = 1 ] \
  && [ "$contention_classified" = 1 ] && [ "$fix_tags_complete" = 1 ] && reward=1

cat > "$OUT/reward.json" <<JSON
{
  "report_exists": $report_exists,
  "validator_passes_legacy": $validator_passes_legacy,
  "collision_reported": $collision_reported,
  "undeclared_edge_reported": $undeclared_edge_reported,
  "fix_tags_present": $fix_tags_present,
  "verdict_not_go": $verdict_not_go,
  "plan_untouched": $plan_untouched,
  "taskgraph_block": $taskgraph_block,
  "taskgraph_levels_valid": $taskgraph_levels_valid,
  "concurrency_claimed": $concurrency_claimed,
  "contention_classified": $contention_classified,
  "fix_tags_complete": $fix_tags_complete,
  "partial": $partial,
  "reward": $reward
}
JSON
cat "$OUT/reward.json"
exit 0
