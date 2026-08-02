# Conductor — failure triage on resume

*Design, 2026-07-31. Revised r2 2026-08-02 after `plan-check` — see the revision log at the end.
Approved, not implemented.*

**Problem.** A conductor run that dies at a gate resumes into the same wall. Resume re-runs the
failed phase with byte-identical inputs, because nothing on disk records *why* it failed and there
is no channel through which new information could reach the retry.

## What already exists — do not rebuild it

Read this first; two thirds of the obvious design is already shipped.

| already built | where |
|---|---|
| **per-dependency-level durable progress** — a level checkpoints *before* dispatch; `integrated:true` levels are skipped on resume; only items with `ok:false` are re-dispatched | `scripts/scaffold-workflow.cjs` §plan fan-out (`results.<key>Levels`) |
| **coverage ledger** — dead item workers, dropped plan items, collapsed cycles are noted, persisted, and end the run `partial` rather than `complete` | same file, `cover()` / `results.coverage` |
| **resume reachability guard** — `phasesDone` must be a contiguous prefix or the conductor throws | same file, prelude IIFE |
| **plan-of-record adjudication** — an item that never landed fails DoDGate instead of shipping unseen | DoDGate |

So the gap is **not** persistence granularity. It is narrower:

1. Every gate failure is a `throw`. The message lands in the transcript and **nowhere on disk** —
   **except DoDGate**, which already persists `status: 'escalated'` + `unmet[]` through the
   `checkpoint.txt` writer before throwing (`scaffold-workflow.cjs:920-931`). The other ~12 throw
   sites record nothing. So this design **generalizes DoDGate's pattern to every throw site**; it
   does not invent one, and it reuses the `escalated` status rather than adding a vocabulary.
2. `SKILL.md` step 5 stamps `status: failed` and discards the reason.
3. Even with a reason, a retry has **no input channel** — the phase prompt is regenerated identically.

## Design

### 1 · Failure record — written by the run, not by whoever is watching

The generator wraps the phase body and the final `return` in `try/catch`. The catch dispatches
**one** postmortem worker, then **rethrows** — the Workflow must still report failed; swallowing a
failure is a worse bug than the one being fixed.

Three constraints the first draft left tacit, all load-bearing:

- **The try starts *after* the resume reachability guard.** A corrupt-`phasesDone` throw must not
  burn a postmortem worker classifying garbage.
- **The wrap must NOT re-indent the body.** Harbor's `phase_order_matches_meta()` finds phases with
  `re.findall(r"^phase\('([^']+)'\)", …, re.M)` — **column-0 anchored**. Indenting the body inside
  `try {` makes `called` empty and the criterion returns `False`, silently dropping a tier-3
  dimension to zero. Emit `try {`, then the existing body verbatim at column 0, then `} catch`.
  Fixing the grader to suit the emit would be backwards; it is a frozen grader.
- **The catch rethrows the ORIGINAL error**, always. A postmortem that dies, returns `null`, or is
  itself aborted must not replace or mask the failure it was sent to explain.
- **The postmortem does NOT write `state.json`.** `prompts/checkpoint.txt` writes state by
  clobbering heredoc (`cat > … <<'DURABLE_JSON'`), preserving only `startedAt`; a second
  independent writer is exactly the drift `workflow-runtime.md` §6 forbids. So: the postmortem
  **returns** the record through its `schema`, the conductor serializes it into the payload, and the
  **existing** `checkpoint()` writes the bytes — extended to take `status` and `failure` instead of
  hardcoding `status: 'running'`.

The record merged into `.workflows/state/<name>.json`:

```json
{
  "status": "failed",
  "failure": {
    "phase":     "DoDGate",
    "kind":      "missing-info | unachievable-dod | convergence-stall | mechanical",
    "reason":    "one sentence — what actually blocked",
    "evidence":  "file:line, command output, or the gate summary",
    "gathered":  [{ "question": "...", "answer": "...", "source": "..." }],
    "questions": [{ "id": "q1", "question": "...", "why": "...", "options": ["..."] }],
    "hint":      "text to inject into the retried phase",
    "retrySafe": false,
    "signature": "<phase> :: <first 120 chars of the error>",
    "attempts":  1
  }
}
```

`signature` + `attempts` exist because `kind` is a **worker self-report**, and the repo already
treats those as untrusted claims (`prompts/dodgate-verify.txt`). See §3.

`gathered` is what the worker resolved by itself; `questions` is only what it could not.

Side benefit: `status: failed` now gets stamped by the run. Today a session that dies mid-run leaves
`running` and no reason at all.

**Honest limit:** a hard session kill runs no catch. Only a *thrown* failure is covered — which is
every gate, the integrate/setup guards, and the fan-out's all-workers-died case.

### 2 · Gather protocol — ordered, stop as soon as it is answered

Baked into the postmortem prompt as a fixed order:

1. run artifacts — the worktree, the diff on `wf/<name>`, `results`, the coverage ledger
2. the repo — `CLAUDE.md`, `docs/changes/`, the code itself
3. project long-term memory — `~/.claude/projects/<slug>/memory/` (path derivable from the repo path)
4. the human's external notes — paths passed in `args.kb` (Obsidian vault, etc.), empty by default
5. `WebSearch` — **off unless `args.web` is set**, opted in once at launch rather than prompted for
   mid-resume. A failure `reason`/`evidence` can carry proprietary code context, and a search
   publishes it. When off, the postmortem may only *name* the query it would have run. When on:
   external facts only (API shapes, error strings, version behaviour), never a fact about this repo.

Steps 3–4 are read-only, **capped** (≤2 KB per source) and source-attributed: whatever they return
lands in `gathered[]` with its `source`, and reaches the next run **only** through the fenced
`PRIOR-RUN CONTEXT` block — never spliced in as if it were an instruction. Step 4 in particular
widens the trust boundary (a vault note can contain clipped web content), so its provenance must
survive into the prompt.

`args.kb` is the only piece needing a data channel: one line, `const KB = (args && args.kb) || []`,
interpolated into the postmortem prompt. Empty by default.

### 3 · Resume triage — `scripts/triage.cjs`, not prose

Routing lives in a **script**, not in SKILL.md: prose cannot be gated, and the repo rule is that
every skill change lands behind a frozen, discrimination-gated check. `triage.cjs` reads
`state.json` and prints `{ action, questions, hints }`; SKILL.md step 4 just runs it and does what
it says.

**`kind` is advisory, not authoritative.** `triage.cjs` **re-derives** `mechanical` from the raw
error string against a fixed pattern set (integrate conflict, worker died, worktree not ready) and
only then may skip the human. The worker's own claim never earns that shortcut on its own — the
repo's rule about untrusted self-reports applies most exactly to the one route with no human in it.

| kind | action |
|---|---|
| `mechanical` **re-derived from the error**, first sighting of this `signature` | relaunch once. Ask nothing. Conductor requires a live session either way (`workflow-runtime.md` §7), so there is no unattended path to guard. |
| `mechanical`, `signature` seen before (`attempts` ≥ 2) | **escalate to `missing-info`** and ask. A repeat of the identical failure is by definition not transient — this is the guard that stops an auto-relaunch loop from reproducing the very bug this design exists to kill. |
| worker claimed `mechanical`, error text does **not** match the pattern set | treat as `missing-info` and ask. Unrecognised is not transient. |
| `convergence-stall` | `hints[phase]` = the prior gate's findings + "these were tried and did not resolve it", so round 1 of the new run starts where round 3 of the old one stopped. |
| `missing-info` with open `questions` | **one** batched `AskUserQuestion` (≤4). Answers become `hints[phase]`. |
| `unachievable-dod` | **no automated action.** Report the criterion, the evidence, and the exact re-scaffold command; the human decides. See the revision log — the automated-amendment route was refuted. |

### 4 · Hint channel — without this, the rest is theatre

```js
const HINTS = (args && args.hints) || {}
```

Every work phase and every gate appends `HINTS[key]` to its prompt under a `PRIOR-RUN CONTEXT`
header. Resume passes `args = { phasesDone, results, hints }`.

Two things this must get right:

- **Conditional, so an empty hint costs zero bytes.** `--help`'s own generator just cut ~42% of
  per-scaffold tokens (#51); unconditional prompt text on every phase gives some of that back for a
  block that is empty on every happy-path run.
- **Both dispatch shapes.** A work phase runs as a level fan-out, as a *single* worker when the plan
  holds one item (`items.length === 1`), or as one serial worker under `--no-plan-fanout`. A hint
  that only reaches the fan-out path silently does nothing on the other two.

### 5 · Write-back — the only thing that makes the knowledge base grow

A human answer to a `missing-info` question is written as a `project` memory file plus its
`MEMORY.md` pointer line. The next run's postmortem finds it at gather-step 3 and never asks again.

Explicitly rejected: a **new** knowledge store. The repo, `docs/changes/`, project memory and the
user's own notes already are one; a new store buys a write path, a staleness problem and a retrieval
step that has to earn its keep. Revisit only if the postmortem twice fails to find something a
dedicated store would have held.

## Files touched

| file | change |
|---|---|
| `scripts/scaffold-workflow.cjs` | try/catch wrap (after the resume guard); postmortem `agent()` + schema; `checkpoint()` gains `status`/`failure`; `HINTS` const + conditional injection across all three dispatch shapes; `KB` const |
| `scripts/prompts/postmortem.txt` | new — classification taxonomy + the ordered gather protocol |
| `scripts/triage.cjs` | new — `state.json` → `{action, questions, hints}`; the routing table as data |
| `scripts/snapshots/*.js` | **regenerate all 7** — `scaffold-golden-snapshots.check.mjs` byte-compares them, so any emit change reds the floor until they are refreshed |
| `SKILL.md` | step 4 runs `triage.cjs`; step 5 notes the run now self-stamps `failed` |
| `references/workflow-runtime.md` | §3 state schema gains `failure` + `hints`; §4 resume protocol gains the triage branch |
| `evals/checks/failure-record.check.mjs` | new |
| `evals/checks/hints-injected.check.mjs` | new |
| `evals/checks/triage-routing.check.mjs` | new — fixtures per `kind`, incl. the repeat-signature escalation |
| `evals/checks-manifest.json` | register all three **with `mutations`** |
| `scripts/test-scaffold.cjs` | regression net for the new emit |

## Gates (repo rule: frozen, discrimination-gated, green floor)

Prove RED on the baseline first —
`node plugins/lirbox/skills/whetstone/scripts/check-baseline.cjs "<cmd>"` → `DISCRIMINATING`.

| check | invariant | mutations that must go RED |
|---|---|---|
| `failure-record` | the generated script's catch dispatches a postmortem **and** rethrows the original error, **and every `phase(` call stays at column 0** | drop the rethrow; drop the catch; drop the postmortem dispatch; rethrow the postmortem's own error instead of the original; indent the body inside the `try` |
| `hints-injected` | every work phase and every gate prompt carries `HINTS[key]`, on all three dispatch shapes | drop the injection from one work phase; from one gate; from the single-item path; from `--no-plan-fanout` |
| `triage-routing` | each `kind` routes to its distinct action, and a repeat `signature` escalates instead of relaunching | make `mechanical` always relaunch; collapse two kinds to one action; ignore `attempts` |

Anchor both to the invariant, never to a variable name or a nearby token.

Also required, unchanged: the conductor-purity string scan in `test-scaffold.cjs` (the catch is pure
JS, the postmortem is a worker), and `node scripts/evals-all.mjs --fast` green.

## Non-goals

- Turning gate `throw`s into structured `blocked` returns — 12+ throw sites and every gate schema,
  for information the postmortem reconstructs.
- Surviving a hard session kill. Out of reach without a supervisor process.
- **Auto-amending a DoD criterion** — refuted, see the revision log.
- Any new persistent store (see §5).
- **`loom`.** Its 3 throw sites have the same no-record problem, but its gate failures already route
  back to earlier stages by edge, so it has less need for cross-run triage. **Decided 2026-08-02:
  leave it alone entirely** — not fixed here, not filed. Revisit only if it actually bites.

## Open risks

- **`triage.cjs` is a new decision surface.** It is gated by `triage-routing.check.mjs`, but it now
  owns whether the human is asked at all — a bug there is silent. This is the file to review hardest.
- **The Harbor dimension is unconfirmed until a scaffold is regenerated and scored.** The column-0
  hazard above was found by reading the grader, not by running it; the reading is strong but the
  proof is a run (`d7`).
- **Misclassification, residual.** Re-deriving `mechanical` from the error text (§3) removes the
  self-report shortcut, but a *novel* transient failure whose text matches no pattern now routes to
  a question instead of a retry. That is the correct direction to fail, at the cost of an occasional
  avoidable ask.

## Revision log

**r2 — 2026-08-02, after `plan-check` (`plan-check-conductor-failure-triage.html`).**

- **REFUTED and removed:** r1 §3 routed `unachievable-dod` to "an amendment rewrites the frozen
  `.dod.json`". `scaffold-workflow.cjs:1010` bakes the criteria into the generated script
  (`const DOD_CRITERIA = ${JSON.stringify(dodCriteria)}`) and the gate reads that constant — nothing
  re-reads the file. The amended run would have enforced the old criteria and escalated again,
  reproducing the exact wall this design exists to remove. Rejected alternatives: regenerating with
  `--force` mid-run (later phases would execute different code than earlier ones, with no record —
  silent drift in the one system whose value is inspectable resume) and an `args.dodAmendments`
  override (a permanent runtime channel that lowers a frozen bar). The route is now report-only.
- **Added:** the signature/attempts guard (§1, §3) — `kind` is a worker self-report and `mechanical`
  is the only route that skips the human.
- **Added:** `triage.cjs` — r1 put the routing table in SKILL.md prose, which no check can gate.
- **Added:** the three tacit constraints in §1 (guard-then-try, rethrow the original, reuse
  `checkpoint()` rather than a second state writer).
- **Added:** golden-snapshot regeneration, conditional hint injection, and the two non-fan-out
  dispatch shapes — all omissions that would have red-floored or silently no-opped.
- **Narrowed:** WebSearch is now opt-in rather than a default gather step.

**r3 — 2026-08-02, blind-spot resolution pass.**

- **New defect found and designed around:** Harbor's `phase_order_matches_meta()` anchors its phase
  regex at column 0, so the obvious `try {` wrap — which indents the body — would have returned
  `False` and silently zeroed a tier-3 dimension. The wrap now emits the body unindented, and
  `failure-record` asserts it.
- **Closed by verification:** the floor baseline is green (`test-scaffold.cjs`, 22/22 combos) and the
  snapshot regen path already exists (`--snapshot-dir` / `SNAPSHOT_DIR`, flag wins) — snapshot
  regeneration is a known step, not an unknown. `every_agent_has_schema()` counts `agent(` against
  `schema:`, which the postmortem keeps balanced. The derived memory path
  `~/.claude/projects/<slug>/memory/` exists as assumed.
- **Strengthened:** `kind` is now advisory — `triage.cjs` re-derives `mechanical` from the error text
  and treats "unrecognised" as a reason to ask. r2 only bounded the self-report with a counter.
- **Decided:** auto-relaunch once on an evidence-derived `mechanical`. `workflow-runtime.md` §7
  rules out any unattended entry point, so a session-mode split would have guarded nothing.
- **Decided:** `loom` is out of scope and will not be filed.
- **Narrowed:** web access is a launch-time `args.web` opt-in, not a mid-resume prompt; gathered
  external content is capped at 2 KB per source.
