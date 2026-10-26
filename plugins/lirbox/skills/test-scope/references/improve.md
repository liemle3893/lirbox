# test-scope improve — turn evidence into rules

Run from SKILL.md's `<improve>`. Commands are `node $TS <verb>` as listed in SKILL.md's `<scripts>`.

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
4. **Slow parts.** From runner timings, the slowest files/parts: propose splitting or a separate
   schedule. Never drop a test to save time without the user's decision.
5. Present one diff (parts.json, rules, docs) with the evidence per change; after approval write,
   re-run `coverage` and `rules --check`, then measure steps 4-5.
Record each improve run (date, misses fixed, lift) in `.test-scope/HISTORY.md` — the trend is the
point.
