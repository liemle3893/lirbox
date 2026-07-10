// ACCEPTANCE CHECK (RED on baseline) — the panel CodeGate LEAD's skip decisions must be auditable.
//
// Concern (feedback/conductor.jsonl → codegate-lead-skip-audit): scaffold-workflow.cjs tells the
// codegate lead it "may skip a finding ONLY with an explicit reason it is wrong", but the lead's
// output schema is exactly {gatePassed, critical, high, summary} with additionalProperties:false —
// skip reasons have no structured home, and results.codeGate = { ...last, panel } is all the
// checkpoint/report ever see. A human cannot audit which confirmed findings the lead overruled or
// why. Expected fix: a 'skippedFindings' array (items requiring title and reason — deliberately
// NOT named 'skipped', which is already a BOOLEAN on the guard-skip path) on the LEAD schema, a
// prompt instruction to record every skipped finding there, and workflow-report.cjs rendering it
// beside the panel counts.
//
//   - baseline: 'skippedFindings' appears nowhere in the generated lead call nor in
//     workflow-report.cjs → assertions a/b/c fail → exit 1 (RED)
//   - after the fix (schema + prompt + report render) → all three pass → exit 0 (GREEN)
//
// Assertion (c) is load-bearing: without the report-path check, a schema/prompt-only fix would go
// green while the audit trail never reaches a human.
//
// Locked (evals/**): the whetstone fixer may NEVER edit this file.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(HERE, '..', '..');                       // .../skills/conductor
const REPO = resolve(SKILL_DIR, '..', '..', '..', '..');           // repo root
const SCAFFOLD = resolve(SKILL_DIR, 'scripts', 'scaffold-workflow.cjs');
const REPORT = resolve(SKILL_DIR, 'scripts', 'workflow-report.cjs');

const TMP = mkdtempSync(join(tmpdir(), 'skip-audit-'));
const PROMPTS = join(TMP, 'prompts.json');
writeFileSync(PROMPTS, JSON.stringify({ Implement: 'Do the work.' }));

let failures = 0;
function ok(cond, msg) {
  if (cond) { console.log(`  ok   ${msg}`); }
  else { failures++; console.error(`  FAIL ${msg}`); }
}

// Generate one script and return its emitted source. Throws (→ harness error, exit 2) if the
// generator itself refuses to emit.
function gen(extraArgs) {
  const outPath = join(TMP, 'w.js');
  try {
    execFileSync('node', [SCAFFOLD, '--name', 'x', '--out', outPath, '--force',
      '--prompts-file', PROMPTS, ...extraArgs], { cwd: REPO, encoding: 'utf8' });
  } catch (e) {
    console.error(`check: generator failed for [${extraArgs.join(' ')}]: ${e.message}`);
    rmSync(TMP, { recursive: true, force: true });
    process.exit(2);
  }
  return readFileSync(outPath, 'utf8');
}

// Extract one balanced {...} literal starting at the first '{' at/after `from`,
// skipping over quoted strings (single, double, backtick) and escapes.
function braced(src, from) {
  const open = src.indexOf('{', from);
  if (open < 0) return null;
  let depth = 0, quote = null;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return src.slice(open, i + 1);
  }
  return null;
}

// --- Slice the generated delivery workflow at the codegate-lead agent call ---
const src = gen(['--phases', 'Implement', '--profile', 'delivery', '--no-dod']);
const leadStart = src.indexOf("inWorktree('codegate-lead')");
const labelIdx = leadStart > -1 ? src.indexOf('codegate:lead-r', leadStart) : -1;
const schemaIdx = labelIdx > -1 ? src.indexOf('schema:', labelIdx) : -1;
const sliceEnd = schemaIdx > -1 ? src.indexOf('\n', schemaIdx) : -1;
const slice = leadStart > -1 && sliceEnd > -1 ? src.slice(leadStart, sliceEnd) : null;

// (a) lead schema declares a skippedFindings ARRAY whose item schema requires title and reason.
let aPass = false, aNote = '';
if (!slice) {
  aNote = " — could not locate the codegate-lead call (inWorktree('codegate-lead') … codegate:lead-r … schema:)";
} else {
  const schemaLit = braced(slice, slice.indexOf('schema:', slice.indexOf('codegate:lead-r')));
  const m = schemaLit && schemaLit.match(/["']?skippedFindings["']?\s*:/);
  if (!schemaLit) aNote = ' — could not extract the lead schema literal';
  else if (!m) aNote = ' — lead schema has no skippedFindings property';
  else {
    const sub = braced(schemaLit, m.index + m[0].length);
    let sf = null;
    try { sf = JSON.parse(sub); } catch { aNote = ' — skippedFindings sub-schema is not parseable JSON'; }
    if (sf) {
      const req = sf.items && sf.items.required;
      aPass = sf.type === 'array' && Array.isArray(req) && req.includes('title') && req.includes('reason');
      if (!aPass) aNote = ' — skippedFindings is not an array whose items require title and reason';
    }
  }
}
ok(aPass, `a. lead schema declares a skippedFindings array requiring title+reason per item${aNote}`);

// (b) the lead PROMPT (text before the label) instructs recording skipped findings in that array.
const promptText = slice ? slice.slice(0, slice.indexOf('codegate:lead-r')) : '';
ok(/skippedFindings/.test(promptText),
  "b. lead prompt instructs recording each skipped finding (needle 'skippedFindings' in prompt text)");

// (c) workflow-report.cjs renders skippedFindings entries from a fixture state.
// The report reads .workflows/state/<name>.json relative to cwd; --project-dir points at an
// empty dir so no real transcripts are scanned. A report crash on this valid state counts as a
// FAIL of (c), not a harness error.
mkdirSync(join(TMP, '.workflows', 'state'), { recursive: true });
const projDir = join(TMP, 'proj');
mkdirSync(projDir, { recursive: true });
writeFileSync(join(TMP, '.workflows', 'state', 'fixture.json'), JSON.stringify({
  status: 'done',
  startedAt: '2026-07-10T00:00:00.000Z',
  finishedAt: '2026-07-10T00:05:00.000Z',
  phasesDone: ['Implement', 'CodeGate'],
  branch: 'wf/fixture',
  worktree: '.worktrees/fixture',
  results: {
    codeGate: {
      gatePassed: true, critical: 0, high: 0,
      summary: 'panel: 3 raw, 2 confirmed',
      panel: { raw: 3, deduped: 3, confirmed: 2 },
      skippedFindings: [{ title: 'FIXTURE-SKIP-TITLE', reason: 'FIXTURE-SKIP-REASON' }],
    },
  },
}, null, 2));

let cPass = false, cNote = '';
try {
  const md = execFileSync('node', [REPORT, 'fixture', '--project-dir', projDir],
    { cwd: TMP, encoding: 'utf8' });
  cPass = md.includes('FIXTURE-SKIP-TITLE') && md.includes('FIXTURE-SKIP-REASON');
  if (!cPass) cNote = ' — report ran but rendered neither the title nor the reason';
} catch (e) {
  cNote = ` — workflow-report.cjs errored on the fixture state: ${String(e.message).split('\n')[0]}`;
}
ok(cPass, `c. workflow-report.cjs renders the skipped finding's title and reason${cNote}`);

rmSync(TMP, { recursive: true, force: true });

if (failures) {
  console.error(`\ncheck RED: ${failures} assertion(s) failed — the lead's skip decisions are not auditable.`);
  process.exit(1);
}
console.log("\ncheck GREEN: skipped findings are structured in the lead schema, prompted, and rendered in the report.");
process.exit(0);
