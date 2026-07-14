#!/usr/bin/env node
/*
 * Deterministically generate the ARENA conductor (a Workflow `.js`) from a run slug — analogous to
 * scaffold-optimize.cjs, but the loop runs conductor against frozen fixtures under N configs and
 * scores the delivered diffs PAIRWISE (Bradley-Terry / win-rate) instead of hill-climbing a scalar.
 *
 * The run CONFIG (tasks, configs, budget, fixture paths) is NOT baked in — it is passed via Workflow
 * args.config so a resume re-passes it unchanged (the conductor cannot read fs).
 *
 * Conductor constraints: the generated loop is PURE JS — no fs/git/require/Date.now()/Math.random().
 * Every side-effect (fixture clone, headless conductor run, diff capture, judging, ledger writes,
 * report, PR) happens inside an agent() worker prompt.
 *
 * The pure helpers below are exported for tests AND inlined verbatim into the generated conductor.
 * The generated source is assembled by array-join (not one giant template literal) so inner backticks
 * in worker prompts need no escaping and the emitted file always parses.
 *
 * Usage: node scaffold-arena.cjs --name <slug> [--out <path>] [--force]
 */
const fs = require('fs');
const path = require('path');

// ============================================================================
// PURE HELPERS — exported for tests AND inlined into the generated loop (legal in the restricted
// layer: plain values only, no fs/git/time/randomness).
// ============================================================================

// FNV-1a over canonical JSON (keys sorted) → stable hex id for a config tuple. No crypto (require-free).
function configHash(config) {
  const canon = JSON.stringify(config, Object.keys(config || {}).sort());
  let h = 0x811c9dc5;
  for (let i = 0; i < canon.length; i++) {
    h ^= canon.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// Cross product tasks × configs, expanded by runsPerCell. Each entry is one conductor run to do.
function planCells(tasks, configs, runsPerCell) {
  const n = (typeof runsPerCell === 'number' && runsPerCell >= 1) ? Math.floor(runsPerCell) : 1;
  const cells = [];
  for (const taskId of tasks) {
    for (const config of configs) {
      const configHashV = configHash(config);
      for (let runIndex = 0; runIndex < n; runIndex++) {
        cells.push({ taskId, configHash: configHashV, config, runIndex });
      }
    }
  }
  return cells;
}

// Deterministic, position-balanced sampling of run-diff pairs for `passes` judge passes. Rotates over
// the available run indices and alternates `swap` so position bias cancels. No randomness.
function pickPairSamples(nA, nB, passes) {
  const out = [];
  const a = Math.max(1, nA | 0), b = Math.max(1, nB | 0), p = Math.max(1, passes | 0);
  for (let k = 0; k < p; k++) {
    out.push({ aIdx: k % a, bIdx: k % b, swap: (k % 2) === 1 });
  }
  return out;
}

// Whole-pair forfeit resolution BEFORE judging. validA/validB = count of non-forfeit runs. One side
// with 0 valid runs loses; both 0 → tie; both >0 → null (go judge).
function resolveForfeit(validA, validB) {
  const okA = validA > 0, okB = validB > 0;
  if (okA && okB) return null;
  if (!okA && !okB) return 'tie';
  return okA ? 'A' : 'B';
}

// Un-swap each verdict back to the true config, then count. verdicts: [{winner:'A'|'B'|'tie', swap}].
function tallyVerdicts(verdicts) {
  let aWins = 0, bWins = 0, ties = 0;
  for (const v of verdicts) {
    if (v.winner === 'tie') { ties++; continue; }
    // When swap=true, shown-A was true-B. So a shown-'A' win maps to true-B and vice-versa.
    const trueWinner = v.swap ? (v.winner === 'A' ? 'B' : 'A') : v.winner;
    if (trueWinner === 'A') aWins++; else bWins++;
  }
  return { aWins, bWins, ties };
}

// Win-rate matrix: cell[i][j] = i's win-rate vs j (ties = 0.5). Diagonal null.
function winRateMatrix(pairTallies, hashes) {
  const m = {};
  for (const i of hashes) { m[i] = {}; for (const j of hashes) m[i][j] = (i === j) ? null : 0; }
  for (const t of pairTallies) {
    const total = t.aWins + t.bWins + t.ties;
    if (!total) continue;
    const aRate = (t.aWins + 0.5 * t.ties) / total;
    m[t.a][t.b] = aRate;
    m[t.b][t.a] = 1 - aRate;
  }
  return m;
}

// Bradley-Terry ratings via MM iteration. Deterministic: ratings init 1.0, fixed `iters`, ties split.
// Returns ratings normalized so they sum to hashes.length.
function bradleyTerry(pairTallies, hashes, iters) {
  const N = hashes.length;
  const it = (typeof iters === 'number' && iters > 0) ? iters : 100;
  const p = {}; for (const h of hashes) p[h] = 1.0;
  const wins = {}; for (const h of hashes) wins[h] = 0;
  const games = {}; for (const i of hashes) { games[i] = {}; for (const j of hashes) games[i][j] = 0; }
  for (const t of pairTallies) {
    wins[t.a] += t.aWins + 0.5 * t.ties;
    wins[t.b] += t.bWins + 0.5 * t.ties;
    const g = t.aWins + t.bWins + t.ties;
    games[t.a][t.b] += g; games[t.b][t.a] += g;
  }
  for (let s = 0; s < it; s++) {
    const next = {};
    for (const i of hashes) {
      let denom = 0;
      for (const j of hashes) { if (i === j) continue; const g = games[i][j]; if (g) denom += g / (p[i] + p[j]); }
      next[i] = denom > 0 ? wins[i] / denom : p[i];
    }
    let sum = 0; for (const h of hashes) sum += next[h];
    const scale = sum > 0 ? N / sum : 1;
    for (const h of hashes) p[h] = next[h] * scale;
  }
  return p;
}

// ============================================================================
// GENERATED LOOP — assembled by array-join. `%NAME%` is the only generation-time injection; every
// other line is emitted verbatim (backticks/${} inside worker prompts are literal output).
// ============================================================================

const HELPERS_SRC = [configHash, planCells, pickPairSamples, resolveForfeit, tallyVerdicts, winRateMatrix, bradleyTerry]
  .map((fn) => fn.toString()).join('\n\n');

function generate(name) {
  const L = [];
  L.push("// AUTO-GENERATED by scaffold-arena.cjs — do NOT hand-edit.");
  L.push("// Run CONFIG (tasks, configs, budget, fixture paths) is passed via Workflow args.config at launch,");
  L.push("// NOT baked here, so a resume re-passes it unchanged. To change LOOP STRUCTURE, re-run the generator");
  L.push("// with --force. Conductor rules: pure JS only — no fs/git/require/Date.now()/Math.random(). Every");
  L.push("// side-effect lives inside an agent() worker prompt.");
  L.push("//");
  L.push("// Loop shape (spec §3): Setup → Execute (per cell ×runs: clone fixture + run conductor headless +");
  L.push("// capture diff, forfeit on non-engagement/gate-fail/timeout) → Judge (per task per config-pair: N");
  L.push("// position-swapped pairwise passes) → Score (Bradley-Terry + win-rate matrix) → Finalize");
  L.push("// (promote leaderboard to tracked docs/arena/<name>/, open PR, never merge).");
  L.push("");
  L.push("export const meta = {");
  L.push("  name: '" + name + "',");
  L.push("  description: 'Arena: " + name + " (pairwise conductor leaderboard over frozen fixtures)',");
  L.push("  phases: [");
  L.push("    { title: 'Setup' },");
  L.push("    { title: 'Execute' },");
  L.push("    { title: 'Judge' },");
  L.push("    { title: 'Score' },");
  L.push("    { title: 'Finalize' },");
  L.push("  ],");
  L.push("}");
  L.push("");
  L.push("if (typeof args === 'string') args = JSON.parse(args)");
  L.push("");
  L.push("// --- Pure helpers inlined from scaffold-arena.cjs (legal in the restricted layer). ---");
  L.push(HELPERS_SRC);
  L.push("");
  L.push("const CONFIG = (args && args.config) ? args.config : null");
  L.push("if (!CONFIG) throw new Error('Missing args.config — launch with { config: <approved .arena/config/" + name + ".json> }')");
  L.push("");
  L.push("const NAME     = '" + name + "'");
  L.push("const STATE    = `.arena/state/${NAME}.json`");
  L.push("const BRANCH   = (args && args.branch) ? args.branch : `arena/${NAME}`");
  L.push("const TASKS    = Array.isArray(CONFIG.tasks) ? CONFIG.tasks : []          // [{ id, taskFile, bundle, sha }]");
  L.push("const CONFIGS  = Array.isArray(CONFIG.configs) ? CONFIG.configs : []      // [{ model, mode, effort }]  (v1 — no skillRef)");
  L.push("const BUDGET   = CONFIG.budget || {}");
  L.push("const RUNS     = (typeof BUDGET.runs === 'number' && BUDGET.runs >= 1) ? Math.floor(BUDGET.runs) : 3");
  L.push("const PASSES   = (typeof BUDGET.judges === 'number' && BUDGET.judges >= 1) ? Math.floor(BUDGET.judges) : 5");
  L.push("const CELLCAPSEC = (typeof BUDGET.cellCapSec === 'number' && BUDGET.cellCapSec > 0) ? Math.floor(BUDGET.cellCapSec) : 3600");
  L.push("");
  L.push("// --- Resume accumulators (re-passed via args; conductor cannot read fs). ---");
  L.push("const doneRuns   = (args && Array.isArray(args.runs)) ? args.runs : []");
  L.push("const doneJudges = (args && Array.isArray(args.judges)) ? args.judges : []");
  L.push("const runKey = (r) => r.taskId + '|' + r.configHash + '|' + r.runIndex");
  L.push("const doneRunSet = {}; for (const r of doneRuns) doneRunSet[runKey(r)] = r");
  L.push("");
  L.push("// Per-worker isolation: a unique notes slot so workers never clobber each other (vary by index).");
  L.push("function slotNote(slot) {");
  L.push("  return `\\n\\nWrite build-scratch to implementation-notes/arena-${slot}.md (unique to you).`");
  L.push("}");
  L.push("");
  L.push("// Checkpoint worker: the ONLY writer of the durable ledger. Runs AFTER each unit's artifact lands.");
  L.push("async function checkpoint(tag, payload) {");
  L.push("  await agent(");
  L.push("    `Checkpoint the arena run \"${NAME}\" (${tag}). Merge this payload into ${STATE} (create dirs if`");
  L.push("    + ` needed), stamping updatedAt with an ISO time you read from the system clock, preserving`");
  L.push("    + ` startedAt. Payload (JSON): ${JSON.stringify(payload)}\\nReturn \"ok\".`,");
  L.push("    { label: `checkpoint:${tag}`, phase: 'Setup' }");
  L.push("  )");
  L.push("}");
  L.push("");
  L.push("// Cell runner worker: clone the fixture into its OWN scratch dir, run conductor headless under a cap,");
  L.push("// capture the delivered diff. Returns { diffPath, forfeit } — schema: forces a real object (proven");
  L.push("// by the Task 0 spike). forfeit=true when conductor didn't engage / gates failed / errored / timed out.");
  L.push("async function runCell(cell) {");
  L.push("  const cfg = cell.config");
  L.push("  const out = `.arena/${NAME}/cells/${cell.taskId}/${cell.configHash}/run-${cell.runIndex}`");
  L.push("  const res = await agent(");
  L.push("    `You are one arena cell run. Do EXACTLY this and return the required JSON object.` +");
  L.push("    ` (Contract proven by the Task 0 spike.)\\n` +");
  L.push("    `1. Clone the fixture into your OWN scratch dir: git clone the bundle \"${cell.bundle}\" and check` +");
  L.push("    ` out commit \"${cell.sha}\". Operate ONLY on this clone — do NOT touch the lirbox repo.\\n` +");
  L.push("    `2. READ \"${cell.taskFile}\" and paste its CONTENT into the sub-claude prompt — NEVER pass the file` +");
  L.push("    ` path itself (hidden SWE graders live beside it; the agent must not see them). Run conductor HEADLESS` +");
  L.push("    ` on the clone with that task text, BACKGROUNDED on real` +");
  L.push("    ` disk (foreground bash caps at 10min and the sandbox discards writes), under a HARD timeout of` +");
  L.push("    ` ${CELLCAPSEC}s: timeout ${CELLCAPSEC} claude -p \"<task>\" --permission-mode ${cfg.mode || 'auto'}` +");
  L.push("    ` --output-format stream-json --verbose  (model=${cfg.model}, effort=${cfg.effort}). Redirect the` +");
  L.push("    ` trace to a log OUTSIDE the clone (else it pollutes the diff). Time out → kill → forfeit.\\n` +");
  L.push("    `3. VERIFY conductor genuinely engaged (headless claude implements small tasks directly): require a` +");
  L.push("    ` wf/ branch in the clone (conductor's output branch) — or a .workflows/ dir / Workflow tool_use in` +");
  L.push("    ` the trace. If none → plain-claude fallback → forfeit=true (do NOT count it as a conductor result).\\n` +");
  L.push("    `4. Capture the delivered diff FROM conductor's wf/ OUTPUT branch — it delivers there and leaves the` +");
  L.push("    ` main checkout CLEAN, so diffing the working tree yields NOTHING. Run: git diff ${cell.sha} <wf/branch>` +");
  L.push("    ` > \"${out}.diff\" (exclude any log/scratch).\\n` +");
  L.push("    `5. SWE-GRADE (rung-1, when this task is graded=${!!cell.graded}): run` +");
  L.push("    ` node plugins/lirbox/skills/arena/scripts/swe-grade.mjs --task ${cell.taskId} --diff \"${out}.diff\"` +");
  L.push("    ` from the lirbox repo root. resolved=false in its JSON → forfeit=true (forfeitReason=\"unresolved\") —` +");
  L.push("    ` an unresolved delivery cannot win, regardless of how good it looks. Record resolved in the meta.\\n` +");
  L.push("    `6. forfeit=true if conductor didn't engage / gates failed / errored / timed out / no diff / unresolved;` +");
  L.push("    ` else false. Write \"${out}.meta\" with {forfeit, forfeitReason, resolved, gateOutcome, tokens}.` +");
  L.push("    slotNote(cell.taskId + '-' + cell.configHash + '-' + cell.runIndex),");
  L.push("    { label: `run:${cell.taskId}:${cell.configHash}:${cell.runIndex}`, phase: 'Execute',");
  L.push("      schema: { type: 'object', additionalProperties: false, required: ['diffPath', 'forfeit'],");
  L.push("        properties: { diffPath: { type: 'string' }, forfeit: { type: 'boolean' }, resolved: { type: 'boolean' },");
  L.push("                      forfeitReason: { type: 'string' }, gateOutcome: { type: 'string' }, tokens: { type: 'number' } } } }");
  L.push("  )");
  L.push("  return res");
  L.push("}");
  L.push("");
  L.push("// Judge worker: blinded pairwise verdict on two delivered diffs for the same task. schema: forces");
  L.push("// {winner, reason}. Oversized diffs → judge on head + summary and say so.");
  L.push("async function judgePass(taskId, taskFile, aDiff, bDiff, swap) {");
  L.push("  const shownA = swap ? bDiff : aDiff");
  L.push("  const shownB = swap ? aDiff : bDiff");
  L.push("  return await agent(");
  L.push("    `Blinded pairwise judge for task \"${taskId}\". The acceptance criteria are in \"${taskFile}\".` +");
  L.push("    ` Diff A = \"${shownA}\". Diff B = \"${shownB}\". Which delivered change better accomplishes the task?` +");
  L.push("    ` Judge ONLY the delivered diff (correctness, completeness, quality). If either diff is too large to` +");
  L.push("    ` read in full, judge on its head plus a summary and note that in reason. No ranking beyond these two.`,");
  L.push("    { label: `judge:${taskId}`, phase: 'Judge',");
  L.push("      schema: { type: 'object', additionalProperties: false, required: ['winner'],");
  L.push("        properties: { winner: { enum: ['A', 'B', 'tie'] }, reason: { type: 'string' } } } }");
  L.push("  )");
  L.push("}");
  L.push("");
  L.push("// ============================ PHASES ============================");
  L.push("phase('Setup')");
  L.push("const cells = planCells(TASKS.map(t => t.id), CONFIGS, RUNS).map(c => {");
  L.push("  const t = TASKS.find(x => x.id === c.taskId)");
  L.push("  return { ...c, taskFile: t.taskFile, bundle: t.bundle, sha: t.sha }");
  L.push("})");
  L.push("await checkpoint('setup', { startedAt: null, plan: { cells: cells.length, tasks: TASKS.length, configs: CONFIGS.length } })");
  L.push("");
  L.push("phase('Execute')");
  L.push("const runResults = doneRuns.slice()");
  L.push("for (const cell of cells) {");
  L.push("  if (doneRunSet[runKey(cell)]) continue                 // resume: skip completed");
  L.push("  const r = await runCell(cell)");
  L.push("  runResults.push({ taskId: cell.taskId, configHash: cell.configHash, runIndex: cell.runIndex,");
  L.push("                    diffPath: r && r.diffPath, forfeit: !!(r && r.forfeit) })");
  L.push("  await checkpoint('run', { runs: runResults })");
  L.push("}");
  L.push("");
  L.push("phase('Judge')");
  L.push("const hashes = CONFIGS.map(configHash)");
  L.push("const judgeResults = doneJudges.slice()");
  L.push("const judged = {}; for (const j of judgeResults) judged[j.taskId + '|' + j.a + '|' + j.b] = true");
  L.push("const pairTallies = []");
  L.push("for (const t of TASKS) {");
  L.push("  const runsByCfg = {}; for (const h of hashes) runsByCfg[h] = runResults.filter(r => r.taskId === t.id && r.configHash === h)");
  L.push("  for (let i = 0; i < hashes.length; i++) for (let k = i + 1; k < hashes.length; k++) {");
  L.push("    const A = hashes[i], B = hashes[k]");
  L.push("    const validA = runsByCfg[A].filter(r => !r.forfeit), validB = runsByCfg[B].filter(r => !r.forfeit)");
  L.push("    const ff = resolveForfeit(validA.length, validB.length)");
  L.push("    let verdicts");
  L.push("    if (ff) {");
  L.push("      verdicts = [{ winner: ff, swap: false }]");
  L.push("    } else if (judged[t.id + '|' + A + '|' + B]) {");
  L.push("      verdicts = judgeResults.find(j => j.taskId === t.id && j.a === A && j.b === B).verdicts");
  L.push("    } else {");
  L.push("      const samples = pickPairSamples(validA.length, validB.length, PASSES)");
  L.push("      verdicts = []");
  L.push("      for (const s of samples) {");
  L.push("        const v = await judgePass(t.id, t.taskFile, validA[s.aIdx].diffPath, validB[s.bIdx].diffPath, s.swap)");
  L.push("        verdicts.push({ winner: (v && v.winner) || 'tie', swap: s.swap })");
  L.push("      }");
  L.push("      judgeResults.push({ taskId: t.id, a: A, b: B, verdicts })");
  L.push("      await checkpoint('judge', { judges: judgeResults })");
  L.push("    }");
  L.push("    const tal = tallyVerdicts(verdicts)");
  L.push("    pairTallies.push({ a: A, b: B, aWins: tal.aWins, bWins: tal.bWins, ties: tal.ties })");
  L.push("  }");
  L.push("}");
  L.push("");
  L.push("phase('Score')");
  L.push("const agg = {}");
  L.push("for (const pt of pairTallies) {");
  L.push("  const key = pt.a + '|' + pt.b");
  L.push("  agg[key] = agg[key] || { a: pt.a, b: pt.b, aWins: 0, bWins: 0, ties: 0 }");
  L.push("  agg[key].aWins += pt.aWins; agg[key].bWins += pt.bWins; agg[key].ties += pt.ties");
  L.push("}");
  L.push("const aggTallies = Object.keys(agg).map(k => agg[k])");
  L.push("const ratings = bradleyTerry(aggTallies, hashes)");
  L.push("const matrix  = winRateMatrix(aggTallies, hashes)");
  L.push("await checkpoint('score', { ratings, matrix, tallies: aggTallies })");
  L.push("");
  L.push("phase('Finalize')");
  L.push("await agent(");
  L.push("  `Render the arena leaderboard for run \"${NAME}\". Read ${STATE}. Write leaderboard.html + report.md` +");
  L.push("  ` into the TRACKED path docs/arena/${NAME}/ (config table sorted by Bradley-Terry rating, the raw` +");
  L.push("  ` win-rate matrix, and a per-task AND per-run breakdown so a noisy run is visible, not averaged away).` +");
  L.push("  ` Any forfeited / zero-valid-run cell MUST be flagged, never silently dropped. Commit docs/arena/${NAME}/` +");
  L.push("  ` on branch ${BRANCH}, then open a PR with report.md as the body; if there is no remote, leave the` +");
  L.push("  ` branch and say so. NEVER merge.`,");
  L.push("  { label: 'finalize', phase: 'Finalize',");
  L.push("    schema: { type: 'object', additionalProperties: false, required: ['reportPath'],");
  L.push("      properties: { reportPath: { type: 'string' }, prUrl: { type: 'string' }, branch: { type: 'string' } } } }");
  L.push(")");
  L.push("");
  return L.join('\n');
}

function arg(name, def) { const i = process.argv.indexOf('--' + name); const v = process.argv[i + 1]; return i > -1 ? (v && !v.startsWith('--') ? v : true) : def; }

module.exports = { configHash, planCells, pickPairSamples, resolveForfeit, tallyVerdicts, winRateMatrix, bradleyTerry, generate };

if (require.main === module) {
  const name = arg('name');
  if (!name || name === true) { console.error('usage: scaffold-arena.cjs --name <slug> [--out <path>] [--force]'); process.exit(1); }
  const out = arg('out', path.join('.arena', name + '.js'));
  if (fs.existsSync(out) && process.argv.indexOf('--force') === -1) { console.error(`refusing to overwrite ${out} (use --force)`); process.exit(1); }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, generate(name));
  console.log(`wrote ${out}`);
}
