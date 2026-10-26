---
name: plan-check
description: This skill should be used to rigorously VERIFY a plan before it is executed — an ops/infra runbook (e.g. a Ceph cluster fix), a code-change plan, or a mix. It treats the plan as a map and pressure-tests it against the territory (official docs + version release notes for ops; the actual repo for code), interrogating the human claim-by-claim to surface unknowns, then emits a self-contained HTML verification report plus a GO / GO-WITH-CONDITIONS / NO-GO verdict. Triggers when the user asks to "verify this plan", "sanity-check this runbook", "is this plan safe to run", "find the holes in this plan", "pressure-test this migration/fix before I run it", or pastes a plan / plan-deck and wants it validated rather than executed. Read-only by default — it NEVER runs commands against live systems, and only does local dry-runs when the human explicitly hands it an environment. NOT for writing a plan (use plan-deck) or executing one.
---

# plan-check

A plan is a **map**; the codebase, cluster and real world are the **territory**. plan-check is an
unknowns-finder, not a reviewer: it checks each claim against evidence, confirms the TBDs the plan
admits are actually resolved, interrogates out the assumptions it never wrote, hunts what nobody
considered, and ends with a self-contained HTML report and a **GO / GO-WITH-CONDITIONS / NO-GO**
verdict.

**Inputs:** the plan (pasted text, a file path, or a `plan-deck` HTML file — ask if missing), and
optionally an environment (sandbox path + commands + docs) for local dry-runs — never assumed.

<non-negotiable>
Read-only + web by default. NEVER run commands against a live system. Local
dry-run / reproduction happens ONLY against an environment the human explicitly
hands over. When in doubt, reason and flag rather than run.
</non-negotiable>

<non-negotiable>
No verdict while a verdict-changing question is unasked. You may NOT emit a verdict
(step 7) or the report (step 8) while an open row whose answer could change the verdict
is still **askable of the human**. Ask it first (step 5). Everything else stays open as
a condition-to-clear — including `needs: run on target` rows, answerable solely on a
live system that was NOT handed to you.
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
4. **Blind-spot pass** (never skip) — hunt risks the plan never names via the per-type checklists in
   `${CLAUDE_PLUGIN_ROOT}/skills/plan-check/references/blind-spot.md`. A row must be specific to
   this plan and say why; a generic checklist item that applies to every plan is not a finding.
5. **Interrogation gate (BLOCKS the verdict).** Ask each open row whose answer could change the
   verdict and that the human can answer — one at a time, the biggest verdict-flip first. Rules in
   `${CLAUDE_PLUGIN_ROOT}/skills/plan-check/references/interrogation.md`.
6. **Adjudicate** — every proposition gets a **status**: `VERIFIED` · `REFUTED` ·
   `UNVERIFIED` (name what would resolve it) · `UNSTATED-ASSUMPTION` · `BLIND-SPOT-RISK`. Every
   non-`VERIFIED` row is tagged `fix: mechanical` (the finding determines the repair — a renamed
   symbol) or `fix: needs-decision` (a wrong approach). **One row is mandatory**
   (`data-goal-coverage`, machine-checked): *if every
   DoD criterion were met, would the stated goal be achieved?*
7. **Verdict** — `NO-GO` if any `REFUTED` row needs a decision; else `GO-WITH-CONDITIONS` if any row
   is open (`UNVERIFIED`, `UNSTATED-ASSUMPTION`, `BLIND-SPOT-RISK`, or a `fix: mechanical`
   `REFUTED`); else `GO`. Every open row becomes a condition-to-clear. A `NO-GO` states, per
   blocking row, **what would have to change to clear it** — a verdict with no route is a dead end.
8. **Emit the report** — copy `${CLAUDE_PLUGIN_ROOT}/skills/plan-check/assets/template.html` to
   `./plan-check-<slug>.html` and fill it, `<style>` unchanged. **Lead with the verdict-changing
   risks** (refutations, blind-spots, conditions); verified rows last.
   Carry step 6's disposition onto **every non-`VERIFIED` row** —
   `<span class="fix">fix: mechanical</span>` or `fix: needs-decision`; machine-checked.
   Fill the **Definition of done** section AND its twin `<script type="application/json" id="dod">`:
   the plan's success criteria, each refined to `checkable` (a command, exit 0 = met) or `judged`
   (cited evidence), never dropping a plan-stated AC. None stated → derive them; the missing DoD is
   a `BLIND-SPOT-RISK`, so the verdict is at best GO-WITH-CONDITIONS.
9. **Verify the output** — must exit 0; fix and re-run until green:
   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/skills/plan-check/assets/validate.mjs ./plan-check-<slug>.html
   ```
10. **Offer autofix — never automatic.** Edit the plan file **in place** — git is the record, so
    say so first if it is untracked or dirty; a pasted plan gets its fixes listed instead. Rules:
    `${CLAUDE_PLUGIN_ROOT}/skills/plan-check/references/autofix.md`.
    - `fix: mechanical` rows: apply on accept. `fix: needs-decision` rows: apply only the
      decision the human states — never choose one for them.
    - Each fixed row is re-adjudicated against the evidence that determined the fix, then
      re-run step 9. The verdict is whatever the rows now derive, NO-GO included.
11. **Offer the handoff** — `deep-understanding` on the risky assumptions, or `plan-deck` to
    re-author against the `REFUTED` rows. Don't auto-run either.

## Quality bar

- **Evidence, not vibes.** Every `VERIFIED` cites a source (doc URL, `file:line`, command
  output). No source → `UNVERIFIED`, which is a valid answer.
- **Honest verdict.** One `REFUTED` row that needs a decision is `NO-GO` — don't soften it, and
  don't inflate a typo into one: a refutation the evidence fully corrects is `fix: mechanical`.
- **A DoD or no clean GO.** Every report carries the `#dod` block (validate.mjs enforces it).
