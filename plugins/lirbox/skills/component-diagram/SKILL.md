---
name: component-diagram
description: This skill should be used to draw the STATIC STRUCTURE of a system as a self-contained interactive HTML component diagram — a Mermaid flowchart with subgraph boundaries (systems/layers), typed dependency edges (calls/reads/publishes), and a clickable per-component detail panel (responsibility, interface, dependencies). Triggers when the user asks to "diagram the components", "show the architecture / module map", "what talks to what", "draw the service/dependency graph", or "map this system's structure". For a branching PROCESS with decisions use flowchart; for a time-ordered interaction use sequence-diagram; for one traced path use codewalk.

# NOTE: output loads Mermaid from a CDN, so the page needs internet to render.
---

# component-diagram

Turn a system's static structure into one self-contained interactive HTML page: a Mermaid
`flowchart` with `subgraph` boundaries and typed dependency edges, plus a clickable panel
that gives each component its responsibility, interface, and dependencies. Warm editorial
design shared with `flowchart`/`codewalk`/`plan-deck`/`pr-writeup`.

**Offline caveat:** the page fetches Mermaid from a CDN (pinned + SRI). It needs internet to
render — mention this when delivering.

## When to use

Use it for **static structure** — components/services/modules, their boundaries, and what
depends on what. NOT for a branching process (use `flowchart`) or a time-ordered interaction
(use `sequence-diagram`). No decision diamonds appear in a component diagram.

## Inputs

- A **system** to map — from prose, or traced from a real repo. If tracing, read the files so
  component names, interfaces, and dependency edges are real (honesty bar: invent nothing).

## Workflow

### 1. Map the structure
List the components, group them into boundaries (systems/layers → `subgraph`s), and the
typed dependencies between them (calls / reads / publishes; dashed for async/events).
Identify the **one critical component** (the control point). If tracing, read the files.

### 2. Write the graph + detail
Read `references/components.md` (shape/edge syntax, escaping rules, the `STEPS` map). Copy
`assets/template.html`, then: replace the graph between `TEMPLATE-GRAPH`, the `STEPS` between
`TEMPLATE-STEPS`, fill the `{{…}}`, set `DEFAULT_NODE`. Keep the `<style>` and Mermaid wiring.
**Use only `id[Label]` rectangles (no diamonds, no cylinder/stadium shapes) and ASCII edge
labels** — the validator enforces this. Default output path: `./<slug>-component.html`.

### 3. Verify before claiming done
- **Run the validator — the headless gate:** `node <skill-dir>/assets/validate.mjs <output>.html`
  must print `PASS` / exit 0. It catches label-escaping breakers, decision diamonds, missing
  boundaries, missing SRI, click↔STEPS mismatches, and leftover markers. Fix and re-run until clean.
- Both `TEMPLATE-GRAPH`/`TEMPLATE-STEPS` marker pairs removed; zero `{{…}}`.
- Every node id has a `click` line and a matching `STEPS` entry; `DEFAULT_NODE` is a real key.
- Exactly one `:::crit`; ≥1 `subgraph`; one `<h1 class="title">`; SRI intact.
- Optional (needs internet): open in a browser — nodes clickable, panel updates.
- Grounding: if traced, names/interfaces/`file:line` are real; if conceptual, faithful to prose.

## Quality bar

- **Boundaries earn their place** — subgraphs reflect real systems/layers, not decoration.
- **Edges are typed** — every dependency says what it is (calls/reads/publishes).
- **One critical component** highlighted (`:::crit`).
- **Clickable depth** — each panel adds responsibility/interface/deps, not a label echo.

See `references/components.md` for syntax, the `STEPS` format, and the SRI update procedure.
