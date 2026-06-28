# Sequence-diagram authoring guide

This skill renders a time-ordered **interaction** as a Mermaid `sequenceDiagram` plus a
**numbered step list** that drives a clickable detail panel. You write the diagram in Mermaid
text (which is reliable) — Mermaid does the layout. You fill a `STEPLIST` array for the
per-message narrative. Mermaid can't bind a click to an individual message, so the numbered
list — not the SVG — is the interactive surface. Keep the `<style>` block and the Mermaid
init/JS wiring intact.

## When a sequence diagram is the right tool

Use it when **order over time** is the story: a request flow, an auth handshake, a checkout,
inter-service message exchange — who calls whom, in what order, sync vs async. For static
structure (what depends on what, no time axis) use `component-diagram`; for a branching
**process** with decisions use `flowchart`; for one traced code path use `codewalk`.

## Writing the diagram (Mermaid `sequenceDiagram`)

Replace everything between `%% TEMPLATE-SEQ-START` and `%% TEMPLATE-SEQ-END` (delete both
markers). The first non-comment line must be `sequenceDiagram`, and `autonumber` must be
present — it numbers the messages, and those numbers are what the side-list maps to 1:1.

### Participants (optional)
```
participant U as User          %% declaring fixes left-to-right ORDER and a display alias
actor U as User                %% actor = stick-figure instead of a box
```
Declaration is **optional** — Mermaid auto-creates a participant the first time a message
names it. Declare them only to control column order or set a friendly alias. (The validator
does NOT require declaration.)

### Messages (arrow vocabulary)

| Arrow | Meaning |
|---|---|
| `A->>B: text` | solid arrowhead — a **sync** call / request |
| `A-->>B: text` | dashed arrowhead — a **return** / response / async reply |
| `A-)B: text` | open arrowhead — async (fire-and-forget) |
| `A->>+B: text` … `B-->>-A: text` | the `+`/`-` suffixes open/close an **activation** bar |

Every message line is `From<arrow>To: message text`. The text after `:` is what renders on the
arrow.

### Blocks
```
alt password ok            %% mutually-exclusive branches; pair with `else`
  API-->>U: 200 + session
else bad password
  API-->>U: 401
end

opt logged in              %% an optional step (may or may not happen)
  API->>Cache: refresh
end

loop every 30s             %% repeated messages
  Worker->>Queue: poll
end

par fan-out                %% concurrent branches; separate with `and`
  API->>A: req
and
  API->>B: req
end

note over A,B: a side note %% `note over X` / `note left of X` / `note right of X`
```

### Escaping (REQUIRED — message text breaks Mermaid otherwise)

Mermaid reads the diagram from the `<pre class="mermaid">` element's `textContent`, then runs
its own grammar over it. Two rules for **message / note text**:

1. **Line breaks: `<br/>` only — never `\n`.** A literal `\n` renders as the visible text
   `\n` (it does not break the line). Use `<br/>` inside the message text instead.
2. **Avoid `;` in message text.** Mermaid can treat `;` as a statement separator and
   misparse the line. Reword to drop it.
3. **HTML-escape `< > &`** in message/note text (`&lt;` `&gt;` `&amp;`) so they don't collide
   with Mermaid's inline-HTML handling.

`assets/validate.mjs` enforces the `\n` and `;` rules headlessly — run it before claiming done
(see below).

## Filling the step list (`STEPLIST`)

Replace everything between `// TEMPLATE-STEPLIST-START` and `// TEMPLATE-STEPLIST-END` (delete
both markers). `STEPLIST` is an **array** — one entry per autonumbered message, **in the same
order as the diagram**. Entry shape:
```js
{
  title: "Look up the user",
  from: "API", to: "Postgres",       // who → who (rendered as a chip)
  kind: "sync",                       // "sync" | "return" | "async" — matches the arrow
  crit: true,                         // EXACTLY ONE entry sets crit:true
  meta: ["SELECT"],                   // short chips: verb, endpoint, status
  body: "<p>Why this message matters. Escape &lt; &gt; &amp; in prose.</p>",
  code: "<pre><span class='kw'>SELECT</span> … </pre>"   // optional, at the real call site
},
```

- **The list maps 1:1 to the diagram's numbers** — `STEPLIST[0]` is message ①, `STEPLIST[1]`
  is ②, and so on. This 1:1 mapping is what the numbered list relies on; the validator counts
  the diagram's messages and the array's `title:` keys and fails if they differ.
- **An `alt`/`opt` branch is ONE logical step.** The primary branch's message is the
  autonumbered/counted step; the `else`-alternative outcome is collapsed into that same
  STEPLIST entry (describe both outcomes in its `body`, e.g. "200 on match, 401 otherwise").
  `loop`/`par` messages are distinct steps and each get their own entry.
- **Exactly one entry has `crit:true`** — the single trust-boundary crossing / irreversible
  write the reader should notice. More than one dilutes it. The validator enforces exactly one.
- `body`/`code` are HTML — escape `<`, `>`, `&` in prose; `\n` inside a `code` `<pre>` is a
  real line break here (this is HTML, not Mermaid text — the `<br/>` rule applies only to the
  **diagram** message text).
- Set `DEFAULT_STEP` to an in-range integer index (usually `0`) so the panel is populated on
  load. `selectStep`/`renderSteps` are provided by the template.

## Grounding

- If the interaction is traced from a **real codebase**, the messages and any `code` at the
  call site must be real (read the files) — same honesty bar as `codewalk`. If it's a
  conceptual interaction (described by the user), keep messages faithful to what they
  described; don't invent steps or fake order. Frame estimates as estimates.
- Don't pad the diagram with messages that don't happen to make it look fuller.

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
  exit 0. It checks: the block is a `sequenceDiagram` with `autonumber`; the message count and
  `STEPLIST` length match 1:1; exactly one `crit:true`; `DEFAULT_STEP` in range; no literal
  `\n` or `;` in message text; SRI intact; no leftover markers/placeholders. Fix what it flags
  and re-run until clean.
- Both `TEMPLATE-SEQ` markers and both `TEMPLATE-STEPLIST` markers are gone; zero `{{…}}` left.
- The `<script>` keeps its `integrity` + `crossorigin` attributes. One `<h1 class="title">`.
- Optional final check (needs internet): open it in a browser — the diagram renders with no
  parse error, the numbered steps are clickable, and the panel updates.
