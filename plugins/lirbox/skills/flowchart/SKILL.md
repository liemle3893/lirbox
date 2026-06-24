---
name: flowchart
description: This skill should be used to turn a branching process or workflow into an interactive HTML flowchart — a Mermaid diagram (decision diamonds, yes/no branches, fail paths, loops) plus a clickable per-node detail panel with title, metadata, explanation, and code. Triggers when the user asks to "make a flowchart", "diagram this workflow/pipeline", "show the decision flow", "visualize the CI/deploy/approval process", or wants a branching process drawn rather than a linear path. Best when the flow has decisions/branches; for a straight linear path use plan-deck or codewalk instead.

# NOTE: this skill's output loads Mermaid from a CDN, so the page needs internet to render
# (the only lirbox skill that is not fully offline).
---

# flowchart

Turn a branching process into a single interactive HTML page: a Mermaid flowchart with
decision diamonds, labelled branches, fail paths and loops, alongside a clickable detail
panel that shows each step's narrative and code. Warm editorial design (ivory/clay/olive),
Mermaid does the graph layout so nodes never overlap. Shares the look of the other lirbox
skills (`pr-writeup`, `plan-deck`, `codewalk`).

**Offline caveat:** the page fetches Mermaid from a CDN (pinned + SRI-hashed), so it needs
internet to render. This is a deliberate trade for rich auto-laid-out diagrams. Mention it
when delivering.

## When to use

Use for a process that **branches** — CI/deploy pipelines, approval/onboarding funnels,
state machines, retry/fallback logic, an algorithm's decision tree. If the flow is linear
(no decisions), use `plan-deck` (data-flow) or `codewalk` (path diagram) instead.

## Inputs

- A **process** to diagram — described in prose, or traced from a real codebase.
- The decision points, branch conditions, and what each step does. If tracing code, read
  the real files so step labels and snippets are accurate.

## Workflow

### 1. Map the process
List the steps, the decisions (and their branch conditions: yes/no, pass/fail), the fail
paths, and any loops/retries. Identify the **one critical step** (the gate/control point).
If tracing a codebase, read the files to get this right.

### 2. Write the graph + detail
Read `references/components.md` (Mermaid shape/edge syntax, classes, click wiring, the
`STEPS` map). **Read the "Escaping labels" section closely** — code-derived labels with raw
`( ) { } [ ] "`, `\n`, HTML entities, or non-ASCII edge text silently break Mermaid; the rules
there are required, not optional. Copy `assets/template.html`, then:
- Replace the graph between the `TEMPLATE-GRAPH` markers with the real `flowchart TD`.
- Replace the `STEPS` object between the `TEMPLATE-STEPS` markers — one entry per node.
- Fill the header/legend `{{PLACEHOLDER}}`s and set `DEFAULT_NODE`.
- Keep the `<style>` block, the Mermaid `<script>` (with its `integrity`/`crossorigin`),
  and the init/JS wiring intact.

Default output path: `./<slug>-flowchart.html`.

### 3. Verify before claiming done
- **Run the validator — this is the gate, and it's runnable headless:**
  `node <skill-dir>/assets/validate.mjs <output>.html` must print `PASS` / exit 0. It
  deterministically catches the label-escaping bugs that otherwise break Mermaid's
  parser/renderer in the browser (raw `( ) { } [ ] "`, literal `\n`, `&#NN;` entities,
  non-ASCII edge labels). Fix every finding and re-run until clean — do NOT claim done while
  it fails.
- Both `TEMPLATE-GRAPH` and both `TEMPLATE-STEPS` markers removed; zero leftover `{{…}}`.
- Every graph node id has a `click` line and a matching `STEPS` entry; `DEFAULT_NODE` is a
  real key. Exactly one `:::crit` node. One `<h1 class="title">`.
- The Mermaid `<script>` still has `integrity` + `crossorigin`.
- Optional (needs internet): open in a browser to confirm nodes are clickable and the panel
  updates. The validator already guarantees the Mermaid itself parses and renders.
- Grounding: if traced from code, snippets/labels are real (read the files); if conceptual,
  faithful to what the user described — invent no steps or fake metrics.

## Quality bar

- **Branches earn their place** — decisions, fail paths and loops are shown, not flattened.
- **One critical node** highlighted (`:::crit`).
- **Clickable depth** — each node's panel adds real narrative, not a label echo.
- **Renders cleanly** — valid Mermaid, no overlaps (Mermaid handles layout), SRI intact.

See `references/components.md` for Mermaid syntax, the `STEPS` format, and the version/SRI
update procedure.
