# Frontend / Mobile Verification Gate — Design

**Date:** 2026-07-10
**Status:** Approved (brainstorm with liemlhd)
**Motivation:** Conductor's enforcement layer (DoD checkable criteria, CodeGate, TestGate) is built
around machine-verifiable backend work. Frontend and mobile runs degrade to lint/typecheck — "looks
right" and "works on device" have no checkable or evidence-cited path. This design adds that path.

## Goal

Give conductor runs that touch UI a real gate: runnable E2E specs where assertion is possible,
evidence-cited verdicts where it is not — for **web (including responsive)** and **native mobile
(iOS Simulator / Android emulator)** — with a user-confirmed, frozen, pluggable engine chain and no
hard dependency on any Claude-Code-specific tooling.

## Decisions made during brainstorm

- **Approach B**: two sibling agents sharing one output contract (not one mega-agent, not an
  extension of `lirbox-tryve-enhancer`).
- **Agent role**: both write tests AND capture evidence (mirrors the test-writer / tryve-enhancer
  split).
- **Mobile**: native apps in scope now, designed alongside responsive web.
- **Engine selection**: auto-detect, human confirms once (inside the existing one-shot DoD
  confirmation), frozen into the run's DoD file.
- **Process split**: new agent files are built directly on a branch; every change to
  `scaffold-workflow.cjs` goes through `feedback/conductor.jsonl` → whetstone (repo rule).

## Components

### 1. `plugins/lirbox/agents/lirbox-web-verifier.md` (new)

For a UI-touching change: writes runnable web E2E specs (Playwright) and captures evidence for
criteria that cannot be asserted.

- **Engine chain** (probed in order, frozen at DoD time):
  1. **playwright** — repo has a Playwright config or it is cleanly installable; specs land in the
     repo's detected e2e dir (fallback `e2e/web/`).
  2. **browser-MCP** — any reachable MCP browser toolset (claude-in-chrome or other); evidence-first,
     spec-optional.
  3. **OS-scripted fallback** — osascript-driven browser on macOS; CDP-over-curl elsewhere.
     Platform-agnostic by construction: no engine is Claude-Code-only.
- **Responsive coverage**: a viewport/device matrix (desktop + mobile emulation, DPR, touch) executed
  within whichever engine is active; matrix recorded in the evidence manifest.

### 2. `plugins/lirbox/agents/lirbox-mobile-verifier.md` (new)

- **Stack detection**: React Native (`react-native` in package.json), Flutter (`pubspec.yaml`),
  native (`*.xcodeproj` / `build.gradle`).
- **Engine chain**: 1. **Maestro** (YAML flows — preferred; specs-as-data), 2. **Appium**,
  3. **raw `xcrun simctl` / `adb`** — evidence-only tier: build+install+launch, screenshots, device
  logs. The raw tier cannot produce runnable specs; the contract allows `specsWritten: []` there and
  the affected would-be-checkable criteria are flagged **evidence-only** (analogous to DoDBaseline's
  non-discriminating flag).
- Simulators/emulators only; no physical devices or device farms.

Engine playbooks live **inline in each agent** — they are per-platform and compact; no shared
mega-reference.

### 3. Shared output contract

Both agents return:

```json
{ "gatePassed": bool,
  "specsWritten": ["path", ...],
  "checkableResults": [{ "criterionId", "command", "exit" }],
  "judgedVerdicts": [{ "criterionId", "verdict": "MET|UNMET|PARTIAL", "evidence": ["path"] }] }
```

and write an **evidence manifest** to `implementation-notes/frontend-evidence/manifest.json`
(entries: `{ criterionId, engine, artifacts[], verdict, notes }`) plus the screenshots/logs
themselves. This directory rides the **existing** Writeup promotion into `docs/changes/<name>/`, and
DoDGate cites the manifest for judged criteria — no new plumbing.

### 4. Engine freezing protocol

At DoD acquisition (conductor SKILL.md step 1c), when the goal touches UI the main session probes
the machine (Playwright config, maestro/appium binaries, Xcode/adb, MCP reachability) and includes
the proposed chain in the **same** one-shot DoD `AskUserQuestion`. On confirm it is frozen into
`.workflows/<name>.dod.json` under a `frontend` block, e.g.:

```json
{ "criteria": [...],
  "frontend": { "web": ["playwright", "browser-mcp", "os-script"],
                "mobile": ["maestro"],
                "viewports": ["desktop-1440", "iphone-15", "pixel-8"] } }
```

The chain travels as DATA in the DoD file → resume is deterministic; the generator splices it, never
probes.

### 5. Runtime error handling

**Tooling failure ≠ app failure.**

- Engine attempt fails → 2 bounded retries → fall to the next engine in the *frozen* chain. The
  manifest records which engine actually produced each artifact.
- Entire chain exhausted → **hard-fail with the tooling log**. Never a silent pass.
- App fails to build/launch → hard-fail immediately with the build-log excerpt. Real failure; no
  engine fallthrough.

### 6. Generator integration — whetstone feedback item (NOT a direct edit)

Filed in `feedback/conductor.jsonl`; touches `scaffold-workflow.cjs` only via whetstone:

- `--frontend web|mobile|both` adds a **FrontendGate** phase: positioned **after
  CodeGate/ReVerify** (evidence must reflect final code), **before DoDGate/Writeup** (DoDGate cites
  the evidence).
- Diff guard: gate skips when the diff touches no UI files (same pattern as the review panel's
  guard).
- Fix-loop ≤3, then hard-fail (standard gate semantics).
- Agent swaps: `--agent-web` (default `lirbox:lirbox-web-verifier`), `--agent-mobile` (default
  `lirbox:lirbox-mobile-verifier`), `none` supported.
- Discriminating check (frozen with the item): RED — current generator emits no FrontendGate for
  `--frontend web`; GREEN — FrontendGate emitted in the correct phase position;
  `test-scaffold.cjs` floor extended with `--frontend` matrix entries.

## Verification of this work

- **Agents**: `claude plugin validate .` must pass; one dogfood run of each agent against a small
  real frontend repo (web: any Playwright-capable app; mobile: a scratch RN or Flutter app on the
  iOS Simulator).
- **Generator half**: the whetstone item's frozen RED→GREEN check + the extended
  `test-scaffold.cjs` matrix (the floor).

## Out of scope (v1)

- Game-engine UIs (Unity/Unreal serialized scenes, binary assets).
- Visual-regression pixel-diffing — screenshots are *evidence*, not baselines.
- Physical devices / device farms.
- Prose/content style-guide gate — separate design, to be filed as its own follow-up.
