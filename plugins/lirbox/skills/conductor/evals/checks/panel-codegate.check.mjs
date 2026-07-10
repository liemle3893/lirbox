// ACCEPTANCE CHECK (RED on baseline) — conductor's CodeGate must become a multi-agent PANEL.
//
// Concern (feedback/conductor.jsonl → panel-codegate): scaffold-workflow.cjs emits only a
// single review+fix agent for the CodeGate. Under `--profile delivery` (panel default ON) and
// wherever a CodeGate exists under `--review-panel`, it must instead emit a panel: a diff guard,
// a parallel dimension fan-out, a git-history dimension (delivery only), a >=80 confidence
// filter, and a lead adjudicator+fixer loop on the code-reviewer agent. The single-agent gate
// stays for the collapsed Review tiers (`--profile lite` / `--merge-gates`) and when the panel is
// switched off with `--no-review-panel`.
//
// Expected emitted fragments are Task 2 of docs/superpowers/plans/2026-07-10-dod-and-panel-review.md.
//   - baseline (single-agent CodeGate) → panel fragments absent → assertions 1–6 fail → exit 1 (RED)
//   - after the fix (panel emitted)     → all fragments present → exit 0 (GREEN)
//
// Compatibility: every --profile lite/delivery invocation also passes --dod-file, so the check
// stays valid after the sibling dod-gate fix makes profiles REJECT runs without a DoD. Today the
// flag is ignored, which is harmless.
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

const TMP = mkdtempSync(join(tmpdir(), 'panel-codegate-'));
const PROMPTS = join(TMP, 'prompts.json');
writeFileSync(PROMPTS, JSON.stringify({ Work: 'Do the work.', Implement: 'Do the work.' }));
const DOD = join(TMP, 'dod.json');
writeFileSync(DOD, JSON.stringify({ criteria: [{ id: 'a', text: 't', tier: 'checkable', check: 'true' }] }));

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

// Panel under --profile delivery (default ON). --dod-file for forward-compat with the dod-gate fix.
const delivery = gen(['--phases', 'Implement', '--profile', 'delivery', '--dod-file', DOD]);
ok(/codegate:guard/.test(delivery), '1. delivery panel emits a diff-guard worker (codegate:guard)');
ok(/const DIMENSIONS = \[/.test(delivery), '2. delivery panel emits a dimension fan-out (const DIMENSIONS = [)');
ok(/"key":"history"/.test(delivery), '3. delivery panel includes the git-history dimension ("key":"history")');
ok(/confidence >= 80/.test(delivery), '4. delivery panel filters findings below 80 confidence (confidence >= 80)');
ok(/codegate:lead-r/.test(delivery) && /agentType: 'lirbox:lirbox-code-reviewer'/.test(delivery),
  "5. delivery panel runs a lead fix-loop (codegate:lead-r) on lirbox:lirbox-code-reviewer");

// Panel forced OUTSIDE delivery via --review-panel — no git-history dimension there.
const forced = gen(['--phases', 'Work', '--enforce-code', '--review-panel']);
ok(/const DIMENSIONS = \[/.test(forced) && !/"key":"history"/.test(forced),
  '6. --review-panel (non-delivery) emits the panel WITHOUT the history dimension');

// --no-review-panel under delivery reverts to the single-agent CodeGate — no fan-out.
const off = gen(['--phases', 'Implement', '--profile', 'delivery', '--no-review-panel', '--dod-file', DOD]);
ok(!/const DIMENSIONS/.test(off), '7. --no-review-panel under delivery emits NO const DIMENSIONS');

// Plain --profile lite keeps its merged Review phase single-agent.
const lite = gen(['--phases', 'Work', '--profile', 'lite', '--dod-file', DOD]);
ok(!/const DIMENSIONS/.test(lite), '8. --profile lite emits NO const DIMENSIONS (single-agent Review)');

// 9. Every generated script must parse.
let allParse = true;
for (const p of generated) {
  try { execFileSync('node', ['--check', p], { encoding: 'utf8' }); }
  catch (e) { allParse = false; console.error(`     node --check failed for ${p}: ${e.message}`); }
}
ok(allParse, '9. every generated script passes node --check');

rmSync(TMP, { recursive: true, force: true });

if (failures) {
  console.error(`\ncheck RED: ${failures} assertion(s) failed — conductor's CodeGate is not yet a panel.`);
  process.exit(1);
}
console.log('\ncheck GREEN: conductor emits the multi-agent panel CodeGate.');
process.exit(0);
