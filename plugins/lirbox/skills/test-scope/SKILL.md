---
name: test-scope
description: Set up and continuously improve path-aware test selection for a repo whose full test suite or CI takes too long — run only the tests a change can affect, with a safeguard so nothing is missed. Use when the user says "tests take forever", "CI is too slow", "only run affected tests", "which tests should this change run", "set up test selection / test parts", "test-scope init", "test-scope improve" (after a full/backstop run, a missed failure, or when selections grow too large), or "were my changes actually tested". Any stack: vitest/jest, pytest, go; optional OpenCodeReview (ocr) rule routing.
---

<purpose>
A full suite per change does not scale; picking files by hand misses things. Selection is three
layers plus a backstop whose misses feed the next improvement. `init` builds the layers once;
`improve` turns evidence into rules, forever; `measure` and `per-change` keep both honest.
</purpose>

<model>
1. **Import graph (native, zero upkeep).** Every changed source file goes to the stack's related-test
   mechanism (`vitest related`, `jest --findRelatedTests`, the bundled Python reverse-import scan,
   `go list -deps -test`) — always: parts are a safeguard ON TOP of the graph, never instead of it.
2. **Parts (for links imports cannot see).** `parts.json` maps source globs → test globs + checks:
   migrations → code querying those tables, API types → handlers and fakes, string-compared keys
   and codes, config ↔ env, fixtures, codegen, schemas (`references/hidden-links.md`).
3. **Reviewer (judgement, with evidence)** reads the diff, per-path rules and agent docs, and may ADD
   parts, each citing a consumer's `file:line`. A link it finds twice belongs in layer 2.
4. **Backstop.** The full suite runs on a schedule (nightly, pre-deploy), never per change. A failure
   in a test the selection skipped is a **miss**; every miss becomes a `paths` entry.
5. **Hubs.** A composition root on most import chains makes layer 1 select everything: refactor
   it; `graphCuts` only as interim (`references/case-study.md`).
6. **Workspaces.** Changed sources also reach workspace dependents' lookups (src or dist);
   dist-consumed upstreams build first (`prebuild`, `references/adapters.md`).
</model>

<hard-rules>
- **Every changed file is covered or explicitly exempt.** A changed file that selects no test and is
  not under `noTests` fails selection (exit 3). Silence is how gaps hide.
- **Measure before and after.** No speed-up or safe-selection claim without `replay` + a backstop result.
- **Run-everything triggers stay short:** runner config, DB bootstrap, auth schema, real dependency
  changes (not a scripts-only edit to a manifest). A broad trigger silently restores the full suite.
- **Parts never shrink on statistics alone.** "Never failed" is not "cannot fail"; remove a path only
  when the link it encodes is gone (cite the commit).
- **A change must be executed by its tests** (`changecov`, `mutate`); green tests that never run it
  prove nothing. Dropping tests (a cut, a narrower glob) needs `mutate --prove-irrelevant`.
- **Respect the machine.** One heavy job at a time, via the repo's lock/nice wrapper, bounded timeout,
  streamed progress. No full run to "double-check" a selection; measure's parity run is the exception.
- **Propose, then write.** `init`/`improve` changes wait for the user's approval; they own the parts.
</hard-rules>

<scripts>
```
TS=${CLAUDE_PLUGIN_ROOT}/skills/test-scope/scripts/test-scope.mjs   # node ≥ 20, no dependencies

node $TS detect                        stacks, runners, test inventory, lock/wrapper, CI files
node $TS select --changed [base] [--to ref] [--list|--json] [--resolve]   graph + parts, each with its reason
node $TS run --part a,b | --changed [base] [--to ref]   one runner invocation per package, via the wrapper
node $TS coverage                      every test file owned by a part or the graph; no dead globs
node $TS replay --commits N            selection size per commit vs. full suite (the speed-up claim)
node $TS misses --results <junit.xml|vitest.json|go-test.json> [--since <ref>]   backstop failures selection skipped
node $TS rules --write|--check         optional: .opencodereview/rule.json `Test parts:` lines
node $TS measure [--commits N] [--resolve] [--label L] [--runs <jsonl>] | --compare A B   -> .test-scope/metrics.jsonl
node $TS changecov --changed [base]    selected tests with coverage: changed code none executes
node $TS mutate --changed [base] [--prove-irrelevant <globs|@file>]   would tests notice a break
node $TS trace <test> <source>         shortest import chain
node $TS hubs --changed [base]         chain per test; modules on most chains
node $TS doctor [--changed [base]]     every per-change check, numbered actions
```
`--resolve` lists vitest/jest related tests (starts the runner, via the wrapper). Exit 3 = uncovered
changed file; 4 = not measurable, never a pass. Config: `.test-scope/parts.json`
(`references/parts-schema.md`). Adapters, limits: `references/adapters.md`.
</scripts>

<init>
Once per repo; steps in `references/init.md`: `detect` → parts drafted from the test tree and
`references/hidden-links.md` → approval → `parts.json` until `coverage` is clean → `measure
--commits 20 --label baseline` → wire into scripts, agent docs, CI. Done when `select --list` on a
recent commit matches what a careful human would run and `doctor --changed` is clean.
</init>

<improve>
On a backstop result, a miss, a slow selection or a grown repo; steps in `references/improve.md`.
Measure steps 1-2, then in order: misses (safety beats speed), drift, over-selection, slow parts.
One diff with evidence, written after approval; measure steps 4-5; log the run in `.test-scope/HISTORY.md`.
</improve>

<measure>
For `init`, `improve`, and any change to the selection or what it depends on (a hub refactor).
Primary: real selected-run time per change (median/p90, `--runs`), tests reached only via a hub
(`--resolve`; target 0), parity. File counts are informational (`references/measurement.md`).
1. Plan each metric as a command + expected value BEFORE editing (`mutate --changed`: no survivor).
2. Baseline: `measure --label before`. No edits while it runs.
3. Change; `doctor --changed`.
4. After: `measure --label after`, same flags (vitest/jest: `--resolve`, else lower bounds).
5. Report the lift: `measure --compare before after` per expectation, never a bare score.
The one justified full run: parity, when the composition root or shared infra changes.
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
</per-change>
