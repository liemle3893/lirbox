# Skill-train — pointing prospector at a SKILL (the SkillOpt recipe)

Reference for running prospector with a **skill's text as the optimization surface** and a **scored
task set as the metric** — i.e. Microsoft SkillOpt's loop (skill file as trainable parameter,
frozen model, validation-gated edits) built from prospector's existing machinery. Load this when
the goal is "make skill X better at its job", not "make code Y faster".

Background: `docs/skillopt-exploration.md` (repo root) maps SkillOpt onto prospector/whetstone.
Use **whetstone** instead when you have a *backlog of specific concerns* (binary checks);
use **skill-train** when you have (or can write) *many small graded tasks* and want to hill-climb
the pass rate.

---

## 1. Scaffold the scored task set

```
node plugins/lirbox/skills/whetstone/scripts/scaffold-readiness.cjs --name <skill> --scored
```

This writes (idempotently) on top of the normal whetstone floor:

```
<skill>/evals/
  run.mjs                 # the FLOOR runner (green on baseline — the gate)
  run-scored.mjs          # the METRIC: runs tasks/<split>/*.test.mjs, prints `score=<pct>`
  tasks/train/*.test.mjs  # tasks whose FAILURES may be shown to the propose worker
  tasks/val/*.test.mjs    # HELD-OUT tasks — the keep decision runs here, NEVER shown to the worker
```

Write each task as a small deterministic `*.test.mjs` that exercises the skill's *output surface*
(run its validator/generator/asset against a fixture; assert). Split them yourself — roughly
50/50, val at least 4 tasks (a 1-task val flips 0↔100 and `minDelta` can't smooth that).

## 2. The config (what makes it SkillOpt and not overfitting)

**You don't hand-write this.** `scaffold-skilltrain-config.cjs --name <skill>` (invoked for you by
prospector's `skill <name>` mode) emits it verbatim from the skill's scored eval set — every field
below is mechanically derived from the skill path. The template, annotated:

```jsonc
{
  "goal": "improve <skill>: raise the held-out task pass rate. To see what is failing, run `node <skillPath>/evals/run-scored.mjs --split train` — NEVER run --split val (it is the held-out judge; using it is gaming the metric).",
  "surface": "<skillPath>/SKILL.md, <skillPath>/references/**, <skillPath>/assets/**, <skillPath>/scripts/**",
  "metric": { "cmd": "node <skillPath>/evals/run-scored.mjs --split val", "parse": "score=([0-9.]+)", "direction": "max" },
  "gate":   { "cmd": "node <skillPath>/evals/run.mjs" },        // + quick_validate when the skill has no argument-hint
  "budgets": { "agentCapSec": 600, "total": { "experiments": 30 }, "plateauStop": 8,
               "minDelta": 1, "maxDiffLines": 120 }
}
```

The four load-bearing choices:

1. **Surface EXCLUDES `evals/**`** — prospector's surface is include-only globs, so lock the eval
   set *by omission*: enumerate the editable dirs (`SKILL.md`, `references/**`, `assets/**`,
   `scripts/**`) and never a glob that covers `evals/`. A worker edit to any eval file then fails
   the surface lock and the experiment is discarded. This is the same fence whetstone builds with
   `editable − locked`.
2. **Metric runs the VAL split; the goal text points the worker at TRAIN.** That is SkillOpt's
   held-out validation gate: the proposer learns from train failures, but a change is KEPT only if
   *val* — tasks it never saw — improves. Without this the loop learns the eval tasks, not the task
   family, and the score is a lie. Known limit: the propose worker has full tools and *could* run
   `--split val` despite the instruction; the surface lock stops it *editing* val, not *reading*
   it. Acceptable for v1 — the branch is human-reviewed — but check the propose transcripts if a
   run looks too good.
3. **Gate = the whetstone floor** (`run.mjs`, plus `quick_validate.py` when applicable) — validity
   and characterization stay non-negotiable regardless of score.
4. **`maxDiffLines`** (the textual learning rate) — bound each step so the diff stays reviewable
   and the ledger digest stays meaningful. ~120 lines is a sane default for prose skills.

`minDelta: 1` means "at least one percentage point" — below that, a val-set of n tasks can't
distinguish signal from a single flaky task. With `repeat > 1` the runner is deterministic, so
leave `repeat` at 1 unless tasks themselves are stochastic.

## 3. Run it

One trigger — prospector generates the config, confirms once, and launches:

```
/lirbox:prospector skill <skill>
```

(SKILL.md step 1c → 2 → 3: generate config → confirm → baseline (gate + val score) → hill-climb →
review `opt/<name>` + report. Nothing is auto-merged.) The gate defaults to the floor `run.mjs`
alone — always runnable; its `00-structure.test.mjs` is the lenient `quick_validate` stand-in. If
the skill has no `argument-hint` and you want the stricter frontmatter check, add
`python3 <skill-creator>/scripts/quick_validate.py <skillPath> &&` in front of the gate in the
generated config before confirming.

## 4. Or: harvest the failures into whetstone instead

When you'd rather work *specific* failures than hill-climb the aggregate score, close the loop the
other way:

```
node plugins/lirbox/skills/whetstone/scripts/harvest-feedback.cjs <skill>
```

Each failing **train** task becomes a `feedback/<skill>.jsonl` item whose `acceptanceCheck` IS that
task — RED-on-baseline by construction (it was just observed failing), already inside the locked
`evals/**` set. Then run `whetstone <skill>` normally. The harvester refuses `--split val` — the
held-out judge must never feed the fixer. Rough guide: few, diagnosable failures → harvest +
whetstone; many diffuse failures → skill-train hill-climb.

## 5. DECLINE cases (same fit test as metric-gate.md)

- **Fewer than ~8 total tasks** → the score is too coarse to hill-climb; file concerns and use
  whetstone instead.
- **Tasks that need an LLM to judge** → not deterministic; the metric can't be trusted unattended.
- **No floor** → a rising score can hide a broken skill; scaffold the floor first (`--scored`
  includes it).
