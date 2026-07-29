#!/bin/bash
# Grades a conductor-skill output. Per the Harbor contract for this skill we check only that the
# GENERATED FILE is correct — the workflow is never executed, which keeps the task hermetic and cheap.
#
# TWO OUTPUTS:
#   /logs/verifier/reward.json — the scored keys. `reward` is the gating scalar and is 100%
#                                DETERMINISTIC: the six checks below and nothing else.
#   /logs/verifier/ctrf.json   — per-check detail the Harbor Viewer renders, so a failure reads as
#                                "which check, and the stderr that explains it" not a bare number.
#   /logs/verifier/*.log       — raw stderr per check.
#
# We deliberately never write reward.txt: it takes PRIORITY over reward.json in Harbor, which would
# collapse this task to one scalar and discard the per-check breakdown.
#
# Every content check runs against the EXECUTING BODY only — the slice from `const NAME` onward. The
# header comment and meta block name the restricted primitives in prose ("A leftover `TODO:`
# means...", "inside agent() subagents"), so scanning the whole file grades the documentation instead
# of the code. That bug cost two of six checks a false red during development.
#
# KNOWN AND DELIBERATE LIMIT: these checks prove the emitted file is WELL-FORMED, not that it is
# GOOD. Measured 2026-07-30 — a scaffold with a single phase named "Work", a prompt of the literal
# string "x", and no DoD scores 6/6 and reward 1. Closing that gap needs a semantic scorer, which is
# tracked separately; it is NOT smuggled in here, because `reward` has to stay deterministic for the
# whetstone loop to keep/revert on it.
set -uo pipefail
OUT=/logs/verifier; mkdir -p "$OUT"
H=$(mktemp -d)
exists=0; parses=0; has_meta=0; pure=0; phase_order=0; no_todo=0; schemas=0

F=$(ls /app/.workflows/*.js 2>/dev/null | head -1)
[ -n "${F:-}" ] && [ -f "$F" ] && exists=1

# --- helpers -----------------------------------------------------------------------------------
# A generated conductor is neither a standalone ES module nor CommonJS: it carries `export const
# meta` AND a top-level `return`. `node --check` can therefore never pass it. The runtime consumes
# it as an ASYNC function body (it uses top-level await), so that is what we compile it as.
cat > "$H/parse.cjs" <<'NODE'
const s = require('fs').readFileSync(process.argv[2], 'utf8').replace(/^export const meta/m, 'const meta');
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

# Epoch millis. GNU date has %3N; BSD date does not and emits a literal "...%3N", which reaches the
# CTRF as NaN -> null. Fall back to whole seconds so the field is always a real number.
now_ms() {
  local t; t=$(date +%s%3N 2>/dev/null)
  case "$t" in
    ''|*[!0-9]*) echo $(( $(date +%s) * 1000 )) ;;
    *) echo "$t" ;;
  esac
}

# --- deterministic grade (the ONLY input to `reward`) -------------------------------------------
START=$(now_ms)
if [ "$exists" = 1 ]; then
  node "$H/parse.cjs"  "$F" >"$OUT/parse.log"  2>&1 && parses=1
  node "$H/meta.cjs"   "$F" >"$OUT/meta.log"   2>&1 && has_meta=1
  node "$H/purity.cjs" "$F" >"$OUT/purity.log" 2>&1 && pure=1
  node "$H/order.cjs"  "$F" >"$OUT/order.log"  2>&1 && phase_order=1
  node "$H/todo.cjs"   "$F" >"$OUT/todo.log"   2>&1 && no_todo=1
  node "$H/schema.cjs" "$F" >"$OUT/schema.log" 2>&1 && schemas=1
fi
STOP=$(now_ms)

score=$(( parses + has_meta + pure + phase_order + no_todo + schemas ))
reward=0
[ "$score" = 6 ] && reward=1

# --- CTRF: per-check detail for the Harbor Viewer ----------------------------------------------
# Never an input to reward — this exists so a human reading `harbor view jobs` sees WHICH check
# failed and why, instead of a row of bare numbers.
node - "$OUT" "$START" "$STOP" \
  "output_exists:$exists:" \
  "parses_as_workflow_body:$parses:parse.log" \
  "has_meta:$has_meta:meta.log" \
  "conductor_layer_pure:$pure:purity.log" \
  "phase_order_matches_meta:$phase_order:order.log" \
  "prompts_as_data:$no_todo:todo.log" \
  "every_agent_has_schema:$schemas:schema.log" <<'NODE' || echo "ctrf emit failed (reward unaffected)" >&2
const fs = require('fs');
const [outDir, start, stop, ...specs] = process.argv.slice(2);
const tests = specs.map((s) => {
  const [name, ok, logFile] = s.split(':');
  let message = '';
  if (ok !== '1' && logFile) {
    try { message = fs.readFileSync(`${outDir}/${logFile}`, 'utf8').trim().slice(0, 2000); } catch (e) {}
  }
  return { name, status: ok === '1' ? 'passed' : 'failed', duration: 0, ...(message ? { message } : {}) };
});
const passed = tests.filter((t) => t.status === 'passed').length;
fs.writeFileSync(`${outDir}/ctrf.json`, JSON.stringify({
  results: {
    tool: { name: 'conductor-generated-file-checks' },
    summary: { tests: tests.length, passed, failed: tests.length - passed,
               pending: 0, skipped: 0, other: 0, start: Number(start), stop: Number(stop) },
    tests,
  },
}, null, 2));
NODE

# --- reward.json (written in EVERY path; a missing/empty file errors the trial) ------------------
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
