# whetstone v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `whetstone` — an overnight, feedback-driven, eval-gated skill improver that works a backlog of concerns through a deterministic floor + per-item acceptance-check, keeping only changes a check confirms, on a branch that is never auto-merged.

**Architecture:** Fork prospector's two-layer Workflow loop (restricted JS conductor + full-tool workers, durable ledger, worktree isolation, surface-lock, resume). Replace prospector's *scalar hill-climb* with a *fixed-backlog GREEN loop*: per item, a `fixer` edits the skill to turn a **frozen, human-confirmed, baseline-failing acceptance-check** green; the conductor keeps iff the **floor** holds AND the **check** passes AND the **surface lock** (editable = skill minus `evals/**` + backlog) holds.

**Tech Stack:** Node ≥18 (CommonJS `.cjs` generators, ESM `.mjs` validators), the Workflow tool, Python 3 (`quick_validate.py` floor), git worktrees.

## Global Constraints

- **Restricted conductor layer:** the generated loop `.js` is pure JS — NO `fs`/`git`/`require`/`Date.now()`/`new Date()`/`Math.random()`. Every side-effect lives in an `agent()` worker prompt. (Verbatim from spec §2; enforced by `test-improve.cjs` no-fs scan.)
- **Trust boundary (spec §3, §7):** a change is auto-KEPT **iff** floor passes AND the item's acceptance-check passes AND surface-lock holds. The `fixer` may never edit any check/fixture/floor — `evals/**` and the backlog are **locked**. Checks are authored at **setup**, pass the **discrimination gate** (fail on baseline), are **human-confirmed**, and **frozen** before the unattended run.
- **Never auto-merge.** The run leaves branch `improve/<skill>` + a report; the human reviews and merges. `main` is byte-unchanged.
- **Resolved decisions:** check-retry `N` = 2; backlog format = `jsonl`; runtime check-authoring deferred to v2.
- **Reuse, don't reinvent:** fork prospector's `scaffold-optimize.cjs`/`list-optimizations.cjs`/`optimize-report.cjs`/`test-optimize.cjs`; floor uses skill-creator's `quick_validate.py`; check-drafter is the `lirbox-test-writer` agent.
- **First target:** `flowchart` (`plugins/lirbox/skills/flowchart`).
- **Paths:** skill at `plugins/lirbox/skills/whetstone/`; runtime namespace `.improve/{config,state,reports}/<skill>.json` + loop `.improve/<skill>.js` (main repo, git-ignored); branch `improve/<skill>`; worktree `.worktrees/improve-<skill>`; backlog `feedback/<skill>.jsonl`.

---

## File Structure

```
plugins/lirbox/skills/whetstone/
├── SKILL.md                       # list/resume/new-run resolution, setup (RED-draft+confirm+freeze), launch, finalize
├── references/
│   ├── loop-runtime.md            # two-layer model, ledger schema, keep/revert, surface-lock, resume (adapted from prospector)
│   └── checks.md                  # acceptance-check derivation, the discrimination gate, the floor, locked-set rules
└── scripts/
    ├── scaffold-improve.cjs       # generator → the loop conductor (fork of scaffold-optimize.cjs)
    ├── check-baseline.cjs         # discrimination-gate helper: assert a proposed check FAILS on the baseline skill
    ├── list-improvements.cjs      # list runs from .improve/state/ (fork of list-optimizations.cjs)
    ├── improve-report.cjs         # baseline→verdicts report (fork of optimize-report.cjs)
    └── test-improve.cjs           # regression net: helpers unit + generator structure + no-fs scan (fork of test-optimize.cjs)

plugins/lirbox/skills/flowchart/
└── evals/                         # NEW: the locked floor+goalposts for the dogfood run
    ├── run.mjs                    # runs every *.test.mjs, exit 0 iff all pass (the floor command)
    ├── fixtures/                  # golden + concern fixtures (locked)
    └── *.test.mjs                 # characterization tests (floor) + per-item acceptance-checks
```

**Decomposition rationale:** `scaffold-improve.cjs` owns all loop boilerplate (one responsibility: emit the conductor). The pure decision helpers live there too (exported for unit test, inlined into the emitted loop — prospector's `HELPERS_SRC` pattern). The floor for a target skill lives *with that skill* (`flowchart/evals/`), not in whetstone — whetstone is target-agnostic.

## prospector → whetstone delta map (apply when forking)

| prospector concept | whetstone replacement |
|---|---|
| `surface` (one glob) | `editable` glob **minus** `locked` globs (`evals/**`, backlog) |
| `metric` {cmd,parse,direction} + `best` hill-climb | per-item `acceptanceCheck` (a command; exit 0 = pass). **No `best`, no `isBetter`** — binary keep |
| `gate` {cmd} | `floor` {cmd} = `quick_validate.py <skill>` + `node <skill>/evals/run.mjs` |
| `MAXEXP` blind experiments | iterate the **fixed** `CONFIG.items` backlog (already discrimination-passed + frozen) |
| baseline = measure scalar | baseline = **floor must pass on the unmodified skill** (abort if red) |
| propose (hill-climb vs best) | `fixer` (turn the item's frozen check green; retry ≤ `N`=2) |
| keep iff gate∧betterMetric∧surfaceOk | keep iff floor∧checkPassed∧surfaceOk |
| `experiments[]` {metric,kept} | `items[]` {id, verdict: kept\|reverted\|unresolved} |
| plateau stop | none (backlog is finite); keep wallclock/tokens stop for overnight safety |

---

### Task 1: Pure decision helpers in `scaffold-improve.cjs`

**Files:**
- Create: `plugins/lirbox/skills/whetstone/scripts/scaffold-improve.cjs`
- Test: `plugins/lirbox/skills/whetstone/scripts/test-improve.cjs`

**Interfaces:**
- Produces (exported from `scaffold-improve.cjs`, also inlined into the emitted loop):
  - `surfaceAllows(files: string[], editable: string, locked: string[]): boolean` — true iff `files` is non-empty AND every file matches an `editable` glob AND no file matches any `locked` glob.
  - `verdictOf(floorPassed: boolean, checkPassed: boolean, surfaceOk: boolean): 'kept' | 'reverted'` — `'kept'` iff all three true.
  - `shouldStop(itemsDone: number, total: {items?:number, wallclockMin?:number, tokens?:number}, elapsedMin?: number, tokensUsed?: number): string | null` — first stop reason or null.
  - `generate(name: string): string` (Task 2).

- [ ] **Step 1: Write the failing unit tests**

Create `test-improve.cjs` with this Part-3 helper suite (fork the harness shape from `prospector/scripts/test-optimize.cjs` lines 33-35, 142-145, 206-212; replace the helper tests with these):

```js
const path = require('path');
const GEN = path.join(__dirname, 'scaffold-improve.cjs');
const { surfaceAllows, verdictOf, shouldStop } = require(GEN);

let failures = 0;
function fail(m){ console.error(`FAIL ${m}`); failures++; }
function eq(a, e, m){ if (a===e){ console.log(`PASS unit: ${m}`); return; } fail(`unit: ${m} — expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`); }

const ED = 'plugins/lirbox/skills/flowchart/**';
const LK = ['plugins/lirbox/skills/flowchart/evals/**', 'feedback/flowchart.jsonl'];
// in-surface edit → ok
eq(surfaceAllows(['plugins/lirbox/skills/flowchart/assets/validate.mjs'], ED, LK), true, 'editable file allowed');
// touches a locked test → blocked (the anti-gaming fence)
eq(surfaceAllows(['plugins/lirbox/skills/flowchart/evals/node-nonascii.test.mjs'], ED, LK), false, 'locked evals/ file blocked');
// touches the backlog → blocked
eq(surfaceAllows(['feedback/flowchart.jsonl'], ED, LK), false, 'locked backlog blocked');
// outside the skill entirely → blocked
eq(surfaceAllows(['plugins/lirbox/skills/conductor/SKILL.md'], ED, LK), false, 'out-of-skill file blocked');
// empty diff → blocked (a fix must change something)
eq(surfaceAllows([], ED, LK), false, 'empty diff blocked');
// mixed (one good, one locked) → blocked (ALL must pass)
eq(surfaceAllows(['plugins/lirbox/skills/flowchart/SKILL.md','plugins/lirbox/skills/flowchart/evals/x.test.mjs'], ED, LK), false, 'any locked file blocks the whole set');

eq(verdictOf(true,  true,  true ), 'kept',     'verdict: all green → kept');
eq(verdictOf(false, true,  true ), 'reverted', 'verdict: floor broke → reverted');
eq(verdictOf(true,  false, true ), 'reverted', 'verdict: check failed → reverted');
eq(verdictOf(true,  true,  false), 'reverted', 'verdict: surface violated → reverted');

eq(shouldStop(3, { items: 3 }), 'items',     'stop: all items done');
eq(shouldStop(2, { items: 3 }), null,        'stop: items remain → continue');
eq(shouldStop(0, { wallclockMin: 60 }, 60),  'wallclock', 'stop: wallclock hit');
eq(shouldStop(0, { wallclockMin: 60 }, 59),  null,        'stop: under wallclock → continue');
eq(shouldStop(0, { tokens: 1000 }, undefined, 1000), 'tokens', 'stop: tokens hit');
eq(shouldStop(0, {}, undefined, undefined),  null,        'stop: no budget → never');

if (failures) { console.error(`\n${failures} check(s) FAILED`); process.exit(1); }
console.log(`\nAll helper checks passed.`);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node plugins/lirbox/skills/whetstone/scripts/test-improve.cjs`
Expected: FAIL — `Cannot find module '.../scaffold-improve.cjs'`.

- [ ] **Step 3: Write the helpers + exports**

Create `scaffold-improve.cjs` starting with the header comment (adapt prospector's lines 1-28), then these helpers. Port `surfaceAllows`'s glob→regex core verbatim from `scaffold-optimize.cjs` lines 458-481 (the `toRe` matcher), adding the `locked` exclusion:

```js
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
function verdictOf(floorPassed, checkPassed, surfaceOk) {
  return (floorPassed && checkPassed && surfaceOk) ? 'kept' : 'reverted';
}
function shouldStop(itemsDone, total, elapsedMin, tokensUsed) {
  total = total || {};
  if (typeof total.items === 'number' && itemsDone >= total.items) return 'items';
  if (typeof total.wallclockMin === 'number' && typeof elapsedMin === 'number' && elapsedMin >= total.wallclockMin) return 'wallclock';
  if (typeof total.tokens === 'number' && typeof tokensUsed === 'number' && tokensUsed >= total.tokens) return 'tokens';
  return null;
}
const HELPERS_SRC = [globToRe, surfaceAllows, verdictOf, shouldStop].map(fn => fn.toString()).join('\n\n');

module.exports = { surfaceAllows, verdictOf, shouldStop, generate };
```

Add a temporary `function generate(){ return ''; }` stub so the module loads (Task 2 fills it).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node plugins/lirbox/skills/whetstone/scripts/test-improve.cjs`
Expected: PASS — all helper checks pass.

- [ ] **Step 5: Commit**

```bash
git add plugins/lirbox/skills/whetstone/scripts/scaffold-improve.cjs plugins/lirbox/skills/whetstone/scripts/test-improve.cjs
git commit -m "feat(whetstone): pure decision helpers (surfaceAllows+locked, verdictOf, shouldStop) + unit net"
```

---

### Task 2: `generate(name)` — emit the backlog GREEN loop

**Files:**
- Modify: `plugins/lirbox/skills/whetstone/scripts/scaffold-improve.cjs` (replace the `generate` stub)
- Modify: `plugins/lirbox/skills/whetstone/scripts/test-improve.cjs` (add structure + no-fs scan)

**Interfaces:**
- Consumes: `HELPERS_SRC` (Task 1).
- Produces: `generate(name)` returns the loop `.js` source. The emitted loop reads `args.config` = `.improve/config/<skill>.json` with shape `{ skill, skillPath, editable, locked[], floor:{cmd}, items:[{id,type,text,acceptanceCheck}], budgets:{agentCapSec,checkRetries,total}, baseline }`. CLI: `node scaffold-improve.cjs --name <skill> [--out <path>] [--force]`, prints `Phases: Setup → Baseline → Items`.

- [ ] **Step 1: Write the failing structure tests**

Add Part-1/2 to `test-improve.cjs` (fork `test-optimize.cjs` lines 96-136; reuse its `conductorBody`/`FORBIDDEN` scan verbatim, lines 80-94). Replace the REQUIRED markers with:

```js
const { execFileSync } = require('child_process');
const fs = require('fs'); const os = require('os');
const REQUIRED = [
  ['Setup phase',            /phase\('Setup'\)/],
  ['Baseline phase',         /phase\('Baseline'\)/],
  ['Items phase',            /phase\('Items'\)/],
  ['item loop',              /for \(let i = 0; i < ITEMS\.length; i\+\+\)/],
  ['baseline floor-must-pass', /Baseline floor failed — cannot improve a skill whose floor is red/],
  ['fixer worker',           /label: `fix:\$\{item\.id\}/],
  ['fixer retry bound',      /RETRIES/],
  ['eval worker',            /label: `eval:\$\{item\.id\}/],
  ['surface-lock untracked', /status --porcelain --untracked-files=all/],
  ['keep-or-revert decision',/verdictOf\(floorPassed, checkPassed, surfaceOk\)/],
  ['keep commits on branch', /git commit -m "whetstone\(/],
  ['revert resets worktree', /git reset --hard HEAD/],
  ['revert cleans untracked',/git clean -fd\b/],
  ['checkpoint worker',      /async function checkpoint\(/],
  ['surface-lock helper',    /function surfaceAllows\(files, editable, locked\)/],
  ['stop check',             /const stop = shouldStop\(/],
  ['finalize return',        /status: 'complete'/],
];
// ... fork the per-slug loop (test-optimize lines 96-136): generate with --name flowchart,
//     node --check, assert every REQUIRED marker, run conductorBody()+FORBIDDEN no-fs scan,
//     assert /^Phases: Setup → Baseline → Items/m in stdout.
```

- [ ] **Step 2: Run to verify it fails**

Run: `node plugins/lirbox/skills/whetstone/scripts/test-improve.cjs`
Expected: FAIL — structure markers missing (generate returns `''`).

- [ ] **Step 3: Implement `generate(name)`**

Replace the stub. Keep these prospector pieces **verbatim** (adapting only the noted names): the `inWorktree(slot,opts)` notes helper (lines 189-198), the `checkpoint()` worker (lines 203-229) — change `.optimize`→`.improve`, persist `items` instead of `experiments`, drop `best`/`baseline.metric` (keep `baseline.floorPassed`), and the Setup worktree worker (lines 233-265) — change `opt/`→`improve/`, `.worktrees/opt-`→`.worktrees/improve-`. Then emit this loop body (the genuinely-new part):

```js
function generate(name) {
  return `// AUTO-GENERATED by scaffold-improve.cjs — do NOT hand-edit. Config is data-in via args.config.
// Restricted conductor: pure JS only — no fs/git/Date.now()/Math.random(); side-effects live in agent() workers.

export const meta = {
  name: '${name}',
  description: 'Skill improver loop: ${name} (feedback backlog → fix → floor+check gate → keep/revert)',
  phases: [ { title: 'Setup' }, { title: 'Baseline' }, { title: 'Items' } ],
}

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

// resume: re-passed ledger so the conductor skips already-done items.
const priorItems = (args && Array.isArray(args.items)) ? args.items : []
const ledger = priorItems.slice()
const doneIds = new Set(ledger.map(e => e && e.id))
let itemsDone = ledger.length
const results = {}
if (args && args.baseline && typeof args.baseline === 'object') results.baseline = args.baseline

// ${'inWorktree'}, ${'checkpoint'} — forked verbatim from scaffold-optimize.cjs (see Task 2 note).
${'/* INLINE: inWorktree(slot,opts) from prospector lines 189-198 */'}
${'/* INLINE: checkpoint(tag,status) from prospector lines 203-229, persisting {name,status,branch,worktree,skill:NAME,skillPath:SKILLPATH,baseline:results.baseline||null,items:ledger} */'}

// --- Setup: create/reuse worktree (forked verbatim, opt/→improve/) ---
phase('Setup')
${'/* INLINE: Setup worker from prospector lines 233-265 */'}

// --- Baseline: the floor MUST pass on the unmodified skill (can't improve a broken skill) ---
phase('Baseline')
if (!(results.baseline && results.baseline.floorPassed)) {
  const base = await agent(
    \`\${inWorktree('baseline', { notes: false })}

BASELINE: run the FLOOR for skill "\${NAME}" on the unmodified worktree — it MUST exit 0:
    \${FLOOR || '(no floor configured — FAIL)'}
Report floorPassed (did it exit 0?) and floorOut (last ~20 lines). Do NOT edit anything.\`,
    { label: 'baseline', phase: 'Baseline',
      schema: { type: 'object', additionalProperties: false, required: ['floorPassed'],
        properties: { floorPassed: { type: 'boolean' }, floorOut: { type: 'string' } } } })
  if (!base || !base.floorPassed) throw new Error('Baseline floor failed — cannot improve a skill whose floor is red: ' + ((base && base.floorOut) || ''))
  results.baseline = { floorPassed: true }
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
  const fix = await agent(
    \`\${inWorktree(\`fix-\${item.id}\`)}

FIX item "\${item.id}" (\${item.type}): \${item.text}
Edit ONLY files in the editable surface \${EDITABLE} (NEVER touch \${JSON.stringify(LOCKED)} — that is locked).
Make the item's FROZEN acceptance-check pass:
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
   (the path after the 2-char status; for \\\`R old -> new\\\` the NEW path).\`,
    { label: \`eval:\${item.id}\`, phase: 'Items',
      schema: { type: 'object', additionalProperties: false, required: ['floorPassed','checkPassed','diffFiles'],
        properties: { floorPassed: { type: 'boolean' }, checkPassed: { type: 'boolean' },
          diffFiles: { type: 'array', items: { type: 'string' } }, summary: { type: 'string' } } } })

  const floorPassed = !!(evalRes && evalRes.floorPassed)
  const checkPassed = !!(evalRes && evalRes.checkPassed)
  const diffFiles = (evalRes && Array.isArray(evalRes.diffFiles)) ? evalRes.diffFiles : []
  const surfaceOk = surfaceAllows(diffFiles, EDITABLE, LOCKED)
  const verdict = verdictOf(floorPassed, checkPassed, surfaceOk)

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
REVERT item "\${item.id}" (\${!floorPassed ? 'floor broke' : !surfaceOk ? 'touched a locked/out-of-surface file' : 'check did not pass'}).
Reset the WHOLE worktree so it is clean for the next item (prior KEPT commits stay on \${BRANCH}):
    git reset --hard HEAD && git clean -fd
Confirm \\\`git status --porcelain\\\` is empty; report clean.\`,
      { label: \`revert:\${item.id}\`, phase: 'Items',
        schema: { type: 'object', additionalProperties: false, required: ['clean'], properties: { clean: { type: 'boolean' } } } })
  }

  const finalVerdict = (verdict === 'kept') ? 'kept' : (floorPassed && surfaceOk && !checkPassed ? 'unresolved' : 'reverted')
  ledger.push({ id: item.id, type: item.type, change, floor: floorPassed ? 'pass' : 'fail', check: checkPassed ? 'pass' : 'fail', verdict: finalVerdict, sha })
  itemsDone = ledger.length
  await checkpoint(\`item-\${item.id}\`)
}

return { workflow: NAME, status: 'complete', branch: BRANCH, worktree: WORKTREE,
  skill: NAME, humanOnly: ALL_ITEMS.filter(it => !it.acceptanceCheck).map(it => it.id),
  itemsDone, items: ledger }

${'/* INLINE: surfaceAllows/verdictOf/shouldStop/globToRe already inlined above via HELPERS_SRC */'}
`;
}
```

Then add the CLI entry (fork prospector lines 491-506): require `--name` kebab, default `--out` = `.improve/<name>.js`, `--force`, write, print `Phases: Setup → Baseline → Items`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node plugins/lirbox/skills/whetstone/scripts/test-improve.cjs`
Expected: PASS — all structure markers present, no-fs scan clean, helper suite still green.

- [ ] **Step 5: Sanity-generate + parse**

Run: `node plugins/lirbox/skills/whetstone/scripts/scaffold-improve.cjs --name flowchart --out /tmp/wh.js --force && node --check /tmp/wh.js && echo OK`
Expected: prints `Phases: Setup → Baseline → Items`, then `OK`.

- [ ] **Step 6: Commit**

```bash
git add plugins/lirbox/skills/whetstone/scripts/scaffold-improve.cjs plugins/lirbox/skills/whetstone/scripts/test-improve.cjs
git commit -m "feat(whetstone): generate() emits the backlog fix→floor+check→keep/revert loop"
```

---

### Task 3: `check-baseline.cjs` — the discrimination gate helper

**Files:**
- Create: `plugins/lirbox/skills/whetstone/scripts/check-baseline.cjs`
- Test: extend `test-improve.cjs` with a discrimination case.

**Interfaces:**
- Produces: CLI `node check-baseline.cjs <acceptanceCheckCmd>` run from a **clean baseline worktree** — exit **0** iff the check **fails** (non-zero) there (good: discriminating), exit **1** iff the check passes on baseline (bad: non-discriminating, reject) or errors ambiguously. Prints `DISCRIMINATING` / `NON-DISCRIMINATING`.

- [ ] **Step 1: Write the failing test**

Add to `test-improve.cjs`:

```js
const cb = path.join(__dirname, 'check-baseline.cjs');
function run(cmd){ try { execFileSync('node', [cb, cmd], { stdio: 'pipe' }); return 0; } catch(e){ return e.status || 1; } }
eq(run('exit 1'), 0, 'check-baseline: a check that FAILS on baseline is discriminating (exit 0)');
eq(run('true'),   1, 'check-baseline: a check that PASSES on baseline is non-discriminating (exit 1)');
```

- [ ] **Step 2: Run to verify it fails**

Run: `node plugins/lirbox/skills/whetstone/scripts/test-improve.cjs`
Expected: FAIL — `Cannot find module '.../check-baseline.cjs'`.

- [ ] **Step 3: Implement**

```js
#!/usr/bin/env node
// Discrimination gate: a legitimate acceptance-check must FAIL on the unmodified baseline
// (fail-before / pass-after). Run from a clean baseline worktree. Exit 0 iff the check fails there.
const { execSync } = require('child_process');
const cmd = process.argv.slice(2).join(' ');
if (!cmd) { console.error('usage: check-baseline.cjs <acceptance-check command>'); process.exit(2); }
let passed;
try { execSync(cmd, { stdio: 'ignore' }); passed = true; } catch { passed = false; }
if (passed) { console.error('NON-DISCRIMINATING: check passes on the baseline — it proves nothing. Reject/strengthen it.'); process.exit(1); }
console.log('DISCRIMINATING: check fails on baseline as required.'); process.exit(0);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node plugins/lirbox/skills/whetstone/scripts/test-improve.cjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/lirbox/skills/whetstone/scripts/check-baseline.cjs plugins/lirbox/skills/whetstone/scripts/test-improve.cjs
git commit -m "feat(whetstone): check-baseline.cjs discrimination gate (fail-before/pass-after)"
```

---

### Task 4: `list-improvements.cjs` + `improve-report.cjs`

**Files:**
- Create: `plugins/lirbox/skills/whetstone/scripts/list-improvements.cjs`
- Create: `plugins/lirbox/skills/whetstone/scripts/improve-report.cjs`
- Test: extend `test-improve.cjs` to run both against a fixture state file.

**Interfaces:**
- `list-improvements.cjs [--all]` — columns NAME / STATUS / ITEMS / KEPT / UNRESOLVED / DURATION from `.improve/state/*.json`.
- `improve-report.cjs <skill>` — writes `.improve/reports/<skill>.md`: per-item verdict table + counts (kept/reverted/unresolved/human-only) + branch/worktree + `git diff <baseline>..improve/<skill>` pointer.

- [ ] **Step 1: Write the failing test**

Add to `test-improve.cjs`: write a fixture `.improve/state/fixture-skill.json` with two `items` (one `kept`, one `unresolved`) and `humanOnly:["x"]`, then assert `list-improvements.cjs --all` stdout contains `fixture-skill` and `improve-report.cjs fixture-skill` creates `.improve/reports/fixture-skill.md` containing `kept` and `unresolved`. Clean up the fixtures after.

- [ ] **Step 2: Run to verify it fails**

Run: `node plugins/lirbox/skills/whetstone/scripts/test-improve.cjs` → FAIL (modules missing).

- [ ] **Step 3: Implement both**

Fork `list-optimizations.cjs` verbatim, changing: dir `.optimize`→`.improve`; the `experiments`→`items` field; columns to NAME/STATUS/ITEMS/KEPT/UNRESOLVED/DURATION (`kept` = items with `verdict==='kept'`, `unresolved` = `verdict==='unresolved'`). Fork `optimize-report.cjs` similarly: read `.improve/state/<skill>.json`, emit the per-item verdict table + counts + the `git diff` pointer to `.improve/reports/<skill>.md`.

- [ ] **Step 4: Run tests to verify they pass** → PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/lirbox/skills/whetstone/scripts/list-improvements.cjs plugins/lirbox/skills/whetstone/scripts/improve-report.cjs plugins/lirbox/skills/whetstone/scripts/test-improve.cjs
git commit -m "feat(whetstone): list-improvements + improve-report (forked from prospector)"
```

---

### Task 5: `SKILL.md` + `references/` (the attended setup/resume/finalize procedure)

**Files:**
- Create: `plugins/lirbox/skills/whetstone/SKILL.md`
- Create: `plugins/lirbox/skills/whetstone/references/loop-runtime.md`
- Create: `plugins/lirbox/skills/whetstone/references/checks.md`
- Test: `python3 <skill-creator>/quick_validate.py plugins/lirbox/skills/whetstone`

**Interfaces:** SKILL.md documents the main-session flow: resolve arg (list / resume `.improve/state/<skill>.json` / new `<skill>`); **setup** = read `feedback/<skill>.jsonl` → dispatch `lirbox-test-writer` as `check-drafter` per item → run `check-baseline.cjs` on each draft (discrimination gate) → measure floor on baseline → `AskUserQuestion` confirm (drafted checks + `human-only` list + budgets) → freeze checks into `evals/` + write `.improve/config/<skill>.json` → `scaffold-improve.cjs --name <skill>` → launch `Workflow({ scriptPath: ".improve/<skill>.js", args:{config} })`; **resume** re-passes `{config, items, baseline}`; **finalize** stamps `status`/`finishedAt` + runs `improve-report.cjs`.

- [ ] **Step 1: Write `references/loop-runtime.md`**

Adapt `prospector/references/loop-runtime.md`: the two-layer model (§1) verbatim; ledger schema (§3) → `items[]` with `{id,type,change,floor,check,verdict,sha}` + `humanOnly[]`, drop `best`/`metric`; keep/revert (§4) → `verdictOf(floorPassed,checkPassed,surfaceOk)` + the `unresolved`-after-`N` rule; surface-lock (§4) → editable-minus-locked; resume (§5) re-passes `{config,items,baseline}`.

- [ ] **Step 2: Write `references/checks.md`**

Document: acceptance-check derivation (one deterministic check per concern, authored at setup by `lirbox-test-writer`); the **discrimination gate** (`check-baseline.cjs` — must fail on baseline); the **floor** (`quick_validate.py` + `node <skill>/evals/run.mjs`); the **locked set** (`evals/**` + backlog; the artifact under edit is NOT the check); the **human-only** path (no deterministic check → excluded + reported); when to DECLINE (a skill with no establishable floor).

- [ ] **Step 3: Write `SKILL.md`** (frontmatter `name: whetstone`, a pushy `description` covering "overnight skill improver / feedback backlog / eval-gated / never auto-merge"), with the setup→launch→finalize procedure above. Keep body < 500 lines; point to the two references.

- [ ] **Step 4: Validate**

Run: `python3 /Users/liemlhd/.claude/plugins/marketplaces/claude-plugins-official/plugins/skill-creator/skills/skill-creator/scripts/quick_validate.py plugins/lirbox/skills/whetstone`
Expected: `Skill is valid!` (exit 0).

- [ ] **Step 5: Commit**

```bash
git add plugins/lirbox/skills/whetstone/SKILL.md plugins/lirbox/skills/whetstone/references
git commit -m "docs(whetstone): SKILL.md + loop-runtime + checks references"
```

---

### Task 6: Flowchart floor + end-to-end dry-run (whetstone's v1 acceptance test)

This is spec §10 — it proves KEEP / REVERT / human-only on a real skill. `validate.mjs:58` only checks non-ASCII on **edge** labels — that is a genuine, fixable gap, so Item A is real.

**Files:**
- Create: `plugins/lirbox/skills/flowchart/evals/run.mjs` (floor runner — runs every `*.test.mjs`)
- Create: `plugins/lirbox/skills/flowchart/evals/edge-nonascii.test.mjs` (characterization = floor; passes on baseline)
- Create: `plugins/lirbox/skills/flowchart/evals/node-nonascii.test.mjs` (Item A acceptance-check; **fails** on baseline)
- Create: `plugins/lirbox/skills/flowchart/evals/fixtures/*.html`
- Create: `feedback/flowchart.jsonl` (the 3-item backlog)
- Create: `plugins/lirbox/skills/whetstone/scripts/test-dryrun.sh` (the acceptance test)

**Interfaces:** `run.mjs` exits 0 iff all `*.test.mjs` pass; each `*.test.mjs` exits 0/1. Floor = `node plugins/lirbox/skills/flowchart/evals/run.mjs`.

- [ ] **Step 1: Write the floor runner + characterization test (must pass on baseline)**

`evals/run.mjs`: read its dir, import every `*.test.mjs`, exit 1 if any throws. `edge-nonascii.test.mjs`: assert `validate.mjs` FAILs a fixture with `—` in an **edge** label (baseline already does this → floor green on baseline).

- [ ] **Step 2: Write Item A's acceptance-check (must FAIL on baseline)**

`node-nonascii.test.mjs`: assert `validate.mjs` FAILs a fixture with `—` in a **node** label (`A[Cost—high]`). On baseline `validate.mjs` only flags edge labels → this test FAILS → discriminating.

Run: `node plugins/lirbox/skills/whetstone/scripts/check-baseline.cjs "node plugins/lirbox/skills/flowchart/evals/node-nonascii.test.mjs"`
Expected: `DISCRIMINATING` (exit 0).

- [ ] **Step 3: Write the backlog**

`feedback/flowchart.jsonl` (one JSON object per line):
```jsonl
{"id":"node-nonascii","type":"concern","text":"validate.mjs flags non-ASCII only in EDGE labels; node labels slip through","acceptanceCheck":"node plugins/lirbox/skills/flowchart/evals/node-nonascii.test.mjs"}
{"id":"floor-breaker","type":"suggestion","text":"(dry-run control) a fix whose check passes but breaks the edge characterization test","acceptanceCheck":"node plugins/lirbox/skills/flowchart/evals/node-nonascii.test.mjs"}
{"id":"prettier","type":"concern","text":"flowchart diagrams should look more polished","acceptanceCheck":null}
```

- [ ] **Step 4: Write the acceptance test `test-dryrun.sh`**

Generates the config (Item A + the human-only item; for the REVERT path, drive one item with a stub fixer that edits `validate.mjs` to delete the `edge` check — breaking the floor), runs the loop via the Workflow tool, then asserts the resulting `.improve/state/flowchart.json`:
```bash
# expected after the run:
#   items[node-nonascii].verdict == "kept"     (validate.mjs now flags node labels; floor still green)
#   the floor-breaking item        == "reverted" (edge characterization test went red → floor failed)
#   humanOnly == ["prettier"]                   (excluded, reported)
node -e "const s=require('./.improve/state/flowchart.json');const v=id=>s.items.find(i=>i.id===id).verdict;if(v('node-nonascii')!=='kept')throw'A!=kept';if(!s.humanOnly.includes('prettier'))throw'prettier not human-only';console.log('DRY-RUN OK')"
```

- [ ] **Step 5: Run the full suite + dry-run**

Run: `node plugins/lirbox/skills/whetstone/scripts/test-improve.cjs && bash plugins/lirbox/skills/whetstone/scripts/test-dryrun.sh`
Expected: regression net PASS; dry-run prints `DRY-RUN OK`; branch `improve/flowchart` holds the kept `validate.mjs` node-label fix; `main` unchanged.

- [ ] **Step 6: Commit**

```bash
git add plugins/lirbox/skills/flowchart/evals feedback/flowchart.jsonl plugins/lirbox/skills/whetstone/scripts/test-dryrun.sh
git commit -m "test(whetstone): flowchart floor + end-to-end dry-run (keep/revert/human-only)"
```

---

## Self-Review

**Spec coverage:** §2 architecture → Tasks 1-2; §3 trust principle (floor+check+surface, frozen checks) → Tasks 1-3,6 + Global Constraints; §4a setup (RED-draft, discrimination, confirm, freeze) → Tasks 3,5; §4b overnight loop → Task 2; §5 components (config/state/ledger/report/workers) → Tasks 2-4; §6 eval layers (floor + per-item check, discrimination) → Tasks 2,3,6; §7 safety (surface-lock incl. locked set, non-destructive revert, never-merge, baseline-must-pass) → Tasks 1,2,6; §9 v1 scope (deterministic only) → whole plan; §10 dry-run → Task 6; §11 decisions (N=2, jsonl, check-authoring) → Global Constraints. v2 items (trigger-tuning, judge, harvester) intentionally absent. **No gaps.**

**Placeholder scan:** `/* INLINE: … */` markers in Task 2 are explicit fork-from-source pointers with exact line ranges, not vague TODOs. All test code and new logic is shown in full.

**Type consistency:** `surfaceAllows(files, editable, locked)`, `verdictOf(floorPassed, checkPassed, surfaceOk)`, `shouldStop(itemsDone, total, elapsedMin, tokensUsed)` are used identically in Task 1 (tests), Task 2 (inlined into the loop), and the REQUIRED markers. Ledger item shape `{id,type,change,floor,check,verdict,sha}` + `humanOnly[]` is consistent across Tasks 2 (write), 4 (read/report), 6 (assert).
