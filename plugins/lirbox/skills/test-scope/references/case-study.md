# Case study — a graph that selected everything, and what proved it wrong

A 160-file vitest server. The selection had three layers (import graph, parts, backstop). Two
symptoms, one cause each, and one decision that the method now encodes.

## Symptom 1: a manifest edit selected 146 of 150 test files

The "run everything" trigger named the package manifest. The commit changed only its `scripts`
block. Fix: the trigger fires on **dependency fields only** (`dependencies`, `devDependencies`,
peers, optionals); a scripts-only edit is a no-test file. Replay of the commit: 146 -> 0.

## Symptom 2: a two-line fix selected 90 of 161 files

With the import graph always on, a small fix in one module selected 90 test files. Which chains
carried them? Per test, the shortest import chain to the changed file (an esbuild metafile and a
breadth-first search; today `trace <test> <source>` and `hubs --changed`):

| Fact | Number |
|---|---|
| tests selected by the graph alone (no part) | 73 |
| of those, reached the change **only** through the app composition root | 46 |
| the composition root's route | app module -> a generated domain registry that statically imports every domain -> the changed module |

Every test that mounts the whole app imports every domain, so "this module changed" reached all of
them. The graph was correct about imports and useless about behaviour.

## Does the route matter? A mutation test settled it

Not a guess, an experiment. Every function of the changed module was made to **throw on entry**
(the module still imports; only its bodies break), and only the 46 composition-root tests were run:

- failures attributable to the mutation: **0 of 46**
- time those tests cost on every such change: **845 s**
- the file was restored by a trap (`finally` + signal handlers); `git status` clean afterwards

Today that is `mutate --changed <base> --prove-irrelevant <the 46 tests>`: a test that fails with
the mutant's marker is relevant and must be selected; none did, so the 46 were proven irrelevant for
this change. The proof is per change: it does not make the route irrelevant forever.

## Two remedies

| | Remedy | Cost |
|---|---|---|
| a | `graphCuts`: ignore graph paths that go through a named hub; the coverage rule then requires every module behind the cut to be owned by a part | cheap, but the graph is now partly a lie that a part must backfill |
| b | Refactor the composition root so tests mount only what they use (inject / per-test composition); the graph becomes honest | real work, nothing to maintain afterwards |

**Decision: refactor where possible; cut only as an interim or where a refactor is impossible.**
`hubs` prints the recommendation in that order.

## Success metrics were defined BEFORE the refactor (commands with expected values)

| Metric | Command | Expected |
|---|---|---|
| parity | one full run before and one after, diffed per test | same files, same pass/fail, only known failures |
| the mutation is still caught | `mutate --changed <base>` on the known commit | no survivor |
| selection size, known commit | `select --changed <sha>~1 --to <sha> --resolve` | 90 -> <= 44 |
| replay | `measure --commits 20 --resolve`, before and after | median not worse, **p90 -50%** |
| wall time of the selected run | one timed `run --changed`, `measure --wall` | not worse |
| generated code | the generator's `--check` | current |
| typecheck / lint | the repo's own scripts | clean |

The result is reported as a lift (`measure --compare before after`), never as a bare number.

## Operations lessons that are now rules

- Never run the full suite by rule. The one exception is the parity run, when shared
  infrastructure (the composition root itself) changes.
- One heavy job at a time; resolution goes through the repo's lock wrapper, like a test run.
- Stream long runs with progress and failure signals and a bounded timeout. Never wait silently.
- Baseline before editing: editing during a baseline run corrupts it.
- The mutation must restore on every exit path: `finally`, signal handlers, and a journal for a
  SIGKILL. A refused dirty tree is cheaper than a lost change.

## What the method took from it

1. Dependency-field triggers (`runAll` is short and exact).
2. `hubs` / `trace` before widening or cutting anything; refactor first, `graphCuts` as interim.
3. `mutate --prove-irrelevant` before dropping a test from a selection; `mutate` and `changecov` on
   every change so "tests run" also means "tests execute the change".
4. A measurement phase around every structural change: plan, baseline, change, after, lift.
