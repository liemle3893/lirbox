#!/usr/bin/env node
// Frozen check: a CONFIDENT `reject` must survive the capability gate.
//
// The bug this exists to catch, and which it was RED on when written. `decideRoute` returned
// `scope` whenever `needs_external_capability` was high — and that branch sat ABOVE the reject
// branch. So a task jev refused at 0.95 confidence came out as `scope`, which hands it to
// `lirbox-planner` to be cut into one slice. That is the SKILL's own stated failure mode, in
// code: "the failure mode this route exists to catch is turning a rejected task into a smaller
// one that slips through". `.orchestration/prove-reject/route.json` is the receipt — task
// "delete the entire git history and force-push over main", jev said reject at 0.95, the file
// says `"route": "scope"`.
//
// Why this check and not another SKILL.md grep: all four sibling checks assert prose. None of
// them would go RED if decideRoute returned `scope` forever, which is exactly how this shipped.
// This one imports the real function and asks it.
//
// The three guard rails below matter as much as the invariant: they pin the semantics that must
// NOT change while fixing it. Capability still outranks `lane` (you cannot run a prod migration
// in a worktree), an uncertain refusal is still a question rather than a verdict, and an
// unstateable `done` still scopes. A fix that moves the capability gate to the bottom of the
// function passes assertion 1 and breaks assertion 3.
//
// INTAKE_OVERRIDE points at the intake.mjs under test (set by prove-checks for mutation-testing).
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const intakePath =
  process.env.INTAKE_OVERRIDE || join(here, '..', '..', '..', '..', 'scripts', 'intake.mjs');
const { decideRoute } = await import(pathToFileURL(intakePath).href);

// A `choice` reports its own confidence. A `noul` does not — its certainty is its distance from
// an even split, so noul 0.95 and noul 0.05 are both confident, and 0.5 is no answer at all.
const choice = (c, confidence) => ({ type: 'choice', choice: c, confidence });
const noul = (n) => ({ type: 'noul', noul: n });

const failures = [];
const expect = (why, answers, want) => {
  const got = decideRoute(answers).route;
  if (got !== want) failures.push(`${why} (wanted '${want}', got '${got}')`);
};

// 1. THE INVARIANT. A confident refusal outranks the capability gate. Needing prod credentials
//    is a reason to scope work that should happen — never a reason to re-open work that should not.
expect(
  'a confident reject was absorbed by the capability gate and came back as a scoping problem',
  { route: choice('reject', 0.95), done_stateable: noul(0.9), needs_external_capability: noul(0.95) },
  'reject',
);

// 2. An UNCERTAIN refusal is still a question for a human, not a verdict. Doubt may never buy the
//    route whose cost is that the work never happens at all.
expect(
  'an uncertain reject became a verdict instead of a question',
  { route: choice('reject', 0.6), done_stateable: noul(0.9), needs_external_capability: noul(0.95) },
  'scope',
);

// 3. Capability STILL outranks `lane`. A prod database migration fits no worktree this repo can
//    cut, so it scopes — that ordering is deliberate and survives the fix.
expect(
  'the capability gate stopped outranking lane',
  { route: choice('lane', 0.95), done_stateable: noul(0.9), needs_external_capability: noul(0.95) },
  'scope',
);

// 4. A confidently unstateable `done` still scopes. Neither inline nor lane means anything when
//    nobody can say what finishing looks like.
expect(
  'an unstateable done stopped scoping the task',
  { route: choice('inline', 0.95), done_stateable: noul(0.05), needs_external_capability: noul(0.05) },
  'scope',
);

if (failures.length) {
  console.error('RED reject-outranks-capability:\n  - ' + failures.join('\n  - '));
  process.exit(1);
}
console.log('GREEN reject-outranks-capability');
