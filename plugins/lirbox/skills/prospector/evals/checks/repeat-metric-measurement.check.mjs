// ACCEPTANCE CHECK (RED on baseline) — concern: repeat-metric-measurement.
//
// The optimization loop measures each metric (baseline + per-experiment) exactly ONCE, so a single
// noisy sample can be KEPT and permanently raise `best`, after which genuine later gains are
// rejected against an inflated bar. The fix is two-part:
//   1) repeated measurement — a `metric.repeat: N` config field makes the generated baseline AND
//      eval worker prompts run the metric N times and aggregate to a MEDIAN (plus spread), and
//   2) a variance-aware keep decision — a within-noise move (improvement < spread) is NOT kept,
//      DISTINCT from the existing minDelta floor.
//
// This check asserts BOTH on the ARTIFACT (the generator scaffold-optimize.cjs): (a) the generated
// source string (generate('x')) for the marker scan, and (b) the exported pure helpers (require())
// for the behavioral unit assertion — mirroring scripts/test-optimize.cjs. It is RED today (no
// median/repeat markers; isBetter has arity 4 and ignores spread) and goes GREEN only once fixed.
//
// Run: node plugins/lirbox/skills/prospector/evals/checks/repeat-metric-measurement.check.mjs
//   exit 0 ONLY when the concern is resolved; non-zero otherwise.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const GEN = resolve(HERE, '..', '..', 'scripts', 'scaffold-optimize.cjs');

const mod = require(GEN);
const { generate } = mod;

let failures = 0;
const fail = (msg) => { console.error(`FAIL ${msg}`); failures++; };
const pass = (msg) => { console.log(`PASS ${msg}`); };
const ok = (cond, msg) => { if (cond) { pass(msg); return true; } fail(msg); return false; };

// ============================================================================
// PART 1 — GENERATED SOURCE must make metric measurement repeat-aware (MEDIAN of N samples)
//          in BOTH the baseline worker prompt AND the per-experiment eval worker prompt.
// ============================================================================
const src = generate('x');

// Tolerant on naming: a configurable repeat/sample COUNT read off the metric config, and a MEDIAN
// aggregation of the repeated samples. Strict enough that the current once-only prompts can't pass.
const repeatCount = /METRIC\.(repeat|samples?|sampleCount|runs|nRuns|n)\b/;
const median = /\bmedian\b/i;

// Isolate the two measurement prompts so a marker in ONE place can't satisfy BOTH requirements.
// Baseline prompt: from "BASELINE (spec" up to its `label: 'baseline'`.
// Eval prompt: from "EVAL (experiment" up to its `label: \`eval:`.
function region(s, startMarker, endMarker) {
  const i = s.indexOf(startMarker);
  if (i === -1) return '';
  const j = s.indexOf(endMarker, i);
  return j === -1 ? s.slice(i) : s.slice(i, j);
}
const baselineRegion = region(src, 'BASELINE (spec', "label: 'baseline'");
const evalRegion = region(src, 'EVAL (experiment', 'label: `eval:');

ok(baselineRegion.length > 0, 'located the baseline worker prompt region');
ok(evalRegion.length > 0, 'located the eval worker prompt region');

ok(repeatCount.test(baselineRegion), 'baseline prompt references a configurable repeat/sample count (e.g. METRIC.repeat)');
ok(median.test(baselineRegion), 'baseline prompt aggregates repeated samples to a MEDIAN');
ok(repeatCount.test(evalRegion), 'eval prompt references a configurable repeat/sample count (e.g. METRIC.repeat)');
ok(median.test(evalRegion), 'eval prompt aggregates repeated samples to a MEDIAN');

// ============================================================================
// PART 2 — a NOISE-AWARE keep decision exists as an exported PURE helper, with spread DISTINCT from
//          the existing minDelta floor. Accept either isBetter extended with a 5th spread arg, OR a
//          new exported helper. Contract (best=10, direction 'min' = lower-is-better, minDelta=0):
//            within : improvement 0.1 with spread 0.5  → MUST be false (within noise → not kept)
//            beyond : improvement 1.0 with spread 0.5  → MUST be true  (clears noise → kept)
//            noiseOff: improvement 0.1 with spread 0   → MUST be true  (no noise floor → kept)
//          The noiseOff clause proves the rejection is driven by the SPREAD argument and not by
//          minDelta — so passing spread-as-minDelta on the existing 4-arg isBetter cannot pass.
// ============================================================================

// 5-arg form: (metric, best, direction, minDelta, spread). The only correct shape for isBetter,
// since arg4 is already minDelta — spread must be a SEPARATE 5th argument.
function noiseAware5(fn) {
  try {
    return fn(9.9, 10, 'min', 0, 0.5) === false   // 0.1 improvement < 0.5 spread → reject
        && fn(9.0, 10, 'min', 0, 0.5) === true    // 1.0 improvement > 0.5 spread → keep
        && fn(9.9, 10, 'min', 0, 0) === true;     // spread 0 → 0.1 improvement kept (spread drives it)
  } catch { return false; }
}
// 4-arg form: (metric, best, direction, spread). Allowed ONLY for a NEW dedicated helper (never for
// isBetter, whose 4th arg is already minDelta).
function noiseAware4(fn) {
  try {
    return fn(9.9, 10, 'min', 0.5) === false
        && fn(9.0, 10, 'min', 0.5) === true
        && fn(9.9, 10, 'min', 0) === true;
  } catch { return false; }
}

let noiseHelper = null;
// Option A: isBetter itself made noise-aware via a distinct 5th spread argument.
if (typeof mod.isBetter === 'function' && noiseAware5(mod.isBetter)) noiseHelper = 'isBetter (5th spread arg)';
// Option B: a distinct exported helper carrying the noise-aware decision (5-arg or 4-arg shape).
if (!noiseHelper) {
  for (const k of Object.keys(mod)) {
    if (k === 'isBetter' || typeof mod[k] !== 'function') continue;
    if (!/noise|spread|signif|variance|\bvar\b|beats|keep/i.test(k)) continue;
    if (noiseAware5(mod[k]) || noiseAware4(mod[k])) { noiseHelper = `${k} (exported helper)`; break; }
  }
}

ok(!!noiseHelper, 'an exported pure helper rejects a within-spread improvement (distinct from minDelta) and keeps a beyond-spread one' + (noiseHelper ? ` [${noiseHelper}]` : ''));

// ============================================================================
if (failures) {
  console.error(`\nrepeat-metric-measurement: ${failures} assertion(s) FAILED — concern is unresolved (RED).`);
  process.exit(1);
}
console.log('\nrepeat-metric-measurement: GREEN — measurement is repeat/median-aware and the keep decision is noise-aware.');
