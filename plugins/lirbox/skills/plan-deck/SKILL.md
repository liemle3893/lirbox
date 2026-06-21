---
name: plan-deck
description: This skill should be used to turn a feature request, spec, or task into a polished, self-contained HTML implementation plan ("plan-deck") — summary stats, a sequenced milestone timeline of independently shippable slices, a data-flow diagram, optional UI mockups, key-code snippets, a risks-and-mitigations table, and open questions. Triggers when the user asks to "make a plan-deck", "make an implementation plan", "plan out this feature", "create a build plan / roadmap page", "turn this spec into a plan", or wants a shareable planning document rather than a bullet list. Works for any plan type — feature, backend, infra/migration, refactor, library — and adapts the sections to fit.
---

# plan-deck

Turn a planning request into a single self-contained HTML page a team can skim:
what ships in what order (milestones), how the pieces talk (data flow), what it
looks like (mockups, for UI work), the few snippets that pin down the hard parts
(key code), the real hazards (risks & mitigations), and the decisions still open
(open questions). Warm editorial design (ivory/clay/olive/oat, serif headings),
renders offline in any browser. Shares its look with the `pr-writeup` skill.

## When to use

Use when someone wants a shareable, structured plan for building something. Not for:
writing the code itself, or producing a throwaway bullet list (just answer inline for that).

## Inputs

- A **requirement / spec / task** to plan (a paragraph, a ticket, a rough idea).
- Optionally a **codebase** to plan against — inspect it so milestones, file tags,
  data flow, and the summary stats are grounded in what actually exists.
- If the scope is unclear, ask 1–2 sharp questions before planning (or state the
  assumptions you're making at the top of the plan).

## Workflow

### 1. Understand the work
Read the request. If a codebase is in scope, explore the relevant surfaces (the graph
tools or search) to learn the real package/file names, existing schema, and the runtime
path the change touches. The plan's credibility comes from these specifics.

### 2. Shape the slices
Decompose into **independently shippable milestones** in sequence — each one a slice
that can ship on its own (ideally behind a flag), not a waterfall phase. Identify the
data flow, the genuine risks, and any decisions that need a human.

### 3. Choose sections for this plan type
Read `references/components.md` → "Adapting by plan type" and the section catalogue.
Decide which sections apply (feature / backend / infra / refactor / library). Delete
sections that don't fit (e.g. mockups for a backend plan), remove their TOC links, and
**renumber the section badges** 01..N.

### 4. Assemble the HTML
Copy `assets/template.html` to the output path and fill every `{{PLACEHOLDER}}` and
marked region. Use snippets from `references/components.md` for variable-length lists
(milestones, flow nodes, risk rows, questions). Keep the `<style>` block unchanged.

Default output path: `./<slug>-plan-deck.html` (slug from the plan title).

### 5. Verify before claiming done
- Valid standalone HTML: one `<h1 class="title">`, section ids match TOC `href`s,
  section badges run 01..N with no gaps, zero leftover `{{...}}` and no leftover
  TEMPLATE comments.
- Honesty pass (see `references/components.md`): every summary stat is grounded or its
  card is dropped; milestone dots are `done` only if truly complete; risks are specific
  to this plan; open questions are real (or the section is omitted). Delete rather than fabricate.
- Report the output path and a one-line description of the plan.

## Quality bar

- **Shippable slices, not a waterfall.** Milestones are ordered, each independently deliverable.
- **Grounded.** Names, counts, and the data flow reflect the real spec/codebase, not guesses.
- **Specific risks.** Name the actual race / lock / auth gap with a concrete mitigation.
- **Self-contained.** No external CSS/JS/fonts/images; the data-flow is CSS, not an external diagram.

See `references/components.md` for the component snippet library, plan-type adaptation, and the honesty rules.
