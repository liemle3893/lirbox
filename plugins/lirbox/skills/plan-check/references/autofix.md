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

The gate is the **fix class**, never the status. `REFUTED` is not the line: a claim can be
refuted by evidence that also fully determines its correction (the symbol moved; the target
does not exist), and transcribing that is not a decision. What is excluded is authorship —
any repair where the correct text is not already established, whatever the row's status.

- **A `REFUTED` row whose repair needs a new approach** — the plan's model of reality is
  wrong and the evidence does not say what to do instead. Choosing that is design. Autofix
  must not touch it, and must not let the plan read as if it had.
- **`BLIND-SPOT-RISK`** — a risk nobody weighed. The response is a judgement call about
  cost and appetite, which is the author's.
- **`UNVERIFIED` needing a live system** — no evidence exists yet to transcribe.
- **Anything altering scope, approach, sequencing intent, or an operator decision the
  plan records.** A file claimed by two tasks is *reported*; whether to merge the tasks or
  declare them serial is the author's call, not a repair.

## NO-GO is cleared by re-verification, never by the edit

<non-negotiable>
A verdict may improve ONLY because a row was re-checked against reality and came back
clean — never because the plan's text now reads better. Recompute the verdict from
re-verified rows alone. This is what stops laundering, and it is the whole of what stops
it; no status is banned from repair to achieve it.
</non-negotiable>

So a `NO-GO` carrying one `fix: mechanical` refutation — the plan names `make test-all`,
the Makefile has only `test` — can honestly become `GO-WITH-CONDITIONS`: the row is
transcribed to what the repo holds, re-run through steps 3–6, and comes back `VERIFIED`
on evidence. The verdict moved because the claim is now true, not because it was reworded.

A `NO-GO` whose refutations are all `fix: needs-decision` does not move, and must not be
made to. Autofix shrinks the decision set — clearing the mechanical rows so the remaining
blockers are only the ones that genuinely need a human.

To stop `NO-GO` being a dead end, each `REFUTED` row must carry **what would have to
change to clear it** — the concrete claim, evidence, or approach that would need to
differ. Then offer the handoff to `plan-deck` to re-author against those rows. Offer;
never auto-run, and never soften the verdict to unblock someone.
