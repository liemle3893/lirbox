# Autofix — repairing the plan without laundering it

plan-check's output is a judgement. Autofix turns the subset of that judgement whose
repair is **determined by the finding itself** into an edit, and leaves the rest alone.
The line is not severity — it is whether fixing requires a *decision*.

<non-negotiable>
The input plan is NEVER modified. Write a sibling `<plan>.autofix.md` (or, for a pasted
plan, a new file next to the report). The original and the report are the evidence that
justified every edit; overwriting the thing you audited destroys the audit.
</non-negotiable>

<non-negotiable>
An autofixed row is UNVERIFIED again until re-checked. Applying a fix invalidates the
report that motivated it. Re-run steps 3–6 on every touched proposition and re-emit the
report before the verdict is recomputed. A verdict that improved because the plan was
edited, without re-verification, is the exact failure this skill exists to prevent.
</non-negotiable>

## What is mechanical (autofixable)

The fix is transcription, not authorship — the correct text is already established by
evidence gathered during the check.

- **An undeclared dependency edge** — the plan states it in step prose ("run this after
  Task 1 has landed") but the task's dependency block declares nothing. Copy the edge
  into the block. You are not deciding the edge exists; the plan already said so.
- **A `Files:` list missing a file its own steps edit** — the steps are the evidence.
- **A stale reference** — a `file:line`, symbol, or path verified against the repo as
  moved or renamed. Correct it to what the repo actually holds, and cite it.
- **A command form proven not to work** — e.g. a flag the Makefile recipe never reads, a
  test invocation that skips rather than fails. Replace with the form you verified.
- **A missing DoD** — step 8 already derives one for the report; write that same DoD back
  into the plan.

## What needs a decision (never autofixed)

- **`REFUTED`** — the plan's model of reality is wrong. Choosing the new approach is
  design. Autofix must not touch it, and must not let the plan read as if it had.
- **`BLIND-SPOT-RISK`** — a risk nobody weighed. The response is a judgement call about
  cost and appetite, which is the author's.
- **`UNVERIFIED` needing a live system** — no evidence exists yet to transcribe.
- **Anything altering scope, approach, sequencing intent, or an operator decision the
  plan records.** A file claimed by two tasks is *reported*; whether to merge the tasks or
  declare them serial is the author's call, not a repair.

## NO-GO is not cleared by autofix

A `NO-GO` means a critical-path claim is `REFUTED`, and that class is never autofixable —
so autofix can never turn `NO-GO` into `GO`. What it does is shrink the decision set:
clear the mechanical rows so the remaining blockers are only the ones that genuinely need
a human. The verdict is then recomputed from re-verified rows alone.

To stop `NO-GO` being a dead end, each `REFUTED` row must carry **what would have to
change to clear it** — the concrete claim, evidence, or approach that would need to
differ. Then offer the handoff to `plan-deck` to re-author against those rows. Offer;
never auto-run, and never soften the verdict to unblock someone.
