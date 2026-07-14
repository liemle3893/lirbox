# Conductor scoreboard — absolute SWE-style scores

**Score = resolution rate over the frozen suite** (hidden F2P turn green + fixture P2P stays green,
per cell). Runs are INDEPENDENT: benchmark a new config/version alone, compare against the rows below.
**Only rows with the same suite hash are comparable** (current: `68fc7b29894a`, tasks: notes-add-tags, notes-archive, notes-fix-data-loss, notes-import-export, notes-search, notes-sync-merge, uglify-corner-cases);
⚠️stale-suite rows predate a suite change. Wilson 95% CI shown — with few cells the interval is wide;
treat overlapping intervals as "not distinguished yet," and raise runs to tighten.

| Run | Date | Suite | Config | Resolved | 95% CI | F2P tests |
|---|---|---|---|---|---|---|
| base-opus48-1m-high | 2026-07-14 | `484dce71c275` ⚠️stale-suite | claude-opus-4-8[1m] / high | **5/5 (100%)** | 57%–100% | 15/15 |
| base-opus48-1m-med | 2026-07-14 | `484dce71c275` ⚠️stale-suite | claude-opus-4-8[1m] / medium | **4/5 (80%)** | 38%–96% | 12/12 |
| base-sonnet5-high | 2026-07-14 | `484dce71c275` ⚠️stale-suite | claude-sonnet-5 / high | **2/5 (40%)** | 12%–77% | 6/6 |
| t3-opus-high | 2026-07-14 | `d6f7224a5da7` ⚠️stale-suite | claude-opus-4-8 / high | **2/2 (100%)** | 34%–100% | 6/6 |
| t3-opus-med | 2026-07-14 | `d6f7224a5da7` ⚠️stale-suite | claude-opus-4-8 / medium | **2/2 (100%)** | 34%–100% | 6/6 |
| x-uglify-conductor-opus48-high | 2026-07-14 | `68fc7b29894a` | claude-opus-4-8[1m] / high | **0/1 (0%)** | 0%–79% | 0/0 |
| x-uglify-conductor-v2-opus48-high | 2026-07-14 | `68fc7b29894a` | claude-opus-4-8[1m] / high / /Users/liemlhd/Documents/git/Personal/lirbox/.worktrees/improve-conductor-20260714-182449/plugins/lirbox | **0/1 (0%)** | 0%–79% | 0/6 |

Produce a new row: `node plugins/lirbox/skills/arena/scripts/swe-run.mjs --name <label> --model <m> --effort <e> [--plugin-dir <lirbox-checkout>] [--runs N]`
Quality-beyond-correctness (style, coverage, thoroughness) is NOT in this score — that stays pairwise
(the arena's judge layer, among resolved runs only).
