# Components & section selection

The write-up adapts to the PR. Pick sections from what the PR actually contains —
never invent a rollout plan or a metric that does not exist. Read [adapting](#adapting-by-pr-type)
first, then copy snippets as needed.

## Section catalogue

| Section id | Always? | Drop it when… |
|---|---|---|
| `tldr` | Always | — |
| `why` | Almost always | Pure mechanical change with no motivation to explain (rare) |
| `why` before/after panels | Behaviour changes | Refactor/docs — replace the `grid2` with a single explanatory `panel` |
| `files` | Always | — |
| `focus` | Usually | Truly trivial PR (1–2 line config bump) |
| `tests` | Always — state "none added" honestly if so | — |
| `rollout` | Behaviour/infra that ships gradually | Docs, refactor, config-only, bugfix with no phased ship → **delete the section and its TOC link** |

## Adapting by PR type

- **Feature / behaviour change** → all sections; before/after panels; rollout if it ships behind a flag or in phases.
- **Bug fix** → TL;DR frames the bug + the fix; `why` before/after = "broken behaviour" vs "correct behaviour"; focus on the root-cause line; usually no rollout.
- **Refactor / cleanup** → `why` is a single panel (the motivation: readability, perf, dedup); file-by-file emphasises *equivalence* ("no behaviour change"); focus points at anything that could subtly differ; no rollout.
- **Docs / config / chore** → keep it short: TL;DR, a compact file-by-file, tests ("n/a — docs only"). Drop focus and rollout.
- **Large PR (many files)** → in file-by-file, write full cards only for the 3–6 load-bearing files; collapse the rest into one "Supporting changes" card with a bullet list. Say how many files were summarised — never imply you covered all of them if you did not.

## Snippets (copy into the template)

### Extra file card
```html
<div class="file" id="file-N">
  <div class="file-head">
    <span class="badge mod">mod</span>            <!-- new | mod | del -->
    <span class="path">src/path/to/file.ts</span>
    <span class="stat"><span class="add">+42</span> <span class="del">−7</span></span>
  </div>
  <p class="role">One-line role of this file in the PR</p>
  <p>What changed and why it matters.</p>
</div>
```

### "Supporting changes" collapse card (for the long tail)
```html
<div class="file" id="file-rest">
  <div class="file-head"><span class="path">Supporting changes (N files)</span></div>
  <ul>
    <li><code>path/a.ts</code> — wires the new worker into the registry.</li>
    <li><code>path/b.test.ts</code> — unit coverage for the retry path.</li>
  </ul>
</div>
```

### Verbose mode — before/after snippet per file
In *verbose* mode (caller said "verbose"), give every non-trivial file card a short
before/after pair so the card reads as a mini-diff. Keep it to the few lines that
changed meaning — never the whole hunk. Skip config/docs/lockfiles (prose only).
```html
<pre><span class="com">// before</span>
<span class="rem">return item.enabled</span>
<span class="com">// after — gate on the allowed set</span>
<span class="add">return item.enabled &amp;&amp; ALLOWED_TYPES.has(item.type)</span></pre>
```
*Lean* mode (default) omits this on all but the 1–2 load-bearing files.

### Code snippet with diff colouring
Wrap added lines in `<span class="add">`, removed in `<span class="rem">`, keywords
`kw`, strings `str`, comments `com`, function names `fn`. Keep snippets short and
illustrative — they explain intent, they are NOT the raw diff. HTML-escape `<`, `>`, `&`.
```html
<pre><span class="com"># before</span>
<span class="rem">notify(user)            # inline, blocking</span>
<span class="com"># after</span>
<span class="add">queue.enqueue(notify, user)   # async, retried</span></pre>
```

### Focus item
```html
<div class="focus">
  <div class="num">3</div>
  <div>
    <p class="ttl">Idempotency of the retry path</p>
    <p>Re-delivery must not double-send; the singleton key dedupes within the window.</p>
    <p class="ref">src/workers/notify.ts · handleJob()</p>
  </div>
</div>
```
**Line refs:** a unified diff has no reliable absolute line numbers (hunk headers
`@@ -a,b +c,d @@` give the *new-file* start of each hunk, not the line of a given
statement). Prefer referencing the **file · symbol** (`notify.ts · handleJob()`)
over `file:line`. Only cite `:line` when computed from the hunk header, and never
present an estimated line number as exact.

### Test checklist item states
```html
<li class="done">Unit: retry backoff schedule (jest)</li>
<li class="todo">Load test at 2× peak — pending staging slot</li>
<li class="na">Migration rollback — n/a, additive column only</li>
```

### TOC sub-link (one per file card you want indexed)
```html
<a class="sub" href="#file-1">worker.ts</a>
```

## Design rules (do not violate)
- Keep the `<style>` block byte-for-byte; it is the design system.
- One `<h1 class="title">` only. Section ids must match TOC `href`s exactly.
- HTML-escape user/diff content (`&lt; &gt; &amp;`). Never paste raw multi-hundred-line diffs.
- Honesty over polish: if there are no tests, no metric, no rollout — say so plainly. A write-up that invents a "180ms" number or a fake rollout is worse than a plain one.
