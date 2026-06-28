# Component-diagram authoring guide

This skill renders a system's **static structure** as a Mermaid `flowchart` with `subgraph`
boundaries plus a clickable detail panel. You write the graph in Mermaid text (reliable) —
Mermaid does the layout. You fill a `STEPS` map for the per-component narrative. Keep the
`<style>` block and the Mermaid init/JS wiring intact.

## When a component diagram is the right tool

Use it for **static structure** — components/services/modules, their boundaries, and what
depends on what. It has **no decisions and no time order**. If the thing branches on a
decision, that's a process → `flowchart`. If it's a time-ordered exchange of messages,
that's `sequence-diagram`. If it's one traced code path, that's `codewalk`.

## Writing the graph (Mermaid `flowchart LR` + `subgraph`)

Replace everything between `%% TEMPLATE-GRAPH-START` and `%% TEMPLATE-GRAPH-END`
(delete both markers). `flowchart LR` reads left-to-right, which suits a dependency map;
`TD` (top-down) is fine too.

**Rectangles only.** Every component is `id[Label]`. Do **not** use decision diamonds
`id{Label}`, and do **not** use exotic shapes (`id([stadium])`, `id[(cylinder)]`,
`id[/parallelogram/]`). The validator rejects diamonds outright — they belong to `flowchart`.

### Boundaries (`subgraph`)

Group components into the real systems/layers they live in. A component diagram needs **≥1
`subgraph`** (the validator enforces this):
```
subgraph edge[Edge]
  gw[API Gateway]:::crit
end
subgraph data[Data stores]
  pg[Postgres]
end
```

### Typed dependency edges

Every edge says **what the dependency is** — label it. Solid for sync, dashed for async/events:
```
A -->|calls| B          %% sync call
A -->|reads| DB         %% sync read
A -->|reads + writes| DB
A -.->|publishes events| Q   %% dashed = async / event / queue
```
Use ASCII edge labels (`reads + writes`, not `reads/writes` if you prefer — both ASCII).

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

   `Auth (jwt) Service` → `Auth #40;jwt#41; Service` ·
   `ApiResponse{Data: Dto}` → `ApiResponse#123;Data: Dto#125;` ·
   `[]ServiceKeyDto` → `#91;#93;ServiceKeyDto`.

2. **Line breaks: literal `<br/>` only — never `\n`.** `\n` renders as the visible text `\n`.
   (Inside the `STEPS` `body` HTML, ordinary `\n` in a `<pre>` is fine — this rule is about
   the **graph** labels only.)

3. **Do NOT use HTML entities (`&#40;`).** `textContent` decodes `&#40;` back to `(` *before*
   Mermaid parses → same parse error. Mermaid's own `#40;` form (no ampersand) survives
   `textContent` and is decoded by Mermaid at render. (`&gt;`/`&lt;`/`&amp;` are fine.)

4. **Edge labels must be ASCII only.** Non-Latin1 chars (`—` `…` `→`) in an edge label make
   Mermaid call `btoa()` on the decoded text → `InvalidCharacterError` at render (in the
   browser too). Map them to ASCII: `—`→`-`, `…`→`...`, `→`→`->`. (Unicode in *node* labels is
   fine — only edge labels hit `btoa`.)

`assets/validate.mjs` enforces all four headlessly — run it before claiming done (see below).

### Colour classes

The template defines `classDef`s — keep them: `:::boundary`, `:::store` (data store),
`:::crit` (the one control point). **Highlight exactly one `:::crit`** — the single
component the reader should notice (the validator requires exactly one). More than one
dilutes it.

### Wiring clicks

Every component the reader can inspect needs a click line and a matching `STEPS` entry:
```
click <nodeId> selectNode "details"
```
`selectNode` is provided in the template; it receives the node id and updates the panel.

## Filling the detail panel (`STEPS`)

Replace everything between `// TEMPLATE-STEPS-START` and `// TEMPLATE-STEPS-END` (delete
both markers). One entry per node id, shaped **responsibility / interface / dependencies**:
```js
auth: {
  title: "Auth Service",
  meta: ["service"],                 // short chips: kind, tech, role
  body: "<p><b>Responsibility:</b> issues + verifies tokens.</p>"
      + "<p><b>Exposes:</b> <code>/verify</code>, <code>/login</code>.</p>"
      + "<p><b>Depends on:</b> Postgres.</p>",
},
```
- Keys must exactly match the node ids in the graph (and the `click` lines).
- `body` is HTML — escape `<`, `>`, `&` in prose (this is HTML, not a Mermaid label — the
  `<br/>`/entity rules above apply only to the **graph** labels).
- Set `DEFAULT_NODE` to a real key (e.g. the control point) so the panel populates on load.

## Grounding

- If the structure is traced from a **real codebase**, component names, interfaces, and
  dependency edges must be real (read the files) — same honesty bar as `codewalk`. If it's a
  conceptual system (described by the user), keep labels faithful to what they described;
  don't invent components or fake edges. Frame estimates as estimates.
- Don't pad the graph with components or boundaries that don't exist to make it look fuller.

## Offline / CDN note

This skill needs **internet** — Mermaid loads from jsDelivr. The tag is pinned to
`mermaid@11.15.0` with a Subresource-Integrity hash and `crossorigin`. If you change the
version, recompute the hash:
```
curl -fsSL https://cdn.jsdelivr.net/npm/mermaid@<VER>/dist/mermaid.min.js \
  | openssl dgst -sha384 -binary | openssl base64 -A
```
and update both the `src` and `integrity` attributes. Never drop the integrity attribute.

## Verify checklist
- **Run the validator** (this is the load-bearing gate — a headless author cannot open a
  browser): `node <skill-dir>/assets/validate.mjs <output>.html`. It must print `PASS` /
  exit 0. It catches every label-escaping failure above (raw `( ) { } [ ] "`, `\n`, `&#NN;`,
  non-ASCII edge labels), decision diamonds, missing boundaries, missing SRI, and
  click↔STEPS mismatches deterministically. Fix what it flags and re-run until clean.
- Both `TEMPLATE-GRAPH` markers and both `TEMPLATE-STEPS` markers are gone; zero `{{…}}` left.
- Every graph node id has a `click` line and a `STEPS` entry; `DEFAULT_NODE` exists in `STEPS`.
- ≥1 `subgraph` boundary. Exactly one `:::crit` node. One `<h1 class="title">`.
- The `<script>` keeps its `integrity` + `crossorigin` attributes.
- Optional final check (needs internet): open it in a browser — chart renders, nodes are
  clickable, the panel updates. The validator already guarantees the Mermaid parses/renders.
