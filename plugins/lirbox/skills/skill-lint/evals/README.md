# skill-lint evals — the floor + acceptance-checks

The check-gate contract `skill-lint` is judged against (CLAUDE.md's "Changing a skill" rule).
**Committed source, not runtime state** (it survives baseline/worktree operations — `evals/**` is
never hand-edited by an automated fixer). Do NOT gitignore it.

## Floor (characterization — GREEN on baseline)

`run.mjs` runs every `floor/*.test.mjs` and exits 0 iff all pass. **The floor command:**

```
python3 <skill-creator>/scripts/quick_validate.py plugins/lirbox/skills/skill-lint && node plugins/lirbox/skills/skill-lint/evals/run.mjs
```

Current floor:
- `floor/00-structure.test.mjs` — SKILL.md frontmatter is valid (name/description; name === dir).

> ⚠️ This is a THIN floor — it only pins frontmatter validity. **Add at least one behavior
> characterization test** under `floor/` (run this skill's validator/generator/asset and assert its
> output) before trusting it to catch a regression, or a kept fix could silently break behavior the
> floor doesn't watch.

## Acceptance-checks (RED on baseline — one per backlog item)

`checks/*.check.mjs` are the per-concern checks drafted during setup (by hand, or by a future
improvement loop), one per `feedback/skill-lint.jsonl` item. Each MUST fail on the unmodified skill
(the discrimination gate) and pass once the fix lands. Run one-at-a-time, never by `run.mjs`. None
are committed yet.
