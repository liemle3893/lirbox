# Use cases + whetstone backlog: `component-diagram` & `sequence-diagram`

**Date:** 2026-06-29
**Purpose:** Design-use-case both v1 diagram skills, then file a whetstone-ready concern
backlog (`feedback/component-diagram.jsonl`, `feedback/sequence-diagram.jsonl`) so a later
`/lirbox:whetstone` run can sharpen them.

Method: for each skill I walked 6–10 realistic, diverse asks a user would actually make, judged
whether v1 handles each well (most are handled), and turned each *genuine* gap into one concern
that is **RED on the current skill** — verified by running the committed `validate.mjs` against a
crafted fixture. Concerns prefer deterministic checks against the skill's files / validator /
output; 2 explicitly subjective concerns per skill are flagged for human-only routing.

`acceptanceCheck` is left `null` in every concern — whetstone's setup RED-drafts and
discrimination-gates the check itself.

---

## `component-diagram`

### Use cases walked

| # | Use case | v1 handles it? |
|---|---|---|
| C1 | A 3-tier web app (web → app → db, layered subgraphs) | **Well** — the template *is* essentially this; subgraph boundaries + typed edges fit. |
| C2 | A microservices map with an **external 3rd-party** system (e.g. Stripe/Twilio) | **Gap** — no way to mark an external/in-house boundary distinctly; only `:::boundary`/`:::store`/`:::crit` exist. |
| C3 | A monorepo package-dependency graph | **Mostly** — but the graph is naturally a flat dependency mesh; an unlabeled `pkg-a --> pkg-b` edge passes the validator even though the quality bar requires typed edges. |
| C4 | An event-driven pipeline (producers → queue → consumers, dashed async) | **Well** — `-.->|publishes events|` dashed edges are first-class. |
| C5 | A data-platform map with stores of different kinds | **Mostly** — `:::store` exists; a reviewer can't tell a node was meant to be a cylinder/store from shape (exotic shapes are claimed-forbidden but unenforced). |
| C6 | A "what talks to what" service map with one control point | **Well** — single `:::crit`, click→panel works. |
| C7 | Diagram traced from a real repo (real module names + file:line) | **Well** — grounding bar is explicit and the panel carries interface/deps. |

### Genuine gaps → backlog

| id | concern (the gap) | why it's RED on v1 | suggested check idea |
|---|---|---|---|
| `untyped-edge` | validator should flag a `-->`/`-.->` with no `\|label\|` | crafted fixture with a bare `gw --> cache` **passes** validate.mjs (exit 0), violating the typed-edge quality bar | scan mermaid block for an arrow line containing no `\|...\|` span → fail |
| `exotic-shape-rejected` | validator should reject stadium/cylinder/parallelogram shapes | `auth([Auth Service])` (clean inner label) **passes**; SKILL.md+references claim "rectangles only, validator rejects exotic shapes" — false | regex for `([`/`[(`/`[/` shape syntax in the graph → fail |
| `orphan-node` | validator should flag a node with no `click` and no `STEPS` entry | added `metrics[Metrics]` node with neither **passes**; design spec promised "no orphans either way" | collect node ids from the graph, require each has a `click` line |
| `steps-orphan-key` | validator should flag a `STEPS` key matching no node id | the parity check is one-directional (click→STEPS only) | diff STEPS keys against graph node ids → fail on extras |
| `external-system-guidance` | references must document marking an external/3rd-party system distinctly | grep of references/components.md finds **no** mention of external/third-party/vendor | assert the doc names an `:::external` (or equivalent) convention |
| `crit-meaningful-placement` *(subjective)* | the `:::crit` node should be the genuine control point | semantic judgment, no deterministic check | human-only |
| `boundary-grouping-quality` *(subjective)* | subgraphs should reflect real systems/layers, not decoration | layout-quality judgment | human-only |

---

## `sequence-diagram`

### Use cases walked

| # | Use case | v1 handles it? |
|---|---|---|
| S1 | OAuth handshake with `loop` + `alt` | **Well** — alt collapses to one logical step; the parity heuristic already handles this (it's the canonical fixture). |
| S2 | Checkout with an **async webhook** callback | **Well** — `-)` open async arrow and `-->>` return are counted correctly. |
| S3 | **Retry-with-backoff** (loop until success / give up) | **Gap** — `loop` is supported, but the guide's only example is `loop every 30s` with no exit/`break`/backoff guidance, so a real retry maps awkwardly. |
| S4 | Multi-service **saga** with compensating transactions | **Mostly** — many sequential messages work; but kind/from/to integrity on each STEPLIST entry is unchecked, so a long list silently degrades. |
| S5 | Request flow with activation bars (`->>+` / `-->>-`) | **Gap** — an opened-but-never-closed activation **passes** the validator yet breaks Mermaid render. |
| S6 | `par` fan-out to N services | **Well** — `par`/`and` branches are each counted (verified: 3-message par fixture counts 3). |
| S7 | Login with `alt password ok / else 401` | **Well** — canonical baseline case. |
| S8 | Traced from a real repo (real call sites + file:line code) | **Well** — grounding bar + `code` field per step. |

### Genuine gaps → backlog

| id | concern (the gap) | why it's RED on v1 | suggested check idea |
|---|---|---|---|
| `steplist-missing-fromto` | validator should reject a STEPLIST entry missing `from`/`to` | stripped from/to from entry 0 → **passes**; panel chip renders only when both present | parse STEPLIST entries, require `from:` and `to:` on each |
| `unbalanced-activation` | validator should flag an unclosed `->>+`/`activate` | `U->>+API` with no `-->>-`/`deactivate` **passes**; breaks Mermaid render | track +/activate vs -/deactivate balance across the block |
| `kind-arrow-mismatch` | validator should flag `kind` contradicting the arrow | validator never cross-checks `kind` vs arrow (`grep kind validate.mjs` → 0 hits) | map each message arrow → expected kind, compare to STEPLIST[i].kind |
| `steplist-missing-kind` | validator should reject an entry missing `kind` | only `title:` keys are counted; a kindless entry passes | require `kind:` on each STEPLIST entry |
| `retry-backoff-guidance` | references must show a retry-with-backoff `loop` (exit/`break`/delay) | guide's only loop example has no exit condition or backoff | assert the doc shows a `break`/exit-condition loop example |
| `steplist-order-faithfulness` *(subjective)* | each entry must faithfully describe its 1:1 message | count-only parity can't read narratives | human-only |
| `crit-step-significance` *(subjective)* | `crit:true` should mark the real trust boundary | semantic judgment | human-only |

---

## Counts

- **component-diagram:** 7 concerns (5 deterministic, 2 subjective) → `feedback/component-diagram.jsonl`
- **sequence-diagram:** 7 concerns (5 deterministic, 2 subjective) → `feedback/sequence-diagram.jsonl`

All deterministic concerns were confirmed RED by running each skill's committed
`assets/validate.mjs` against a crafted fixture (it passed the bad input). Candidates that
turned out to be already-handled were **dropped**, not filed — e.g. `par` branch counting, the
async open arrow `-)`, the diamond-shape rejection, and the existing `par`/`loop` examples in the
sequence guide.
