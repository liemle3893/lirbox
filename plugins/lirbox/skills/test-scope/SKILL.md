---
name: test-scope
description: Set up and continuously improve path-aware test selection for a repo whose full test suite or CI takes too long — run only the tests a change can affect, with a safeguard so nothing is missed. Use when the user says "tests take forever", "CI is too slow", "only run affected tests", "which tests should this change run", "set up test selection / test parts", "test-scope init", "test-scope improve" (after a full/backstop run, a missed failure, or when selections grow too large), or "were my changes actually tested". Any stack: vitest/jest, pytest, go; optional OpenCodeReview (ocr) rule routing.
---

<purpose>
A full suite per change does not scale; "run the files the change touches" by hand misses things.
Test selection is three layers plus a backstop, and the backstop's misses are the input to the next
improvement. `init` builds the layers once; `improve` turns evidence into rules, forever; `measure`
and `per-change` keep both honest.
</purpose>

<model>
1. **Import graph (native, zero upkeep).** Every changed source file goes to the stack's
   related-test mechanism — `vitest related`, `jest --findRelatedTests`, the bundled Python
   reverse-import scan, `go list -deps -test`. Always, even when a part also matches it: parts are a
   safeguard ON TOP of the graph, never instead of it.
2. **Parts (explicit, for links imports cannot see).** `parts.json` maps source globs → test globs +
   checks. Migrations → the code that queries those tables; API types → generated handlers and
   fakes; i18n keys, error/audit codes compared as strings; config keys ↔ env/compose; fixtures,
   codegen, schemas. Catalogue: `references/hidden-links.md`.
3. **Reviewer (judgement, with evidence).** The reviewer reads the diff, the per-path rules and the
   repo's agent docs, and may ADD parts — each addition cites `file:line` of a consumer. A link it
   finds twice belongs in layer 2.
4. **Backstop.** The full suite runs on a schedule (nightly, pre-deploy), never per change. A
   failure in a test the change's selection skipped is a **miss**; every miss becomes a `paths`
   entry. This loop is what keeps selection honest as the repo grows.
5. **Hubs.** A composition root on most import chains makes layer 1 select everything: refactor
   it; `graphCuts` only as interim (`references/case-study.md`).
</model>

<hard-rules>
- **Every changed file is covered or explicitly exempt.** A changed file that selects no test and is
  not under `noTests` fails selection (exit 3). Silence is how gaps hide.
- **Measure before and after.** Never claim a speed-up or a safe selection without `replay`
  numbers (files selected per commit vs. the full suite) and a backstop result.
- **Run-everything triggers stay short:** runner config, DB bootstrap, auth schema, real dependency
  changes (not a scripts-only edit to a manifest). A broad trigger silently restores the full suite.
- **Parts never shrink on statistics alone.** "Never failed" is not "cannot fail"; remove a path only
  when the link it encodes is gone (cite the commit).
- **A change must be executed by its tests** (`changecov`, `mutate`); green tests that never run it
  prove nothing. Dropping tests (a cut, a narrower glob) needs `mutate --prove-irrelevant`.
- **Respect the machine.** One heavy job at a time, through the repo's lock/nice wrapper (resolution,
  `changecov`, `mutate` too), bounded timeout, streamed progress. No full run to "double-check" a
  selection; the parity run (measure) is the one exception.
- **Propose, then write.** `init` and `improve` present parts/rules/doc changes for the user's
  approval before writing; the user owns which parts exist.
</hard-rules>

<scripts>
```
TS=${CLAUDE_PLUGIN_ROOT}/skills/test-scope/scripts/test-scope.mjs   # node ≥ 20, no dependencies

node $TS detect                       stacks, runners, test-file inventory, lock/wrapper, CI files
node $TS select --changed [base] [--to ref] [--list|--json]
                                      graph + parts; prints every file with its reason
                                      --resolve also lists vitest/jest related tests (starts the runner, via the wrapper)
node $TS run    --part a,b | --changed [base] [--to ref]
                                      one runner invocation per package, through the wrapper
node $TS coverage                     every test file owned by a part or the graph; no dead globs
node $TS replay --commits N           selection size per commit vs. full suite (the speed-up claim)
node $TS misses --results <junit.xml|vitest.json|go-test.json> [--since <ref>]
                                      backstop failures the responsible commit's selection skipped
node $TS rules  --write|--check       optional: .opencodereview/rule.json `Test parts:` lines
node $TS measure [--commits N] [--resolve] [--label L] [--wall S]   record -> .test-scope/metrics.jsonl
node $TS measure --compare A B        lift per metric, B over A
node $TS changecov --changed [base]   selected tests with coverage: changed code none executes
node $TS mutate --changed [base] [--prove-irrelevant <globs|@file>]   would tests notice a break
node $TS trace <test> <source>        shortest import chain
node $TS hubs --changed [base]        chain per test; modules on most chains
node $TS doctor [--changed [base]]    every per-change check, numbered actions
```
Exit 3 = uncovered changed file; 4 = not measurable, never a pass. Config: `.test-scope/parts.json`
(`references/parts-schema.md`). Adapters, limits: `references/adapters.md`.
</scripts>

<init>
1. `detect`; plan the metrics first (measure). Note every package, runner, wrapper
   (lock/nice script, CI matrix) and the suite's size; time the full suite if a recent duration is
   not already known — do not run it to find out if CI or logs say.
2. Draft parts from the **test tree** (test folders/names cluster into domains) and map **source
   dirs** onto them. Then walk `references/hidden-links.md` against this repo, grepping for each
   link class; each confirmed link becomes a `paths` glob with the evidence in a `_comment`.
3. Present the part table (part → tests → source globs → checks) and the run-everything list.
   Wait for approval; adjust granularity as the user asks.
4. Write `parts.json`; run `coverage` until every test file is owned and no glob is dead.
5. `measure --commits 20 --label baseline`: median/max files selected vs. full. A commit that
   selects nearly everything names a trigger or hub that is too broad — `hubs`, fix it now.
6. Wire it in: a package script (`test:run`), the repo's agent/contributor docs (implementer runs
   `select --changed` once; reviewer adds parts on evidence; full suite = backstop), CI if any
   (select on PR, full on schedule). With OCR: `rules --write` and the reviewer uses delegate mode
   (`ocr delegate preview` → `ocr delegate rule <files>`) with the user's chosen model.
7. Acceptance: on a real recent commit, `select --list` matches what a careful human would run,
   one `run` is green, `doctor --changed` is clean; `measure --compare baseline <label>` gives the lift.
</init>

<improve>
Inputs, any of: a backstop result file, a reported miss ("X broke and we didn't run it"), a slow
selection, a repo that grew. Measure steps 1-2 first. Order:
1. **Misses first** (safety beats speed). `misses --results <file>`: for each failure the
   responsible commit's selection skipped, find the hidden link (grep the failing test's subject
   back to the changed file) and add the narrowest `paths` glob that would have selected it. No
   link found → say so; do not add a broad glob to make the number go away.
2. **Drift.** `coverage`: new test files without a part, dead globs, packages added since init.
3. **Over-selection.** `replay`: commits selecting far more than their diff suggests — a hub module
   or trigger; `hubs --changed` names it: refactor it (`graphCuts` interim), split the part, or move
   a type-only hub to the typecheck instead of the tests.
4. **Slow parts.** From runner timings, the slowest files/parts; propose splitting or a separate
   schedule. Never drop a test to save time without the user's decision.
5. Present one diff (parts.json, rules, docs) with the evidence per change; after approval write,
   re-run `coverage` and `rules --check`, then measure steps 4-5.
Record each improve run (date, misses fixed, lift) in `.test-scope/HISTORY.md` — the trend is the
point.
</improve>

<measure>
For `init`, `improve`, and any change to the selection or the code it depends on (a hub refactor).
Standard set: parity, mutant still caught, known-commit selection size, replay
median/p90, selected-run wall time, codegen current, typecheck/lint clean (`references/measurement.md`).
1. Plan each metric as a command + expected value BEFORE editing (`select --resolve` on a known
   commit: 90 -> <=44; `mutate --changed`: no survivor).
2. Baseline: `measure --label before`. No edits while it runs.
3. Change; `doctor --changed`.
4. After: `measure --label after`, same flags (vitest/jest: `--resolve`, else lower bounds).
5. Report the lift: `measure --compare before after` against each expectation, never a bare score.
The one justified full run: the parity check, when the composition root or shared infra changes.
</measure>

<per-change>
Every change (pre-commit, review, CI):

| Question | Command |
|---|---|
| Every changed file selected? | `select --changed` (exit 3 = no) |
| Changed functions executed? | `changecov --changed` |
| Logic change: would a break be noticed? | `mutate --changed` |
| New module, dir or test file owned? | `doctor` |
| New hidden link (schema, string key, config, codegen)? | part `paths` in the SAME diff, then `coverage`, `rules --check` |
| Selection over budget? | `hubs --changed`: refactor first, `graphCuts` interim |
| All of the above? | `doctor --changed` |

A new link or miss goes into parts/rules in the same change; `measure` tracks the trend.
</per-change>
