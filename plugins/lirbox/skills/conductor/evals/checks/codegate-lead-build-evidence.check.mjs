// ACCEPTANCE CHECK (RED on baseline) — CodeGate/Review gates must carry build-run EVIDENCE.
//
// Concern (feedback/conductor.jsonl → codegate-lead-build-evidence): every CodeGate variant
// tells its agent to "run the project build/lint (it MUST pass)", yet the gate schema is just
// { gatePassed, critical, high, summary } with only gatePassed required, and every loop accepts
// `passed = last && last.gatePassed` on the honor system — nothing requires evidence the build
// actually ran. Fix expected (honesty anchor, not a second verifier): the gate schemas for the
// panel LEAD, the single-agent CodeGate (gateLoop), and the merged Review (gateLoop) must
// require buildCmd (string) + buildExit (number); the prompts must demand reporting them (with
// a no-build fallback: run the closest verification command, e.g. the test suite, and report
// that); and the emitted pass condition must reject gatePassed:true when buildExit !== 0.
//
// Scope: gateLoop is shared ONLY by CodeGate and Review. TestGate has its own inline loop and
// is OUT of scope (regression-guarded green below). The panel's zero-confirmed early pass
// synthesizes gatePassed:true WITHOUT any lead agent — it must stay untouched, so NO build
// evidence is asserted on that synthesized object (regression-guarded green below).
//
//   - baseline: the emitted scripts contain no buildCmd/buildExit at all → assertions 2-4,
//     6-8, 10-12 fail → exit 1 (RED)
//   - after the fix: all three gate blocks carry schema + prompt + pass-condition evidence,
//     while TestGate and the zero-confirmed early pass stay evidence-free → exit 0 (GREEN)
//
// Locked (evals/**): the whetstone fixer may NEVER edit this file.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(HERE, '..', '..');                       // .../skills/conductor
const REPO = resolve(SKILL_DIR, '..', '..', '..', '..');           // repo root
const SCAFFOLD = resolve(SKILL_DIR, 'scripts', 'scaffold-workflow.cjs');

const TMP = mkdtempSync(join(tmpdir(), 'build-evidence-'));
const PROMPTS = join(TMP, 'prompts.json');
writeFileSync(PROMPTS, JSON.stringify({ Work: 'Do the work.', Implement: 'Do the work.' }));

let failures = 0;
function ok(cond, msg) {
  if (cond) { console.log(`  ok   ${msg}`); }
  else { failures++; console.error(`  FAIL ${msg}`); }
}

// Generate one script and return its emitted source. Records the output path for the node --check
// pass. Throws (→ harness error, exit 2) if the generator itself refuses to emit.
const generated = [];
let genCounter = 0;
function gen(extraArgs) {
  const outPath = join(TMP, `w${genCounter++}.js`);
  try {
    execFileSync('node', [SCAFFOLD, '--name', 'x', '--out', outPath, '--force',
      '--prompts-file', PROMPTS, ...extraArgs], { cwd: REPO, encoding: 'utf8' });
  } catch (e) {
    console.error(`check: generator failed for [${extraArgs.join(' ')}]: ${e.message}`);
    rmSync(TMP, { recursive: true, force: true });
    process.exit(2);
  }
  generated.push(outPath);
  return readFileSync(outPath, 'utf8');
}

// --- structural slicing: a phase block runs from its column-0 `phase('T')` call to the next
// column-0 `phase('` (or EOF); the gate agent sub-block runs from its prompt's inWorktree
// anchor to the end of the phase block, so schema/label/passed-line probes NEVER touch a
// sibling gate (in particular never TestGate).
function phaseBlock(src, title) {
  const s = src.indexOf(`phase('${title}')`);
  if (s === -1) return '';
  const e = src.indexOf("\nphase('", s);
  return e === -1 ? src.slice(s) : src.slice(s, e);
}
function subBlockFrom(block, anchor) {
  const s = block.indexOf(anchor);
  return s === -1 ? '' : block.slice(s);
}

// The three RED probes, applied to ONE gate agent sub-block (prompt → label → schema → passed).
function assertBuildEvidence(sub, name, n) {
  const labelIdx = sub.indexOf('label:');
  const promptPart = sub.slice(0, Math.max(labelIdx, 0));
  const passedLine = (sub.match(/passed\s*=(?!=)[^\n]*gatePassed[^\n]*/) || [''])[0];
  ok(/required:\s*\[[^\]]*buildCmd[^\]]*\]/.test(sub) && /required:\s*\[[^\]]*buildExit[^\]]*\]/.test(sub)
    && /["']?buildCmd["']?\s*:\s*\{/.test(sub) && /["']?buildExit["']?\s*:\s*\{/.test(sub),
    `${n}. ${name} gate schema declares buildCmd + buildExit properties and lists both in required`);
  ok(promptPart.includes('buildCmd') && promptPart.includes('buildExit'),
    `${n + 1}. ${name} gate prompt demands reporting buildCmd + buildExit`);
  ok(/buildExit\s*[!=]==?\s*0/.test(passedLine),
    `${n + 2}. ${name} pass condition checks buildExit against 0 alongside gatePassed (passed line: ${passedLine || '(none)'})`);
}

// (1) Panel lead — --profile delivery (panel default ON); --no-dod is the explicit DoD opt-out.
const delivery = gen(['--phases', 'Implement', '--profile', 'delivery', '--no-dod']);
const leadSub = subBlockFrom(phaseBlock(delivery, 'CodeGate'), "inWorktree('codegate-lead')");
ok(leadSub.includes('label: `codegate:lead-r'),
  '1. delivery emits the panel lead loop (codegate:lead-r) inside the CodeGate phase');
assertBuildEvidence(leadSub, 'panel lead', 2); // assertions 2-4

// (2) Single-agent CodeGate via gateLoop.
const single = gen(['--phases', 'Work', '--enforce-code']);
const codegateSub = subBlockFrom(phaseBlock(single, 'CodeGate'), "inWorktree('codegate')");
ok(codegateSub.includes('label: `codegate:r'),
  '5. --enforce-code emits the single-agent CodeGate loop (codegate:r)');
assertBuildEvidence(codegateSub, 'single-agent CodeGate', 6); // assertions 6-8

// (3) Merged Review via gateLoop — --merge-gates collapses CodeGate+TestGate into ONE Review
// phase (its CodeGate/TestGate siblings still emit under these flags; the slice ignores them).
const merged = gen(['--phases', 'Work', '--merge-gates', '--enforce-code', '--enforce-tests']);
const reviewSub = subBlockFrom(phaseBlock(merged, 'Review'), "inWorktree('review')");
ok(reviewSub.includes('label: `review:r') && reviewSub.includes("phase: 'Review'"),
  "9. --merge-gates emits the merged Review block (review:r label, phase 'Review')");
assertBuildEvidence(reviewSub, 'merged Review', 10); // assertions 10-12

// --- regression guards: MUST pass today AND stay green after the fix ---
// TestGate has its own inline loop and is OUT of scope — no buildExit requirement, ever.
const testsOnly = gen(['--phases', 'Work', '--enforce-tests']);
const testGate = phaseBlock(testsOnly, 'TestGate');
ok(testGate.includes('label: `testgate:r') && !testGate.includes('buildExit'),
  '13. TestGate (out of scope) still contains NO buildExit requirement');

// The panel zero-confirmed early pass synthesizes gatePassed:true with NO lead agent — it must
// stay untouched (do NOT demand build evidence on the synthesized object).
const earlyLine = (delivery.match(/results\.codeGate\s*=\s*\{[^\n]*0 confirmed[^\n]*/) || [''])[0];
ok(/gatePassed:\s*true/.test(earlyLine) && !earlyLine.includes('buildExit'),
  '14. panel zero-confirmed early pass still synthesizes gatePassed: true without buildExit');

// 15. Every generated script must parse.
let allParse = true;
for (const p of generated) {
  try { execFileSync('node', ['--check', p], { encoding: 'utf8' }); }
  catch (e) { allParse = false; console.error(`     node --check failed for ${p}: ${e.message}`); }
}
ok(allParse, '15. every generated script passes node --check');

rmSync(TMP, { recursive: true, force: true });

if (failures) {
  console.error(`\ncheck RED: ${failures} assertion(s) failed — CodeGate/Review gates carry no build-run evidence.`);
  process.exit(1);
}
console.log('\ncheck GREEN: CodeGate/Review gates require buildCmd/buildExit evidence and reject gatePassed without buildExit === 0.');
process.exit(0);
