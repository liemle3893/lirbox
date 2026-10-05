# Measurement — metrics, plans and the parity procedure

Every change to the selection (parts, triggers, `graphCuts`, adapters) or to the code structure that
the selection depends on (a refactor of a hub, a split package) is judged by numbers fixed **before**
the change. A plan states each metric as a **command and an expected value**; an expectation written
after seeing the result is a description, not a gate.

## The plan (write it down first)

| # | Metric | Command | Expected (example) |
|---|---|---|---|
| 1 | Parity: same files, same pass/fail per test, only known failures | the one justified full run, before and after, results diffed (below) | identical sets |
| 2 | Safety: a break in the changed code is still caught | `mutate --changed <base>` (or `--prove-irrelevant` for tests being dropped) | no survivor, no relevant dropped test |
| 3 | Selection size for a known commit | `select --changed <sha>~1 --to <sha> --resolve --json` | 90 -> <= 44 |
| 4 | Selection size across history | `measure --commits 20 --resolve --label X`, `measure --compare before after` | p90 -50%, median not worse |
| 5 | Wall time of a selected run | time one `run --changed ...`, pass `measure --wall <s>` | not worse; ideally the lift of #4 |
| 6 | Misses | `misses --results <backstop file>` or `measure --results` | 0 new |
| 7 | Hygiene | `coverage`, `rules --check`, codegen current, typecheck, lint | clean |
| 8 | The change itself is tested | `doctor --changed <base>` | clean |

Pick the rows that apply; keep the expectation next to the command in the plan, in the PR or in
`.test-scope/HISTORY.md`.

## Record, then compare

`measure` appends one JSON line per call to `.test-scope/metrics.jsonl`:

| Field | Meaning |
|---|---|
| `label`, `sha`, `dirty`, `ts` | what was measured and when; use the same labels in the plan |
| `selection.median/p90/max` (+ `...Percent`) | files selected per commit over the last `--commits` first-parent commits |
| `selection.lowerBoundCommits` | commits whose vitest/jest graph was not resolved: the figure is a lower bound; add `--resolve` |
| `runAllRate` | share of commits that select the whole suite (too-broad triggers) |
| `uncoveredRate` | share of commits with a changed file that selects no test (exit 3) |
| `parts` | number of parts (information, never a goal) |
| `drift` | `unowned`, `dead` globs, `problems`, `cutUnowned` (modules behind a `graphCuts` hub that no part owns) |
| `misses` | last known backstop misses; `fresh: false` means carried forward, not re-measured |
| `wallSeconds` | only when `--wall` is given: node cannot time your runner for you |

`measure --compare A B` prints the lift of the latest record labelled B over the latest labelled A:
value, delta, percent and `better / worse / same` (lower is better for every metric except `parts`).
Report that table, not a bare score: "p90 90 -> 44 (-51%)" says something, "44" does not. A replay
is an estimate on the checked-out tree (`replay` resolves history against the current graph), so
compare like with like: same `--commits`, same `--resolve`.

## The parity procedure (the one justified full run)

Allowed only when the change touches shared infrastructure: the composition root, a runner config,
a shared test helper, the graph itself. Never "to double-check" a selection.

1. Baseline first. No edits, no other heavy job, while it runs (editing during a baseline corrupts it).
2. Run the full suite through the repo's lock wrapper with a machine-readable reporter
   (`--reporter=json` / junit), stream progress and failure lines, give it a bounded timeout, and
   save the file as `before`.
3. Make the change. Run the full suite again the same way: `after`.
4. Diff per test: same files, same pass/fail, same skipped. Differences must be only the failures
   already known before the change (name them). Anything else blocks.
5. Record both file names and the verdict in the PR; delete nothing from `before` until merged.

## Rules that keep the numbers honest

- One heavy job at a time; resolution (`--resolve`, `trace`, `hubs`, `mutate`, `changecov`) goes
  through the repo's lock wrapper like a test run does.
- Long runs stream progress and failure signals and have a bounded timeout. Never wait silently.
- Do not tune the metric: a part that selects a test only to move the count is a regression of #2.
- A metric that cannot be measured says so (`not measurable`, exit 4); it is not a pass.
