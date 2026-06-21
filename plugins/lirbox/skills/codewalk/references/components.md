# Components & grounding

A codewalk traces ONE path through real code — a request flow, a call stack, a data
path, a trust boundary. Its whole value is being **true to the repo**. Every file path,
line range, and code excerpt must come from files you actually read. Fabrication is the
one unforgivable failure here.

## Scope: trace one thing, well

Pick a single spine and follow it end to end: e.g. "how a request gets authenticated",
"what happens when a QR scan is submitted", "how a rate-limit decision is made". Resist
documenting the whole module — depth on one path beats breadth across many.

Name the **one idea** the reader should leave with: the single point of control, the
trust boundary, the hot path, the place the invariant is enforced. Highlight it (the
`critical` node and `critical` step).

**Exactly one critical highlight per axis.** Use `class="step critical"` on **at most one**
walkthrough step, and `class="node critical"` on **at most one** diagram node. If two
steps feel critical, pick the more load-bearing one and leave the other a normal step —
two highlights dilute the point. Do not render the same critical node twice in the
diagram (e.g. across an allow-row and a block-row); show it once.

## Section catalogue

| Section / panel | Always? | Drop when… |
|---|---|---|
| Summary (header) | Always | — |
| `path` diagram | Almost always | The flow is purely linear and trivial (rare) — then lean on the walkthrough alone |
| `walkthrough` | Always | — (this is the body: ordered steps with real loc + excerpt) |
| Key files panel | Always | — |
| Gotchas panel | When real traps exist | **Omit if none** — don't invent a gotcha to fill it |

## Grounding workflow (how to get the facts)

1. Find the entry point — where the path starts (a route handler, an event consumer, a
   CLI command). Prefer the code-graph tools (callers/callees/impact) if available;
   otherwise search.
2. Walk the call path one hop at a time, opening each file at the relevant lines. Record
   the real `file:line` range and copy the few load-bearing lines verbatim (trim the rest).
3. Identify the critical step — the place the key decision/invariant lives.
4. Collect the key files (the handful that matter) and any real gotchas (caches, races,
   ordering hazards, edge cases) you saw while reading — not generic advice.

## Snippets (copy into the template)

### Extra walkthrough step
```html
<div class="step">                         <!-- add class "critical" for the trust boundary -->
  <div class="num">3</div>
  <div class="body">
    <p class="loc">src/lib/sessionStore.ts:22–55</p>
    <p>What this hop does and why it matters to the path.</p>
    <details class="snip"><summary>sessionStore.ts · lookup()</summary>
<pre><span class="kw">async</span> <span class="fn">lookup</span>(id) { <span class="com">// real, trimmed excerpt</span> }</pre>
    </details>
  </div>
</div>
```

### Path node + arrow
```html
<span class="node">/api/session<span class="sub">route handler</span></span>
<span class="arrow"><span class="albl">cookie</span>→</span>            <!-- labelled sync hop -->
<span class="node critical">verifyToken()<span class="sub">middleware/auth.ts</span></span>
<span class="arrow async"><span class="albl">enqueue</span>⇢</span>       <!-- async: queue/event/bg -->
```

### Key file
```html
<div class="kf"><div class="path">src/middleware/auth.ts</div><div class="role">auth entry point — every request passes through</div></div>
```

### Gotcha
```html
<div class="gotcha"><b>Per-process LRU cache</b> — session lookups are cached per worker, so a revoked session can linger on other workers until TTL.</div>
```

### Code excerpt colouring
Keywords `kw`, strings `str`, comments `com`, function names `fn`, numbers `num`.
HTML-escape `<`, `>`, `&`. Keep excerpts to the load-bearing lines; use `// …` to elide.
The `<details>` element gives native expand/collapse — **no JavaScript**.

## Honesty rules (do not violate)
- Keep the `<style>` block byte-for-byte; it is the design system (shared with the other lirbox skills).
- Every `loc` (file:line) must be real and the line range must actually contain the code shown. If a step shows a helper that is defined elsewhere, cite **that helper's** line range — not the enclosing function's entry lines.
- At most one `step critical` and at most one `node critical` in the whole document (see "Scope").
- Every excerpt is a faithful (optionally trimmed) copy of the real source — never paraphrased into code that doesn't exist. Eliding with `// …` is fine; inventing is not.
- Gotchas are things you actually observed in the code, not boilerplate cautions.
- One `<h1 class="title">`; section ids match the TOC; self-contained single file.
