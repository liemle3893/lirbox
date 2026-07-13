# arena evals — the arena floor

The contract `lirbox:arena` is judged against. **Committed source, not runtime state.**

## Floor (characterization — GREEN on baseline)

`run.mjs` runs every `floor/*.test.mjs` and exits 0 iff all pass. **The arena floor command:**

```
python3 <skill-creator>/scripts/quick_validate.py plugins/lirbox/skills/arena && node plugins/lirbox/skills/arena/evals/run.mjs
```

Current floor:
- `floor/00-structure.test.mjs` — SKILL.md frontmatter is valid (`name === 'arena'`, non-empty description).
- `floor/01-elo-characterization.test.mjs` — `bradleyTerry` produces the known dominance ranking (strong > mid >
  weak) on a frozen tally, pinning the scoring math a kept fix must not break.

## Regression net (not part of the floor, run directly)

`node plugins/lirbox/skills/arena/scripts/test-arena.cjs` — pure-helper units + emitted-loop structure markers +
the conductor-layer purity scan + the report renderer. Run after touching `scaffold-arena.cjs` or
`arena-report.cjs`.
