# plan-deck evals

whetstone-readiness floor for `plan-deck`.

- `assets/validate.mjs` — the report contract (see its header). Both this floor and
  SKILL.md step 5 call it.
- `floor/structure.test.mjs` — characterization; **passes on baseline**. Pins that
  `validate.mjs` accepts a well-formed page and rejects each contract break.
- `fixtures/` — one clean page + one fixture per break.
- `checks/` — empty. whetstone writes one acceptance-check per filed concern here;
  each **fails on baseline** and is run one-at-a-time by the loop.

Floor command (must exit 0 on baseline):

```bash
node plugins/lirbox/skills/plan-deck/evals/run.mjs
```

Backlog for whetstone: `plugins/lirbox/skills/feedback/plan-deck.jsonl`.
