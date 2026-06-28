---
name: sequence-diagram
description: This skill should be used to draw a TIME-ORDERED INTERACTION between actors/services as a self-contained interactive HTML sequence diagram — a Mermaid sequenceDiagram (autonumbered messages, sync/return arrows, alt/opt/loop, notes) paired with a NUMBERED step list that drives a clickable detail panel (who→who, sync/async, narrative, code at the real call site). Triggers when the user asks to "make a sequence diagram", "show the request/login/checkout flow over time", "diagram the message exchange between services", "who calls whom and in what order". For static structure use component-diagram; for a branching process with decisions use flowchart; for one traced code path use codewalk.

# NOTE: output loads Mermaid from a CDN, so the page needs internet to render.
---

# sequence-diagram

Turn a time-ordered interaction into one self-contained interactive HTML page: a Mermaid
`sequenceDiagram` (autonumbered) beside a **numbered step list** that drives a detail panel.
Mermaid can't bind clicks to individual messages, so the numbered list — not the SVG — is the
interactive surface. Warm editorial design shared with the other lirbox HTML skills.

**Offline caveat:** the page fetches Mermaid from a CDN (pinned + SRI). It needs internet to
render — mention this when delivering.

## When to use

Use it for **interaction over time** — request flows, auth handshakes, checkout, inter-service
message exchange. NOT for static structure (use `component-diagram`) or a branching process
with decisions (use `flowchart`).

## Inputs

- An **interaction** to trace — from prose, or from a real repo. If tracing, the messages and
  any `code` at the call site must be real (read the files). Invent nothing.

## Workflow

### 1. Order the messages
List the participants and the messages between them in order: who initiates, sync call vs
async/return, any `alt`/`opt`/`loop` blocks, and notes. Identify the **one critical step**
(the trust-boundary crossing / irreversible write).

### 2. Write the diagram + step list
Read `references/components.md` (sequence syntax, escaping, the `STEPLIST` shape). Copy
`assets/template.html`, then: replace the diagram between `TEMPLATE-SEQ` (keep `autonumber`),
replace the `STEPLIST` array between `TEMPLATE-STEPLIST` (**one entry per autonumbered message,
in order; exactly one `crit:true`**), fill `{{…}}`, set `DEFAULT_STEP`. Keep `<style>` + wiring.
Line breaks in message text: `<br/>` only; avoid `;`. Default output: `./<slug>-sequence.html`.

### 3. Verify before claiming done
- **Run the validator — the headless gate:** `node <skill-dir>/assets/validate.mjs <output>.html`
  must print `PASS` / exit 0. It checks: it's a `sequenceDiagram` with `autonumber`; every
  autonumbered message has exactly one `STEPLIST` entry (1:1 count); one `crit:true`;
  `DEFAULT_STEP` in range; no literal `\n`/`;` or unescaped `#` in message text; SRI intact; no leftover markers.
- Both marker pairs removed; zero `{{…}}`.
- Optional (needs internet): open in a browser — numbered steps clickable, panel updates,
  Mermaid renders with no parse error.
- Grounding: if traced, messages/`code`/`file:line` are real; if conceptual, faithful to prose.

## Quality bar

- **Order is the story** — messages read top-to-bottom as the real sequence; branches use
  `alt`/`opt`, not separate diagrams.
- **One critical step** marked (`crit:true`) — the trust boundary / irreversible action.
- **Clickable depth** — each step's panel adds who→who, sync/async, and real narrative, not a
  label echo.

See `references/components.md` for sequence syntax, escaping, the `STEPLIST` format, and the
SRI update procedure.
