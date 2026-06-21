---
name: codewalk
description: This skill should be used to produce a self-contained HTML "codewalk" — a guided walkthrough that traces ONE path through a real codebase (a request flow, call stack, data path, or trust boundary) with a path diagram, numbered steps each carrying a real file:line location and code excerpt, a key-files panel, and gotchas. Triggers when the user asks to "explain how X works in this codebase", "trace the request/auth/scan flow", "map this module", "make a codewalk", "onboarding doc for this subsystem", or "walk me through how this code path works". Grounded in the actual repo — never fabricates paths or code.
---

# codewalk

Trace one path through a real codebase and render it as a single self-contained HTML
page an engineer can read to onboard or audit: a one-paragraph summary, a request/call
path diagram, a numbered walkthrough where each step carries a real `file:line` and an
expandable real code excerpt, plus a key-files list and gotchas. Warm editorial design
(ivory/clay/slate, serif headings), native `<details>` expand/collapse (no JS), opens
offline. Shares its look with the other lirbox skills (`pr-writeup`, `plan-deck`).

## When to use

Use to explain how a specific flow/subsystem works by following real code. Not for:
planning future work (use `plan-deck`), or summarizing a diff/PR (use `pr-writeup`).

## Inputs

- A **codebase** (the current repo, or a path) and **which path to trace** — a flow, a
  subsystem, an entry point, or a question like "how does auth work here?".
- If the target is vague, pick the most load-bearing interpretation and say so, or ask
  one sharp question.

## Workflow

### 1. Trace the path in real code
This is the core of the skill — the document is only as good as the tracing. Read
`references/components.md` → "Grounding workflow". Find the entry point, then walk the
call path one hop at a time, **opening each file** at the relevant lines. Prefer the
code-graph tools (callers/callees/impact) when available; otherwise search. Record real
`file:line` ranges and copy the load-bearing lines verbatim (trim with `// …`).

Identify the **one critical step** (the trust boundary / single point of control / hot
path) — it gets highlighted. Collect the key files and any real gotchas you saw.

### 2. Choose what to include
Read the section catalogue in `references/components.md`. Keep the path diagram, the
walkthrough (3–6 steps is typical), and the key-files panel. Include the gotchas panel
only if there are real traps; omit it otherwise.

### 3. Assemble the HTML
Copy `assets/template.html` to the output path and fill every `{{PLACEHOLDER}}` and
marked region from what you traced. Use snippets from `references/components.md` for
extra steps, nodes, key files, and gotchas. Keep the `<style>` block unchanged.

Default output path: `./<slug>-codewalk.html` (slug from the path being traced).

### 4. Verify before claiming done
- Valid standalone HTML: one `<h1 class="title">`, section ids match the TOC, zero
  leftover `{{...}}` and no leftover TEMPLATE comments.
- Exactly one critical highlight per axis: at most one `step critical` and at most one
  `node critical` (don't repeat the critical node across diagram rows).
- **Grounding pass (the important one):** re-open the cited files and confirm each
  `file:line` range exists and actually contains the excerpt shown. Confirm key-file
  paths exist. Any path/line/excerpt that can't be verified must be fixed or removed —
  never ship an invented one.
- Report the output path and the one-line takeaway of the path you traced.

## Quality bar

- **One path, traced deeply** — not a shallow tour of a whole module.
- **Real and verifiable** — every path, line, and excerpt matches the repo.
- **Points at the boundary** — the critical step (where the invariant lives) is obvious.
- **Self-contained** — no external CSS/JS/fonts; `<details>` handles expand/collapse.

See `references/components.md` for the snippet library, the grounding workflow, and the
non-negotiable honesty rules.
