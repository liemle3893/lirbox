# Conductor scoreboard — absolute SWE-style scores

> ## ⛔ EVERY ROW ON THIS PAGE WAS MEASURED AT THE CEILING — 2026-08-01
>
> A raw-arm headroom probe measured **all 7 registered graded tasks against a bare `claude -p`
> session with no skill, no conductor and no plugin injection**. Raw resolved **7 of 7**, at full
> marks, and five of them in **under 90 seconds** ($2.12 total).
>
> | task | difficulty | raw sonnet-5 | time |
> |---|---|---|---|
> | notes-add-tags | easy | 3/3 | 62s |
> | notes-archive | easy | 3/3 | 55s |
> | notes-search | medium | 3/3 | 71s |
> | notes-import-export | medium-hard | 3/3 | 57s |
> | notes-fix-data-loss | **hard** | 3/3 | **84s** |
> | notes-sync-merge | xhard | 4/4 | ~25m (prior, experiments.md) |
> | uglify-corner-cases | xxhard | 6/6 | ~53m (prior, experiments.md) |
>
> **Lift is bounded at zero on a task the control already passes.** Every comparison recorded below
> is therefore between two configurations solving problems neither needed help with, and no row here
> supports a claim that one config is better than another. The numbers are real; what they measure
> is the fixtures' difficulty, not the skill.
>
> This also explains the engagement finding called out further down: on a saturated suite the only
> quantity that *can* vary between arms is whether the harness engaged at all.
>
> **Do not add rows to this board until the suite discriminates.** Reproduce the probe with
> `scripts/raw-headroom-probe.mjs`. Full analysis: [../../loop-consolidation.md](../../loop-consolidation.md).

**Score = resolution rate over the frozen suite** (hidden F2P turn green + fixture P2P stays green,
per cell). Runs are INDEPENDENT: benchmark a new config/version alone, compare against the rows below.
**Only rows with the same suite hash are comparable** (current: `68fc7b29894a`, tasks: notes-add-tags, notes-archive, notes-fix-data-loss, notes-import-export, notes-search, notes-sync-merge, uglify-corner-cases);
⚠️stale-suite rows predate a suite change. Wilson 95% CI shown — with few cells the interval is wide;
treat overlapping intervals as "not distinguished yet," and raise runs to tighten.

**A low headline may be ENGAGEMENT failure, not quality failure — check the Engaged column first.**
A cell scores 0 both when the skill ran and got the change wrong AND when the skill never ran at all
(no `wf/` branch). Those are different defects with different fixes: non-engagement is a skill/prompt
problem, wrong output is a model-capability problem. **Engaged** = cells that produced a `wf/` branch;
**Resolved | Eng** = resolution among only those. Worked example: `base-sonnet5-high` reads **2/5 (40%)**,
but engaged only 2/5 and resolved 2/2 of what it attempted — every failure in that row is
non-engagement, and nothing in it supports "worse at the work". Never read the headline alone.

**Minimum detectable effect.** The suite is ~7 cells and `--runs 1` is the default, so n ≈ 7 per arm:
only differences of roughly **20 percentage points or larger** are detectable here. Resolving ~10pp
would need on the order of **293 observations per arm**. Overlapping Wilson intervals mean "not
distinguished yet" — not "equal", and not "one is better".

**There is currently NO usable cross-model engagement comparison** — worth stating plainly, because
the apparent one is a trap. `base-sonnet5-high` measured 2/5, but the obvious comparator
`base-opus48-1m-high` is a † row: its 5/5 was assumed by construction, never measured. The only
measured opus arm is `base-opus48-1m-med` at 4/5, which differs from the sonnet row in **effort as
well as model**, so it is confounded. Even taken at face value, 4/5 vs 2/5 is Fisher-exact p = 0.52
at n = 5. Producing a real answer needs one `swe-run` per model at matched effort.

**Null control — run it before trusting any comparison.** Benchmark the SAME config twice under two
names. That pair measures the harness, not the model: if the two rows differ materially, the harness
is the noise source and any A-vs-B gap smaller than that spread is unreadable.

| Run | Date | Suite | Config | Resolved | 95% CI | Engaged | Resolved \| Eng | F2P tests |
|---|---|---|---|---|---|---|---|---|
| base-opus48-1m-high | 2026-07-14 | `484dce71c275` ⚠️stale-suite | claude-opus-4-8[1m] / high | **5/5 (100%)** | 57%–100% | 5/5† | 5/5 | 15/15 |
| base-opus48-1m-med | 2026-07-14 | `484dce71c275` ⚠️stale-suite | claude-opus-4-8[1m] / medium | **4/5 (80%)** | 38%–96% | 4/5 | 4/4 | 12/12 |
| base-sonnet5-high | 2026-07-14 | `484dce71c275` ⚠️stale-suite | claude-sonnet-5 / high | **2/5 (40%)** | 12%–77% | 2/5 | 2/2 | 6/6 |
| t3-opus-high | 2026-07-14 | `d6f7224a5da7` ⚠️stale-suite | claude-opus-4-8 / high | **2/2 (100%)** | 34%–100% | 2/2† | 2/2 | 6/6 |
| t3-opus-med | 2026-07-14 | `d6f7224a5da7` ⚠️stale-suite | claude-opus-4-8 / medium | **2/2 (100%)** | 34%–100% | 2/2† | 2/2 | 6/6 |
| x-uglify-conductor-opus48-high | 2026-07-14 | `68fc7b29894a` | claude-opus-4-8[1m] / high | **0/1 (0%)** | 0%–79% | 1/1 | 0/1 | 0/0 |
| x-uglify-conductor-v2-opus48-high | 2026-07-14 | `68fc7b29894a` | claude-opus-4-8[1m] / high / /Users/liemlhd/Documents/git/Personal/lirbox/.worktrees/improve-conductor-20260714-182449/plugins/lirbox | **0/1 (0%)** | 0%–79% | 1/1 | 0/1 | 0/6 |

† engagement assumed, not measured: the row contains at least one cell whose engagement was never
recorded. Those rows were built (`--cells`) from `.grade` files written back when only ENGAGED cells
produced one — a non-engaged cell left no grade, so it never entered the denominator and its
non-engagement is structurally invisible. `swe-run.mjs` now writes a grade record for every cell
carrying its measured `engaged` flag, so rows built either way measure engagement; a † means the
underlying files predate that. **F2P tests** is pooled over all cells, so non-engaged cells
contribute 0/0 and vanish from it — it says nothing about engagement either.

Produce a new row: `node plugins/lirbox/skills/arena/scripts/swe-run.mjs --name <label> --model <m> --effort <e> [--plugin-dir <lirbox-checkout>] [--runs N]`
Quality-beyond-correctness (style, coverage, thoroughness) is NOT in this score — that stays pairwise
(the arena's judge layer, among resolved runs only).
