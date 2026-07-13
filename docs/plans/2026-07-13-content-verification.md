# Content Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** File one precisely-authored whetstone item that adds a zero-dep `prose-lint.mjs` (deterministic anchor) plus a SKILL.md step-1c content probe (same-commit companion), so content-writing conductor runs get a real checkable DoD criterion — per `docs/specs/2026-07-13-content-verification-dod-design.md`.

**Architecture:** Both deliverables touch the conductor skill surface, so per the repo rule they land via **whetstone**, not a hand-edit — exactly the frontend-gate precedent (#25) which bundled a deterministic generator change with SKILL.md-1c + writeup.txt companions in ONE item. Here the deterministic anchor is `prose-lint.mjs` (run it on RED/GREEN fixtures → exit codes), and the SKILL.md content probe rides the same commit (behavioral, proven post-merge by `claude -p` A/B, not by the frozen check).

**Tech Stack:** Node ESM (zero external deps — `node:*` only), `feedback/conductor.jsonl` (whetstone backlog), `lirbox:whetstone` (the loop), `claude -p` (behavioral proof).

## Global Constraints

- Work on branch `design/content-verification` (spec + plan committed there).
- **Do NOT hand-edit any conductor skill file** (`SKILL.md`, `scripts/*`) — the whole point is that the change flows through `feedback/conductor.jsonl` → whetstone. This plan's ONLY repo write is appending one line to that backlog.
- The item is ONE JSON object on ONE line, schema `{id, type, text}`, valid JSON, newline-terminated. Append-only; do not touch other lines.
- Commit identity enforced by `.githooks/pre-commit` (author `liemle3893 <33980597+liemle3893@users.noreply.github.com>`).
- Never commit runtime artifacts (`.workflows/`, `.worktrees/`, `.improve/`).

---

### Task 1: File the `content-verification` whetstone item

**Files:**
- Modify: `feedback/conductor.jsonl` (append ONE line; the file is currently empty — pruned after #25)

**Interfaces:**
- Consumes: nothing.
- Produces: backlog entry id `content-verification` for a future whetstone run. The item text is the full spec the whetstone fixer will implement, and the discriminating-check spec whetstone setup will draft the frozen check from.

- [ ] **Step 1: Append the item**

Append exactly this single line (one JSON object, valid JSON, newline-terminated) to `feedback/conductor.jsonl`:

```json
{"id":"content-verification","type":"concern","text":"conductor has no checkable enforcement for CONTENT-writing runs: a docs/marketing goal's DoD degrades to judged-only. Approved design (amended): docs/specs/2026-07-13-content-verification-dod-design.md. Deterministic-lint-only, no new phase, no agent, no generator flag. TWO same-commit pieces. PIECE A (the deterministic anchor) — add plugins/lirbox/skills/conductor/scripts/prose-lint.mjs, a ZERO-DEP Node ESM check (imports only node:* — no npm install, no network; in the spirit of flowchart's validate.mjs). CLI: `node prose-lint.mjs <path> [--anchors] [--flesch <min>] [--dupe-words] [--frontmatter-keys k1,k2]`. Scans *.md under <path>; exits 0 if clean, non-zero with a per-file violation report otherwise. DEFAULT checks (every failure must be a real defect regardless of content — never red on good content): (1) heading levels don't skip (h1->h3 without h2); (2) LOCAL file-link targets resolve (a relative ./foo.md referenced in markdown exists on disk — renderer-independent); (3) fenced code blocks balanced (``` pairs even); (4) no placeholder markers (TODO, TBD, FIXME, 'lorem ipsum', empty links [text]()); (5) frontmatter parses as valid YAML IF present (absence is NOT a violation — a README needs none). OPT-IN flags (OFF by default, checkable-but-judgment-call): --anchors = heading-anchor resolution (#sec, other.md#h) via a PINNED documented GitHub-style slugger (off by default because slugging is renderer-dependent and would red good content on a repo with a different renderer); --flesch <min> = reading-ease bound; --dupe-words = duplicate consecutive words; --frontmatter-keys = required-key enforcement. Do NOT implement spelling, prose-style, or EXTERNAL http link checks (need dict/config/network — non-deterministic; out of scope). PIECE B (behavioral companion, SAME commit) — SKILL.md step 1c gains a CONTENT probe mirroring the existing Frontend/mobile-goals probe (~SKILL.md:123-132): when the goal is content-shaped (touches docs/, *.md, marketing copy), probe the repo for existing prose tooling (.vale.ini, cspell.json, .markdownlint*, a docs-lint npm script) and propose a checkable CRITERION in the SAME one-shot DoD AskUserQuestion. CRITICAL — this is a plain entry appended to criteria[], NOT a dod.json block: DoDGate reads criteria[] only (dodgate-verify.txt:4 runs the check inside ${WORKTREE}); a block is inert without a phase to splice it (scaffold-workflow.cjs:121,417 shows frontend block is phase-consumed), and content has no phase. Criterion shape: { id:'prose-lint', tier:'checkable', text:'...', check:'node <worktree-local>/prose-lint.mjs docs/' }. Repo has its own tooling -> propose that command instead. PATH RESOLUTION (resolves the plan-check open condition, worktree-copy approach): because the check runs inside the target worktree but prose-lint.mjs ships in the plugin dir, the probe COPIES prose-lint.mjs into the worktree at DoD-acquisition (e.g. .workflows/prose-lint.mjs or an implementation-notes location) and the criterion references that WORKTREE-LOCAL path — resume-proof (survives a mid-run plugin update; no absolute-plugin-cache path that can move). DISCRIMINATING CHECK (RED on baseline, GREEN after — anchors on PIECE A only): a check that runs prose-lint.mjs against fixtures under evals/fixtures/ — each RED fixture (a doc with a skipped heading; a doc with a dead local link; a doc with an unbalanced code fence; a doc containing a TODO marker; a doc with malformed frontmatter) MUST make prose-lint.mjs exit non-zero, AND a GREEN clean fixture MUST exit 0. RED on baseline because prose-lint.mjs does not exist yet (the command errors). Floor: conductor's evals/run.mjs (incl. test-scaffold.cjs) stays green. NOTE: PIECE B is BEHAVIORAL — the frozen check does NOT verify the SKILL.md probe; its acceptance is a POST-MERGE claude -p A/B (a content-shaped goal proposes a prose-lint criterion; a pure-backend goal does not), per repo convention behavioral-skill-proof-via-claude-p. The probe rides the same commit as a companion (like #25's SKILL.md-1c companion)."}
```

- [ ] **Step 2: Verify it parses and is the only item**

Run: `jq -r '.id' feedback/conductor.jsonl && jq -e 'select(.id=="content-verification").text | test("prose-lint.mjs")' feedback/conductor.jsonl`
Expected: prints `content-verification` (one line), and jq exits 0 (valid JSON, text references `prose-lint.mjs`).

- [ ] **Step 3: Commit**

```bash
git add feedback/conductor.jsonl
git commit -m "feedback(conductor): file content-verification (prose-lint.mjs + step-1c content probe)"
```

---

## Execution path (NOT bite-sized tasks — interactive + a human gate)

The item above is the deliverable of this plan. Implementing it is a **whetstone run**, identical in shape to the two runs already done this session (#24, #25). It is interactive (one human confirmation) and is driven via the `lirbox:whetstone` skill, not authored as TDD steps here:

1. **Run** `lirbox:whetstone conductor`. Setup will: read the backlog → RED-draft the `content-verification` check via the `lirbox-test-writer` agent (it authors the fixtures + the runnable check) → discrimination gate (`check-baseline.cjs` must say `DISCRIMINATING`) → measure the floor (`evals/run.mjs` green) → **confirm once** (human) → freeze → run the loop (the fixer builds `prose-lint.mjs` + the SKILL.md probe companion, kept iff floor + frozen check + surface-lock hold) → open a PR (never a merge; switch to the `liemle3893` gh account for PR creation, then switch back).
2. **After the PR merges** + `/plugin marketplace update lirbox`: prove PIECE B behaviorally with a `claude -p` A/B — a content-shaped conductor goal proposes a `prose-lint` criterion; a pure-backend goal does not. (This is the probe's real acceptance; the frozen check only gated PIECE A.)
3. **Optional end-to-end** (post-merge, like the FrontendGate proof): a real `/lirbox:conductor` docs goal whose confirmed DoD carries the `prose-lint.mjs` criterion, verified headless under `--permission-mode auto`.

## Self-review

- **Spec coverage:** prose-lint default checks (headings, local links, fences, placeholders, frontmatter-if-present) ✓ in item PIECE A; anchor opt-in ✓ (`--anchors`); criteria[]-not-block ✓ (item PIECE B, explicit); worktree-copy path resolution ✓ (resolves the open condition); whetstone routing ✓; behavioral probe = claude -p A/B ✓. Excluded (spelling/style/external-links/LLM-judge) ✓ stated in item.
- **Placeholder scan:** no TBD/TODO-as-planning-gap (the "TODO" strings are the placeholder-marker CHECK's own content). The item text is complete, not a stub.
- **Consistency:** id `content-verification` used identically in Steps 1–3 and the execution path; the check anchors on PIECE A (prose-lint) everywhere; PIECE B consistently described as behavioral/companion.
