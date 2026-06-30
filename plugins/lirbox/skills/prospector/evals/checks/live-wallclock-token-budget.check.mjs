// ACCEPTANCE-CHECK (RED on baseline) — concern id: live-wallclock-token-budget
//
// CONCERN: `budgets.total.wallclockMin` and `budgets.total.tokens` never fire on a fresh,
// single-session run. Inside the experiment loop the conductor feeds shouldStop its 5th/6th
// args (elapsedMin / tokensUsed) ONLY from launch `args` — `(args && args.elapsedMin)` and
// `(args && args.tokensUsed)` — which are undefined until a resume, so the wallclock/token
// budgets can never trip LIVE. The eval/checkpoint workers already return per-experiment
// `sec`/`tokens`; the fix must accumulate those into mutable LIVE running counters and feed
// THOSE into the in-loop shouldStop call.
//
// GREEN ONLY WHEN: the in-experiment-loop `const stop = shouldStop(...)` call no longer passes
// bare `(args && args.elapsedMin)` / `(args && args.tokensUsed)` as its 5th/6th args, AND a
// mutable live accumulator exists (a `let` incremented via `+=` from the workers' sec/tokens).
//
// Assert on the generated SOURCE STRING (generate('x')): the run config is data-in via
// args.config, so the emitted loop body is identical for every slug. Mirrors test-optimize.cjs.
//
// Run: node plugins/lirbox/skills/prospector/evals/checks/live-wallclock-token-budget.check.mjs
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const GEN = resolve(HERE, '..', '..', 'scripts', 'scaffold-optimize.cjs');
const { generate } = require(GEN);

const src = generate('x');

let failures = 0;
const fail = (m) => { console.error(`FAIL ${m}`); failures++; };
const pass = (m) => console.log(`PASS ${m}`);
const check = (cond, m) => { if (cond) pass(m); else fail(m); };

// ---------------------------------------------------------------------------
// 1. Isolate the IN-LOOP stop check `const stop = shouldStop(...)` — NOT the post-loop
//    `const stopReason = shouldStop(...)`. The arg list is on a single source line.
// ---------------------------------------------------------------------------
const inLoop = src.match(/const stop = shouldStop\(([^\n]*)\)/);
check(!!inLoop, 'found the in-experiment-loop `const stop = shouldStop(...)` call');

if (inLoop) {
  const argList = inLoop[1];

  // RED today: the loop's stop check feeds bare resume-only `args` values that are undefined on
  // a fresh single-session run, so wallclock/token budgets can never trip live.
  check(
    !/args\s*&&\s*args\.elapsedMin/.test(argList),
    'in-loop shouldStop does NOT pass bare `(args && args.elapsedMin)` as its elapsedMin arg ' +
      '(must pass an accumulated LIVE counter)',
  );
  check(
    !/args\s*&&\s*args\.tokensUsed/.test(argList),
    'in-loop shouldStop does NOT pass bare `(args && args.tokensUsed)` as its tokensUsed arg ' +
      '(must pass an accumulated LIVE counter)',
  );
}

// ---------------------------------------------------------------------------
// 2. A mutable LIVE accumulator must exist — a `let` running counter for elapsed AND for tokens,
//    each incremented (`+=`) from the eval/checkpoint workers' per-experiment results.
// ---------------------------------------------------------------------------
check(
  /\blet\s+\w*([Ee]lapsed|[Ww]allclock)\w*\s*=/.test(src),
  'declares a mutable `let` live elapsed/wallclock accumulator',
);
check(
  /\blet\s+\w*[Tt]okens\w*\s*=/.test(src),
  'declares a mutable `let` live tokens accumulator',
);

// Incremented from worker return values each iteration (the eval worker returns `sec`/`tokens`).
check(
  /\+=[^\n;]*\bsec\b/.test(src),
  'live elapsed counter is incremented (`+=`) from a worker-returned `sec` value',
);
check(
  /\+=[^\n;]*\btokens\b/.test(src),
  'live tokens counter is incremented (`+=`) from a worker-returned `tokens` value',
);

// ---------------------------------------------------------------------------
if (failures) {
  console.error(`\nlive-wallclock-token-budget: ${failures} assertion(s) FAILED (concern unresolved).`);
  process.exit(1);
}
console.log('\nlive-wallclock-token-budget: ok (live wallclock/token budgets fire in-loop).');
