---
name: plan-check
description: This skill should be used to rigorously VERIFY a plan before it is executed — an ops/infra runbook (e.g. a Ceph cluster fix), a code-change plan, or a mix. It treats the plan as a map and pressure-tests it against the territory (official docs + version release notes for ops; the actual repo for code), interrogating the human claim-by-claim to surface unknowns, then emits a self-contained HTML verification report plus a GO / GO-WITH-CONDITIONS / NO-GO verdict. Triggers when the user asks to "verify this plan", "sanity-check this runbook", "is this plan safe to run", "find the holes in this plan", "pressure-test this migration/fix before I run it", or pastes a plan / plan-deck and wants it validated rather than executed. Read-only by default — it NEVER runs commands against live systems, and only does local dry-runs when the human explicitly hands it an environment. NOT for writing a plan (use plan-deck) or executing one.
---

# plan-check

A plan is a **map**; the codebase, cluster, and real world are the **territory**.
The gap between them is *unknowns* — what blows up plans mid-execution. plan-check
**surfaces the unknowns before they get expensive.** It is an unknowns-finder, not
a reviewer: it interrogates you claim-by-claim, checks each claim against real
evidence, hunts the potholes the plan never named, and ends with a self-contained
HTML report and a **GO / GO-WITH-CONDITIONS / NO-GO** verdict.

Every gap is tagged to one quadrant — this keeps the report legible:

| Quadrant | In a plan | How plan-check handles it |
|---|---|---|
| **known-known** | explicit claims | verify against evidence (web / repo) |
| **known-unknown** | TBDs the plan admits | confirm actually resolved, not hand-waved |
| **unknown-known** | tacit assumptions never written | **interrogate them out of you** |
| **unknown-unknown** | potholes nobody considered | **blind-spot pass** (highest value) |

## When to use

Before running a runbook, migration, infra fix, or code-change plan where being
wrong is costly, and you want the holes found — not the plan rewritten.

**Not for:** writing a plan (→ `plan-deck`), executing one, or posting PR review
comments. If the request is "do the plan," this is the wrong skill.

## Inputs

- **The plan** — pasted text, a file path, or a `plan-deck` HTML file. Ask if missing.
- **Optional environment** — a sandbox path + commands + docs, ONLY if you want
  local dry-runs. Never assumed, never auto-detected.

<non-negotiable>
Read-only + web by default. NEVER run commands against a live system. Local
dry-run / reproduction happens ONLY against an environment the human explicitly
hands over. When in doubt, reason and flag rather than run.
</non-negotiable>

## Workflow

1. **Ingest & classify** the plan: `ops` / `code` / `mixed`. State it back — it routes §3.
2. **Decompose** into atomic checkable propositions — not the plan as a blob:
   preconditions, each step's claimed effect, ordering & hidden dependencies,
   expected outcomes, rollback, and the **unstated assumptions** it drags in.
3. **Verify from evidence — demand references, not assertions** ("show me the doc /
   the state / the code," never "trust me"). *Ops:* web docs, version release notes,
   deprecations, known-issue/CVE trackers for the stated version. *Code:* repo
   read/grep/AST — do the referenced files/funcs/APIs exist, fit the real types and
   callers, and match the plan's model of current behavior?
4. **Blind-spot pass** — go beyond the plan's claims; hunt unknown-unknowns via the
   per-type checklists in `${CLAUDE_PLUGIN_ROOT}/skills/plan-check/references/blind-spot.md`.
   Highest-value step; don't skip.
5. **Interrogate** — when a proposition can't be confirmed, stop and grill: one
   question at a time, hardest where the answer flips the verdict. Rules in
   `${CLAUDE_PLUGIN_ROOT}/skills/plan-check/references/interrogation.md`.
6. **Adjudicate** — every proposition gets a **quadrant** + **status**: `VERIFIED` ·
   `REFUTED` · `UNVERIFIED` (name what would resolve it) · `UNSTATED-ASSUMPTION` ·
   `BLIND-SPOT-RISK`.
7. **Verdict** — `NO-GO` if any `REFUTED` on a critical path; else
   `GO-WITH-CONDITIONS` if any open item (`UNVERIFIED` / `BLIND-SPOT-RISK`) remains;
   else `GO`. Every open item becomes a condition-to-clear.
8. **Emit the report** — copy `${CLAUDE_PLUGIN_ROOT}/skills/plan-check/assets/template.html`
   to `./plan-check-<slug>.html` and fill it. **Lead with the verdict-changing risks**
   (refutations, blind-spots, conditions); mechanically-verified rows last. Keep the
   `<style>` block unchanged.
9. **Verify the output** — must exit 0; fix and re-run until green:
   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/skills/plan-check/assets/validate.mjs ./plan-check-<slug>.html
   ```
10. **Offer the handoff** — offer to launch `deep-understanding` on the risky
    assumptions so you internalize what could break. Don't auto-run it.

## Quality bar

- **Unknowns-first.** The report's value is the unknown-knowns and unknown-unknowns
  it surfaced, not the checklist it ran — lead with them.
- **Evidence, not vibes.** Every `VERIFIED` cites a source (doc URL, `file:line`,
  command output). No source → not verified; `UNVERIFIED` is a valid answer.
- **Honest verdict.** One `REFUTED` critical path is `NO-GO` — don't soften it.
- **Self-contained report.** No external CSS/JS/fonts/images; opens offline.
