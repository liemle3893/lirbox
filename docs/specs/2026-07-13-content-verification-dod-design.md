# Content Verification (DoD criteria) — Design

**Date:** 2026-07-13
**Status:** Approved (brainstorm with liemlhd)
**Motivation:** The last gap from "is conductor fit for tasks beyond backend?". Backend, test-writing,
frontend, and mobile now have real checkable enforcement (DoD checkable criteria; the frontend gate
ships Playwright/simulator verification). Content-writing runs still degrade to judged-only. This
design gives them an honest **checkable** floor — without pretending prose quality is machine-gradable.

## The honest framing (decided in brainstorm)

- **Deterministic lint only.** The gate enforces the genuinely-checkable layer (structure, links,
  placeholders). It makes **no** claim about quality — persuasion, tone, accuracy, and flow stay
  **judged / human**, the same line the frontend gate drew. No LLM-judge (conductor/whetstone
  exclude LLM-judge from the checkable tier in v1).
- **No new gate phase, no new agent, no generator flag.** Content verification **collapses into
  checkable DoD criteria** that the **existing DoDGate** already runs and fix-loops. The frontend
  gate earned a phase because its verifier does creative work (writes specs, captures evidence);
  a prose linter does not — running it *is* the check.
- **Auto-detect, confirm once.** Symmetric to the frontend engine probe: DoD acquisition proposes
  content criteria, frozen into `dod.json`. Respects a repo's existing prose tooling; never forces a
  tool the repo didn't choose.

## Filtering principle for every check

**A failure must be a real defect regardless of what the content is.** A check that goes red on
*good* content (merely a different style) is worse than no check — it trains authors to ignore the
gate. This test is what separates "checkable and meaningful" from "checkable but theater," and it is
why spelling/style/reading-level are NOT in the default set.

## Components

### 1. `plugins/lirbox/skills/conductor/scripts/prose-lint.mjs` (new)

A **zero-dependency**, offline, deterministic Node check — in the spirit of flowchart's
`validate.mjs`. Signature: `node prose-lint.mjs <path> [--flesch <min>] [--dupe-words]
[--frontmatter-keys k1,k2]`. Scans `*.md` under `<path>`; exits 0 if clean, non-zero with a
violation report otherwise.

**Default checks (every failure is an unambiguous defect):**

| Check | What it catches |
|---|---|
| Heading levels don't skip (h1→h3 without h2) | Broken document structure — breaks TOC/accessibility in every content type. |
| Local link targets resolve (`./foo.md`) | Dead internal link. Highest-value check; the most common real docs defect. |
| Fenced code blocks balanced (` ``` ` pairs) | An unclosed fence silently swallows the rest of the doc at render time. |
| No placeholder markers (`TODO`, `TBD`, `FIXME`, `lorem ipsum`, empty links `[t]()`) | For a *definition-of-done* meter, "did you ship a TODO" is exactly the question. |
| Frontmatter parses as valid YAML **if present** | A malformed frontmatter block is a real defect; absence is not (a README needs none). |

> **Amendment (plan-check, 2026-07-13):** heading-**anchor** resolution (`#sec`, `other.md#h`) is
> moved OUT of the default set to opt-in (`--anchors`), because it is deterministic only against a
> *chosen* slug algorithm — a repo whose renderer slugs headings differently would see the check go
> RED on good content, violating this design's own filtering principle. When enabled it pins a
> documented GitHub-style slugger (state the assumption). The **local file-link existence** half
> (`./foo.md` exists) is renderer-independent and stays in the default set above.

**Opt-in checks (checkable but the threshold is a judgment call — OFF by default):**

- `--anchors`: heading-anchor resolution (`#sec`, `other.md#h`) via a pinned GitHub-style slugger.
  Off by default (renderer-dependent — see the amendment above); on when the repo's renderer matches.
- `--flesch <min>`: reading-ease bound. Deterministic, but the right threshold for marketing ≠ API
  reference, so only when the human sets it.
- `--dupe-words`: duplicate consecutive words ("the the"). Catches typos but false-positives on
  legitimate repetition ("that that", identifiers) — offered, not forced.
- `--frontmatter-keys k1,k2`: required-key enforcement, only when the run supplies the key list
  (e.g. `docs/changes/` frontmatter).

**Excluded entirely** (needs config or judgment → vale/cspell or a human): spelling (needs a
dictionary), prose style / passive-voice / weasel-words / banned phrases (repo-specific, subjective),
and **external HTTP links** (needs network → non-deterministic — disqualifying for a frozen check).

### 2. SKILL.md step 1c — content-tooling probe

When the goal is content-shaped (touches `docs/`, `*.md`, marketing copy), DoD acquisition probes the
repo for existing prose tooling (`.vale.ini`, `cspell.json`, `.markdownlint*`, a docs-lint npm script)
and proposes a checkable criterion in the **same one-shot DoD confirmation**:

- repo has tooling → propose the repo's own command (e.g. `npx vale docs/`).
- repo has none → propose the built-in floor `prose-lint.mjs`.

> **Amendment (plan-check, 2026-07-13) — this is NOT a `dod.json` block.** The original spec proposed
> a `content` block "mirroring the `frontend` block." That is refuted: a `dod.json` block does
> something only because a **phase** reads it — the generator parses `parsed.frontend` and splices it
> into the FrontendGate phase prompt (`scaffold-workflow.cjs:121,417`). DoDGate itself reads
> `criteria[]` and nothing else (`dodgate-verify.txt:4`). With **no content phase**, a `content`
> block would be inert — read by nobody, the linter never runs, the run ships green. So the probe
> instead **appends a normal checkable criterion to `criteria[]`** — the array DoDGate already runs
> and fix-loops. No block, no new field, no reader to build (simpler than the original).

The frozen criterion:

```json
{ "criteria": [
    { "id": "prose-lint", "tier": "checkable",
      "text": "docs prose passes the structural lint (headings, local links, fences, no placeholders)",
      "check": "node /ABS/PATH/TO/plugins/lirbox/skills/conductor/scripts/prose-lint.mjs docs/" }
  ] }
```

> **Condition (plan-check, 2026-07-13) — absolute path.** The `check` command runs **inside the
> target project's worktree** (`dodgate-verify.txt:4`), but `prose-lint.mjs` ships in the lirbox
> plugin dir. A bare `node .../prose-lint.mjs` won't resolve from an arbitrary worktree, and
> `${CLAUDE_PLUGIN_ROOT}` is a skill-context var, not guaranteed in a bare shell. So the step-1c
> probe must resolve the **absolute** plugin path at DoD-acquisition and freeze THAT into the
> criterion's `check` (shown as `/ABS/PATH/...` above). Resume caveat: an absolute plugin-cache path
> can move if the plugin updates between sessions — the plan should note re-resolving on resume, or
> copying `prose-lint.mjs` into the worktree at probe time as an alternative.

The **existing DoDGate** runs this as a checkable criterion (exit 0 = met) and fix-loops it — no new
machinery.

## Process split (matches the frontend-gate delivery)

Both pieces touch the **conductor skill surface**, so both are filed as **whetstone items** in
`feedback/conductor.jsonl` — never hand-edited (repo rule; `[[skill-changes-via-whetstone-feedback]]`).

- **`prose-lint.mjs`** gets a clean **deterministic** discriminating check: RED fixtures (a doc with
  a skipped heading / dead local link / unbalanced fence / TODO / malformed frontmatter) must fail;
  a GREEN fixture must pass. Ideal whetstone material — the script is the surface, fixtures are the
  proof.
- **The step-1c probe** is **behavioral** (does conductor propose content criteria for a content
  goal?). Per repo convention (`[[behavioral-skill-proof-via-claude-p]]`) its acceptance is a
  `claude -p` A/B proof, **not** a gameable static grep. The plan will run it as a separate item with
  that proof, or leave it human-verified — it will not fake a deterministic check.

## Verification of this work

- `prose-lint.mjs`: unit-style fixtures (RED docs + a GREEN doc) asserting exit codes; the whetstone
  discrimination gate proves the frozen check is RED-before / GREEN-after.
- Probe: a `claude -p` A/B — a content goal proposes content criteria; a pure-backend goal does not.
- End-to-end (optional, post-merge): a real `/lirbox:conductor` docs run whose DoD carries a
  `prose-lint.mjs` criterion, verified like the FrontendGate proof.

## Out of scope (v1)

- LLM-judge quality scoring; persuasion / tone / accuracy (all judged → human).
- Spelling without repo config; prose-style rules (vale/cspell own these).
- External HTTP link checking (non-deterministic).
- Auto-fixing prose beyond what the DoDGate fix-loop already does.
- A dedicated ContentGate phase or content agent (explicitly rejected — collapses into DoD criteria).
