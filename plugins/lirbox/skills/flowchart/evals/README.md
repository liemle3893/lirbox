# flowchart evals — the whetstone floor + acceptance-checks

The contract `lirbox:whetstone` judges `flowchart` against. **Committed source, not runtime state**
(it survives baseline/worktree operations and is in whetstone's locked set — the fixer may never
edit `evals/**`). Do NOT gitignore it.

## Floor (characterization — GREEN on baseline)

`run.mjs` runs every `floor/*.test.mjs` and exits 0 iff all pass. **The whetstone floor command:**

```
python3 <skill-creator>/scripts/quick_validate.py plugins/lirbox/skills/flowchart && node plugins/lirbox/skills/flowchart/evals/run.mjs
```

Current floor:
- `floor/00-structure.test.mjs` — SKILL.md frontmatter is valid (name/description; name === dir).

> ⚠️ This is a THIN floor — it only pins frontmatter validity. **Add at least one behavior
> characterization test** under `floor/` (run this skill's validator/generator/asset and assert its
> output) before relying on whetstone, or a kept fix could silently break behavior the floor doesn't
> watch.

## Acceptance-checks (RED on baseline — one per backlog item)

`checks/*.check.mjs` are the per-concern checks whetstone drafts during setup, one per
`feedback/flowchart.jsonl` item. Each MUST fail on the unmodified skill (the discrimination gate) and
pass once the fix lands. Run one-at-a-time by the loop, never by `run.mjs`. None are committed yet.
