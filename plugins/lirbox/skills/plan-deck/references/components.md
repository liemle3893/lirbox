# Components & section selection

The plan adapts to the work. Include only sections that carry real content — an empty
"Mockups" or a padded "Risks" table is worse than omitting it. After deleting or
reordering sections, **renumber the `.sec-num` badges (01, 02, …)** and fix the TOC.

## Section catalogue

| Section id | Always? | Drop / adapt when… |
|---|---|---|
| summary stats (header) | Always (2–4 cards) | Drop a card if you can't justify its number; never guess an effort/table count |
| `decisions` (lead) | Recommended | **Un-numbered lead block, before `milestones`.** The decisions most likely to change, ordered by likelihood (data models → contracts → user-facing). Lead with them so reviewers react to what matters; the mechanical plan follows. Omit only if the plan truly has no soft spots |
| `milestones` | Always | — (this is the backbone: sequenced, independently shippable slices) |
| `dataflow` | Usually | Pure refactor/docs with no new runtime path → drop it |
| `mockups` | UI work only | Backend / infra / library / CLI plans → **delete** (and TOC link) |
| `code` | Usually | Drop if no snippet clarifies (trivial plan); keep to 1–2 snippets max |
| `risks` | Almost always | Only drop for a genuinely low-stakes change; otherwise name real, plan-specific risks |
| `questions` | When real unknowns exist | **Omit if none** — do not manufacture questions to fill the section |

## Adapting by plan type

- **User-facing feature** → all sections; mockups carry weight; milestones map to UI+API+realtime slices.
- **Backend / API** → drop mockups; dataflow + key code (schema, contracts) are the core.
- **Infra / migration / data backfill** → drop mockups; milestones = phased rollout; dataflow shows old→new path; risks emphasise data safety + reversibility; key code = migration / runbook step.
- **Refactor / tech-debt** → often drop dataflow AND mockups; milestones = safe incremental steps with "no behaviour change" checkpoints; risks emphasise regressions; key code shows before/after of the central pattern.
- **Library / SDK / CLI** → drop mockups; key code shows the public API surface; risks = compat/versioning.

## Honesty rules (do not violate)

- **Effort, table counts, surface counts, flag names** in the summary must be grounded — derive from the spec or the codebase you inspected, or omit the card. Never invent a `~2 weeks` you can't defend.
- **Milestone `dot done`** only for slices that are actually complete. For a fresh plan, all dots are pending (no `done` class).
- **Risks** must be specific to this plan (a real race, a real migration lock, a real auth gap), not generic ("bugs may occur").
- **Open questions** are real decisions you can't make alone — omit the section if there are none.
- **Code snippets** are illustrative and must be consistent with the actual stack/schema; HTML-escape `<`, `>`, `&`.

## Snippets (copy into the template)

### Decision likely to change (lead block)
Order these by likelihood of change — a data-model/contract/UX decision the reader
should react to *before* reading the mechanical plan. Reuses the `.question` card.
```html
<div class="question">
  <p class="q">Comment identity: soft-delete + edit history, or hard delete?</p>
  <span class="owner">Changes the schema &amp; every read path · blocks slice 2</span>
</div>
```

### Extra milestone
```html
<div class="milestone">
  <span class="dot"></span>                 <!-- add class "done" only if complete -->
  <div class="m-when">Week 2 · Mon–Wed</div>
  <div class="m-title">Realtime fan-out &amp; unread state</div>
  <p>What this slice delivers and why it can ship on its own.</p>
  <div class="tags"><span class="tag">packages/api</span><span class="tag">0043_reads.sql</span></div>
</div>
```

### Data-flow node + arrow
```html
<span class="node">comments.create<span class="sub">tRPC · packages/api</span></span>
<span class="arrow">→</span>              <!-- sync request/response -->
<span class="arrow async">⇢</span>         <!-- async: queue / realtime / background -->
```
For a vertical flow on many nodes, just let them wrap — the `.flow` box flex-wraps.

### Risk row
```html
<tr>
  <td>Realtime duplicate — socket append races the HTTP response</td>
  <td><span class="sev high">High</span></td>   <!-- high | med | low -->
  <td>Dedupe on server id; filter temp rows on reconcile.</td>
</tr>
```

### Open question
```html
<div class="question">
  <p class="q">Edit vs. delete-and-repost for comments?</p>
  <span class="owner">Decide with design · before slice 2</span>
</div>
```

### Code block (escape + colour)
Keywords `kw`, strings `str`, comments `com`, function names `fn`, added `add`, removed `rem`.
Keep it to the lines that pin down the hard part — not a full file.
```html
<pre><span class="com">// reconcile temp id -> real id so the realtime append doesn't duplicate</span>
<span class="kw">onSuccess</span>(real, vars, ctx) { <span class="fn">replaceTemp</span>(ctx.tempId, real.id) }</pre>
```

## Design rules
- Keep the `<style>` block byte-for-byte; it is the design system (shared look with the `pr-writeup` skill).
- One `<h1 class="title">`. Section ids must match TOC `href`s. Section badges run 01..N with no gaps.
- Self-contained: no external CSS/JS/fonts/images. The data-flow uses CSS nodes (no SVG dependency).
