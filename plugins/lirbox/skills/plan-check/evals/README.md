# plan-check evals

whetstone-readiness floor for `plan-check`.

- `assets/validate.mjs` — the report contract (see its header). The real
  invariant checker; both this floor and step 9 of the skill call it.
- `floor/structure.test.mjs` — characterization; **passes on baseline**. Pins that
  `validate.mjs` accepts a well-formed report and rejects each contract break.
- `fixtures/` — one clean report + one fixture per break.
- `checks/` — empty. whetstone writes one acceptance-check per filed concern here;
  each **fails on baseline** and is run one-at-a-time by the loop.

Floor command (must exit 0 on baseline):

```bash
node plugins/lirbox/skills/plan-check/evals/run.mjs
```

Backlog for whetstone: `plugins/lirbox/skills/feedback/plan-check.jsonl`.
