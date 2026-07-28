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

## Frozen acceptance-checks (`checks/`)

One `checks/<item>.check.mjs` per filed concern — RED before its fix, GREEN after. Every check MUST be
listed in `checks-manifest.json` (`expect: green|red`); `scripts/evals-all.mjs` fails the repo-wide gate
on a check that is on disk but unlisted, or listed with no file.

- `engagement-measured-not-assumed` — engagement is READ off each `.grade` record, never assumed:
  `engaged: false` counts as non-engaged, a legacy record with no `engaged` field stays UNKNOWN (†),
  and `swe-run.mjs` writes a record for every cell rather than only the engaged ones.

## Regression net (not part of the floor, run directly)

`node plugins/lirbox/skills/arena/scripts/test-arena.cjs` — pure-helper units + emitted-loop structure markers +
the conductor-layer purity scan + the report renderer. Run after touching `scaffold-arena.cjs` or
`arena-report.cjs`.
