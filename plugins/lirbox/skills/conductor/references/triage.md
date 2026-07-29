# Triage detail — pick ONE tier (SKILL.md step 1b)

SKILL.md keeps the DECISION (which tier, which flag, the hard rules); this file holds the HOW —
long-form probes, formats, precedence and worked examples. Split out of the old `run-planning.md`
so a run loads only the step it is on.

Classify the goal and pick ONE tier. Bias **down** — do not reach for a bigger profile than the
work earns.

- **decline** — trivial / one-shot / single-file; finishes in one pass and won't span sessions.
  Conductor is overkill: say so, do it inline or call the Workflow tool directly, and **STOP**.
  This applies **even if conductor was invoked explicitly** (e.g. `/lirbox:conductor <goal>` or
  by name) — explicit invocation selects the skill, it does not license skipping triage or
  jumping straight to scaffold/launch. Regardless of how directly conductor was called, when
  triage lands on decline you must still surface the cost/overkill caveat and offer to do the
  work inline **before** generating or launching anything.
- **bare** — multi-step but low-risk, no PR/ticket/gates → generator with just `--phases` (or
  the default single `Work`).
- **lite** — routine delivery, small/low-risk PR → `--profile lite`.
- **delivery** — substantial or risky: broad surface, migration, behavioral change, must not
  regress → `--profile delivery`.

Signals that push **up** a tier: spans sessions · losing progress is costly · many files
touched · behavioral/endpoint change · needs review/tests/docs/PR/ticket. With none present,
pick the lowest tier. When the signals are genuinely ambiguous, ask the user **one**
`AskUserQuestion` (decline / bare / lite / delivery) rather than guessing big.
