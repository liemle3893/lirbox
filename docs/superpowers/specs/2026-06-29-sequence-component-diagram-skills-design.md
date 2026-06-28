# Design: `sequence-diagram` & `component-diagram` skills

**Date:** 2026-06-29
**Status:** approved (design) → ready for implementation plan
**Family:** HTML-artifact skills (siblings of `flowchart`, `codewalk`, `plan-deck`, `pr-writeup`)

## Problem

lirbox has one Mermaid-backed artifact skill, `flowchart`, which draws a **branching
process** (decision diamonds, control flow). Two common diagram needs are unserved:

- **Sequence diagrams** — interactions *over time* between actors/services (ordered
  messages, async returns, `alt`/`opt`/`loop`, activations).
- **Component diagrams** — *static structure*: components, system/layer boundaries, typed
  dependencies, interfaces.

Both want the flowchart treatment: a self-contained interactive HTML page with a clickable
detail panel, grounded in real code when pointed at a repo.

## Decision summary

| Question | Decision |
|---|---|
| Packaging | **Two separate skills**: `sequence-diagram`, `component-diagram`. Self-contained, visually consistent by convention (not shared files — the established lirbox pattern). |
| Grounding | **Both** — code-traced (read real files; real participants/components, real call sites/deps, `file:line`) *and* conceptual (from prose). Invent nothing. |
| Component construct | **Subgraph flowchart** (`flowchart`/`graph` + `subgraph`). Best-supported, renders reliably, supports per-node `click`. (Not C4 / not `architecture-beta` — both experimental, no clean click binding.) |
| Sequence interaction | **Numbered side-list** (codewalk-style). Mermaid `sequenceDiagram` has no per-message `click`; an autonumbered side list drives the panel. |
| Build scope | **Both in one plan.** Build `component-diagram` first (closest to flowchart, de-risks the shared backbone), then `sequence-diagram`. |
| Evals floor | **Yes, minimal**, per skill — clean + broken fixtures + a floor test wiring the validator. Makes the validator trustworthy and the skill `whetstone`-improvable. |

## Why two skills, not one (or an extension of flowchart)

- CLAUDE.md: a skill's `description` **is its trigger** — keep it specific. A combined
  skill broadens/muddies the trigger.
- The two types diverge in syntax, escaping rules, **and** interaction model, so a combined
  skill carries two machineries anyway — combining saves little.
- Neither collapses into `flowchart`: flowchart = *branching process* (decisions); component
  = *static structure* (no decision diamonds); sequence = *time-ordered interaction*.

## Shared backbone (held by convention, duplicated per skill)

Each skill is self-contained and mirrors flowchart's anatomy:

```
plugins/lirbox/skills/<skill>/
├── SKILL.md                      # frontmatter trigger + workflow + verify gate
├── references/components.md      # authoring guide (syntax, escaping, STEPS/STEPLIST format)
├── assets/
│   ├── template.html             # warm-editorial shell, panel, Mermaid loader, JS wiring
│   └── validate.mjs              # headless verify gate (no browser/network/npm)
└── evals/
    ├── fixtures/{clean,*-broken}.html
    ├── floor/<name>.test.mjs     # characterization — PASSES on baseline
    └── run.mjs                   # floor runner (exit 0 iff all floor tests pass)
```

Common properties:

- **Single self-contained HTML** artifact; warm editorial palette (ivory/clay/olive) matching
  the other HTML skills.
- **Mermaid from CDN**, version-pinned + SRI hash + `crossorigin`. Consequence: **both skills
  are non-offline**, like flowchart — state this on delivery.
- **Clickable detail panel**: title, meta chips, narrative (HTML, escape `< > &`), optional
  **real** code snippet.
- **Headless `validate.mjs`** is the load-bearing verify gate a subagent can actually run.
  Structural checks + syntax-specific escaping checks; prints `PASS`/exit 0 or findings/exit 1.
- **Grounding honesty bar** (codewalk's): trace real files when given a repo; else stay faithful
  to the user's prose. No invented steps, participants, components, or metrics. Estimates are
  framed as estimates.
- **Evals floor**: characterization tests that pass on baseline, asserting the validator's
  existing behavior, so the validator can't silently regress (and `whetstone` can harden it).

## `sequence-diagram`

- **Mermaid `sequenceDiagram`** + `autonumber`: `participant`/`actor`, `->>` (sync call),
  `-->>` (async/return), `alt`/`opt`/`loop`/`par` blocks, `activate`/`deactivate`, `note`.
- **Interaction — numbered side-list:** each autonumbered message is one entry in a `STEPLIST`
  array rendered as a numbered list beside the SVG; clicking an entry updates the panel
  (and may highlight). This replaces flowchart's SVG `click` because Mermaid sequence diagrams
  do not expose per-message click binding.
- **Panel** per step: title, meta chips (`from→to`, sync/async, role/timing), body narrative,
  optional `code` = the real call site (`file:line` when traced).
- **One critical step** highlighted — the trust-boundary crossing / irreversible write — so the
  reader's eye lands on the step that matters.
- **`validate.mjs`** asserts:
  - exactly one `<pre class="mermaid">` with a `sequenceDiagram` header + `autonumber`;
  - every autonumbered message ↔ a `STEPLIST` entry (count + index match), no orphans;
  - every participant referenced is declared;
  - `DEFAULT_STEP` resolves to a real entry; exactly one critical step;
  - SRI + `crossorigin` intact on the Mermaid `<script>`;
  - **escaping** — sequence render-breakers escaped (`<br/>` not `\n`; message-text / `note`
    pitfalls). **The exact rule set is discovered empirically during the build** (render real
    diagrams, codify each failure into the validator + an evals fixture). v1 ships the known
    set; `whetstone` hardens later.
- **Output:** `./<slug>-sequence.html`.

## `component-diagram`

- **Mermaid `flowchart`/`graph`** with `subgraph` boundaries (systems/layers), **typed**
  dependency edges (`depends-on` / `calls` / `publishes-to` / `reads`), interface labels.
  **No decision diamonds** — that distinguishes it from flowchart.
- **Trigger** sharply differentiated from flowchart: *static structure / architecture /
  module map / dependency graph / what-talks-to-what / system boundaries* vs flowchart's
  *branching process / decisions / pipeline*.
- **Interaction — per-node `click` → panel** (flowchart's binding works here).
- **Panel** per component: title, meta chips (layer/tech/role), responsibility, **interface**
  (what it exposes), **dependencies** (what it uses), optional entry `file:line`.
- **One critical component** highlighted (`:::crit`) — the control point.
- **`validate.mjs`** = flowchart's four label-escaping rules (same `flowchart`/`graph` syntax,
  so the escaping checker is reused, starting as a copy of flowchart's `validate.mjs`) **plus**
  component structural checks:
  - at least one `subgraph` boundary present (a component diagram without boundaries is a smell);
  - every node id has a `click` line and a matching `STEPS` entry; no orphans either way;
  - `DEFAULT_NODE` resolves; exactly one `:::crit`; SRI + `crossorigin` intact;
  - no decision-diamond shapes `{...}` (those belong to flowchart).
- **Output:** `./<slug>-component.html`.

## Conventions honored

- Each skill scaffolded from `templates/skill-template`; `name:` == dir name (kebab-case);
  `description:` a specific, differentiated trigger (third person, explicit *when*).
- **README.md** skill catalog + **CONTRIBUTING.md** references updated to list both skills.
- Runtime sample artifacts (`*-sequence.html`, `*-component.html`) are gitignored like the
  other generated HTML; the `evals/` floor + fixtures + template are committed.
- `claude plugin validate .` passes; commit identity = `liemle3893` (githook-enforced).

## Verifiable success criteria (loop until all green)

1. `claude plugin validate .` → passes (both skills schema-valid, auto-discovered).
2. Each skill: `node plugins/lirbox/skills/<skill>/assets/validate.mjs evals/fixtures/clean.html`
   → `PASS` / exit 0; each broken fixture → finding / exit 1.
3. Each skill: `node plugins/lirbox/skills/<skill>/evals/run.mjs` → `FLOOR GREEN` / exit 0.
4. A generated sample per skill opens in a browser (needs internet): Mermaid parses with no
   error, steps/nodes are clickable, the panel updates. (Manual final check; the validator is
   the headless gate.)
5. README + CONTRIBUTING list both skills; each `SKILL.md` `name` matches its directory and its
   `description` is differentiated from flowchart's.

## Tradeoffs / open questions

1. **Validator duplication.** `component-diagram/assets/validate.mjs` ≈ `flowchart/assets/validate.mjs`.
   v1 **duplicates** (matches the existing self-contained-skill pattern). A shared
   `_shared/escape-lint.mjs` is noted as a *later* refactor, not v1 scope.
2. **Sequence validator completeness.** Its render-breaker rules must be discovered empirically.
   v1 ships the known set + evals fixtures; `whetstone` is the mechanism to harden it over time.
3. **`component` vs `flowchart` trigger overlap.** Mitigated by sharp, contrasting `description`
   wording (static-structure vs branching-process) — verify the two don't mis-trigger during
   smoke-testing.

## Out of scope (v1)

- C4 and `architecture-beta` component backends.
- UML class diagrams, state diagrams, ER diagrams, gantt — separate future skills if wanted.
- Shared/factored validator module (see tradeoff 1).
- Auto-discovery of a system's architecture (the skill draws what it's told / what it traces;
  it is not an architecture *miner*).
