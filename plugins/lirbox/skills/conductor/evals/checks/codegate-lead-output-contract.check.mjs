// ACCEPTANCE CHECK (RED on baseline) — the panel CodeGate LEAD must get an explicit output contract.
//
// Concern (feedback/conductor.jsonl → codegate-lead-output-contract): the panel CodeGate lead
// prompt (panelBody, scaffold-workflow.cjs ~349-355) leaves the lead's output contract undefined:
// the prompt orders "FIX every Critical and High ... run the project build/lint (it MUST pass)"
// but never states what returning gatePassed=true requires, nor whether critical/high count
// REMAINING unresolved findings or FIXED ones — and the emitted schema requires only
// ['gatePassed'], leaving critical/high optional.
//
// Fix expected in the GENERATOR (never here): add a contract sentence to the lead prompt
// containing the verbatim needles 'gatePassed=true ONLY' and 'left UNRESOLVED', and add
// 'critical' and 'high' to the LEAD schema's required array (alongside 'gatePassed').
//
// This check generates one delivery panel loop and slices the emitted source between
// "inWorktree('codegate-lead')" and the end of the schema line following the 'codegate:lead-r'
// label, so every contract assertion is scoped to the LEAD prompt+schema specifically — not the
// guard/finding/score schemas.
//   - baseline: needles absent + required == ["gatePassed"] → assertions 1–3 fail → exit 1 (RED)
//   - after the fix: needles present + required includes critical/high → exit 0 (GREEN)
//   - assertions 4–6 are regression guards that MUST pass today AND stay green: the deterministic
//     guard-skip and zero-confirmed results keep hard-coding 'critical: 0, high: 0' (a lazy fix
//     cannot resolve the ambiguity by deleting the counts), and the generated script still parses.
//   - missing slice boundaries → harness error → exit 2 (never a silent RED).
//
// Locked (evals/**): the whetstone fixer may READ this file but NEVER edit it.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(HERE, '..', '..');                       // .../skills/conductor
const REPO = resolve(SKILL_DIR, '..', '..', '..', '..');           // repo root
const SCAFFOLD = resolve(SKILL_DIR, 'scripts', 'scaffold-workflow.cjs');

const TMP = mkdtempSync(join(tmpdir(), 'lead-contract-'));
const PROMPTS = join(TMP, 'prompts.json');
writeFileSync(PROMPTS, JSON.stringify({ Implement: 'Do the work.' }));

let failures = 0;
function ok(cond, msg) {
  if (cond) { console.log(`  ok   ${msg}`); }
  else { failures++; console.error(`  FAIL ${msg}`); }
}
function harnessError(msg) {
  console.error(`check: harness error — ${msg}`);
  rmSync(TMP, { recursive: true, force: true });
  process.exit(2);
}

// Generate one script and return its emitted source. Records the output path for the
// node --check pass. Throws (→ harness error, exit 2) if the generator itself refuses to emit.
const generated = [];
let genCounter = 0;
function gen(extraArgs) {
  const outPath = join(TMP, `w${genCounter++}.js`);
  try {
    execFileSync('node', [SCAFFOLD, '--name', 'x', '--out', outPath, '--force',
      '--prompts-file', PROMPTS, ...extraArgs], { cwd: REPO, encoding: 'utf8' });
  } catch (e) {
    harnessError(`generator failed for [${extraArgs.join(' ')}]: ${e.message}`);
  }
  generated.push(outPath);
  return readFileSync(outPath, 'utf8');
}

// Panel under --profile delivery (panel default ON). delivery hard-errors without a DoD, so pass
// the explicit --no-dod escape hatch — the lead contract is orthogonal to the DoD gate.
const src = gen(['--phases', 'Implement', '--profile', 'delivery', '--no-dod']);

// --- Slice the LEAD section: inWorktree('codegate-lead') → end of the schema line after the
// --- 'codegate:lead-r' label. Verify every boundary exists BEFORE slicing (else exit 2).
const startIdx = src.indexOf("inWorktree('codegate-lead')");
if (startIdx === -1) harnessError("slice start not found: \"inWorktree('codegate-lead')\" missing from generated source — is the panel CodeGate gone?");
const labelIdx = src.indexOf('codegate:lead-r', startIdx);
if (labelIdx === -1) harnessError("slice anchor not found: 'codegate:lead-r' label missing after the lead prompt");
const schemaIdx = src.indexOf('schema:', labelIdx);
if (schemaIdx === -1) harnessError("slice end not found: no 'schema:' after the 'codegate:lead-r' label");
const schemaLineEnd = src.indexOf('\n', schemaIdx);
const lead = src.slice(startIdx, schemaLineEnd === -1 ? src.length : schemaLineEnd);

// --- Contract assertions (RED today; the fix turns them GREEN) ------------------------------
ok(lead.includes('gatePassed=true ONLY'),
  "1. lead prompt states the pass condition verbatim: 'gatePassed=true ONLY'");
ok(lead.includes('left UNRESOLVED'),
  "2. lead prompt defines critical/high as counts of findings 'left UNRESOLVED'");

const reqMatch = lead.match(/required:\s*(\[[^\]]*\])/);
const reqText = reqMatch ? reqMatch[1] : '';
ok(/["']gatePassed["']/.test(reqText) && /["']critical["']/.test(reqText) && /["']high["']/.test(reqText),
  `3. LEAD schema required array lists 'critical' and 'high' alongside 'gatePassed' (found: ${reqText || '(no required array in lead slice)'})`);

// --- Regression guards (GREEN today; MUST stay green after the fix) -------------------------
ok(src.includes('skipped: true, critical: 0, high: 0'),
  "4. guard-skip result still hard-codes 'critical: 0, high: 0' (counts must not be deleted)");
ok(src.includes("critical: 0, high: 0, summary: 'panel: '"),
  "5. zero-confirmed result still hard-codes 'critical: 0, high: 0' (counts must not be deleted)");

let allParse = true;
for (const p of generated) {
  try { execFileSync('node', ['--check', p], { encoding: 'utf8' }); }
  catch (e) { allParse = false; console.error(`     node --check failed for ${p}: ${e.message}`); }
}
ok(allParse, '6. every generated script passes node --check');

rmSync(TMP, { recursive: true, force: true });

if (failures) {
  console.error(`\ncheck RED: ${failures} assertion(s) failed — the CodeGate lead's output contract is still undefined.`);
  process.exit(1);
}
console.log("\ncheck GREEN: the CodeGate lead prompt defines its output contract and the lead schema requires critical/high.");
process.exit(0);
