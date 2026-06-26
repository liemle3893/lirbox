# Checks — Acceptance-Check Derivation, the Discrimination Gate, the Floor, the Locked Set

Reference for the whetstone skill's **setup step** (the attended, human-in-the-loop half — the only
place a human approves anything). Load before drafting checks. Covers: how to derive one
deterministic **acceptance-check** per backlog concern; the **discrimination gate** that proves a
check is real; the **floor** that fences every kept change; the **locked set** the loop may never
edit; the **human-only** path; and when to **DECLINE**.

The deal whetstone offers: it only earns its keep when each concern can be turned into **a check it
can run automatically that is RED before the fix and GREEN after**, behind a **floor it can't tunnel
under** and a **locked set it can't reach into**. The whole job of setup is to manufacture that
trio — frozen and human-confirmed — or to say **no**.

---

## 1. What setup must produce (per run)

For a target `<skill>` with a backlog at `feedback/<skill>.jsonl` (one JSON object per line:
`{id, type, text, acceptanceCheck?}`), setup produces `.improve/config/<skill>.json`:

```jsonc
{
  "skill": "flowchart",
  "skillPath": "plugins/lirbox/skills/flowchart",
  "editable": "plugins/lirbox/skills/flowchart/**",          // the ONLY tree the loop may edit
  "locked":  ["plugins/lirbox/skills/flowchart/evals/**",    // the checks + floor — NEVER edited
              "feedback/flowchart.jsonl"],                    // the backlog — NEVER edited
  "floor":   { "cmd": "python3 .../quick_validate.py plugins/lirbox/skills/flowchart && node plugins/lirbox/skills/flowchart/evals/run.mjs" },
  "items": [                                                  // FROZEN at setup, discrimination-passed
    { "id": "node-nonascii", "type": "concern",
      "text": "validate flags non-ASCII only in edge labels; node labels slip through",
      "acceptanceCheck": "node plugins/lirbox/skills/flowchart/evals/node-nonascii.test.mjs" },
    { "id": "prettier", "type": "concern",
      "text": "diagrams should look more polished", "acceptanceCheck": null }   // human-only
  ],
  "budgets": { "agentCapSec": 600, "checkRetries": 2, "total": { "items": 1 } },
  "baseline": "origin/main"
}
```

`items[]` and the floor are the load-bearing fields. Everything project-specific is **data-in** —
the loop conductor reads it from `args.config`; nothing is baked into the generated `.js`.

---

## 2. Acceptance-check derivation — one deterministic check per concern

An acceptance-check is a **single command that exits 0 iff the concern is resolved** — RED on the
unmodified skill, GREEN once a correct fix lands. It is the per-item analog of prospector's metric,
but **binary** (no scalar, no `best`).

- **Author at setup, by the `lirbox-test-writer` agent** acting as a *check-drafter*. That agent is
  the RED step of TDD: it writes a runnable test from acceptance criteria and confirms it fails for
  the right reason — exactly the property a whetstone check needs. Dispatch it once per backlog
  item that has a verifiable concern, feeding it the item `text` and the target skill.
- **Deterministic only (v1).** The check must be a repeatable command with a stable exit code —
  typically a `*.test.mjs` under `<skill>/evals/` that imports the skill's own validator/asset and
  asserts the concern. No LLM-judge, no flaky network, no human in the inner loop (those are v2).
- **Target observable behavior, not implementation.** "validate flags `—` in node labels" is a
  check; "function `checkNode` exists" is not — the loop could satisfy the latter without fixing
  anything.
- **One concern per check.** Each backlog item maps to exactly one check; the loop keeps/reverts per
  item, so a check spanning two concerns makes the verdict ambiguous.

A drafted check that the agent cannot make fail on the baseline (see §3) is **not a real concern** —
either the concern is already resolved, or the check is too weak. Reject it; do not freeze it.

---

## 3. The discrimination gate — a check MUST fail on the baseline

Before any check is frozen, run it through `check-baseline.cjs` from a **clean baseline worktree**:

```
node <skill-dir>/scripts/check-baseline.cjs "<acceptanceCheck command>"
```

- Exit **0** + `DISCRIMINATING` → the check **fails** on the unmodified skill. Good: it is
  fail-before / pass-after, so a later GREEN is *caused by the fix*, not pre-existing. Freeze it.
- Exit **1** + `NON-DISCRIMINATING` → the check **passes** on the baseline. It proves nothing — a
  fix that does nothing would still pass it. **Reject or strengthen** the check; never freeze a
  check that is already green.

This is the anti-self-deception guard: without it the loop could "resolve" a concern with a no-op
because the check was green all along. Every frozen item's check has passed this gate.

After all checks pass the gate, **freeze** them: write the `*.test.mjs` files into `<skill>/evals/`
(and any fixtures into `<skill>/evals/fixtures/`), add `<skill>/evals/**` to `locked`, and record
each item's `acceptanceCheck` command in the config. The checks are now immutable for the run.

---

## 4. The floor — `quick_validate.py` + `evals/run.mjs`

The floor is the **always-on correctness fence**: a deterministic command that MUST exit 0 or the
candidate is reverted, no matter what the item's check did. It runs at baseline (must pass — a
broken base can't be improved) and per item (fail → revert before the keep).

```
floor.cmd = python3 <skill-creator>/scripts/quick_validate.py <skillPath>   \
            && node <skillPath>/evals/run.mjs
```

Two layers:
1. **`quick_validate.py <skillPath>`** (skill-creator's validator) — the skill is still a *valid
   skill* (frontmatter, structure, naming). A fix that turns its own check green but corrupts the
   SKILL.md must not be kept.
2. **`node <skillPath>/evals/run.mjs`** — the **characterization** layer: `run.mjs` imports and runs
   **every** `*.test.mjs` in `evals/`, exiting 0 iff all pass. This bundles the characterization
   tests (behavior that must NOT regress — green on baseline, must stay green) **and** every frozen
   acceptance-check (the item under fix is red until fixed; sibling items' checks vary). Because the
   floor runs the whole suite, a fix that resolves item A but **breaks** the behavior pinned by a
   characterization test fails the floor → reverted. This is what catches the "floor-breaker"
   class: a change whose own check passes but that regresses something pinned.

The floor command and the `evals/` tree it runs live **inside `locked`** — the loop runs the floor
but can never edit it.

---

## 5. The locked set — `evals/**` + the backlog

`locked` is whetstone's anti-gaming fence (prospector had a single surface; whetstone has
**editable minus locked**). Two globs are always locked:
- **`<skill>/evals/**`** — every characterization test, every frozen acceptance-check, every
  fixture, and the floor runner. The artifact *under edit is the skill, NOT the check.* If the
  `fixer` could edit `evals/`, it would "pass" by weakening the test — the loop would be worthless.
- **`feedback/<skill>.jsonl`** — the backlog itself. The loop must not rewrite the list of concerns
  it is being judged against.

Any diff that touches a locked path (or anything outside `editable`) reverts the whole item —
enforced by `surfaceAllows(diffFiles, editable, locked)` in the conductor (see `loop-runtime.md`
§4). The `editable` glob is the skill tree minus those locked subpaths; a fix may add new files
inside `editable` but never reach into `locked`.

---

## 6. The human-only path — concerns with no deterministic check

A backlog item with `acceptanceCheck: null` (or no verifiable, deterministic check the
check-drafter can author and discriminate) is **human-only**:
- It **never enters the autonomous loop** — there is no way to verify a fix, so attempting one would
  be unfalsifiable.
- It is recorded in `humanOnly[]` and surfaced in the report, so a human can address it by hand.

Typical human-only concerns: subjective polish ("diagrams should look more polished"), ergonomics,
taste, or anything whose resolution can only be judged by a person. Do **not** invent a weak proxy
check to drag such an item into the loop — that reintroduces the gaming the discrimination gate
exists to prevent. Leave it human-only.

---

## 7. When to DECLINE

Whetstone earns its keep only when the trio holds. **DECLINE the whole run** (or ask one
`AskUserQuestion`) when:

- **No establishable floor** — the target skill has no `quick_validate`-able structure AND no
  characterization tests can be written (nothing pins its behavior). With no floor, a "fix" could
  silently break the skill and still be kept. Without a floor, do not run; build a floor first or
  decline.
- **Every backlog item is human-only** — if no concern yields a deterministic, discriminating
  check, there is nothing for the autonomous loop to do. Hand the backlog back for manual work.
- **Checks can't be made to discriminate** — if the drafted checks all pass on the baseline (the
  concerns are already resolved, or the checks are too weak to author honestly), there is nothing to
  improve. Report which concerns were already green.

When declining, name **which half is missing** (no floor, or no discriminating check) so the user
can supply it or pick a different tool. This mirrors prospector's DECLINE rule: proceed only with
**both** a fence the loop can't climb (the floor + locked set) and a signal it can read honestly
(a baseline-failing check) — never invent a gameable one.
