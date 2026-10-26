# Autofix — repairing the plan in place

plan-check's output is a judgement. Autofix turns the rows whose repair is settled into edits to
the plan file itself. A row's repair is settled when the evidence determines it (`fix:
mechanical`) or when the human has stated the decision (`fix: needs-decision`, answered).

Edit the plan **in place**. Git is the record of what changed and why — the report names the
evidence for each edit. If the plan is untracked or has uncommitted changes, say so before
editing: then there is no record to fall back on. A pasted plan has no file; list each fix in the
report as exact old → new text instead.

## What is mechanical

The fix is transcription, not authorship — the correct text is already established by evidence
gathered during the check.

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

## What needs a decision

The gate is the **fix class**, never the status. `REFUTED` is not the line: a claim can be
refuted by evidence that also fully determines its correction (the symbol moved; the target
does not exist), and transcribing that is not a decision. What needs a decision is authorship —
any repair where the correct text is not already established, whatever the row's status.

- **A `REFUTED` row whose repair needs a new approach** — the plan's model of reality is
  wrong and the evidence does not say what to do instead. Choosing that is design. Autofix
  must not choose it, and must not let the plan read as if it had.
- **`BLIND-SPOT-RISK`** — a risk nobody weighed. The response is a judgement call about
  cost and appetite, which is the author's.
- **`UNVERIFIED` needing a live system** — no evidence exists yet to transcribe.
- **Anything altering scope, approach, sequencing intent, or an operator decision the
  plan records.** A file claimed by two tasks is *reported*; whether to merge the tasks or
  declare them serial is the author's call, not a repair.

Ask for the decision. Once the human states it, writing it into the plan is transcription
again — apply it like a mechanical row. Never pick one for them.

## The verdict follows the rows

After editing, re-adjudicate each fixed row against the evidence that settled it — the
Makefile that has `test`, the human's answer — update its status and cite that evidence, then
re-run `validate.mjs`. The verdict is whatever the rows now derive. A `NO-GO` whose blocking
rows were all decided and applied can become `GO`; one with a decision still outstanding stays
`NO-GO`. No verdict is frozen, and none moves without a row that moved first.

To stop `NO-GO` being a dead end, each blocking row carries **what would have to change to
clear it**. Offer the handoff to `plan-deck` when the change is bigger than an edit. Offer;
never auto-run.
