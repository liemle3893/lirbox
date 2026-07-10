# Frontend / Mobile Verification Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the two frontend-verification agents (`lirbox-web-verifier`, `lirbox-mobile-verifier`) and file the FrontendGate generator integration as a whetstone feedback item, per `docs/specs/2026-07-10-frontend-mobile-verification-gate-design.md`.

**Architecture:** Two sibling agents under `plugins/lirbox/agents/` sharing one output contract (runnable E2E specs for assertable criteria + an evidence manifest at `implementation-notes/frontend-evidence/manifest.json` for judged ones), each with a probed-then-frozen engine chain and hard tooling-vs-app failure separation. The conductor generator is NOT touched — that half is a `feedback/conductor.jsonl` entry with a frozen RED→GREEN check, landed later by whetstone.

**Tech Stack:** Claude Code plugin agents (markdown + frontmatter), Playwright / browser-MCP / osascript (web), Maestro / Appium / `xcrun simctl`+`adb` (mobile), `claude plugin validate`, `claude -p` for behavioral dogfood.

## Global Constraints

- Work on branch `design/frontend-mobile-gate` (already exists; spec is committed on it).
- All names kebab-case; agents are flat `*.md` files at `plugins/lirbox/agents/` (never inside `.claude-plugin/`).
- Commit identity is enforced by `.githooks/pre-commit` — author must be `liemle3893 <33980597+liemle3893@users.noreply.github.com>`. If a commit is rejected, run the three `git config` lines from CONTRIBUTING.md §Commit identity; do not bypass the hook.
- **Do NOT edit `plugins/lirbox/skills/conductor/scripts/scaffold-workflow.cjs` or any conductor skill file.** Generator changes go only into `feedback/conductor.jsonl` (Task 3).
- `feedback/conductor.jsonl` is clean as of the merged whetstone run #23 (its former pending batch landed); Task 3 appends one line and commits it on this branch.
- `claude plugin validate .` must pass before every commit that touches `plugins/`.
- Never commit runtime artifacts (`.workflows/`, `.worktrees/`, `implementation-notes/`, dogfood scratch dirs).
- Dogfood scratch lives under the session scratchpad (`$SCRATCHPAD` below), never `/tmp`, never inside the repo.

---

### Task 1: `lirbox-web-verifier` agent

**Files:**
- Create: `plugins/lirbox/agents/lirbox-web-verifier.md`
- Modify: `README.md` (Agents table, after the `lirbox-tryve-enhancer` row)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: agent name `lirbox-web-verifier` (namespaced `lirbox:lirbox-web-verifier`) — referenced verbatim by Task 3's feedback entry and Task 4's dogfood. Output contract: a `## WEB VERIFY: gatePassed=<true|false> engine=<engine>` report + `implementation-notes/frontend-evidence/manifest.json` with entries `{ criterionId, engine, artifacts, verdict, notes }`.

- [ ] **Step 1: Write the agent file**

Write `plugins/lirbox/agents/lirbox-web-verifier.md` with exactly this content:

````markdown
---
name: lirbox-web-verifier
description: Verifies a UI-touching WEB change end-to-end — writes runnable E2E specs (Playwright preferred) for criteria that can be asserted, and captures evidence (screenshots, console/network logs, responsive viewport matrix) for criteria that must be judged. Engine-pluggable with graceful fallback (Playwright → browser-MCP → OS-scripted), honoring a frozen engine chain when the caller supplies one. Use as the web half of a frontend verification gate in a delivery workflow, or standalone to verify a web change. Distinguishes tooling failure from app failure; never silently passes.
color: cyan
---

<role>
You are a web frontend verifier. For a change that touches web UI you produce two things:
runnable E2E specs for every criterion that CAN be asserted, and an evidence manifest
(screenshots, console/network logs, viewport matrix) for every criterion that must be judged
by a human or a downstream gate. One invocation = one verification round.
</role>

<inputs>
The task prompt gives you the goal / DoD criteria, the app start command, and (when run inside
a conductor workflow) a FROZEN engine chain + viewport list from the run's dod.json `frontend`
block. Anything unspecified, infer from the repo:
- Engine chain default: `playwright → browser-mcp → os-script` (see <engines>).
- Viewports default: `desktop-1440` (1440×900), `iphone-15` (390×844, touch, DPR 3),
  `pixel-8` (412×915, touch).
- Spec location: the repo's existing e2e dir; else `e2e/web/`.
Work on the current branch/worktree; do not assume a specific project layout.
</inputs>

<engines>
Probe IN ORDER and use the first engine that works. When the caller supplies a frozen chain,
probe ONLY that chain, in that order.
1. **playwright** — a Playwright config exists, or `@playwright/test` is installed (or cleanly
   installable) in the repo. Write real spec files; run `npx playwright test <specs>`.
2. **browser-mcp** — any connected MCP browser toolset available among your tools (e.g.
   `mcp__claude-in-chrome__*` or another browser MCP; you inherit all session tools, so use
   whichever browser server is present). Drive the page, screenshot per viewport,
   read the console. Evidence-first; still write Playwright spec files when the repo can host
   them (they become checkable criteria for later runs even if you could not execute them here —
   say so in the manifest notes).
3. **os-script** — last resort, host-OS scripted browser: `osascript` driving Safari/Chrome plus
   `screencapture` on macOS; elsewhere headless Chrome via CDP
   (`chrome --headless --remote-debugging-port=<port>` + `curl` for screenshot/console).
An engine attempt fails → retry twice, then fall to the NEXT engine in the chain and record the
failure in the manifest. Chain exhausted → hard-fail with the tooling log (see <rules>).
</engines>

<process>
1. Read the diff / changed files to see which pages, routes, and components changed.
2. Resolve the engine chain and viewports (frozen inputs win; else probe per <engines>).
3. Start the app with the given command (else infer: the package.json `dev` script, or a static
   server for plain HTML); wait until it answers.
4. For each criterion, decide assertable vs judged:
   - **assertable** → write a Playwright spec asserting the observable behavior (selectors,
     navigation, network responses); run it across the viewport matrix.
   - **judged** ("looks right", visual hierarchy) → capture per-viewport screenshots plus console
     and network logs as evidence; give an evidence-cited verdict, never a bare opinion.
5. Write the evidence manifest `implementation-notes/frontend-evidence/manifest.json` — one entry
   per criterion: `{ "criterionId", "engine", "artifacts": [paths], "verdict": "MET|UNMET|PARTIAL",
   "notes" }` — with the screenshots/logs saved alongside it.
6. Report per <output>. A criterion you could not verify is UNMET-with-reason, never omitted.
</process>

<rules>
- **Tooling failure ≠ app failure.** The app won't build/start, or a spec fails against real
  behavior → that is a FINDING: report it, `gatePassed=false`, and do NOT fall through engines.
  Engine/tooling breakage → retry ≤2, fall down the chain; the manifest records which engine
  actually produced each artifact.
- Chain exhausted with criteria unverified → `gatePassed=false` with the tooling log. NEVER
  report a criterion MET without an artifact or a green spec run behind it.
- Do NOT modify production code. Do NOT weaken or delete existing tests or specs.
- Match the repo's existing e2e conventions (naming, fixtures, tags) when they exist.
- Do NOT commit or push — the caller owns git.
</rules>

<output>
Return:
```
## WEB VERIFY: gatePassed=<true|false> engine=<engine actually used>
specsWritten: <n> — <paths>
checkable: <criterionId>: PASS|FAIL (<command>)
judged: <criterionId>: MET|UNMET|PARTIAL — <evidence path>
manifest: implementation-notes/frontend-evidence/manifest.json
## FINDINGS: <app-failure findings>          (omit if none)
```
On tooling exhaustion: `## WEB VERIFY FAILED (tooling): <engine>: <log excerpt>`.
</output>
````

The missing `tools:` line is DELIBERATE (plan-check finding, human-approved): an explicit
allowlist blocks all MCP tools and `ToolSearch` is not valid in one, which would kill the
browser-mcp engine tier. Inherit-all keeps the agent platform-agnostic. Do not "fix" it to match
the other agents' restricted lists.

- [ ] **Step 2: Add the README catalog row**

In `README.md`, in the Agents table (starts near line 35, columns `| Agent | Role |`), add after the last existing row:

```markdown
| **`lirbox-web-verifier`** | Web half of the frontend verification gate: writes Playwright E2E specs for assertable criteria and captures per-viewport screenshot/console evidence for judged ones; engine chain playwright → browser-MCP → OS-script, tooling failure never silently passes. |
```

- [ ] **Step 3: Validate**

Run: `claude plugin validate .`
Expected: validation passes (no schema errors; the new agent is listed/loaded without complaint).

- [ ] **Step 4: Commit**

```bash
git add plugins/lirbox/agents/lirbox-web-verifier.md README.md
git commit -m "feat(lirbox): add lirbox-web-verifier agent (web half of frontend gate)"
```

---

### Task 2: `lirbox-mobile-verifier` agent

**Files:**
- Create: `plugins/lirbox/agents/lirbox-mobile-verifier.md`
- Modify: `README.md` (Agents table, after the `lirbox-web-verifier` row added in Task 1)

**Interfaces:**
- Consumes: manifest schema `{ criterionId, engine, artifacts, verdict, notes }` — identical to Task 1's (shared contract; keep field names byte-identical).
- Produces: agent name `lirbox-mobile-verifier` (namespaced `lirbox:lirbox-mobile-verifier`) — referenced verbatim by Task 3's feedback entry and Task 5's smoke. Output contract: `## MOBILE VERIFY: gatePassed=<true|false> stack=<rn|flutter|ios|android> engine=<used>`; on undetectable stack, the exact line `## MOBILE VERIFY FAILED: no mobile stack detected` (plus what was probed).

- [ ] **Step 1: Write the agent file**

Write `plugins/lirbox/agents/lirbox-mobile-verifier.md` with exactly this content:

````markdown
---
name: lirbox-mobile-verifier
description: Verifies a MOBILE app change on a simulator/emulator — detects the stack (React Native / Flutter / native iOS / native Android), writes runnable E2E flows (Maestro preferred, Appium fallback) for criteria that can be asserted, and falls back to raw xcrun simctl / adb evidence capture (screenshots, device logs) when no flow runner exists. Honors a frozen engine chain when the caller supplies one. Use as the mobile half of a frontend verification gate in a delivery workflow, or standalone. Simulators/emulators only; distinguishes tooling failure from app failure; never silently passes.
tools: Read, Write, Edit, Bash, Grep, Glob
color: orange
---

<role>
You are a mobile app verifier. For a change to a mobile app you produce runnable E2E flows for
every criterion that CAN be asserted, and an evidence manifest (screenshots, device logs) for
every criterion that must be judged. Simulators/emulators only — never physical devices.
One invocation = one verification round.
</role>

<inputs>
The task prompt gives you the goal / DoD criteria, how to build+launch, and (inside a conductor
workflow) a FROZEN engine chain from the run's dod.json `frontend` block. Anything unspecified,
infer from the repo:
- Stack detection: `react-native` in package.json → RN; `pubspec.yaml` → Flutter;
  `*.xcodeproj` / `Package.swift` app target → native iOS; `build.gradle` → native Android.
- Engine chain default: `maestro → appium → raw` (see <engines>).
- Flow location: the repo's existing e2e/flow dir; else `e2e/mobile/`.
Work on the current branch/worktree. If NO mobile stack is detectable, stop immediately and
report it (see <output>) — do not improvise against a web app.
</inputs>

<engines>
Probe IN ORDER; frozen chain wins when supplied.
1. **maestro** — `maestro` on PATH (or the repo has `.maestro/` flows). Write YAML flows; run
   `maestro test <flow>`.
2. **appium** — an Appium server is available (or cleanly installable) with a driver for the
   target platform (XCUITest / UiAutomator2).
3. **raw** — evidence-only tier via `xcrun simctl` (boot simulator, install, launch,
   `simctl io <udid> screenshot`, `simctl spawn <udid> log stream`) or `adb` (install,
   `adb exec-out screencap`, `adb logcat`). NO runnable spec artifact is possible on this tier:
   report `specsWritten: 0` and FLAG every would-be-checkable criterion as **evidence-only**
   in the manifest notes.
An engine attempt fails → retry twice, then fall to the NEXT engine, recording the failure in
the manifest. Chain exhausted → hard-fail with the tooling log (see <rules>).
</engines>

<process>
1. Detect the stack; read the diff to see which screens/flows changed.
2. Resolve the engine chain (frozen inputs win; else probe).
3. Build and install on the simulator/emulator with the given command (else the stack's
   standard: `npx expo run:ios` / `npx react-native run-ios`, `flutter run`, `xcodebuild`,
   `./gradlew installDebug`). A build or launch failure is an APP failure: stop and report it
   with the build-log excerpt — do not fall through engines.
4. Assertable criteria → write Maestro/Appium flows and run them. Judged criteria → capture
   screenshots + device logs; give an evidence-cited verdict, never a bare opinion.
5. Write `implementation-notes/frontend-evidence/manifest.json` — same schema as the web
   verifier: `{ "criterionId", "engine", "artifacts": [paths], "verdict": "MET|UNMET|PARTIAL",
   "notes" }` — artifacts alongside.
6. Report per <output>. A criterion you could not verify is UNMET-with-reason, never omitted.
</process>

<rules>
- **Tooling failure ≠ app failure.** Build/launch/behavior failures are FINDINGS
  (`gatePassed=false`, no engine fallthrough). Engine breakage → retry ≤2, fall down the chain;
  the manifest records which engine produced each artifact.
- NEVER report a criterion MET without an artifact or a green flow run. Chain exhausted →
  `gatePassed=false` plus the tooling log.
- Raw tier honesty: `specsWritten` MUST be 0 there, with evidence-only flags set — never
  fabricate a "runnable" flow that was not executed.
- Do NOT modify production code. Do NOT weaken or delete existing tests/flows.
- Do NOT commit or push — the caller owns git.
</rules>

<output>
Return:
```
## MOBILE VERIFY: gatePassed=<true|false> stack=<rn|flutter|ios|android> engine=<used>
specsWritten: <n> — <paths>              (0 on the raw tier, criteria flagged evidence-only)
checkable: <criterionId>: PASS|FAIL (<command>)
judged: <criterionId>: MET|UNMET|PARTIAL — <evidence path>
manifest: implementation-notes/frontend-evidence/manifest.json
## FINDINGS: <app-failure findings>       (omit if none)
```
On no detectable mobile stack: `## MOBILE VERIFY FAILED: no mobile stack detected (probed: package.json, pubspec.yaml, *.xcodeproj, build.gradle)`.
On tooling exhaustion: `## MOBILE VERIFY FAILED (tooling): <engine>: <log excerpt>`.
</output>
````

- [ ] **Step 2: Add the README catalog row**

In `README.md`, Agents table, add directly after the `lirbox-web-verifier` row:

```markdown
| **`lirbox-mobile-verifier`** | Mobile half of the frontend verification gate: detects RN/Flutter/native, writes Maestro/Appium E2E flows, falls back to raw `simctl`/`adb` evidence capture on simulators/emulators; raw tier is honestly flagged evidence-only. |
```

- [ ] **Step 3: Validate**

Run: `claude plugin validate .`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add plugins/lirbox/agents/lirbox-mobile-verifier.md README.md
git commit -m "feat(lirbox): add lirbox-mobile-verifier agent (mobile half of frontend gate)"
```

---

### Task 3: FrontendGate feedback item for whetstone

**Files:**
- Modify: `feedback/conductor.jsonl` (append ONE line; do NOT touch existing lines; do NOT commit — see Global Constraints)

**Interfaces:**
- Consumes: agent names `lirbox:lirbox-web-verifier` / `lirbox:lirbox-mobile-verifier` from Tasks 1–2 (must match those frontmatter `name:` fields exactly, with the `lirbox:` namespace prefix).
- Produces: backlog entry id `frontend-gate-phase` for a future whetstone run.

- [ ] **Step 1: Append the entry**

Append exactly this single line (one JSON object, no trailing comma, newline-terminated) to `feedback/conductor.jsonl`:

```json
{"id":"frontend-gate-phase","type":"concern","text":"conductor's gate layer has no frontend/mobile enforcement: a UI-touching delivery run's DoD degrades to lint/typecheck because no phase produces E2E specs or an evidence manifest for visual/device criteria. Approved design: docs/specs/2026-07-10-frontend-mobile-verification-gate-design.md (the two verifier agents ship separately on branch design/frontend-mobile-gate). Fix in the GENERATOR (scaffold-workflow.cjs; regenerate; test-scaffold.cjs stays green as the floor): add --frontend web|mobile|both emitting a FrontendGate phase positioned AFTER the code-quality gate (CodeGate/ReVerify under --cycle; the merged Review phase under lite) and BEFORE DoDGate/Writeup so DoDGate can cite the evidence manifest at implementation-notes/frontend-evidence/manifest.json; a diff guard skips the gate when the diff touches no UI files (same pattern as the review-panel diff guard); standard gate semantics (fix-loop <=3 then hard-fail, conductor throws, run goes failed); agent swap flags --agent-web (default lirbox:lirbox-web-verifier) and --agent-mobile (default lirbox:lirbox-mobile-verifier) with 'none' supported like the other --agent-* flags; the phase prompt splices the dod.json frontend block (engine chain, viewports) as DATA — the generator never probes the machine. Skill-side companion (same item, same commit): SKILL.md step 1c gains the machine probe (playwright config, maestro/appium binaries, Xcode/adb, MCP reachability) and folds the proposed frontend block into the SAME one-shot DoD AskUserQuestion, frozen into .workflows/<name>.dod.json per the design's §4. Promotion companion (same item, same commit — plan-check found the gap): prompts/writeup.txt step 1 currently copies only implementation-notes/*.html (flat, HTML-only), so the gate's evidence would silently never reach the PR; extend it to ALSO copy implementation-notes/frontend-evidence/** (manifest.json, screenshots, logs — all types, recursive) into docs/changes/<name>/evidence/. DEPENDENCY: the default agents ship on branch design/frontend-mobile-gate — merge it and update the installed plugin BEFORE running this item; and the emitted FrontendGate must degrade gracefully: if the lirbox:lirbox-web-verifier / lirbox:lirbox-mobile-verifier agentType is unavailable at dispatch, rerun the same prompt with no agentType (generic subagent) and log a warning instead of hard-failing on the missing agent. Discriminating check (RED on current generator, GREEN after): node scripts/scaffold-workflow.cjs --name fgcheck --phases Implement --frontend web --profile delivery --no-dod --out <scratch>/fgcheck.js --force must exit 0 AND the emitted script must contain phase('FrontendGate') ordered after phase('CodeGate') and before phase('Writeup'); today the flag is unknown/rejected (or ignored with no FrontendGate emitted), so the check is RED. Floor: the existing test-scaffold.cjs matrix stays green; natural same-commit stretch (not part of the frozen check): add --frontend entries to the test-scaffold.cjs matrix."}
```

- [ ] **Step 2: Verify the file still parses and the id is unique**

Run: `jq -r '.id' feedback/conductor.jsonl`
Expected: every existing id plus `frontend-gate-phase`, each exactly once; jq exits 0 (valid JSONL).

- [ ] **Step 3: Commit**

The file is clean since whetstone run #23 merged its former pending batch, so the appended line commits safely:

```bash
git add feedback/conductor.jsonl
git commit -m "feedback(conductor): file frontend-gate-phase (FrontendGate + evidence promotion)"
```

---

### Task 4: Web agent dogfood (behavioral proof)

**Files:**
- Create (scratch only, never committed): `$SCRATCHPAD/webverify-dogfood/{index.html,package.json,playwright.config.js}`

Where `$SCRATCHPAD` = the session scratchpad directory (see the system prompt's Scratchpad Directory; for this session `/private/tmp/claude-502/-Users-liemlhd-Documents-git-Personal-lirbox/8547fb51-4ab2-4272-947c-280ed9ab24f5/scratchpad`).

**Interfaces:**
- Consumes: agent `lirbox-web-verifier` (Task 1) via `claude -p --plugin-dir`; its `## WEB VERIFY:` output contract and manifest path.
- Produces: pass/fail evidence for the plan's success criteria; nothing downstream consumes it.

- [ ] **Step 1: Create the scratch app**

```bash
mkdir -p "$SCRATCHPAD/webverify-dogfood" && cd "$SCRATCHPAD/webverify-dogfood"
cat > index.html <<'EOF'
<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Dogfood</title></head>
<body><h1>Dogfood</h1><p>web-verifier target page</p></body></html>
EOF
cat > package.json <<'EOF'
{ "name": "webverify-dogfood", "private": true, "devDependencies": { "@playwright/test": "^1.49.0" } }
EOF
cat > playwright.config.js <<'EOF'
module.exports = {
  testDir: './e2e/web',
  use: { baseURL: 'http://localhost:4173' },
  webServer: { command: 'python3 -m http.server 4173', port: 4173, reuseExistingServer: true },
};
EOF
npm install && npx playwright install chromium
```

Expected: install succeeds, chromium downloaded.

- [ ] **Step 2: Dispatch the agent headless**

```bash
cd "$SCRATCHPAD/webverify-dogfood"
claude -p --plugin-dir /Users/liemlhd/Documents/git/Personal/lirbox/plugins/lirbox \
  --permission-mode auto \
  "Use the Agent tool to dispatch the lirbox-web-verifier agent on the app in the current directory. Criteria: [{id: c1, text: 'GET / shows an h1 reading Dogfood', tier: checkable}, {id: c2, text: 'the page renders acceptably at a mobile viewport', tier: judged}]. App start command: python3 -m http.server 4173. Relay the agent's full report verbatim."
```

(Permissions, human-approved via plan-check: try `--permission-mode auto` FIRST — it auto-approves the sandboxed majority with a safer default. If the run fails on permission denials (visible in the transcript), rerun once with `--dangerously-skip-permissions`; that flag grants FULL filesystem access — no directory confinement — acceptable only because the prompt is fixed and benign and the target is a 3-file scratch app we authored. Either way, run the `npm install` / `npx playwright install chromium` from Step 1 FIRST and fail fast: an install failure is an environment blocker, reported as such — distinct from an agent defect.)

- [ ] **Step 3: Verify the behavioral success criteria**

Check ALL of:
1. Output contains `## WEB VERIFY: gatePassed=true` with `engine=playwright`.
2. A spec file exists under `$SCRATCHPAD/webverify-dogfood/e2e/web/` and asserts the h1.
3. `$SCRATCHPAD/webverify-dogfood/implementation-notes/frontend-evidence/manifest.json` exists, parses with `jq .`, and has entries for `c1` and `c2` with `verdict` fields; `c2`'s entry lists at least one screenshot artifact that exists on disk.

Expected: all three hold. If any fails, fix the AGENT PROMPT (Task 1 file), re-validate, re-run this dogfood — do not weaken the criteria.

- [ ] **Step 4: Clean up the server**

```bash
pkill -f "http.server 4173" || true
```

No commit (scratch only).

---

### Task 5: Mobile agent honest-failure smoke (+ manual simulator dogfood)

**Files:**
- Create (scratch only): `$SCRATCHPAD/mobileverify-smoke/` (an EMPTY directory — deliberately no mobile stack)

**Interfaces:**
- Consumes: agent `lirbox-mobile-verifier` (Task 2); its `## MOBILE VERIFY FAILED: no mobile stack detected` contract line.
- Produces: proof the agent refuses honestly instead of fabricating a pass — the spec's core error-handling requirement, runnable without simulators.

- [ ] **Step 1: Dispatch against a stack-less directory**

```bash
mkdir -p "$SCRATCHPAD/mobileverify-smoke" && cd "$SCRATCHPAD/mobileverify-smoke"
claude -p --plugin-dir /Users/liemlhd/Documents/git/Personal/lirbox/plugins/lirbox \
  --permission-mode auto \
  "Use the Agent tool to dispatch the lirbox-mobile-verifier agent on the app in the current directory. Criteria: [{id: m1, text: 'the home screen shows a greeting', tier: judged}]. Relay the agent's full report verbatim."
```

- [ ] **Step 2: Verify the honest-failure criteria**

Check ALL of:
1. Output contains `## MOBILE VERIFY FAILED: no mobile stack detected`.
2. Output does NOT contain `gatePassed=true`.
3. No fabricated manifest claiming `MET` exists under the scratch dir.

Expected: all three hold. If the agent improvises a pass, fix the Task 2 agent file (`<inputs>` stop-rule), re-validate, re-run.

- [ ] **Step 3: Record the manual simulator dogfood as follow-up (do not attempt headless)**

The full-positive mobile dogfood needs a booted iOS Simulator plus an RN/Flutter scratch app — environment-dependent and slow, so it is a MANUAL pre-merge step for the user (plan-check bottleneck 7, human-approved), not a plan step. Include in the final task report, with these commands:

```bash
npx create-expo-app "$SCRATCHPAD/dogfood-rn" && cd "$SCRATCHPAD/dogfood-rn"
npx expo run:ios          # builds + boots the simulator
claude -p --plugin-dir /Users/liemlhd/Documents/git/Personal/lirbox/plugins/lirbox \
  --permission-mode auto \
  "Use the Agent tool to dispatch the lirbox-mobile-verifier agent on the app in the current directory. Criteria: [{id: m1, text: 'the home screen shows the default Expo greeting', tier: judged}]. Relay the agent's full report verbatim."
```

Expected: `gatePassed=true`, screenshots under `implementation-notes/frontend-evidence/`, manifest citing them. **Merging waits on this check.**

---

### Task 6: Final validation and wrap-up

**Files:**
- Modify: none (verification only).

**Interfaces:**
- Consumes: everything above.
- Produces: the branch `design/frontend-mobile-gate` ready for human review.

- [ ] **Step 1: Full validation sweep**

```bash
cd /Users/liemlhd/Documents/git/Personal/lirbox
claude plugin validate .
git status --short
git log --oneline main..HEAD
```

Expected: validate passes; working tree clean apart from the untracked `plan-check-frontend-mobile-gate.html`; commits on the branch: spec, plan (+amendments), web agent, mobile agent, feedback entry.

- [ ] **Step 2: Report**

Report to the user: the branch name, the two agents, the committed feedback id `frontend-gate-phase`, the dogfood results, and the manual simulator follow-up. Do NOT merge, do NOT push, do NOT open a PR unless asked (note: PR creation requires the `liemle3893` gh account per memory — the default EMU account cannot).
