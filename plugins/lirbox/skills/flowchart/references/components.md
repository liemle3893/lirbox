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

### Escaping labels (REQUIRED — code-derived labels break Mermaid otherwise)

Mermaid reads label text from the `<pre class="mermaid">` element's `textContent`, then runs
its own grammar over it. Real code in labels (which this skill encourages) breaks that parser
or its renderer unless you escape it. Four rules — they apply to **node labels and edge
labels** alike:

1. **Replace `( ) { } [ ] "` with Mermaid entities** — not the literal char, not an HTML
   entity:

   | char | use | char | use |
   |---|---|---|---|
   | `(` | `#40;` | `)` | `#41;` |
   | `{` | `#123;` | `}` | `#125;` |
   | `[` | `#91;` | `]` | `#93;` |
   | `"` | `#34;` | | |

   `c.Param("tenant_id")` → `c.Param#40;#34;tenant_id#34;#41;` ·
   `ApiResponse{Data: Dto}` → `ApiResponse#123;Data: Dto#125;` ·
   `[]ServiceKeyDto` → `#91;#93;ServiceKeyDto`.

2. **Line breaks: literal `<br/>` only — never `\n`.** `\n` renders as the visible text `\n`.
   (Inside the `STEPS` `code`/`body` HTML, ordinary `\n` in a `<pre>` is fine — this rule is
   about the **graph** labels only.)

3. **Do NOT use HTML entities (`&#40;`).** `textContent` decodes `&#40;` back to `(` *before*
   Mermaid parses → same parse error. Mermaid's own `#40;` form (no ampersand) survives
   `textContent` and is decoded by Mermaid at render. (`&gt;`/`&lt;`/`&amp;` are fine.)

4. **Edge labels must be ASCII only.** Non-Latin1 chars (`—` `…` `→`) in an edge label make
   Mermaid call `btoa()` on the decoded text → `InvalidCharacterError` at render (in the
   browser too). Map them to ASCII: `—`→`-`, `…`→`...`, `→`→`->`. (Unicode in *node* labels is
   fine — only edge labels hit `btoa`.)

`assets/validate.mjs` enforces all four headlessly — run it before claiming done (see below).

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
- `body`/`code` are HTML — escape `<`, `>`, `&` in prose; `\n` inside a `code` `<pre>` is a
  real line break here (this is HTML, not a Mermaid label — the `<br/>`/entity rules above
  apply only to the **graph** labels).
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
- **Run the validator** (this is the load-bearing gate — a headless author cannot open a
  browser): `node <skill-dir>/assets/validate.mjs <output>.html`. It must print `PASS` /
  exit 0. It catches every label-escaping failure above (raw `( ) { } [ ] "`, `\n`, `&#NN;`,
  non-ASCII edge labels) deterministically. Fix the labels it flags and re-run until clean.
- Both `TEMPLATE-GRAPH` markers and both `TEMPLATE-STEPS` markers are gone; zero `{{…}}` left.
- Every graph node id has a `click` line and a `STEPS` entry; `DEFAULT_NODE` exists in `STEPS`.
- Exactly one `:::crit` node. One `<h1 class="title">`.
- The `<script>` keeps its `integrity` + `crossorigin` attributes.
- Optional final check (needs internet): open it in a browser — chart renders, nodes are
  clickable, the panel updates. The validator already guarantees the Mermaid parses/renders.
