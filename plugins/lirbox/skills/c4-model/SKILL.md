---
name: c4-model
description: This skill should be used to model a system's architecture as a C4 model — context → container → component drill-down from ONE LikeC4 (.c4) source — delivered as a single self-contained interactive HTML file (multi-view, pan/zoom, offline-viewable) plus the .c4 source of truth. Triggers when the user asks for a "C4 diagram / C4 model", "context diagram", "container diagram", "system landscape", "architecture model with drill-down", or mentions likec4. Grounded in a real repo (traced, invent nothing) or authored from prose/spec. Requires a running docker daemon (toolchain runs in a throwaway pinned container; first use pulls ~1 GB; nothing installed on the host). For single-level "what talks to what" use component-diagram; for a branching process use flowchart; for a time-ordered interaction use sequence-diagram; for one traced path use codewalk.
---

# c4-model

Turn a system's architecture into a LikeC4 C4 model: one `.c4` source producing a
system landscape plus per-system container views and per-container component views,
built into ONE self-contained interactive HTML page (pan/zoom, clickable drill-down).
Unlike the Mermaid skills, the output is fully **offline-viewable**.

**Toolchain caveat:** every likec4 command runs in a throwaway docker container via
`scripts/likec4.sh` (image pinned there, and only there). Needs a running docker
daemon; first use pulls ≈1 GB. Nothing is installed on the host. Only *generation*
needs docker — the delivered HTML does not.

## When to use

- Whole-system architecture with **hierarchy**: landscape → containers → components,
  many views from one model.
- NOT for: single-level structure (`component-diagram`), a branching process
  (`flowchart`), a time-ordered interaction (`sequence-diagram`), one traced code
  path (`codewalk`).

## Inputs

- The **system** to model — a repo to trace, or prose/spec to author from. If tracing,
  read the files so element names, technologies, and relationships are real (honesty
  bar: invent nothing). Ask for the system + desired depth if unclear.

## Workflow

### 1. Ground
Decide the hierarchy: actors, systems, containers (deployable/runnable units:
services, apps, stores), components (modules inside one container). Decide the views:
`index` landscape + a `view of <system>` per system + `view of <container>` for each
container worth opening. If tracing a repo, read the code first.

### 2. Write the model
Read `references/dsl.md`. Write `./<slug>-c4/model.c4`: `specification` (declare the
kinds), `model` (elements + typed relationships `a -> b 'label' 'tech'`), `views`
(one per drill-down level; always define `view index`). The `<slug>-c4/` dir is the
source of truth — leave it next to the HTML; the user may commit it.

### 3. Validate — the headless gate
From the directory containing `<slug>-c4/`:
`${CLAUDE_PLUGIN_ROOT}/skills/c4-model/scripts/likec4.sh validate --json <slug>-c4`
must exit 0 with `"totalErrors": 0`. Errors carry file/line — fix and re-run until
clean. Never skip this; the compiler is the validator.

### 4. Emit
`${CLAUDE_PLUGIN_ROOT}/skills/c4-model/scripts/likec4.sh build --output-single-file -o <slug>-c4/dist <slug>-c4`
then deliver: `mv <slug>-c4/dist/index.html ./<slug>-c4.html` and delete
`<slug>-c4/dist/` (its `404.html` + favicon are byproducts, not deliverables).

### 5. Verify before claiming done
- Validate gate ran clean (step 3) — evidence, not assertion.
- `./<slug>-c4.html` exists and is > 1 MB; every view title appears in the file
  (`grep -c '<title-text>' <slug>-c4.html` ≥ 1 per view).
- `<slug>-c4/dist/` removed; `<slug>-c4/model.c4` kept.
- Grounding: traced names/technologies/relationships are real; prose faithfully
  represented; nothing invented.
- When delivering, mention: offline-viewable; source of truth in `<slug>-c4/`.

## Quality bar

- **Hierarchy earns its place** — a container with one component, or a `view of X`
  that renders empty, means the level shouldn't exist.
- **Relationships are typed** — every `->` carries a label ('calls', 'reads',
  'publishes'), technology where known.
- **Views are curated** — `include *` plus deliberate `exclude`/`with` overrides,
  not an unreadable include-everything dump.
- **The `.c4` source ships with the HTML** — it is the model; the page is a render.

See `references/dsl.md` for syntax, predicates, and pitfalls.
