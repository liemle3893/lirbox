# conductor evals — the whetstone floor + acceptance-checks

This directory is the contract the `lirbox:whetstone` loop judges conductor against. It is
**committed source, not runtime state**: it survives baseline/worktree operations and lives in
whetstone's **locked set** (`evals/**` — the fixer may never edit it). Do NOT gitignore it.

## Floor (characterization — GREEN on baseline)

`run.mjs` runs every `floor/*.test.mjs` and exits 0 iff all pass. **This is the whetstone floor
command for conductor:**

```
node plugins/lirbox/skills/conductor/evals/run.mjs
```

It deliberately does NOT call skill-creator's `quick_validate.py`: that validator hard-fails on
conductor's (valid Claude Code) `argument-hint` frontmatter key. `floor/00-structure.test.mjs` does
a lenient structural check instead (decision: 2026-06-27 — keep `argument-hint`). Current floor:

- `floor/00-structure.test.mjs` — SKILL.md has parseable frontmatter with name/description/allowed-tools; name === dir.
- `floor/01-generator-net.test.mjs` — `scripts/test-scaffold.cjs` (16 combos + 17 evals + purity scan) is green.

When you run whetstone setup, set the config's `floor.cmd` to the single command above (NOT the
`quick_validate + run.mjs` default).

## Acceptance-checks (RED on baseline — one per backlog item)

`checks/*.check.mjs` are the per-concern checks whetstone drafts during setup, one per
`feedback/conductor.jsonl` item. Each MUST fail on the unmodified skill (the discrimination gate,
`check-baseline.cjs`) and pass once the fix lands. They are run **one-at-a-time by the loop**, never
by `run.mjs`. None are committed yet — they appear when you file a backlog and run setup.
