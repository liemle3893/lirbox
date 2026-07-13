# arena loop runtime — state schema + two-layer model

Read before authoring/debugging `scaffold-arena.cjs` or a generated `.arena/<name>.js`.

## Two layers (confusing them is the #1 bug)

- **Conductor** = the generated loop `.js`. PURE JS — no `fs`/`git`/`require`/`Date.now()`/`Math.random()`.
  It computes the cell plan (`planCells`), samples judge pairs (`pickPairSamples`), and tallies verdicts into
  ratings (`tallyVerdicts` → `bradleyTerry`/`winRateMatrix`). Enforced by the purity scan in `test-arena.cjs`.
- **Workers** = the `agent()` subagents it spawns. Full tools. Every side-effect lives here: clone the fixture,
  run conductor headless, capture the diff, judge, write the ledger, finalize.

The durable ledger is written ONLY by the **checkpoint worker**, after every unit (setup / each run / each
config-pair judged / score). The conductor never writes fs.

## Durable state — `.arena/state/<name>.json`

```jsonc
{
  "name": "arena-20260713-…",
  "startedAt": "ISO",           // stamped by the checkpoint worker (reads the clock; the conductor can't)
  "updatedAt": "ISO",
  "finishedAt": "ISO | null",
  "plan": { "cells": 12, "tasks": 2, "configs": 2 },
  "runs":   [ { "taskId", "configHash", "runIndex", "diffPath", "forfeit", "forfeitReason?" } ],
  "judges": [ { "taskId", "a": "<hashA>", "b": "<hashB>", "verdicts": [ { "winner": "A|B|tie", "swap": bool } ] } ],
  "ratings": { "<hash>": number },              // Bradley-Terry, normalized to sum = #configs
  "matrix":  { "<hash>": { "<hash>": number|null } },  // win-rate; diagonal null
  "tallies": [ { "a", "b", "aWins", "bWins", "ties" } ]  // aggregated across tasks
}
```

## Resume

Cells and judge-passes are AT-LEAST-ONCE: the checkpoint is written AFTER each unit's artifact lands, so a
crash between artifact and checkpoint re-runs that unit (idempotent — a re-clone + re-run overwrites). The main
session re-passes `runs`/`judges`/`ratings` via `args`; the loop skips any cell in `runs` and any config-pair in
`judges`. The conductor can't read fs, so resume state is data-in, not read-back.

## Config

A config tuple is `{ model, mode, effort }` (v1 — no `skillRef`; skills load from the plugin cache, not a git
checkout). `configHash` is a stable FNV-1a hex over the canonical (sorted-key) JSON, so it is generic over its
keys — re-adding a `skillRef` axis later is a config change, not a code change.
