#!/bin/bash
# Grades a flowchart-skill output. The skill's OWN headless validator is the gate — the same
# check the skill tells its user to run — plus the structural contract SKILL.md promises.
# Multi-key reward for partial credit, PLUS a scalar `reward` because Harbor's pass@k silently
# returns {} for anything that is not a single 0/1.
set -uo pipefail
OUT=/logs/verifier; mkdir -p "$OUT"
F=/app/out.html
exists=0; valid=0; crit=0; wired=0; nomarkers=0

[ -f "$F" ] && exists=1

if [ "$exists" = 1 ]; then
  # 1. the load-bearing gate: does it actually render? (label escaping, Mermaid parse)
  node /tests/skill-assets/validate.mjs "$F" >"$OUT/validate.log" 2>&1 && valid=1

  # 2. exactly one :::crit — SKILL.md: "Highlight exactly one :::crit ... More than one dilutes it"
  [ "$(grep -o ':::crit' "$F" | wc -l | tr -d ' ')" = "1" ] && crit=1

  # 3. every clickable node has a STEPS entry (no dead panels)
  node -e '
    const h=require("fs").readFileSync(process.argv[1],"utf8");
    const clicks=[...h.matchAll(/^\s*click (\w+) selectNode/gm)].map(m=>m[1]);
    const steps=new Set([...h.matchAll(/^\s{2,}(\w+):\s*\{\s*title:/gm)].map(m=>m[1]));
    const missing=clicks.filter(c=>!steps.has(c));
    process.exit(clicks.length>0 && missing.length===0 ? 0 : 1);
  ' "$F" >>"$OUT/validate.log" 2>&1 && wired=1

  # 4. template markers stripped
  ! grep -q 'TEMPLATE-GRAPH\|TEMPLATE-STEPS\|{{' "$F" && nomarkers=1
fi

score=$(( valid + crit + wired + nomarkers ))
reward=0
[ "$valid" = 1 ] && [ "$crit" = 1 ] && [ "$wired" = 1 ] && [ "$nomarkers" = 1 ] && reward=1

cat > "$OUT/reward.json" <<JSON
{
  "output_exists": $exists,
  "validator_passes": $valid,
  "single_crit_node": $crit,
  "all_nodes_wired": $wired,
  "no_template_markers": $nomarkers,
  "partial": $score,
  "reward": $reward
}
JSON
cat "$OUT/reward.json"
exit 0
