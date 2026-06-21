# Flowchart authoring guide

This skill renders a branching **process** as a Mermaid `flowchart` plus a clickable
detail panel. You write the graph in Mermaid text (which is reliable) — Mermaid does the
layout. You fill a `STEPS` map for the per-node narrative. Keep the `<style>` block and
the Mermaid init/JS wiring intact.

## When a flowchart is the right tool

Use it when the process **branches**: decisions, yes/no gates, fail paths, loops,
retries, parallel forks. If the flow is linear (A→B→C, no decisions), it belongs in
`plan-deck` (data-flow strip) or `codewalk` (path diagram) instead — don't reach for a
flowchart just to draw a straight line.

## Writing the graph (Mermaid `flowchart TD`)

Replace everything between `%% TEMPLATE-GRAPH-START` and `%% TEMPLATE-GRAPH-END`
(delete both markers). Node shapes:

| Syntax | Shape | Use for |
|---|---|---|
| `id[Label]` | rounded box | a process step |
| `id{Label}` | diamond | a decision / gate |
| `id([Label])` | stadium/pill | start & end terminals |
| `id[/Label/]` | parallelogram | input/output (optional) |

Edges and labels:
```
A --> B                 %% plain
G -->|yes| H            %% labelled branch (use yes/no, pass/fail, healthy/…)
H -.->|async| Q         %% dashed = async / queue / background
L --> L                 %% a self-loop = retry
```

Apply the colour classes (already defined as `classDef` in the template — keep them):
`:::term` start/end · `:::dec` decision · `:::ok` success · `:::fail` failure/rollback ·
`:::crit` the one most important step. Example: `test[unit + e2e]:::crit`.

Apply `:::dec` to **every** decision diamond (e.g. `gate{checks pass?}:::dec`) so the
diamonds match the "decision" swatch in the legend — otherwise they render unstyled.

**Highlight exactly one `:::crit`** — the single gate/control point the reader should
notice. More than one dilutes it.

### Wiring clicks
Every node the reader can inspect needs a click line and a matching `STEPS` entry:
```
click <nodeId> selectNode "details"
```
`selectNode` is provided in the template; it receives the node id and updates the panel.

## Filling the detail panel (`STEPS`)

Replace everything between `// TEMPLATE-STEPS-START` and `// TEMPLATE-STEPS-END` (delete
both markers). One entry per node id:
```js
test: {
  title: "Unit + e2e",
  meta: ["~6m", "critical"],        // short chips: duration, tech, role
  body: "<p>Why this gate matters. Escape &lt; &gt; &amp; in prose.</p>",
  code: "<pre><span class='com'>// optional snippet</span>\nyarn test</pre>"  // optional
},
```
- Keys must exactly match the node ids in the graph (and the `click` lines).
- `body`/`code` are HTML — escape `<`, `>`, `&` in prose; use `\n` for line breaks in code.
- Set `DEFAULT_NODE` to the entry node so the panel is populated on load.

## Grounding

- If the flow is traced from a **real codebase**, the `code` snippets and any file refs
  must be real (read the files) — same honesty bar as `codewalk`. If it's a conceptual
  process (described by the user), keep labels faithful to what they described; don't
  invent steps or fake durations. Frame estimates as estimates.
- Don't pad the graph with steps that don't exist to make it look fuller.

## Offline / CDN note

This is the one lirbox skill that needs **internet** — Mermaid loads from jsDelivr.
The tag is pinned to `mermaid@11.15.0` with a Subresource-Integrity hash and
`crossorigin`. If you change the version, recompute the hash:
```
curl -fsSL https://cdn.jsdelivr.net/npm/mermaid@<VER>/dist/mermaid.min.js \
  | openssl dgst -sha384 -binary | openssl base64 -A
```
and update both the `src` and `integrity` attributes. Never drop the integrity attribute.

## Verify checklist
- Both `TEMPLATE-GRAPH` markers and both `TEMPLATE-STEPS` markers are gone; zero `{{…}}` left.
- Every graph node id has a `click` line and a `STEPS` entry; `DEFAULT_NODE` exists in `STEPS`.
- Exactly one `:::crit` node. One `<h1 class="title">`.
- The `<script>` keeps its `integrity` + `crossorigin` attributes.
- Open it in a browser (with internet): the chart renders, nodes are clickable, the panel updates.
