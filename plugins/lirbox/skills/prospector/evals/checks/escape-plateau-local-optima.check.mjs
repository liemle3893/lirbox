// ACCEPTANCE-CHECK (RED on baseline) — concern id: escape-plateau-local-optima
//
// THE CONCERN: on plateau the loop hard-stops (`shouldStop` returns 'plateau') at the FIRST local
// optimum, surrendering remaining budget, and it only ever proposes from the single global `best`.
// THE FIX: a BOUNDED ESCAPE — before a terminal stop, RESTART proposing from a NON-INCUMBENT (the
// baseline, or a kept-but-not-best commit) for K rounds, THEN stop.
//
// This check mirrors scripts/test-optimize.cjs in style and asserts on the two surfaces that test
// owns: (a) the exported pure decision helpers, and (b) the generated conductor SOURCE STRING from
// generate('x') (config is data-in, so the body is identical for every slug).
//
// GREEN requires BOTH:
//   1. A pure decision helper signals RESTART (not a terminal stop) when on a plateau WITH restart
//      rounds remaining, and a terminal stop once restarts are exhausted. Accepted as EITHER an
//      extended `shouldStop` that can return a 'restart' signal, OR a NEW exported helper
//      (nextAction / planRestart / …) — tolerant on naming, strict on behavior.
//   2. The generated source contains a BOUNDED restart branch (a restart budget/counter) that
//      RE-SEEDS the propose step from a NON-INCUMBENT (baseline or a kept-but-not-best commit),
//      i.e. it proposes from something other than `best`.
//
// Today neither holds → RED. Exits 0 ONLY when the concern is resolved.
//
//   node escape-plateau-local-optima.check.mjs
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const GEN = require('../../scripts/scaffold-optimize.cjs');

let failures = 0;
const fail = (m) => { console.error(`FAIL ${m}`); failures++; };
const pass = (m) => { console.log(`PASS ${m}`); };

// ----------------------------------------------------------------------------
// Signal classifiers — tolerant of return shape (string code or small object),
// but strict on MEANING: a restart signal must name restart/reseed/escape; a
// terminal stop must name plateau/stop/terminal/done.
// ----------------------------------------------------------------------------
const RESTART_WORD = /restart|re-?seed|escape/i;
const TERMINAL_WORD = /^(plateau|stop|terminal|done|exhausted)$/i;
const TERMINAL_LOOSE = /plateau|stop|terminal|done|exhausted/i;

function isRestartSignal(v) {
  if (typeof v === 'string') return RESTART_WORD.test(v);
  if (v && typeof v === 'object') {
    return v.restart === true || v.reseed === true ||
      RESTART_WORD.test(String(v.action || '')) ||
      RESTART_WORD.test(String(v.type || '')) ||
      RESTART_WORD.test(String(v.signal || ''));
  }
  return false;
}
function isTerminalStop(v) {
  if (typeof v === 'string') return TERMINAL_WORD.test(v);
  if (v && typeof v === 'object') {
    return v.stop === true ||
      TERMINAL_LOOSE.test(String(v.action || '')) ||
      TERMINAL_LOOSE.test(String(v.type || '')) ||
      TERMINAL_LOOSE.test(String(v.signal || ''));
  }
  return false;
}

// ============================================================================
// ASSERTION 1 — a pure helper signals RESTART (rounds remaining) vs terminal (exhausted).
// We probe EVERY exported function (except `generate`) with the plausible argument shapes for the
// restart decision, so the fix can land as an extended shouldStop OR a brand-new helper. A function
// "satisfies" iff, on a plateau, it returns a restart signal while restarts remain AND a terminal
// stop once they are exhausted (and NOT a restart signal then).
// ============================================================================

// Scenario inputs: plateau is reached (sinceKept >= plateauStop) in both cases.
const PLATEAU = 3;
const SINCE = 3; // >= plateauStop → plateau condition met
// (restartsDone, maxRestarts): A = rounds remaining; B = exhausted.
const A = { restartsDone: 0, maxRestarts: 2 };
const B = { restartsDone: 2, maxRestarts: 2 };

// Candidate argument builders (tolerant of the eventual signature):
//  - new dedicated helper:  fn(sinceKept, plateauStop, restartsDone, maxRestarts)
//  - extended shouldStop tail: fn(experimentsDone, sinceKept, total, plateauStop, elapsedMin, tokensUsed, restartsDone, maxRestarts)
//  - single options object:  fn({ sinceKept, plateauStop, restartsDone, maxRestarts })
function argShapes(r) {
  return [
    [SINCE, PLATEAU, r.restartsDone, r.maxRestarts],
    [0, SINCE, {}, PLATEAU, undefined, undefined, r.restartsDone, r.maxRestarts],
    [{ sinceKept: SINCE, plateauStop: PLATEAU, restartsDone: r.restartsDone, maxRestarts: r.maxRestarts }],
  ];
}

const callSafe = (fn, args) => { try { return fn(...args); } catch { return undefined; } };

const fnExports = Object.keys(GEN).filter((k) => typeof GEN[k] === 'function' && k !== 'generate');
let restartHelperFound = false;
let foundWhere = '';

for (const key of fnExports) {
  const fn = GEN[key];
  const shapesA = argShapes(A);
  const shapesB = argShapes(B);
  for (let s = 0; s < shapesA.length; s++) {
    const outA = callSafe(fn, shapesA[s]);
    const outB = callSafe(fn, shapesB[s]);
    if (isRestartSignal(outA) && isTerminalStop(outB) && !isRestartSignal(outB)) {
      restartHelperFound = true;
      foundWhere = `${key}() shape#${s} → restart(${JSON.stringify(outA)}) / terminal(${JSON.stringify(outB)})`;
      break;
    }
  }
  if (restartHelperFound) break;
}

if (restartHelperFound) pass(`unit: a helper signals RESTART with rounds left, terminal once exhausted [${foundWhere}]`);
else fail('unit: NO exported helper signals a bounded RESTART on plateau — shouldStop only ever returns a terminal stop, and there is no restart/nextAction/planRestart export');

// ============================================================================
// ASSERTION 2 — the generated conductor SOURCE has a bounded restart branch that RE-SEEDS propose
// from a NON-INCUMBENT. Two markers, both required: a restart budget/counter (the bounded-K
// mechanism) AND a propose seed that is explicitly NOT `best` (baseline or a kept-but-not-best
// commit). Regexes are kept specific so the current no-restart source cannot pass.
// ============================================================================

const src = GEN.generate('x');
if (typeof src !== 'string' || !src.length) {
  fail('source: generate("x") did not return a non-empty source string');
} else {
  // 2a — a bounded restart budget/counter exists (a named restart variable).
  const RE_RESTART_BUDGET = /\b(maxRestarts?|restarts?(Done|Left|Remaining|Used|Round|Rounds|Count|Budget)|RESTARTS?(_\w+)?|restartsAllowed|escapeRounds?)\b/;
  if (RE_RESTART_BUDGET.test(src)) pass('source: bounded restart budget/counter present');
  else fail('source: no bounded restart budget/counter (e.g. maxRestarts / restartsDone) — plateau is still terminal');

  // 2b — propose is re-seeded from a NON-INCUMBENT (not `best`). Accept any of:
  //   P1: the explicit "non-incumbent" concept word
  //   P2: a "kept-but-not-best" phrasing
  //   P3: a dedicated seed-source variable distinct from `best`
  //   P4: a restart branch that seeds propose from the baseline
  const P1 = /non-?incumbent/i;
  const P2 = /kept[\s\S]{0,40}\bnot[\s\S]{0,10}\bbest/i;
  const P3 = /\b(seedFrom|proposeFrom|restartFrom|escapeFrom|reseedFrom|seedRef|seedSha|seedBase|fromBaseline|seedCommit|reseedSha)\b/;
  const P4 = /restart[\s\S]{0,500}\bbaseline\b/i;
  if (P1.test(src) || P2.test(src) || P3.test(src) || P4.test(src)) {
    pass('source: propose is re-seeded from a non-incumbent (baseline / kept-but-not-best), not always `best`');
  } else {
    fail('source: propose still seeds only from `best` — no re-seed from a non-incumbent on restart');
  }
}

// ============================================================================
if (failures) {
  console.error(`\nescape-plateau-local-optima: RED — ${failures} assertion(s) failed (concern not yet fixed).`);
  process.exit(1);
}
console.log('\nescape-plateau-local-optima: GREEN — bounded restart + non-incumbent re-seed in place.');
