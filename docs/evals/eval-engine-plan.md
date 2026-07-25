# Eval engine — research findings and corrected plan

Two earlier drafts of this plan specced building things that already exist. This version is
written after empirical verification; every claim below was checked by running the code or
recomputing the numbers, not by reading prose.

---

## 1. What is already built (verified)

| capability | state | how verified |
|---|---|---|
| per-criterion graders | **built** — 38 `fail_to_pass/*.test.cjs` over 9 tasks | file census |
| hidden-test discipline | **built** — F2P injected *after* the diff, into a dir the agent never saw | `swe-grade.mjs` header |
| discrimination gate | **built and passing** | ran it: `notes-add-tags` → `f2pRedOnBase {red:3,total:3,leaks:[]}`, `p2pGreenOnBase:true`, exit 0 |
| regression half | **built** — `p2p` = fixture's own `npm test` | `swe-grade.mjs:94` |
| **skill-version axis** | **built** — `swe-run.mjs --plugin-dir <checkout>` | used in `x-uglify-conductor-v2-*` scorecard |
| repetition support | **built** — `--runs N` | `swe-run.mjs` usage block |
| model axis | **built** — `--model`, and it *rejects floating aliases* (`opus` → error, must pin `claude-opus-4-8[1m]`) | `swe-run.mjs:~30` |
| result store | **built** — `docs/arena/scores/*.json`, committed, plus auto-generated index | 7 scorecards on disk |
| Wilson intervals | **built and correct** | recomputed all 5 published CIs — exact match (5/5→57-100%, 4/5→38-96%, 2/5→12-77%, 2/2→34-100%, 0/1→0-79%) |
| comparability eras | **built** — scorecards embed a suite fingerprint; only matching hashes compare | `swe-score.mjs` header |
| partial credit + engagement | **computed** — `f2pPassed/f2pTotal`, `engagementRate` | score object |

**My earlier claim that "conductor has no behavioural layer" was wrong**, and so were plan steps
1, 2 and 4 (result store, skill-version axis, model matrix). All three exist. A cross-model
comparison has already been run by hand.

---

## 2. The finding that matters most

Re-analysing the recorded `opus-4-8[1m]/high` vs `sonnet-5/high` comparison:

| arm | engaged | resolved \| engaged | f2p criteria | **headline** |
|---|---|---|---|---|
| opus-4-8[1m]/high | 5/5 | 5/5 | 15/15 | 5/5 = **100%** |
| sonnet-5/high | 2/5 | 2/2 | 6/6 | 2/5 = **40%** |

The 40% is **entirely engagement failure** — on 3 of 5 tasks sonnet's driver never created a `wf/`
branch at all. On every criterion it actually attempted it scored **6/6**. Conditional on
engagement, both models resolve 100%.

So "sonnet is worse at the work" is **not supported by this data**. "Sonnet fails to *drive* the
skill" is — and that is a skill/prompt defect with a completely different fix than a model
capability verdict. The single headline number hides the distinction.

**Correction found during implementation (2026-07-25):** the engagement *gap* above is weaker still
— it is not usable at all. `swe-score.mjs`'s `loadCells()` hardcodes `engaged: true`, because a
`.grade` file only exists for cells that engaged; non-engaged cells leave no grade and never enter
the denominator. `base-opus48-1m-high` was built that way (`--cells`), so its 5/5 engagement was
**assumed by construction, never measured**. The only *measured* opus arm is `base-opus48-1m-med` at
4/5, which differs from the sonnet row in **effort as well as model** — confounded — and even at
face value 4/5 vs 2/5 is Fisher exact **p = 0.52** at n=5.

So the sonnet half of the finding stands (2/5 engaged, 6/6 on attempted criteria, all measured), but
there is **no usable cross-model engagement comparison** in the recorded data. Getting one needs a
`swe-run` per model at matched effort. Rows built this way now carry a `†` marker and the scoreboard
says so explicitly.

**This is the headline metric bug, and it is worth more than any new infrastructure.**

---

## 3. Power analysis (computed, α=0.05, power=0.80)

| effect to detect | n per arm |
|---|---|
| 100% → 60% (the gap actually observed) | **~14** |
| 80% → 60% (20pp) | ~81 |
| 80% → 70% (10pp) | ~293 |
| 80% → 75% (5pp) | ~1094 |

What the suite can deliver:

| configuration | task-level n | criterion-level n |
|---|---|---|
| **today** (7 in-suite tasks, `runs:1`) | **7** | 25 |
| 7 tasks, runs=3 | 21 | 75 |
| 9 tasks (promote 2 orphans), runs=3 | 27 | **114** |
| 9 tasks, runs=5 | 45 | 190 |

Conclusions:

- Today's n=7 is underpowered **even for the enormous 100%→60% gap** (needs ~14). Every comparison
  on the scoreboard is currently a hypothesis, not a result. The README's ⚠️ and CI columns already
  say so honestly.
- 10pp effects are **out of reach** at any realistic budget (~293 runs/arm). Stop pretending
  otherwise; declare a minimum detectable effect of ~20pp and design around it.
- Criterion-level counting is what crosses the 20pp threshold at feasible cost (114 vs 81 needed).

**Caveat that must not be ignored:** the 3–8 criteria inside one task share a single conductor
run, so they are **not independent**. Treating 114 clustered observations as 114 Bernoullis
overstates power. The honest fix is not to count criteria as independent trials but to use each
task's **f2p pass fraction as a continuous per-task score** and compare with a paired test. That
recovers most of the power without the independence lie.

---

## 4. What is actually missing

1. **`runs: 1` in every recorded scorecard** despite `--runs N` existing → zero within-config
   variance estimate, no `pass^k`, no flake detection.
2. **Headline metric conflates engagement failure with quality failure** (§2).
3. **No significance test** — comparison is by eyeballing overlapping Wilson CIs. That is
   conservative and lossy: non-overlap implies significance, but overlap does *not* imply
   non-significance.
4. **Suite-hash churn** — 3 eras across 7 scorecards (`484dce71c275`×3, `d6f7224a5da7`×2,
   `68fc7b29894a`×2); only the last 2 match the current fingerprint, so 5 of 7 rows are ⚠️stale.
   History is already mostly non-comparable.
5. **2 orphan tasks** on disk but not in the suite (`notes-selective-sync` 5 criteria,
   `notes-wide-features` 8) — 13 criteria idle.
6. **No train/val split** — any optimiser reading these tasks overfits them.
7. **No cost/latency in scorecards** — `experiments.md` tracks them by hand.
8. **arena's *pairwise* suite lacks `skillRef`** (filed as `config-plugindir-skill-version-axis`).
   `swe-run` has it; the pairwise loop does not.

---

## 5. Corrected plan

Ordered by value per unit of work. Note how little of it is new infrastructure.

### Step 1 — Fix the metric (highest value, smallest diff)

Report three numbers instead of one, all already computed:

- **engagement rate** — did the skill get driven at all (skill robustness, model-sensitive)
- **resolution | engaged** — quality, conditional on engagement
- **mean per-task f2p fraction** — continuous partial credit, the statistically useful one

Headline stays `resolved/total` for continuity, but the scoreboard must print engagement beside it
so a 40% caused by non-engagement can never again read as a quality verdict.

*Verify:* regenerate the index (`swe-score.mjs --index`) and confirm `base-sonnet5-high` renders as
`2/5 resolved, engaged 2/5, 6/6 f2p among engaged` — i.e. the §2 finding is visible on the page.

### Step 2 — Raise `runs` and freeze the era

Set `runs: 3` minimum for any comparison-grade scorecard; re-baseline the current suite hash so
there is a non-stale reference row. Declare the MDE (~20pp) in the README so readers stop
over-reading small differences.

*Verify:* two scorecards of the *same* config at runs=3 must not differ significantly (the null
control). If they do, the harness is the noise source, not the model.

### Step 3 — Promote the orphans, add the split

Add `notes-selective-sync` and `notes-wide-features` to the suite (+13 criteria → 9 tasks / 38
criteria), then mark 5 train / 4 val. Optimisers read train; the gate scores val.

*Verify:* `swe-grade --task <id> --validate` exit 0 for both promoted tasks (the discrimination
gate — it already passes for the in-suite 7); suite fingerprint changes exactly once and the
README marks prior rows stale.

### Step 4 — Comparator with an "I can't tell" verdict

New `swe-compare.mjs --a <card> --b <card>`:

- refuses outright when suite fingerprints differ (comparability contract already exists — enforce it)
- paired Wilcoxon signed-rank on per-task f2p fractions; Fisher exact on engagement
- exit **0** no difference · **1** difference detected · **2** underpowered or non-comparable

*Verify* on synthetic fixtures: identical arms → 0; injected 30pp with n=27 → 1; 5pp with n=7 →
**2, not 1** (the false-positive test); mismatched fingerprints → 2.

### Step 5 — Cost/latency into the scorecard

Capture per-cell wall-clock and cost in `swe-run`, so quality can be read against price. A skill
+2% better at 3× cost is a regression for most callers.

### Step 6 — arena pairwise `skillRef` (already filed)

Unchanged from the filed item. Lower priority than it looked: `swe-run --plugin-dir` already
answers the skill-version question for *absolute* scoring; only the pairwise-preference loop is
blocked.

---

## 6. What I am dropping from the earlier drafts

- **"Build a result store"** — `docs/arena/scores/` is one, committed, with an auto-generated index.
  Extend it; do not rebuild it.
- **"Build the model matrix"** — `swe-run --model` is it. What was missing was `runs > 1`.
- **"Author a behavioural task set"** — 9 tasks with 38 validated criteria already exist.
- **"New `eval-engine` skill"** — not justified. The work is 4 small changes to arena's existing
  scripts plus one new comparator. A new skill would duplicate `swe-score`/`swe-grade`.
- **"L2 gates PR merge"** — premature. At n=7–27 the comparator cannot support a blocking gate
  for anything under ~20pp. It should *report*, loudly, until the suite is big enough to block.

## 7. Open decisions

- **MDE declaration.** Recommend stating ~20pp explicitly in the scoreboard README. Without it,
  every overlapping-CI pair invites an unfounded story.
- **Cost ceiling.** 9 tasks × 3 runs × 3 models = 81 conductor runs at `cap 900–3600s`. Needs a
  declared budget and a `--max-cost` abort before any matrix is scheduled.
- **Engagement failures: bug or score?** Currently they count as failures in the denominator
  (defensible for a benchmark). But since they are a *skill* defect, they should probably also be
  filed as backlog items automatically rather than silently depressing a model's score.
- **Capability floor.** Which model conductor is contractually expected to work on. The §2 finding
  suggests the real answer today is "opus engages reliably, sonnet does not" — which is a fixable
  skill bug, not a model verdict.
