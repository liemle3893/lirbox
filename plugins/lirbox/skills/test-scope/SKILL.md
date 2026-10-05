---
name: test-scope
description: Set up and continuously improve path-aware test selection for a repo whose full test suite or CI takes too long — run only the tests a change can affect, with a safeguard so nothing is missed. Use when the user says "tests take forever", "CI is too slow", "only run affected tests", "which tests should this change run", "set up test selection / test parts", "test-scope init", or "test-scope improve" (after a full/backstop run, a missed failure, or when selections grow too large). Any stack: vitest/jest, pytest, go; optional OpenCodeReview (ocr) rule routing.
---

<purpose>
A full suite per change does not scale; "run the files the change touches" by hand misses things.
Test selection is three layers plus a backstop, and the backstop's misses are the input to the next
improvement. `init` builds the layers once; `improve` turns evidence into rules, forever.
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
- **Respect the machine.** Selected tests run once, through the repo's lock/nice wrapper if it has
  one, one heavy job at a time. Never start the full suite to "double-check" a selection.
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
```
Config: `.test-scope/parts.json` (schema: `references/parts-schema.md`). Stack adapters and their
limits: `references/adapters.md`.
</scripts>

<init>
1. `detect`. Note every package, runner, wrapper (lock/nice script, CI matrix) and the suite's
   size; time the full suite if a recent duration is not already known — do not run it to find out
   if CI or logs say.
2. Draft parts from the **test tree** (test folders/names cluster into domains) and map **source
   dirs** onto them. Then walk `references/hidden-links.md` against this repo, grepping for each
   link class; each confirmed link becomes a `paths` glob with the evidence in a `_comment`.
3. Present the part table (part → tests → source globs → checks) and the run-everything list.
   Wait for approval; adjust granularity as the user asks.
4. Write `parts.json`; run `coverage` until every test file is owned and no glob is dead.
5. `replay --commits 20`: show median/max files selected vs. full. A commit that selects nearly
   everything names a trigger or hub that is too broad — fix it now.
6. Wire it in: a package script (`test:run`), the repo's agent/contributor docs (implementer runs
   `select --changed` once; reviewer adds parts on evidence; full suite = backstop), CI if any
   (select on PR, full on schedule). With OCR: `rules --write` and the reviewer uses delegate mode
   (`ocr delegate preview` → `ocr delegate rule <files>`) with the user's chosen model.
7. Acceptance: on a real recent commit, `select --list` matches what a careful human would run,
   one `run` is green, `coverage` and `rules --check` are clean. Report the numbers.
</init>

<improve>
Inputs, any of: a backstop result file, a reported miss ("X broke and we didn't run it"), a slow
selection, a repo that grew. Order:
1. **Misses first** (safety beats speed). `misses --results <file>`: for each failure the
   responsible commit's selection skipped, find the hidden link (grep the failing test's subject
   back to the changed file) and add the narrowest `paths` glob that would have selected it. No
   link found → say so; do not add a broad glob to make the number go away.
2. **Drift.** `coverage`: new test files without a part, dead globs, packages added since init.
3. **Over-selection.** `replay`: commits selecting far more than their diff suggests — a hub module
   or trigger; split the part or move a type-only hub to the typecheck instead of the tests.
4. **Slow parts.** From runner timings, the slowest files/parts; propose splitting or a separate
   schedule. Never drop a test to save time without the user's decision.
5. Present one diff (parts.json, rules, docs) with the evidence per change; after approval write,
   re-run `coverage`, `replay` and `rules --check`, and report before/after numbers.
Record each improve run (date, misses fixed, median selection before/after) in
`.test-scope/HISTORY.md` — the trend is the point.
</improve>
