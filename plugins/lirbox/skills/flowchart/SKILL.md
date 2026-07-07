---
name: flowchart
description: This skill should be used to turn a branching process or workflow into an interactive HTML flowchart — a Mermaid diagram (decision diamonds, yes/no branches, fail paths, loops) plus a clickable per-node detail panel with title, metadata, explanation, and code. Triggers when the user asks to "make a flowchart", "diagram this workflow/pipeline", "show the decision flow", "visualize the CI/deploy/approval process", or wants a branching process drawn rather than a linear path. Best when the flow has decisions/branches; for a straight linear path use plan-deck or codewalk instead.
---

# flowchart

Turn a branching process into one interactive HTML page: a Mermaid flowchart (decision
diamonds, labelled branches, fail paths, loops) plus a clickable per-node detail panel with
each step's narrative and code. Warm editorial design (ivory/clay/olive) shared with the
other lirbox skills (`pr-writeup`, `plan-deck`, `codewalk`); Mermaid does the layout so
nodes never overlap.

**Offline caveat:** the page loads Mermaid from a CDN (pinned + SRI-hashed), so it needs
internet to render — the only lirbox skill not fully offline. Mention this when delivering.

Use for processes that **branch** — CI/deploy pipelines, approval/onboarding funnels, state
machines, retry/fallback logic, decision trees. For a linear flow use `plan-deck`
(data-flow) or `codewalk` (path diagram) instead.

## Workflow

### 1. Map the process
List the steps, the decisions (with their branch conditions: yes/no, pass/fail), the fail
paths, and any loops/retries. Identify the **one critical step** (the gate/control point).
If tracing a codebase, read the real files so step labels and snippets are accurate.

### 2. Write the graph + detail
Read `references/components.md` (Mermaid shape/edge syntax, classes, click wiring, the
`STEPS` map, the version/SRI update procedure). **Its "Escaping labels" rules are required,
not optional** — code-derived labels with raw `( ) { } [ ] "`, literal `\n`, HTML entities,
or non-ASCII edge text silently break Mermaid. Copy `assets/template.html`, then:
- Replace the graph between the `TEMPLATE-GRAPH` markers with the real `flowchart TD`.
- Replace the `STEPS` object between the `TEMPLATE-STEPS` markers — one entry per node.
- Fill the header/legend `{{PLACEHOLDER}}`s and set `DEFAULT_NODE`.
- Keep the `<style>` block, the Mermaid `<script>` (with its `integrity`/`crossorigin`),
  and the init/JS wiring intact.

Default output path: `./<slug>-flowchart.html`.

### 3. Verify before claiming done
- **The gate, runnable headless:** `node <skill-dir>/assets/validate.mjs <output>.html`
  must print `PASS` / exit 0 — it deterministically catches the label-escaping bugs above.
  Fix every finding and re-run until clean; do NOT claim done while it fails.
- Both `TEMPLATE-GRAPH` and both `TEMPLATE-STEPS` markers removed; zero leftover `{{…}}`.
- Every graph node id has a `click` line and a matching `STEPS` entry; `DEFAULT_NODE` is a
  real key; exactly one `:::crit` node; one `<h1 class="title">`; the Mermaid `<script>`
  still has `integrity` + `crossorigin`.
- Optional (needs internet): open in a browser to confirm nodes are clickable and the panel
  updates — the validator already guarantees the Mermaid parses and renders.
- Grounding: if traced from code, snippets/labels are real (read the files); if conceptual,
  faithful to what the user described — invent no steps or fake metrics.

## Quality bar

Branches earn their place (decisions, fail paths and loops shown, not flattened); one
critical node highlighted (`:::crit`); each node's panel adds real narrative, not a label
echo; renders cleanly (valid Mermaid, no overlaps, SRI intact).
