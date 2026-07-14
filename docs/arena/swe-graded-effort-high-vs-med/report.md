# Arena leaderboard — swe-graded-effort-high-vs-med

## Ranking (Bradley-Terry)

| Rank | Config | Rating |
|---|---|---|
| 1 | `7fa03fa6` | 1.333 |
| 2 | `11d899ef` | 0.667 |

## Win-rate matrix

Row config's win-rate vs column config (ties = 0.5).

| | `7fa03fa6` | `11d899ef` |
|---|---|---|
| `7fa03fa6` | — | 66.7% |
| `11d899ef` | 33.3% | — |

## Runs

- total runs: 4 · forfeited: 0


## Config legend + resolution rate (rung 1, SWE-graded)

| Hash | Config | Resolved |
|---|---|---|
| `11d899ef` | opus effort=high | 2/2 |
| `7fa03fa6` | opus effort=medium | 2/2 |

## ⚠️ Methodological finding — read before trusting the ranking above

The judge picked **shown-position B in all 6 passes** (including the swapped ones, where B = the other
config). That is position bias, not a quality preference (~3% probability by chance). With an **odd**
pass count (3: two unswapped + one swapped), a pure position artifact mechanically becomes a 2–1 "win"
for whichever config occupies position B more often — which is what the ranking above shows.

**Honest verdict of this run:** rung 1 — both configs **2/2 resolved** (SWE-graded, deterministic);
rung 4 — quality **indistinguishable** to the judge (position-bias artifact ⇒ treat as tie).

**Fix applied:** default judge passes changed to an EVEN count (exact position balance), so an
all-same-position judge yields an exact tie instead of a fake winner.
