# Conductor scoreboard — absolute SWE-style scores

**Score = resolution rate over the frozen suite** (hidden F2P turn green + fixture P2P stays green,
per cell). Runs are INDEPENDENT: benchmark a new config/version alone, compare against the rows below.
**Only rows with the same suite hash are comparable** (current: `484dce71c275`, tasks: notes-add-tags, notes-archive, notes-fix-data-loss, notes-import-export, notes-search);
⚠️stale-suite rows predate a suite change. Wilson 95% CI shown — with few cells the interval is wide;
treat overlapping intervals as "not distinguished yet," and raise runs to tighten.

| Run | Date | Suite | Config | Resolved | 95% CI | F2P tests |
|---|---|---|---|---|---|---|
| t3-opus-high | 2026-07-14 | `d6f7224a5da7` ⚠️stale-suite | claude-opus-4-8 / high | **2/2 (100%)** | 34%–100% | 6/6 |
| t3-opus-med | 2026-07-14 | `d6f7224a5da7` ⚠️stale-suite | claude-opus-4-8 / medium | **2/2 (100%)** | 34%–100% | 6/6 |

Produce a new row: `node plugins/lirbox/skills/arena/scripts/swe-run.mjs --name <label> --model <m> --effort <e> [--plugin-dir <lirbox-checkout>] [--runs N]`
Quality-beyond-correctness (style, coverage, thoroughness) is NOT in this score — that stays pairwise
(the arena's judge layer, among resolved runs only).
