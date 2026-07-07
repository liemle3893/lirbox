#!/usr/bin/env node
/*
 * Deterministically generate the skill-IMPROVER loop conductor (a Workflow `.js` script) from a
 * skill slug. A fork of prospector's scaffold-optimize.cjs: same two-layer Workflow shape, but it
 * emits a FIXED-BACKLOG GREEN loop instead of a scalar hill-climb. Per backlog item, a `fixer`
 * worker edits the skill to turn a frozen, human-confirmed, baseline-failing acceptance-check
 * green; the conductor keeps the change iff the FLOOR passes AND the CHECK passes AND the
 * SURFACE-LOCK holds (editable = skill minus `evals/**` + backlog), reverting otherwise.
 *
 * Key difference from scaffold-workflow: the RUN CONFIG (skill, surface, floor, items, budgets,
 * baseline) is NOT baked into the template — it is passed to the loop conductor via Workflow
 * `args.config` at launch, so a `resume` re-passes it unchanged (the conductor cannot read fs).
 * The generator therefore bakes only the LOOP STRUCTURE; everything project-specific is data-in.
 *
 * Conductor constraints (same as conductor): the generated loop is PURE JS — no fs, no git, no
 * Date.now()/Math.random(). Every side-effect (worktree create, running the floor/check, edits,
 * commit/revert, ledger writes) happens inside an `agent()` worker prompt.
 *
 * Usage:
 *   node scaffold-improve.cjs --name <slug> [--out <path>] [--force]
 * Options:
 *   --name <slug>   required; kebab slug; drives state/branch/worktree paths and the resume key.
 *   --out <path>    output file (default: .improve/<name>.js).
 *   --force         overwrite an existing output file.
 *
 * Exposes pure decision helpers (surfaceAllows / verdictOf / shouldStop) on module.exports so the
 * regression net (test-improve.cjs) can unit-test them directly — they are ALSO inlined verbatim
 * into the generated conductor (pure JS, legal in the restricted layer).
 */
const fs = require('fs');
const path = require('path');

// --- pure decision helpers: exported for tests AND inlined into the generated loop (legal in the restricted layer) ---
function globToRe(glob) {
  let re = '^';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') { if (glob[i+1] === '*') { re += '.*'; i++; if (glob[i+1] === '/') i++; } else re += '[^/]*'; }
    else if (c === '?') re += '[^/]';
    else if ('\\^$.|+()[]{}'.indexOf(c) !== -1) re += '\\' + c;
    else re += c;
  }
  return new RegExp(re + '$');
}
function surfaceAllows(files, editable, locked) {
  const eds = String(editable || '').split(/[,\n]/).map(s => s.trim()).filter(Boolean).map(globToRe);
  const lks = (Array.isArray(locked) ? locked : String(locked || '').split(/[,\n]/)).map(s => String(s).trim()).filter(Boolean).map(globToRe);
  if (!eds.length || !files.length) return false;
  return files.every(f => {
    const file = String(f).replace(/^\.\//, '');
    if (lks.some(r => r.test(file))) return false;       // locked → blocked (anti-gaming fence)
    return eds.some(r => r.test(file));
  });
}
function verdictOf(floorPassed, checkPassed, surfaceOk, sizeOk) {
  const size = (sizeOk === undefined) ? true : !!sizeOk;
  return (floorPassed && checkPassed && surfaceOk && size) ? 'kept' : 'reverted';
}
// EDIT-SIZE BUDGET (SkillOpt "textual learning rate"): bound HOW MUCH a single fix may change, not
// just WHERE (the surface lock). Disabled when maxDiffLines is absent/0 → always true. When enabled,
// an unknown diffLines (worker failed to measure) is conservatively over-budget — the bound only
// matters if it is actually measured.
function withinEditBudget(diffLines, maxDiffLines) {
  const max = (typeof maxDiffLines === 'number' && isFinite(maxDiffLines) && maxDiffLines > 0) ? Math.floor(maxDiffLines) : 0;
  if (!max) return true;
  return typeof diffLines === 'number' && isFinite(diffLines) && diffLines <= max;
}
// CONSOLIDATION keep-half (SkillOpt "slow/meta update"): a consolidation pass is kept only when the
// skill got STRICTLY smaller — equal size means the pass did nothing worth a commit; unknown sizes
// never pass (can't prove a shrink you didn't measure).
function tokensShrank(before, after) {
  return typeof before === 'number' && isFinite(before) &&
         typeof after === 'number' && isFinite(after) && after < before;
}
function shouldStop(itemsDone, total, elapsedMin, tokensUsed) {
  total = total || {};
  if (typeof total.items === 'number' && itemsDone >= total.items) return 'items';
  if (typeof total.wallclockMin === 'number' && typeof elapsedMin === 'number' && elapsedMin >= total.wallclockMin) return 'wallclock';
  if (typeof total.tokens === 'number' && typeof tokensUsed === 'number' && tokensUsed >= total.tokens) return 'tokens';
  return null;
}
const HELPERS_SRC = [globToRe, surfaceAllows, verdictOf, shouldStop, withinEditBudget, tokensShrank].map(fn => fn.toString()).join('\n\n');

// --- CLI arg parser (forked from scaffold-optimize.cjs) ---
function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true; // bare flag → true
}

function generate(name) {
  return `// AUTO-GENERATED by scaffold-improve.cjs — do NOT hand-edit. Config is data-in via args.config.
// Restricted conductor: pure JS only — no fs/git/Date.now()/Math.random(); side-effects live in agent() workers.
//
// The run CONFIG (skill, surface, floor, items, budgets, baseline) is passed in via Workflow
// \\\`args.config\\\` at launch — NOT baked here — so a resume re-passes it unchanged (the conductor
// cannot read the filesystem). To change the LOOP STRUCTURE, re-run the generator with --force.
//
// Loop shape (spec §2): Setup → Baseline (floor MUST pass) → fixed-backlog GREEN loop (fix → eval
// floor+check+surface → keep-or-revert with surface-lock → checkpoint) → optional Consolidate
// (opt-in slow/meta pass: compress the skill; kept iff floor + ALL kept checks + surface hold AND
// the skill got strictly smaller) → stop on the FIRST of {items, wallclockMin, tokens}. KEPT
// commits accumulate on improve/<name>; never merged (spec §4).

export const meta = {
  name: '${name}',
  description: 'Skill improver loop: ${name} (feedback backlog → fix → floor+check gate → keep/revert)',
  phases: [ { title: 'Setup' }, { title: 'Baseline' }, { title: 'Items' }, { title: 'Consolidate' } ],
}

// Some Workflow harnesses deliver \`args\` as a JSON STRING; normalize to an object before any read.
if (typeof args === 'string') args = JSON.parse(args)

// ---------------------------------------------------------------------------
// Pure decision helpers — inlined from scaffold-improve.cjs (legal in the restricted layer).
// surfaceAllows(files, editable, locked) — the surface-lock fence (editable minus locked).
// verdictOf(floorPassed, checkPassed, surfaceOk, sizeOk) — binary keep iff all hold (sizeOk optional).
// shouldStop(itemsDone, total, elapsedMin, tokensUsed) — first stop reason or null.
// withinEditBudget(diffLines, maxDiffLines) — the edit-size budget; true when disabled (0/absent).
// tokensShrank(before, after) — consolidation keep-half: the skill got STRICTLY smaller.
// ---------------------------------------------------------------------------
${HELPERS_SRC}

const CONFIG = (args && args.config) ? args.config : null
if (!CONFIG) throw new Error('Missing args.config — launch with { config: <.improve/config/' + '${name}' + '.json> }')
const NAME = '${name}'
const STATE = \`.improve/state/\${NAME}.json\`
const BRANCH = (args && args.branch) ? args.branch : \`improve/\${NAME}\`
const BASELINE = CONFIG.baseline || ''
const WORKTREE = \`.worktrees/improve-\${NAME}\`
const SKILLPATH = CONFIG.skillPath || ''
const EDITABLE = CONFIG.editable || ''
const LOCKED = CONFIG.locked || []
const FLOOR = (CONFIG.floor && CONFIG.floor.cmd) || ''
const ALL_ITEMS = Array.isArray(CONFIG.items) ? CONFIG.items : []
// human-only items (no acceptanceCheck) never enter the autonomous loop — reported, not attempted.
const ITEMS = ALL_ITEMS.filter(it => it && it.acceptanceCheck)
const BUDGETS = CONFIG.budgets || {}
const RETRIES = (typeof BUDGETS.checkRetries === 'number') ? BUDGETS.checkRetries : 2
const AGENTCAP = (typeof BUDGETS.agentCapSec === 'number') ? BUDGETS.agentCapSec : 600
const TOTAL = BUDGETS.total || { items: ITEMS.length }
// Edit-size budget (opt-in): max inserted+deleted lines per fix. 0/absent → unbounded (as before).
const MAXDIFF = (typeof BUDGETS.maxDiffLines === 'number' && BUDGETS.maxDiffLines > 0) ? Math.floor(BUDGETS.maxDiffLines) : 0
// Consolidation pass (opt-in): one slow/meta compress-the-skill pass after the backlog.
const CONSOLIDATE = CONFIG.consolidate === true
// The token-estimate one-liner for the skill entrypoint (words × 4/3, integer). Used by the
// baseline + eval workers so every measurement is the same formula on the same file.
const TOKENS_CMD = \`echo skillTokens=$(( ( $(wc -w < "\${SKILLPATH}/SKILL.md") * 4 + 2 ) / 3 ))\`

// resume: re-passed ledger so the conductor skips already-done items.
const priorItems = (args && Array.isArray(args.items)) ? args.items : []
const ledger = priorItems.slice()
const doneIds = new Set(ledger.map(e => e && e.id))
let itemsDone = ledger.length
const results = {}
if (args && args.baseline && typeof args.baseline === 'object') results.baseline = args.baseline

// Per-worker isolation instruction. \`slot\` makes the notes file UNIQUE so parallel/sequential
// workers never clobber each other (vary by item id, never randomness). Pass { notes: false }
// for mechanical steps (commit/revert/checkpoint) that make no design decision.
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
// Mirrors conductor's checkpoint() exactly, but persists the improver ledger schema (items, not
// experiments; baseline.floorPassed, not best/metric).
async function checkpoint(tag, status) {
  const payload = JSON.stringify(
    {
      name: NAME, status: status || 'running',
      branch: BRANCH, worktree: WORKTREE,
      skill: NAME, skillPath: SKILLPATH,
      baseline: results.baseline || null,
      items: ledger,
    },
    null, 2,
  )
  await agent(
    \`Persist the durable improver ledger to the MAIN repo (do NOT cd into the worktree). Run EXACTLY:

mkdir -p .improve/state
cat > .improve/state/.\${NAME}.payload.json <<'DURABLE_JSON'
\${payload}
DURABLE_JSON
node -e "const fs=require('fs');const f='\${STATE}';const p='.improve/state/.\${NAME}.payload.json';let prev={};try{prev=JSON.parse(fs.readFileSync(f,'utf8'))}catch(e){};const s=JSON.parse(fs.readFileSync(p,'utf8'));const n=new Date().toISOString();s.startedAt=prev.startedAt||n;s.updatedAt=n;s.finishedAt=prev.finishedAt||null;fs.writeFileSync(f,JSON.stringify(s,null,2));fs.unlinkSync(p)"
node -e "JSON.parse(require('fs').readFileSync('\${STATE}','utf8'))" && echo OK

Return whether the file was written and parses.\`,
    { label: \`checkpoint:\${tag}\`, phase: 'Items',
      schema: { type: 'object', additionalProperties: false, required: ['written'], properties: { written: { type: 'boolean' }, path: { type: 'string' } } } },
  )
}

// --- Setup: create/reuse worktree + symlink node_modules (worktrees don't carry it) ---
// Branch is improve/<name> in .worktrees/improve-<name>; main is never touched (spec §4).
phase('Setup')
results.setup = await agent(
  \`Create an isolated git worktree for the improver loop. Run idempotently:

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "ERROR: not a git repo"; exit 1; }
ROOT="\$(git rev-parse --show-toplevel)"
if git worktree list --porcelain | grep -q "/\${WORKTREE}\$"; then
  echo "worktree exists — reusing"
elif git show-ref --verify --quiet "refs/heads/\${BRANCH}"; then
  git worktree add "\${WORKTREE}" "\${BRANCH}"
else
  # Branch from the FRESH remote tip, not a possibly-stale local ref.
  git fetch origin --quiet 2>/dev/null || echo "WARN: git fetch origin failed — using local refs (may be stale)"
  if [ -n "\${BASELINE}" ]; then
    # An explicit baseline MUST carry the frozen evals/ checks, so resolve it to an EXACT commit.
    # Prefer the fresh remote tip when it names an origin branch; otherwise resolve SHAs / tags /
    # local-only branches via rev-parse (which show-ref --verify cannot, as it needs a full refname).
    # NEVER silently fall back to HEAD — that builds the worktree from the wrong commit, so every
    # item is judged against a missing check and reverts / comes back unresolved.
    BASEREF="\${BASELINE}"
    if git show-ref --verify --quiet "refs/remotes/origin/\$BASEREF"; then
      START="origin/\$BASEREF"
    elif START="\$(git rev-parse --verify --quiet "\$BASEREF^{commit}")"; then
      echo "NOTE: baseline '\$BASEREF' resolved to commit \$START (not an origin/ branch)"
    else
      echo "ERROR: baseline '\$BASEREF' is set but cannot be resolved to a commit (tried origin/\$BASEREF and \$BASEREF^{commit}) — refusing to fall back to HEAD"; exit 1
    fi
  else
    # No baseline: branch from the remote default-branch tip; only here may we fall back to HEAD.
    BASEREF="\$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##')"
    if [ -n "\$BASEREF" ] && git show-ref --verify --quiet "refs/remotes/origin/\$BASEREF"; then
      START="origin/\$BASEREF"
    else
      echo "WARN: could not detect remote default branch — branching from current HEAD (may be stale)"; START="HEAD"
    fi
  fi
  echo "Branching \${BRANCH} from \$START"
  git worktree add "\${WORKTREE}" -b "\${BRANCH}" "\$START"
fi
[ -e "\${WORKTREE}/node_modules" ] || [ ! -d "\$ROOT/node_modules" ] || ln -s "\$ROOT/node_modules" "\${WORKTREE}/node_modules"
test -d "\${WORKTREE}" && echo OK\`,
  { label: 'setup:worktree', phase: 'Setup',
    schema: { type: 'object', additionalProperties: false, required: ['ready'], properties: { ready: { type: 'boolean' }, worktree: { type: 'string' }, branch: { type: 'string' } } } },
)

// --- Baseline: the floor MUST pass on the unmodified skill (can't improve a broken skill) ---
phase('Baseline')
if (!(results.baseline && results.baseline.floorPassed)) {
  const base = await agent(
    \`\${inWorktree('baseline', { notes: false })}

BASELINE: run the FLOOR for skill "\${NAME}" on the unmodified worktree — it MUST exit 0:
    \${FLOOR || '(no floor configured — FAIL)'}
Report floorPassed (did it exit 0?) and floorOut (last ~20 lines).
Also report skillTokens — the integer token estimate of the unmodified skill entrypoint, via:
    \${TOKENS_CMD}
Do NOT edit anything.\`,
    { label: 'baseline', phase: 'Baseline',
      schema: { type: 'object', additionalProperties: false, required: ['floorPassed'],
        properties: { floorPassed: { type: 'boolean' }, floorOut: { type: 'string' }, skillTokens: { type: 'number' } } } })
  if (!base || !base.floorPassed) throw new Error('Baseline floor failed — cannot improve a skill whose floor is red: ' + ((base && base.floorOut) || ''))
  results.baseline = { floorPassed: true, skillTokens: (typeof base.skillTokens === 'number' && isFinite(base.skillTokens)) ? base.skillTokens : null }
  await checkpoint('baseline')
}

// --- Items: per frozen, discrimination-passed item, GREEN against its check ---
phase('Items')
for (let i = 0; i < ITEMS.length; i++) {
  const item = ITEMS[i]
  if (doneIds.has(item.id)) continue                     // resume: skip completed items
  const stop = shouldStop(itemsDone, TOTAL, (args && args.elapsedMin), (args && args.tokensUsed))
  if (stop) { log(\`Stopping: \${stop} budget reached (itemsDone=\${itemsDone})\`); break }

  // (a) FIX (GREEN) — bounded; edit ONLY the editable surface to turn the FROZEN check green. Retry ≤ RETRIES.
  // With an edit-size budget configured, tell the fixer up front — an oversized diff is a revert.
  const sizeNote = MAXDIFF ? \`Keep the edit SMALL: total inserted+deleted lines must be ≤ \${MAXDIFF} (the edit-size budget) or the item is REVERTED — prefer the smallest change that turns the check green.
\` : ''
  const fix = await agent(
    \`\${inWorktree(\`fix-\${item.id}\`)}

FIX item "\${item.id}" (\${item.type}): \${item.text}
Edit ONLY files in the editable surface \${EDITABLE} (NEVER touch \${JSON.stringify(LOCKED)} — that is locked).
\${sizeNote}Make the item's FROZEN acceptance-check pass:
    \${item.acceptanceCheck}
You have a soft budget of \${AGENTCAP}s and up to \${RETRIES + 1} attempts; re-run the check yourself and iterate.
Do NOT edit the check, any evals/ file, or the backlog. Do NOT commit — the eval step decides keep/revert.
Describe your fix in one line as \\\`change\\\`.\`,
    { label: \`fix:\${item.id}\`, phase: 'Items',
      schema: { type: 'object', additionalProperties: false, required: ['change'],
        properties: { change: { type: 'string' }, summary: { type: 'string' } } } })
  const change = (fix && fix.change) || '(no change)'

  // (b) EVAL — floor + the item's check + surface diff (worker measures only; conductor decides).
  const evalRes = await agent(
    \`\${inWorktree(\`eval-\${item.id}\`, { notes: false })}

EVAL item "\${item.id}" — measure, do NOT commit/revert:
1. FLOOR (must still pass): \${FLOOR}  → report floorPassed (exit 0?).
2. ACCEPTANCE CHECK: \${item.acceptanceCheck}  → report checkPassed (exit 0?).
3. SURFACE: report diffFiles = EVERY changed path incl. untracked, via:
       git -c core.quotepath=false status --porcelain --untracked-files=all
   (the path after the 2-char status; for \\\`R old -> new\\\` the NEW path).
4. EDIT SIZE: report diffLines = total inserted+deleted lines INCLUDING new untracked files, via:
       git add -AN && git -c core.quotepath=false diff --numstat HEAD | awk '{i=($1=="-")?0:$1; d=($2=="-")?0:$2; s+=i+d} END{print s+0}' && git reset -q
5. SKILL SIZE: report skillTokens — the integer token estimate of the skill entrypoint, via:
       \${TOKENS_CMD}\`,
    { label: \`eval:\${item.id}\`, phase: 'Items',
      schema: { type: 'object', additionalProperties: false, required: ['floorPassed','checkPassed','diffFiles'],
        properties: { floorPassed: { type: 'boolean' }, checkPassed: { type: 'boolean' },
          diffFiles: { type: 'array', items: { type: 'string' } }, diffLines: { type: 'number' },
          skillTokens: { type: 'number' }, summary: { type: 'string' } } } })

  const floorPassed = !!(evalRes && evalRes.floorPassed)
  const checkPassed = !!(evalRes && evalRes.checkPassed)
  const diffFiles = (evalRes && Array.isArray(evalRes.diffFiles)) ? evalRes.diffFiles : []
  const diffLines = (evalRes && typeof evalRes.diffLines === 'number' && isFinite(evalRes.diffLines)) ? evalRes.diffLines : null
  const skillTokens = (evalRes && typeof evalRes.skillTokens === 'number' && isFinite(evalRes.skillTokens)) ? evalRes.skillTokens : null
  const surfaceOk = surfaceAllows(diffFiles, EDITABLE, LOCKED)
  const sizeOk = withinEditBudget(diffLines, MAXDIFF)
  const verdict = verdictOf(floorPassed, checkPassed, surfaceOk, sizeOk)

  let sha = null
  if (verdict === 'kept') {
    const c = await agent(
      \`\${inWorktree(\`keep-\${item.id}\`, { notes: false })}
KEEP item "\${item.id}": floor + check passed and surface-lock confirmed every change ⊆ the surface.
    git add -A && git commit -m "whetstone(\${NAME}) \${item.id}: \${change}"
Report the commit \\\`sha\\\`. Do not push or merge.\`,
      { label: \`keep:\${item.id}\`, phase: 'Items',
        schema: { type: 'object', additionalProperties: false, required: ['sha'], properties: { sha: { type: 'string' } } } })
    sha = (c && c.sha) || null
  } else {
    await agent(
      \`\${inWorktree(\`revert-\${item.id}\`, { notes: false })}
REVERT item "\${item.id}" (\${!floorPassed ? 'floor broke' : !surfaceOk ? 'touched a locked/out-of-surface file' : !sizeOk ? 'diff exceeded the maxDiffLines edit budget' : 'check did not pass'}).
Reset the WHOLE worktree so it is clean for the next item (prior KEPT commits stay on \${BRANCH}):
    git reset --hard HEAD && git clean -fd
Confirm \\\`git status --porcelain\\\` is empty; report clean.\`,
      { label: \`revert:\${item.id}\`, phase: 'Items',
        schema: { type: 'object', additionalProperties: false, required: ['clean'], properties: { clean: { type: 'boolean' } } } })
  }

  // unresolved = well-behaved fix (floor + surface + size all held) whose check never went green;
  // an over-budget diff is a REVERT (the loop misbehaved), not an unresolved concern.
  const finalVerdict = (verdict === 'kept') ? 'kept' : (floorPassed && surfaceOk && sizeOk && !checkPassed ? 'unresolved' : 'reverted')
  ledger.push({ id: item.id, type: item.type, change, floor: floorPassed ? 'pass' : 'fail', check: checkPassed ? 'pass' : 'fail', verdict: finalVerdict, sha, diffLines, skillTokens })
  itemsDone = ledger.length
  await checkpoint(\`item-\${item.id}\`)
}

// --- Consolidate (opt-in, SkillOpt-style "slow/meta update"): the backlog only ever ADDS text —
// this one bounded compress/dedupe pass fights that accretion. KEPT iff the floor passes AND every
// check a KEPT item turned green THIS RUN is still green AND the surface-lock holds AND the skill
// entrypoint got STRICTLY smaller (tokensShrank). The per-item maxDiffLines budget deliberately
// does NOT apply here — the strict-shrink requirement is this pass's own bound.
phase('Consolidate')
const keptChecks = ITEMS.filter(it => ledger.some(e => e && e.id === it.id && e.verdict === 'kept')).map(it => it.acceptanceCheck)
let tokensBefore = (results.baseline && typeof results.baseline.skillTokens === 'number' && isFinite(results.baseline.skillTokens)) ? results.baseline.skillTokens : null
for (let i = ledger.length - 1; i >= 0; i--) { const t = ledger[i] && ledger[i].skillTokens; if (typeof t === 'number' && isFinite(t)) { tokensBefore = t; break } }
if (!CONSOLIDATE) { /* not requested (config.consolidate !== true) — the run ends after the backlog as before */ }
else if (doneIds.has('__consolidate')) { log('Consolidate: already recorded in the ledger (resume) — skipping') }
else if (!keptChecks.length) { log('Consolidate: no KEPT items this run — nothing to consolidate') }
else if (tokensBefore == null) { log('Consolidate: no skillTokens measurement available — cannot prove a shrink, skipping') }
else {
  const cfix = await agent(
    \`\${inWorktree('fix-consolidate')}

CONSOLIDATE the skill (a slow/meta pass): the kept fixes above each ADDED text. Compress, dedupe,
and reorganize the skill WITHOUT changing behavior — merge overlapping guidance, remove repetition,
tighten wording. Edit ONLY files in the editable surface \${EDITABLE} (NEVER touch
\${JSON.stringify(LOCKED)} — that is locked).
Every check that is currently green MUST STAY green:
\${keptChecks.map(c => '    ' + c).join('\\n')}
and the floor must stay green: \${FLOOR}
This pass is KEPT only if the skill entrypoint gets STRICTLY smaller (current estimate:
\${tokensBefore} tokens) — if you cannot shrink it without changing behavior, make NO edit and say so.
You have a soft budget of \${AGENTCAP}s. Do NOT commit — the eval step decides keep/revert.
Describe your consolidation in one line as \\\`change\\\`.\`,
    { label: 'fix:consolidate', phase: 'Consolidate',
      schema: { type: 'object', additionalProperties: false, required: ['change'],
        properties: { change: { type: 'string' }, summary: { type: 'string' } } } })
  const cchange = (cfix && cfix.change) || '(no change)'

  const ceval = await agent(
    \`\${inWorktree('eval-consolidate', { notes: false })}

EVAL the consolidation pass — measure, do NOT commit/revert:
1. FLOOR (must still pass): \${FLOOR}  → report floorPassed (exit 0?).
2. EVERY KEPT CHECK (run each; checksPassed = ALL exited 0):
\${keptChecks.map(c => '    ' + c).join('\\n')}
3. SURFACE: report diffFiles = EVERY changed path incl. untracked, via:
       git -c core.quotepath=false status --porcelain --untracked-files=all
4. SKILL SIZE: report skillTokens — the integer token estimate of the skill entrypoint, via:
       \${TOKENS_CMD}\`,
    { label: 'eval:consolidate', phase: 'Consolidate',
      schema: { type: 'object', additionalProperties: false, required: ['floorPassed','checksPassed','diffFiles'],
        properties: { floorPassed: { type: 'boolean' }, checksPassed: { type: 'boolean' },
          diffFiles: { type: 'array', items: { type: 'string' } }, skillTokens: { type: 'number' }, summary: { type: 'string' } } } })

  const cFloor = !!(ceval && ceval.floorPassed)
  const cChecks = !!(ceval && ceval.checksPassed)
  const cFiles = (ceval && Array.isArray(ceval.diffFiles)) ? ceval.diffFiles : []
  const cTokens = (ceval && typeof ceval.skillTokens === 'number' && isFinite(ceval.skillTokens)) ? ceval.skillTokens : null
  const cSurfaceOk = surfaceAllows(cFiles, EDITABLE, LOCKED)
  const cKeep = verdictOf(cFloor, cChecks, cSurfaceOk) === 'kept' && tokensShrank(tokensBefore, cTokens)

  let csha = null
  if (cKeep) {
    const cc = await agent(
      \`\${inWorktree('keep-consolidate', { notes: false })}
KEEP the consolidation pass: floor + every kept check passed, surface-lock held, and the skill
shrank (\${tokensBefore} → \${cTokens} tokens).
    git add -A && git commit -m "whetstone(\${NAME}) consolidate: \${cchange}"
Report the commit \\\`sha\\\`. Do not push or merge.\`,
      { label: 'keep:consolidate', phase: 'Consolidate',
        schema: { type: 'object', additionalProperties: false, required: ['sha'], properties: { sha: { type: 'string' } } } })
    csha = (cc && cc.sha) || null
  } else {
    await agent(
      \`\${inWorktree('revert-consolidate', { notes: false })}
REVERT the consolidation pass (\${!cFloor ? 'floor broke' : !cChecks ? 'a kept check went red' : !cSurfaceOk ? 'touched a locked/out-of-surface file' : 'the skill did not get strictly smaller'}).
Reset the WHOLE worktree so it is clean (prior KEPT commits stay on \${BRANCH}):
    git reset --hard HEAD && git clean -fd
Confirm \\\`git status --porcelain\\\` is empty; report clean.\`,
      { label: 'revert:consolidate', phase: 'Consolidate',
        schema: { type: 'object', additionalProperties: false, required: ['clean'], properties: { clean: { type: 'boolean' } } } })
  }

  ledger.push({ id: '__consolidate', type: 'consolidate', change: cchange,
    floor: cFloor ? 'pass' : 'fail', check: cChecks ? 'pass' : 'fail',
    verdict: cKeep ? 'kept' : 'reverted', sha: csha, diffLines: null, skillTokens: cTokens })
  itemsDone = ledger.length
  await checkpoint('consolidate')
}

return { workflow: NAME, status: 'complete', branch: BRANCH, worktree: WORKTREE,
  skill: NAME, humanOnly: ALL_ITEMS.filter(it => !it.acceptanceCheck).map(it => it.id),
  itemsDone, items: ledger }
`;
}

module.exports = { surfaceAllows, verdictOf, shouldStop, withinEditBudget, tokensShrank, generate };

// --- CLI entry (skip when require()'d by the test net; forked from scaffold-optimize.cjs) ---
if (require.main === module) {
  const name = arg('name');
  if (!name || name === true) { console.error('ERROR: --name <slug> is required'); process.exit(1); }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) { console.error('ERROR: --name must be a kebab slug (a-z0-9-)'); process.exit(1); }
  const out = arg('out', path.join('.improve', name + '.js'));
  const force = arg('force', false) === true;
  if (fs.existsSync(out) && !force) { console.error(`ERROR: ${out} exists (use --force to overwrite)`); process.exit(1); }

  const src = generate(name);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, src);
  console.log(`Generated ${out}`);
  console.log('Phases: Setup → Baseline → Items → Consolidate (opt-in via config.consolidate)');
  console.log('Launch via the Workflow tool with args.config = the approved .improve/config/' + name + '.json (config is data-in, NOT baked).');
}
