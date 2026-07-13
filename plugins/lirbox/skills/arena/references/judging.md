# arena judging — pairwise rubric, forfeit filter, position balance

## What is judged

ONLY the **delivered diff** — the code conductor produced for the task, judged on correctness, completeness
against the acceptance criteria (`task.md`), and quality. Not the process, not the docs, not token count.

## Gates are a FORFEIT filter, not a judged dimension

A run is marked `forfeit` (it cannot win) when, in the cell worker:

- conductor did NOT genuinely engage (no `.workflows/` dir, no `wf/` branch, no `Workflow` tool_use in the
  trace) — headless claude implements small tasks directly, and a plain-claude fallback must NOT be scored as a
  conductor result (proven by the Task 0 spike);
- its gates failed / it errored / it timed out against `cellCapSec` / it produced no diff.

Whole-pair resolution before judging (`resolveForfeit`): if exactly one config has zero valid runs, the other
wins the pair; both zero → tie; both have valid runs → judge normally. Forfeited cells are **flagged in the
report**, never silently dropped.

## Pairwise passes — position balance

Per task, per unordered config-pair: `PASSES` (default 5) blinded passes (`judgePass`). `pickPairSamples` rotates
over the available run indices (folding run-variance into the passes) and alternates `swap` so shown-A/shown-B
position bias cancels. `tallyVerdicts` un-swaps each verdict back to the true config before counting.

> Caveat: with 5 passes only 2 are swapped (3 unswapped) — a small residual order bias toward position A.
> Acceptable for v1; use an even `judges` budget for exact balance.

## Scoring

`tallyVerdicts` per pair → aggregate across tasks → `bradleyTerry` (Elo-style rating, headline) + `winRateMatrix`
(the raw, legible number the report leads with). Ratings are deterministic (fixed iterations, ratings init 1.0,
ties split 0.5) so the same tally always yields the same ranking.

## Oversized diffs

A delivered diff can exceed the judge's context. The judge worker is told to judge on the diff's head + a summary
and say so in `reason`, rather than silently truncating one side and biasing the verdict.
