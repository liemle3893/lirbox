#!/bin/bash
# Grades a conductor-skill output. Per the Harbor contract for this skill we check only that the
# GENERATED FILE is correct — the workflow is never executed. These are standing invariants the
# generator's own contract promises (CLAUDE.md: the conductor layer is "pure JS only — NO
# fs/git/require/Date.now()/Math.random()"; SKILL.md: prompts travel as DATA, so a leftover TODO
# means they did not).
#
# Every content check runs against the EXECUTING BODY only — the slice from `const NAME` onward.
# The header comment and the meta block describe the restricted primitives in prose ("A leftover
# `TODO:` means...", "inside agent() subagents"), so scanning the whole file scores the
# documentation instead of the code.
#
# Multi-key reward for partial credit, PLUS a scalar `reward` because Harbor's pass@k silently
# returns {} for anything that is not a single 0/1.
set -uo pipefail
OUT=/logs/verifier; mkdir -p "$OUT"
H=$(mktemp -d)
exists=0; parses=0; has_meta=0; pure=0; phase_order=0; no_todo=0; schemas=0

F=$(ls /app/.workflows/*.js 2>/dev/null | head -1)
[ -n "${F:-}" ] && [ -f "$F" ] && exists=1

# --- helpers -----------------------------------------------------------------------------------
# A generated conductor is neither a standalone ES module nor CommonJS: it carries `export const
# meta` AND a top-level `return`. `node --check` can therefore never pass it. The runtime consumes
# it as a function BODY, so that is what we compile it as.
cat > "$H/parse.cjs" <<'NODE'
const s = require('fs').readFileSync(process.argv[2], 'utf8').replace(/^export const meta/m, 'const meta');
// The body uses top-level await, so it must compile as an ASYNC function body — the same shape
// the Workflow runtime wraps it in. A plain `new Function` rejects the await and would fail every
// correct script.
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
new AsyncFunction('args', 'log', 'phase', 'agent', 'parallel', 'pipeline', 'budget', 'workflow', s);
NODE

cat > "$H/meta.cjs" <<'NODE'
const s = require('fs').readFileSync(process.argv[2], 'utf8');
const m = s.match(/export const meta = \{[\s\S]*?\n\}/);
if (!m) { console.error('no meta block'); process.exit(1); }
const b = m[0];
if (!/name:\s*'\S/.test(b)) { console.error('meta.name missing'); process.exit(1); }
if (!/description:\s*'\S/.test(b)) { console.error('meta.description missing'); process.exit(1); }
if (!(b.match(/\{ title: /g) || []).length) { console.error('meta.phases empty'); process.exit(1); }
NODE

cat > "$H/purity.cjs" <<'NODE'
const s = require('fs').readFileSync(process.argv[2], 'utf8');
const i = s.indexOf('const NAME');
if (i < 0) { console.error('no executing body'); process.exit(1); }
const body = s.slice(i).replace(/`(?:[^`\\]|\\.)*`/g, '""');   // worker prompts are DATA
const bad = [[/\brequire\s*\(/, 'require('], [/\bfs\./, 'fs.'], [/\bDate\.now\s*\(/, 'Date.now'],
             [/\bnew Date\b/, 'new Date'], [/\bMath\.random\s*\(/, 'Math.random']]
  .filter(([re]) => re.test(body)).map(([, n]) => n);
if (bad.length) { console.error('forbidden at conductor layer: ' + bad.join(', ')); process.exit(1); }
NODE

cat > "$H/order.cjs" <<'NODE'
const s = require('fs').readFileSync(process.argv[2], 'utf8');
const m = s.match(/export const meta = \{[\s\S]*?\n\}/);
if (!m) process.exit(1);
const declared = [...m[0].matchAll(/\{ title: '([^']+)' \}/g)].map((x) => x[1]);
const called = [...s.slice(m.index + m[0].length).matchAll(/^phase\('([^']+)'\)/gm)].map((x) => x[1]);
if (!called.length) { console.error('no phase() calls'); process.exit(1); }
const stray = called.filter((c) => !declared.includes(c));
if (stray.length) { console.error('phase() not declared in meta: ' + stray.join(', ')); process.exit(1); }
const idx = called.map((c) => declared.indexOf(c));
for (let k = 1; k < idx.length; k++) {
  if (idx[k] < idx[k - 1]) { console.error('phase order drifts from meta at ' + called[k]); process.exit(1); }
}
NODE

cat > "$H/schema.cjs" <<'NODE'
const s = require('fs').readFileSync(process.argv[2], 'utf8');
const i = s.indexOf('const NAME');
if (i < 0) process.exit(1);
const body = s.slice(i);
const calls = (body.match(/\bagent\(/g) || []).length;
const schemas = (body.match(/\bschema:/g) || []).length;
if (!calls) { console.error('no agent() dispatches'); process.exit(1); }
if (schemas < calls) { console.error(`${calls} agent() call(s) but only ${schemas} schema(s)`); process.exit(1); }
NODE

cat > "$H/todo.cjs" <<'NODE'
const s = require('fs').readFileSync(process.argv[2], 'utf8');
const i = s.indexOf('const NAME');
if (i < 0) process.exit(1);
if (/TODO:/.test(s.slice(i))) { console.error('unfilled TODO prompt in body'); process.exit(1); }
NODE

# --- grade -------------------------------------------------------------------------------------
if [ "$exists" = 1 ]; then
  node "$H/parse.cjs"  "$F" >"$OUT/parse.log"  2>&1 && parses=1
  node "$H/meta.cjs"   "$F" >"$OUT/meta.log"   2>&1 && has_meta=1
  node "$H/purity.cjs" "$F" >"$OUT/purity.log" 2>&1 && pure=1
  node "$H/order.cjs"  "$F" >"$OUT/order.log"  2>&1 && phase_order=1
  node "$H/todo.cjs"   "$F" >"$OUT/todo.log"   2>&1 && no_todo=1
  node "$H/schema.cjs" "$F" >"$OUT/schema.log" 2>&1 && schemas=1
fi

score=$(( parses + has_meta + pure + phase_order + no_todo + schemas ))
reward=0
[ "$score" = 6 ] && reward=1

cat > "$OUT/reward.json" <<JSON
{
  "output_exists": $exists,
  "parses_as_workflow_body": $parses,
  "has_meta": $has_meta,
  "conductor_layer_pure": $pure,
  "phase_order_matches_meta": $phase_order,
  "prompts_as_data": $no_todo,
  "every_agent_has_schema": $schemas,
  "partial": $score,
  "reward": $reward
}
JSON
cat "$OUT/reward.json"
exit 0
