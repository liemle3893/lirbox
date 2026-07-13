# Arena leaderboard — real-conductor-opus-vs-baseline

## Ranking (Bradley-Terry)

| Rank | Config | Rating |
|---|---|---|
| 1 | `7cdd3fe6` | 2.992 |
| 2 | `8f6732dd` | 0.008 |
| 3 | `f750a2aa` | 0 |

## Win-rate matrix

Row config's win-rate vs column config (ties = 0.5).

| | `7cdd3fe6` | `8f6732dd` | `f750a2aa` |
|---|---|---|---|
| `7cdd3fe6` | — | 100% | 100% |
| `8f6732dd` | 0% | — | 100% |
| `f750a2aa` | 0% | 0% | — |

## Runs

- total runs: 6 · forfeited: 3
- ⚠️ forfeited cells (excluded from scoring, NOT silently dropped):
  - `notes-add-tags` / `f750a2aa` run 0 — no-wf-or-timeout
  - `notes-add-tags` / `f750a2aa` run 1 — no-wf-or-timeout
  - `notes-add-tags` / `8f6732dd` run 1 — no-wf-or-timeout


## Config legend

| Hash | Conductor | Model | Note |
|---|---|---|---|
| `7cdd3fe6` | 7a2c5ee | opus | current conductor (content-verification) |
| `f750a2aa` | 7a2c5ee | sonnet | current conductor |
| `8f6732dd` | 455ff36 | opus | baseline conductor (skill-lint era) |
