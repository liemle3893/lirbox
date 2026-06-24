#!/usr/bin/env node
/*
 * Deterministically generate the optimization-LOOP conductor (a Workflow `.js` script) from a
 * slug. Analogous to conductor's scaffold-workflow.cjs, but emits a sequential keep-or-discard
 * hill-climbing loop instead of a fixed phase sequence.
 *
 * Key difference from scaffold-workflow: the RUN CONFIG (goal, surface, metric, gate, budgets,
 * baseline) is NOT baked into the template — it is passed to the loop conductor via Workflow
 * `args.config` at launch, so a `resume` re-passes it unchanged (the conductor cannot read fs).
 * The generator therefore bakes only the LOOP STRUCTURE; everything project-specific is data-in.
 *
 * Conductor constraints (same as conductor): the generated loop is PURE JS — no fs, no git, no
 * Date.now()/Math.random(). Every side-effect (worktree create, running the gate/metric, edits,
 * commit/revert, ledger writes) happens inside an `agent()` worker prompt.
 *
 * Usage:
 *   node scaffold-optimize.cjs --name <slug> [--out <path>] [--force]
 * Options:
 *   --name <slug>   required; kebab slug; drives state/branch/worktree paths and the resume key.
 *   --out <path>    output file (default: .optimize/<name>.js).
 *   --force         overwrite an existing output file.
 *
 * Exposes pure decision helpers (isBetter / shouldStop / deriveEvalCap) on module.exports so the
 * regression net (test-optimize.cjs) can unit-test them directly — they are ALSO inlined verbatim
 * into the generated conductor (pure JS, legal in the restricted layer).
 */
const fs = require('fs');
const path = require('path');

// ============================================================================
// PURE DECISION HELPERS — exported for tests AND inlined into the generated loop.
// They take ONLY plain values (no fs/git/time/randomness), so they are legal in the
// restricted conductor layer. Keep these in sync with HELPERS_SRC below (the inlined copy).
// ============================================================================

// KEEP rule (the metric half): does `metric` beat `best` by at least `minDelta` for `direction`?
// `min`  → lower is better → keep iff best - metric >= minDelta.
// `max`  → higher is better → keep iff metric - best >= minDelta.
// A non-finite metric (failed parse / timeout) never beats best.
function isBetter(metric, best, direction, minDelta) {
  if (typeof metric !== 'number' || !isFinite(metric)) return false;
  const d = (minDelta == null ? 0 : minDelta);
  if (typeof best !== 'number' || !isFinite(best)) return true; // no baseline yet → any valid metric wins
  return direction === 'max' ? metric - best >= d : best - metric >= d;
}

// STOP rule: returns the FIRST hit reason (string) or null to keep going. Pure — the caller
// passes the live counters; the conductor cannot read a clock, so `wallclockMin`/`elapsedMin`
// and `tokens`/`tokensUsed` are supplied by checkpoint workers via the ledger/args.
//   experimentsDone        — count already run
//   sinceKept              — experiments since the last KEPT (plateau counter)
//   total = { experiments?, wallclockMin?, tokens? }  — first to hit stops the run
//   plateauStop            — stop after this many with no KEEP (0/undefined → disabled)
//   elapsedMin, tokensUsed — measured-so-far, supplied by workers (may be undefined)
function shouldStop(experimentsDone, sinceKept, total, plateauStop, elapsedMin, tokensUsed) {
  total = total || {};
  if (typeof total.experiments === 'number' && experimentsDone >= total.experiments) return 'experiments';
  if (typeof total.wallclockMin === 'number' && typeof elapsedMin === 'number' && elapsedMin >= total.wallclockMin) return 'wallclock';
  if (typeof total.tokens === 'number' && typeof tokensUsed === 'number' && tokensUsed >= total.tokens) return 'tokens';
  if (typeof plateauStop === 'number' && plateauStop > 0 && sinceKept >= plateauStop) return 'plateau';
  return null;
}

// Derive the per-experiment eval cap from the measured baseline eval time. `factor` defaults to
// ~3 (generous enough to measure a change that legitimately got slower, tight enough to kill an
// infinite loop). Floored so a sub-second baseline still gives a usable cap.
function deriveEvalCap(evalSec, factor) {
  const f = (typeof factor === 'number' && factor > 0) ? factor : 3;
  const e = (typeof evalSec === 'number' && isFinite(evalSec) && evalSec > 0) ? evalSec : 0;
  return Math.max(30, Math.ceil(e * f));
}

// ============================================================================
// CLI
// ============================================================================

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true; // bare flag → true
}

// The literal SOURCE of the helpers above, inlined verbatim into the generated conductor so the
// restricted layer can call them. Single source: read the functions back via toString() rather
// than re-typing them, so the inlined copy can never drift from the tested exports.
const HELPERS_SRC = [isBetter, shouldStop, deriveEvalCap].map((fn) => fn.toString()).join('\n\n');

function generate(name) {
  return `// AUTO-GENERATED by scaffold-optimize.cjs — do NOT hand-edit.
// The run CONFIG (goal, surface, metric, gate, budgets, baseline) is passed in via
// Workflow \\\`args.config\\\` at launch — NOT baked here — so a resume re-passes it unchanged
// (the conductor cannot read the filesystem). To change the LOOP STRUCTURE, re-run the
// generator with --force. Never edit this file by hand (that reintroduces drift).
//
// Conductor rules: pure JS only — no fs/git, no Date.now()/Math.random(). Every side-effect
// (worktree create, running the gate/metric, editing the surface, commit/revert, ledger writes)
// happens inside an agent() worker prompt.
//
// Loop shape (spec §2): Setup → Baseline → bounded experiment loop (propose → bounded eval →
// keep-or-discard with surface-lock → checkpoint) → stop on the FIRST of
// {experiments, wallclockMin, tokens, plateau}. KEPT commits accumulate on opt/<name>; never
// merged (spec §4).
//
// Resume semantics: experiments are AT-LEAST-ONCE. The checkpoint is written AFTER the
// commit-or-revert, so a crash between them re-runs that experiment. The revert (git checkout --
// <surface>) makes a re-run safe; every experiment body is idempotent.

export const meta = {
  name: '${name}',
  description: 'Optimization loop: ${name} (sequential keep-or-discard hill-climb)',
  phases: [
    { title: 'Setup' },
    { title: 'Baseline' },
    { title: 'Experiments' },
  ],
}

// ---------------------------------------------------------------------------
// Pure decision helpers — inlined from scaffold-optimize.cjs (legal in the restricted layer).
// isBetter(metric, best, direction, minDelta) — the metric half of the KEEP rule.
// shouldStop(experimentsDone, sinceKept, total, plateauStop, elapsedMin, tokensUsed) — first stop reason or null.
// deriveEvalCap(evalSec, factor) — per-experiment eval cap from the measured baseline.
// ---------------------------------------------------------------------------
${HELPERS_SRC}

// --- Config comes from args (NOT baked). Resume re-passes it so the loop is reproducible. ---
const CONFIG   = (args && args.config) ? args.config : null
if (!CONFIG) throw new Error('Missing args.config — launch with { config: <approved .optimize/config/' + '${name}' + '.json> }')

const NAME     = '${name}'
const STATE    = \`.optimize/state/\${NAME}.json\`
const BRANCH   = (args && args.branch) ? args.branch : \`opt/\${NAME}\`
const BASELINE = CONFIG.baseline || ''
const WORKTREE = \`.worktrees/opt-\${NAME}\`

const GOAL      = CONFIG.goal || ''
const SURFACE   = CONFIG.surface || ''
const METRIC    = CONFIG.metric || {}                 // { cmd, parse, direction }
const GATE      = CONFIG.gate || {}                   // { cmd }
const DIRECTION = METRIC.direction === 'max' ? 'max' : 'min'
const BUDGETS   = CONFIG.budgets || {}
const TOTAL     = BUDGETS.total || { experiments: 100 }
const PLATEAU   = (typeof BUDGETS.plateauStop === 'number') ? BUDGETS.plateauStop : 0
const MINDELTA  = (typeof BUDGETS.minDelta === 'number') ? BUDGETS.minDelta : 0
const AGENTCAP  = (typeof BUDGETS.agentCapSec === 'number') ? BUDGETS.agentCapSec : 600
const MAXEXP    = (typeof TOTAL.experiments === 'number') ? TOTAL.experiments : 1000

// --- Resume state: passed in via args so the loop continues from where it stopped. ---
// The conductor can't read fs, so the main session re-passes the ledger + best + count.
const priorExperiments = (args && Array.isArray(args.experiments)) ? args.experiments : []
let best = (args && args.best) ? args.best : null     // { metric, sha, experiment } | null
const experimentsDone0 = (args && typeof args.experimentsDone === 'number')
  ? args.experimentsDone
  : priorExperiments.length

// Mutable run accumulators (rebuilt from the resume args).
const ledger = priorExperiments.slice()               // [{ g, change, metric, gate, kept, sha, sec, tokens }]
let experimentsDone = experimentsDone0

// sinceKept (plateau counter): trailing run with no KEEP, reconstructed from the resumed ledger.
let sinceKept = 0
for (let i = ledger.length - 1; i >= 0; i--) { if (ledger[i] && ledger[i].kept) break; sinceKept++ }

// --- Resume reachability guard ---
// best, if present, MUST point at an experiment within the resumed ledger and (when the ledger is
// non-empty) carry a metric — a best referencing an experiment beyond what we've run is corrupt/
// forged. Reject loudly rather than silently optimizing from a bogus baseline.
;(() => {
  if (best == null) return
  if (typeof best.metric !== 'number' || !isFinite(best.metric)) {
    throw new Error(\`Unreachable resume: best.metric is not a finite number (got \${JSON.stringify(best && best.metric)})\`)
  }
  if (typeof best.experiment === 'number' && best.experiment > experimentsDone) {
    throw new Error(\`Unreachable resume: best.experiment=\${best.experiment} exceeds experimentsDone=\${experimentsDone} — ledger is corrupt or forged\`)
  }
})()

const results = { config: CONFIG }
// On resume the main session re-passes the measured baseline (metric/sha/evalSec) so the loop can
// (a) re-derive the eval cap from the measured evalSec and (b) re-persist baseline at every
// checkpoint — otherwise the first post-resume checkpoint would overwrite it with null and the
// report would lose baseline→best. Symmetric with how best/experiments are re-passed.
if (args && args.baseline && typeof args.baseline === 'object') results.baseline = args.baseline

// Per-worker isolation instruction. \`slot\` makes the notes file UNIQUE so parallel/sequential
// workers never clobber each other (vary by experiment index, never randomness). Pass
// { notes: false } for mechanical steps (commit/revert/checkpoint) that make no design decision.
function inWorktree(slot, opts) {
  const base = \`Work ONLY inside the git worktree at \${WORKTREE} (run \\\`cd \${WORKTREE}\\\` first; it is on \` +
    \`branch \${BRANCH}). Do NOT edit any file outside \${WORKTREE}. Commit your changes there.\`
  if (opts && opts.notes === false) return base
  return base + \`\\n\\nIf — and ONLY if — this step involved a non-trivial design decision, an \` +
    \`intentional deviation from the spec, a tradeoff between real alternatives, or an open question a \` +
    \`reviewer must confirm, append it to a notes file UNIQUE to you at implementation-notes/\${slot}.html \` +
    \`in the worktree (mkdir -p the dir; create if missing; APPEND — never clobber). For mechanical or \` +
    \`no-decision work, SKIP the file — do not create empty or boilerplate notes.\`
}

// startedAt-preserving merge: cat clobbers the file, so read prev startedAt first, then write the
// full canonical ledger. The conductor serializes the bytes; the worker only adds timestamps.
// Mirrors conductor's checkpoint() exactly, but persists the optimization ledger schema (spec §2).
async function checkpoint(tag, status) {
  const payload = JSON.stringify(
    {
      name: NAME, status: status || 'running',
      branch: BRANCH, worktree: WORKTREE,
      goal: GOAL, surface: SURFACE,
      baseline: results.baseline || null,
      best,
      experiments: ledger,
    },
    null, 2,
  )
  await agent(
    \`Persist the durable optimization ledger to the MAIN repo (do NOT cd into the worktree). Run EXACTLY:

mkdir -p .optimize/state
cat > .optimize/state/.\${NAME}.payload.json <<'DURABLE_JSON'
\${payload}
DURABLE_JSON
node -e "const fs=require('fs');const f='\${STATE}';const p='.optimize/state/.\${NAME}.payload.json';let prev={};try{prev=JSON.parse(fs.readFileSync(f,'utf8'))}catch(e){};const s=JSON.parse(fs.readFileSync(p,'utf8'));const n=new Date().toISOString();s.startedAt=prev.startedAt||n;s.updatedAt=n;s.finishedAt=prev.finishedAt||null;fs.writeFileSync(f,JSON.stringify(s,null,2));fs.unlinkSync(p)"
node -e "JSON.parse(require('fs').readFileSync('\${STATE}','utf8'))" && echo OK

Return whether the file was written and parses.\`,
    { label: \`checkpoint:\${tag}\`, phase: 'Experiments',
      schema: { type: 'object', additionalProperties: false, required: ['written'], properties: { written: { type: 'boolean' }, path: { type: 'string' } } } },
  )
}

// --- Setup: create/reuse worktree + symlink node_modules (worktrees don't carry it) ---
// Branch is opt/<name> in .worktrees/opt-<name>; main is never touched (spec §4).
phase('Setup')
results.setup = await agent(
  \`Create an isolated git worktree for the optimization loop. Run idempotently:

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "ERROR: not a git repo"; exit 1; }
ROOT="\$(git rev-parse --show-toplevel)"
if git worktree list --porcelain | grep -q "/\${WORKTREE}\$"; then
  echo "worktree exists — reusing"
elif git show-ref --verify --quiet "refs/heads/\${BRANCH}"; then
  git worktree add "\${WORKTREE}" "\${BRANCH}"
else
  # Branch from the FRESH remote tip, not a possibly-stale local ref.
  git fetch origin --quiet 2>/dev/null || echo "WARN: git fetch origin failed — using local refs (may be stale)"
  BASEREF="\${BASELINE}"
  # Auto-detect the remote's default branch when no baseline was given.
  [ -n "\$BASEREF" ] || BASEREF="\$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##')"
  if [ -n "\$BASEREF" ] && git show-ref --verify --quiet "refs/remotes/origin/\$BASEREF"; then
    START="origin/\$BASEREF"
  elif [ -n "\$BASEREF" ] && git show-ref --verify --quiet "\$BASEREF"; then
    echo "NOTE: \$BASEREF is not an origin/ ref — using it verbatim (e.g. a tag/sha/origin-prefixed ref)"; START="\$BASEREF"
  elif [ -n "\$BASEREF" ]; then
    echo "WARN: \$BASEREF not found — branching from current HEAD (may be stale)"; START="HEAD"
  else
    echo "WARN: could not detect remote default branch — branching from current HEAD (may be stale)"; START="HEAD"
  fi
  echo "Branching \${BRANCH} from \$START"
  git worktree add "\${WORKTREE}" -b "\${BRANCH}" "\$START"
fi
[ -e "\${WORKTREE}/node_modules" ] || [ ! -d "\$ROOT/node_modules" ] || ln -s "\$ROOT/node_modules" "\${WORKTREE}/node_modules"
test -d "\${WORKTREE}" && echo OK\`,
  { label: 'setup:worktree', phase: 'Setup',
    schema: { type: 'object', additionalProperties: false, required: ['ready'], properties: { ready: { type: 'boolean' }, worktree: { type: 'string' }, branch: { type: 'string' } } } },
)

// --- Baseline: gate MUST pass (can't optimize a broken base) → metric → measure evalSec → cap ---
// On resume \`best\` is already set from args, so the baseline is measured only on a fresh run.
let EVALCAP
if (best != null && results.baseline) {
  // Resumed WITH the baseline re-passed in args: a pinned evalCapSec wins, else derive from the
  // measured baseline.evalSec — never re-measure (that would change best).
  EVALCAP = (typeof BUDGETS.evalCapSec === 'number' && BUDGETS.evalCapSec > 0)
    ? BUDGETS.evalCapSec
    : deriveEvalCap(results.baseline.evalSec, BUDGETS.evalCapFactor)
} else if (best != null) {
  // Resumed but the baseline was NOT re-passed (older ledger): best came from args but we still
  // need a per-experiment eval cap. Prefer a pinned evalCapSec; otherwise fall back to the floor
  // (re-measuring the baseline would change best, so we must not).
  EVALCAP = (typeof BUDGETS.evalCapSec === 'number' && BUDGETS.evalCapSec > 0)
    ? BUDGETS.evalCapSec
    : deriveEvalCap((args && args.evalSec) || 0, BUDGETS.evalCapFactor)
} else {
  phase('Baseline')
  const baseRes = await agent(
    \`\${inWorktree('baseline')}

BASELINE (spec §1/§3) for goal: "\${GOAL}".
1. Run the hard GATE — this MUST exit 0; a broken base cannot be optimized:
     \${GATE.cmd || '(no gate configured — FAIL: a gate is required)'}
   If the gate is missing or fails, set gatePassed=false and STOP (do not measure the metric).
2. Time the GATE+METRIC together with the shell's \\\`time\\\`/\\\`date +%s\\\` and run the METRIC command:
     \${METRIC.cmd || '(no metric configured — FAIL)'}
   Extract the scalar using parse rule \\\`\${METRIC.parse || 'lastnumber'}\\\` (a regex with one capture
   group, or \\\`json:<dot.path>\\\`, or \\\`lastnumber\\\`) from the metric command's stdout. Report it as
   \\\`metric\\\` (a finite number) — confirms metric.cmd runs and parse yields a number.
3. Report \\\`evalSec\\\` = the wall-clock seconds the gate+metric took (this DERIVES the per-experiment
   eval cap, ~3× evalSec). Report the current commit \\\`sha\\\` (git rev-parse HEAD in the worktree).
Do NOT edit any source — this is a pure measurement.\`,
    { label: 'baseline', phase: 'Baseline',
      schema: { type: 'object', additionalProperties: false, required: ['gatePassed', 'metric'],
        properties: { gatePassed: { type: 'boolean' }, metric: { type: 'number' }, evalSec: { type: 'number' }, sha: { type: 'string' }, summary: { type: 'string' } } } },
  )
  if (!baseRes || !baseRes.gatePassed) {
    throw new Error('Baseline gate failed — cannot optimize a broken base: ' + ((baseRes && baseRes.summary) || ''))
  }
  if (typeof baseRes.metric !== 'number' || !isFinite(baseRes.metric)) {
    throw new Error('Baseline metric did not parse to a finite number — fix metric.cmd/metric.parse: ' + ((baseRes && baseRes.summary) || ''))
  }
  results.baseline = { metric: baseRes.metric, sha: baseRes.sha || '', evalSec: baseRes.evalSec || 0 }
  best = { metric: baseRes.metric, sha: baseRes.sha || '', experiment: 0 }
  // Pinned evalCapSec overrides the derived value (spec §3: "Override to pin").
  EVALCAP = (typeof BUDGETS.evalCapSec === 'number' && BUDGETS.evalCapSec > 0)
    ? BUDGETS.evalCapSec
    : deriveEvalCap(baseRes.evalSec, BUDGETS.evalCapFactor)
  await checkpoint('baseline')
}

// --- Experiment loop: sequential keep-or-discard, bounded; stops on FIRST budget/plateau hit ---
phase('Experiments')
for (let i = 0; i < MAXEXP; i++) {
  // Stop check BEFORE spawning work — the conductor can't read a clock, so elapsedMin/tokensUsed
  // are passed in by resume (args) and otherwise undefined (only count/plateau stops apply live).
  const stop = shouldStop(experimentsDone, sinceKept, TOTAL, PLATEAU, (args && args.elapsedMin), (args && args.tokensUsed))
  if (stop) { log(\`Stopping: \${stop} budget reached (experimentsDone=\${experimentsDone}, sinceKept=\${sinceKept})\`); break }

  const g = experimentsDone + 1

  // (a) PROPOSE — ONE focused edit to the surface, given the goal + the ledger so far (so it does
  // not repeat ideas). Bounded by agentCapSec so a stuck agent can't stall the night (spec §3).
  const ledgerDigest = JSON.stringify(ledger.map((e) => ({ g: e.g, change: e.change, metric: e.metric, kept: e.kept })))
  const propose = await agent(
    \`\${inWorktree(\`propose-\${g}\`)}

PROPOSE (experiment \${g}, spec §2). Goal: "\${GOAL}".
Make ONE focused, self-contained edit toward the goal, touching ONLY files within the surface:
    \${SURFACE}
You have a soft time budget of \${AGENTCAP}s — keep the edit small. Do NOT touch the metric/gate/
harness/config or anything outside the surface (that experiment will be discarded by the surface lock).
The current best metric is \${best ? best.metric : 'unknown'} (direction: \${DIRECTION === 'max' ? 'higher is better' : 'lower is better'}).
Past experiments (do NOT repeat an idea that was tried and discarded): \${ledgerDigest}
Describe your change in one line as \\\`change\\\`. Do NOT commit — the eval step decides keep-or-revert.\`,
    { label: \`propose:\${g}\`, phase: 'Experiments',
      schema: { type: 'object', additionalProperties: false, required: ['change'],
        properties: { change: { type: 'string' }, summary: { type: 'string' } } } },
  )
  const change = (propose && propose.change) || '(no change proposed)'

  // (b) EVAL (bounded) — run the gate (fail → discard) then the metric under evalCapSec
  // (timeout → discard). Return structured {gatePassed, metric, diffFiles, sec, tokens} so the
  // CONDUCTOR makes the keep-or-discard decision (the worker never decides keep — it only measures).
  const evalRes = await agent(
    \`\${inWorktree(\`eval-\${g}\`, { notes: false })}

EVAL (experiment \${g}, spec §2/§3). Measure the candidate edit; DO NOT commit or revert (the
conductor decides keep-or-discard). Run in order, each step under its cap:
1. GATE (the correctness floor): \${GATE.cmd || '(no gate — FAIL)'}
   Run it under a \${EVALCAP}s timeout (e.g. \\\`timeout \${EVALCAP} <gate>\\\`). Non-zero exit OR timeout
   ⇒ gatePassed=false (a discard); skip the metric.
2. METRIC (only if the gate passed): \${METRIC.cmd || '(no metric — FAIL)'}
   Run it under the SAME \${EVALCAP}s timeout. Extract the scalar with parse rule
   \\\`\${METRIC.parse || 'lastnumber'}\\\` → report \\\`metric\\\` (finite number). Timeout/parse-fail ⇒
   omit metric (a discard).
3. SURFACE LOCK: report \\\`diffFiles\\\` = EVERY path this edit touched, INCLUDING new untracked files
   (\\\`git diff --name-only\\\` alone MISSES untracked files — an out-of-surface NEW file would slip the
   lock). Use, from the worktree root:
       git -c core.quotepath=false status --porcelain --untracked-files=all
   and report the path from each line (the part after the 2-char status; for a rename \\\`R  old -> new\\\`
   report the NEW path). The conductor verifies they are ALL within the surface \\\`\${SURFACE}\\\` — any
   file outside (or an empty list) ⇒ discard.
4. Report \\\`sec\\\` (eval wall-clock seconds) and, if known, \\\`tokens\\\` used this experiment.\`,
    { label: \`eval:\${g}\`, phase: 'Experiments',
      schema: { type: 'object', additionalProperties: false, required: ['gatePassed', 'diffFiles'],
        properties: {
          gatePassed: { type: 'boolean' }, metric: { type: 'number' },
          diffFiles: { type: 'array', items: { type: 'string' } },
          sec: { type: 'number' }, tokens: { type: 'number' }, summary: { type: 'string' },
        } } },
  )

  const gatePassed = !!(evalRes && evalRes.gatePassed)
  const metric = (evalRes && typeof evalRes.metric === 'number') ? evalRes.metric : NaN
  const diffFiles = (evalRes && Array.isArray(evalRes.diffFiles)) ? evalRes.diffFiles : []
  const sec = (evalRes && typeof evalRes.sec === 'number') ? evalRes.sec : null
  const tokens = (evalRes && typeof evalRes.tokens === 'number') ? evalRes.tokens : null

  // CONDUCTOR DECISION (pure JS, spec §2/§4):
  //   KEEP iff gatePassed AND metric beats best by >= minDelta for the direction AND every
  //   touched file is within the surface (surface lock — anti-metric-gaming fence).
  const beats = isBetter(metric, best ? best.metric : null, DIRECTION, MINDELTA)
  const surfaceOk = surfaceAllows(diffFiles, SURFACE)
  const keep = gatePassed && beats && surfaceOk

  let sha = best ? best.sha : ''
  if (keep) {
    // Worker commits the kept change on the opt branch; conductor advances best.
    const committed = await agent(
      \`\${inWorktree(\`keep-\${g}\`, { notes: false })}

KEEP experiment \${g}: the gate passed and the metric improved, and the surface lock already
confirmed EVERY changed path is within the surface \${SURFACE} — so staging all changes here stages
only surface files (this avoids fragile pathspec globbing when the surface is a multi-glob list).
Commit on branch \${BRANCH}:
    git add -A     # safe: surface-lock already verified all changes ⊆ the surface
    git commit -m "opt(\${NAME}) g\${g}: \${change} [metric \${metric}]"
Report the new commit \\\`sha\\\` (git rev-parse HEAD). Do not push; do not merge.\`,
      { label: \`keep:\${g}\`, phase: 'Experiments',
        schema: { type: 'object', additionalProperties: false, required: ['sha'], properties: { sha: { type: 'string' } } } },
    )
    sha = (committed && committed.sha) || sha
    best = { metric, sha, experiment: g }
    sinceKept = 0
  } else {
    // Worker reverts the surface so the worktree is clean for the next experiment (spec §4).
    await agent(
      \`\${inWorktree(\`revert-\${g}\`, { notes: false })}

DISCARD experiment \${g} (\${!gatePassed ? 'gate failed/timed out' : !surfaceOk ? 'touched files outside the surface' : 'metric did not improve'}).
Drop ALL uncommitted changes so the worktree is clean for the next experiment. Reset the WHOLE
worktree, not just the surface — the candidate may have touched files OUTSIDE the surface (that is
itself a discard reason), and a surface-only revert would leave those behind to pollute the next
experiment or a later KEEP. Prior KEPT commits are already on \${BRANCH}, so this only drops the
uncommitted candidate:
    git reset --hard HEAD     # revert tracked edits (in AND outside the surface) to the last commit
    git clean -fd             # drop ALL new untracked files the edit added anywhere
Then confirm \\\`git status --porcelain\\\` is EMPTY. Report \\\`clean\\\` = whether the worktree is clean.\`,
      { label: \`revert:\${g}\`, phase: 'Experiments',
        schema: { type: 'object', additionalProperties: false, required: ['clean'], properties: { clean: { type: 'boolean' } } } },
    )
    sinceKept++
  }

  // (c) CHECKPOINT — append this experiment to the durable ledger (startedAt-preserving merge).
  const gateStr = gatePassed ? 'pass' : 'fail'
  ledger.push({
    g, change,
    metric: (typeof metric === 'number' && isFinite(metric)) ? metric : null,
    gate: gateStr, kept: keep, sha: keep ? sha : null, sec, tokens,
  })
  experimentsDone = g
  await checkpoint(\`g\${g}\`)
}

// Final stop reason (for status reporting by the main session at finalize).
const stopReason = shouldStop(experimentsDone, sinceKept, TOTAL, PLATEAU, (args && args.elapsedMin), (args && args.tokensUsed)) || 'experiments'

return {
  workflow: NAME, status: 'complete', stopReason,
  branch: BRANCH, worktree: WORKTREE,
  baseline: results.baseline || null, best,
  experimentsDone, experiments: ledger,
}

// --- surface-lock helper (pure): every touched file must be within the surface glob (spec §4) ---
// A minimal glob matcher (no external deps in the restricted layer): supports \`**\` (any path
// segment incl. /), \`*\` (any chars except /), and \`?\`. A surface like \`src/search/**\` allows new
// matching files. Returns true only when EVERY file matches at least one surface pattern.
function surfaceAllows(files, surface) {
  if (!surface) return false
  const pats = String(surface).split(/[,\\n]/).map((s) => s.trim()).filter(Boolean)
  if (!pats.length) return false
  const toRe = (glob) => {
    let re = '^'
    for (let i = 0; i < glob.length; i++) {
      const c = glob[i]
      if (c === '*') {
        if (glob[i + 1] === '*') { re += '.*'; i++; if (glob[i + 1] === '/') i++ }
        else re += '[^/]*'
      } else if (c === '?') re += '[^/]'
      else if ('\\\\^$.|+()[]{}'.indexOf(c) !== -1) re += '\\\\' + c
      else re += c
    }
    return new RegExp(re + '$')
  }
  const res = pats.map(toRe)
  // A bare \`dir/**\` should also match the directory itself; normalize trailing-/** to allow the dir.
  return files.length > 0 && files.every((f) => {
    const file = String(f).replace(/^\\.\\//, '')
    return res.some((r) => r.test(file))
  })
}
`;
}

// surfaceAllows is also defined inside the generated conductor; it is pure JS and legal there.
// We do NOT export it from the generator (the regex is generated as a string), but the three
// scalar helpers ARE exported for the test net.

module.exports = { isBetter, shouldStop, deriveEvalCap, generate };

// --- CLI entry (skip when require()'d by the test net) ---
if (require.main === module) {
  const name = arg('name');
  if (!name || name === true) { console.error('ERROR: --name <slug> is required'); process.exit(1); }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) { console.error('ERROR: --name must be a kebab slug (a-z0-9-)'); process.exit(1); }
  const out = arg('out', path.join('.optimize', name + '.js'));
  const force = arg('force', false) === true;
  if (fs.existsSync(out) && !force) { console.error(`ERROR: ${out} exists (use --force to overwrite)`); process.exit(1); }

  const src = generate(name);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, src);
  console.log(`Generated ${out}`);
  console.log('Phases: Setup → Baseline → Experiments (sequential keep-or-discard loop)');
  console.log('Launch via the Workflow tool with args.config = the approved .optimize/config/' + name + '.json (config is data-in, NOT baked).');
}
