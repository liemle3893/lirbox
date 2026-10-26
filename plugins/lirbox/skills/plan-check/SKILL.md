---
name: plan-check
description: This skill should be used to rigorously VERIFY a plan before it is executed — an ops/infra runbook (e.g. a Ceph cluster fix), a code-change plan, or a mix. It treats the plan as a map and pressure-tests it against the territory (official docs + version release notes for ops; the actual repo for code), interrogating the human claim-by-claim to surface unknowns, then emits a self-contained HTML verification report plus a GO / GO-WITH-CONDITIONS / NO-GO verdict. Triggers when the user asks to "verify this plan", "sanity-check this runbook", "is this plan safe to run", "find the holes in this plan", "pressure-test this migration/fix before I run it", or pastes a plan / plan-deck and wants it validated rather than executed. Read-only by default — it NEVER runs commands against live systems, and only does local dry-runs when the human explicitly hands it an environment. NOT for writing a plan (use plan-deck) or executing one.
---

# plan-check

A plan is a **map**; the codebase, cluster and real world are the **territory**. plan-check is an
unknowns-finder, not a reviewer: it checks each claim against evidence, hunts what the plan never
named, and ends with a self-contained HTML report and a **GO / GO-WITH-CONDITIONS / NO-GO** verdict.

Every gap is tagged to one quadrant (`data-quadrant`):

| Quadrant | In a plan | How plan-check handles it |
|---|---|---|
| **known-known** | explicit claims | verify against evidence (web / repo) |
| **known-unknown** | TBDs the plan admits | confirm actually resolved, not hand-waved |
| **unknown-known** | tacit assumptions never written | **interrogate them out of you** |
| **unknown-unknown** | potholes nobody considered | **blind-spot pass** (highest value) |

**Inputs:** the plan (pasted text, a file path, or a `plan-deck` HTML file — ask if missing), and
optionally an environment (sandbox path + commands + docs) for local dry-runs — never assumed.

<non-negotiable>
Read-only + web by default. NEVER run commands against a live system. Local
dry-run / reproduction happens ONLY against an environment the human explicitly
hands over. When in doubt, reason and flag rather than run.
</non-negotiable>

<non-negotiable>
No verdict while an askable question is open. You may NOT emit a verdict (step 7) or
the report (step 8) while any UNVERIFIED proposition is still **askable of the human**.
Ask it first (step 5). Only propositions tagged `needs: run on target` — answerable
solely by touching a live system that was NOT handed to you — may remain open, and only
as conditions-to-clear. A verdict emitted with an unasked askable question is invalid.
</non-negotiable>

## Workflow

1. **Ingest & classify** the plan: `ops` / `code` / `mixed` — it routes §3. Capture its **goal** in
   its own terms (what it is trying to achieve, not what it does); none stated → `UNSTATED-ASSUMPTION`.
2. **Decompose** into atomic checkable propositions — not the plan as a blob:
   preconditions, each step's claimed effect, ordering & hidden dependencies,
   expected outcomes, rollback, and the **unstated assumptions** it drags in.
   Where the plan declares a task graph, invert its own `Files:` lists into a
   file → tasks table and test the declared edges against it: a file claimed by two
   tasks, or an edge stated only in step prose, is a proposition (see
   `references/blind-spot.md` → *Execution shape*).
3. **Verify from evidence — demand references, not assertions.** *Ops:* web docs, version release
   notes, deprecations, known-issue/CVE trackers for the stated version. *Code:* repo read/grep/AST —
   do the referenced files/funcs/APIs exist, fit the real types and callers, and match the plan's
   model of current behavior?
4. **Blind-spot pass** (highest value; never skip) — hunt unknown-unknowns beyond the plan's claims
   via the per-type checklists in `${CLAUDE_PLUGIN_ROOT}/skills/plan-check/references/blind-spot.md`.
5. **Interrogation gate (BLOCKS the verdict).** Enumerate every `UNVERIFIED` proposition and ask
   each **askable** one (not tagged `needs: run on target`) — one at a time, hardest first where
   the answer flips the verdict. Rules in
   `${CLAUDE_PLUGIN_ROOT}/skills/plan-check/references/interrogation.md`.
6. **Adjudicate** — every proposition gets a **quadrant** + **status**: `VERIFIED` ·
   `REFUTED` · `UNVERIFIED` (name what would resolve it) · `UNSTATED-ASSUMPTION` ·
   `BLIND-SPOT-RISK`. **One row is mandatory** (`data-goal-coverage`, machine-checked): *if every
   DoD criterion were met, would the stated goal be achieved?*
7. **Verdict** — `NO-GO` if any `REFUTED` on a critical path; else `GO-WITH-CONDITIONS` if any open
   item (`UNVERIFIED` / `BLIND-SPOT-RISK`) remains; else `GO`. Every open item becomes a
   condition-to-clear. Tag each `REFUTED` and open row `fix: mechanical` (the finding determines the
   repair — a renamed symbol) or `fix: needs-decision` (a wrong approach); the class, never the
   status, decides what autofix may touch. A `NO-GO` states, per `REFUTED` row, **what would have
   to change to clear it** — a verdict with no route is a dead end, not a finding.
8. **Emit the report** — copy `${CLAUDE_PLUGIN_ROOT}/skills/plan-check/assets/template.html` to
   `./plan-check-<slug>.html` and fill it, `<style>` unchanged. **Lead with the verdict-changing
   risks** (refutations, blind-spots, conditions); mechanically-verified rows last.
   Carry step 7's disposition onto **every `REFUTED` and open row** —
   `<span class="fix">fix: mechanical</span>` or `fix: needs-decision`; machine-checked, and drop
   the span on `VERIFIED` / `UNSTATED-ASSUMPTION` rows.
   Fill the **Definition of done** section AND its twin `<script type="application/json" id="dod">`:
   the plan's success criteria, each refined to `checkable` (a command, exit 0 = met) or `judged`
   (cited evidence), never dropping a plan-stated AC. None stated → derive them; the missing DoD is
   a `BLIND-SPOT-RISK`, so the verdict is at best GO-WITH-CONDITIONS.
   Fill **`#taskgraph`** the same way — the plan's execution shape, machine-checked. Each edge is
   `needs` (this task needs the other's *output*) or `contention` (both write one file: a merge
   cost, not an order, since each task gets its own worktree) and carries a `why`. `levels` is
   **derived** — validate.mjs recomputes it from the `needs` edges — so you can neither invent
   serialization nor claim parallelism the edges forbid. No task graph → all three arrays empty.
9. **Verify the output** — must exit 0; fix and re-run until green:
   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/skills/plan-check/assets/validate.mjs ./plan-check-<slug>.html
   ```
10. **Offer autofix — never automatic.** Apply only `fix: mechanical` rows. Rules:
    `${CLAUDE_PLUGIN_ROOT}/skills/plan-check/references/autofix.md`.
    - The input plan is **never modified** — write a sibling `<plan>.autofix.md`.
    - An applied fix invalidates the report: re-run steps 3–6 on every touched row, re-emit,
      then recompute the verdict.
    - `fix: needs-decision` is never autofixed — **the fix class is the gate, not the status**.
      A `fix: mechanical` `REFUTED` row IS repaired, and if re-verification then clears it the
      verdict moves honestly; a `NO-GO` whose refutations all need a decision does not move.
11. **Offer the handoff** — `deep-understanding` on the risky assumptions, or `plan-deck` to
    re-author against the `REFUTED` rows. Don't auto-run either.

## Quality bar

- **Evidence, not vibes.** Every `VERIFIED` cites a source (doc URL, `file:line`, command
  output). No source → `UNVERIFIED`, which is a valid answer.
- **Honest verdict.** One `REFUTED` critical path is `NO-GO` — don't soften it.
- **A DoD or no clean GO.** Every report carries the `#dod` block (validate.mjs enforces it).
