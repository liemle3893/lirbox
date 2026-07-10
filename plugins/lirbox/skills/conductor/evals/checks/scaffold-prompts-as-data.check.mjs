// ACCEPTANCE CHECK (RED on baseline) — conductor's worker prompts must live as data, not inline.
//
// Concern (feedback/conductor.jsonl → scaffold-prompts-as-data): every worker prompt in
// scaffold-workflow.cjs sits three-to-four quoting layers deep; editing prose means knowing which
// interpolation layer you are in, and a wrong-layer interpolation yields a subtly-wrong generated
// script instead of a parse error. Fix expected: extract the static prose of the worker prompts
// into plain template files under scripts/prompts/ and have the generator load them at generation
// time with mechanical substitution. Templates MAY carry emitted-runtime dollar-brace expressions
// verbatim plus a distinct generation-time placeholder syntax — a pure named-placeholder scheme is
// NOT required.
//
// Discriminating strategy: one distinctive prose sentinel per extracted prompt family.
//   (a) every sentinel appears in SOME file under scripts/prompts/ (any extension)
//   (b) NO sentinel remains inline in scaffold-workflow.cjs source
//   (c) scripts/prompts/ contains at least 12 files (a minimal 3-prompt extraction stays RED)
//   (d) substitution wiring: the sentinel sets OBSERVED in today's generated outputs are pinned
//       and must still land in the outputs — delivery matrix entry (--profile delivery
//       --dod-file … --phases Implement) and a separate Work/--enforce-tests run for TestGate's
//       'Assess the changes on branch' (delivery's cycle replaces TestGate). This guards the
//       wiring, not the location: it passes today via the inline prose and must keep passing
//       after extraction.
//   (e) regression guard: both generated scripts pass node --check.
//
//   - baseline: no scripts/prompts/ dir, prose inline → (a)/(b)/(c) fail, (d)/(e) pass → exit 1 (RED)
//   - after the fix: templates exist, generator loads them, emitted output unchanged → exit 0 (GREEN)
//
// Pin note: 'Review AND fix the changes on branch' (single-agent CodeGate / merged Review tier)
// appears in NEITHER pinned generation's output on the current baseline (delivery emits the panel
// CodeGate instead), so that sentinel is guarded by (a)/(b) only, per the pin-observed-set rule.
//
// Locked (evals/**): the whetstone fixer may NEVER edit this file.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(HERE, '..', '..');                       // .../skills/conductor
const REPO = resolve(SKILL_DIR, '..', '..', '..', '..');           // repo root
const SCAFFOLD = resolve(SKILL_DIR, 'scripts', 'scaffold-workflow.cjs');
const PROMPTS_DIR = resolve(SKILL_DIR, 'scripts', 'prompts');

const TMP = mkdtempSync(join(tmpdir(), 'prompts-data-'));
const PROMPTS = join(TMP, 'prompts.json');
writeFileSync(PROMPTS, JSON.stringify({ Work: 'Do the work.', Implement: 'Do the work.' }));
const DOD = join(TMP, 'dod.json');
writeFileSync(DOD, JSON.stringify({ criteria: [{ id: 'a', text: 't', tier: 'checkable', check: 'true' }] }));

// One distinctive prose sentinel per worker-prompt family currently inline in the generator.
const SENTINELS = [
  'DoD BASELINE (pre-work measurement)',
  'RED (test-first):',
  'VERIFY (GREEN):',
  'PATH-GAP: the ACs do NOT cover',
  'Review AND fix the changes on branch',
  'RE-VERIFY: after IMPROVE/SIMPLIFY',
  'Assess the changes on branch',
  'Write an implementation summary',
  'DoD VERIFY (round',
  'DoD FIX (round',
  'Produce reviewer-facing delivery artifacts',
  'Push the branch and open a PR',
  'Update tracker ticket',
  'READ-ONLY panel review',
  'Score 0-100 how confident',
  'Work ONLY inside the git worktree',
];

// Sentinels OBSERVED in the baseline delivery output (pinned; guards substitution wiring).
const DELIVERY_EXPECTED = [
  'DoD BASELINE (pre-work measurement)',
  'RED (test-first):',
  'VERIFY (GREEN):',
  'PATH-GAP: the ACs do NOT cover',
  'RE-VERIFY: after IMPROVE/SIMPLIFY',
  'Write an implementation summary',
  'DoD VERIFY (round',
  'DoD FIX (round',
  'Produce reviewer-facing delivery artifacts',
  'Push the branch and open a PR',
  'Update tracker ticket',
  'READ-ONLY panel review',
  'Score 0-100 how confident',
  'Work ONLY inside the git worktree',
];

// Sentinels OBSERVED in the baseline Work/--enforce-tests output (pinned).
const TESTGATE_EXPECTED = [
  'Assess the changes on branch',
  'Work ONLY inside the git worktree',
];

let failures = 0;
function ok(cond, msg) {
  if (cond) { console.log(`  ok   ${msg}`); }
  else { failures++; console.error(`  FAIL ${msg}`); }
}

// Recursive file listing; a missing directory reads as "no files" (that IS the RED condition).
function listFiles(dir) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); }
  catch { return []; }
  let out = [];
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out = out.concat(listFiles(p));
    else if (e.isFile()) out.push(p);
  }
  return out;
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

// (a) every sentinel lives in some template file under scripts/prompts/.
const promptFiles = listFiles(PROMPTS_DIR);
const promptBodies = promptFiles.map((p) => readFileSync(p, 'utf8'));
const missingFromTemplates = SENTINELS.filter((s) => !promptBodies.some((b) => b.includes(s)));
for (const s of missingFromTemplates) console.error(`     missing from scripts/prompts/: "${s}"`);
ok(missingFromTemplates.length === 0,
  `a. every sentinel (${SENTINELS.length}) appears in some file under scripts/prompts/`);

// (b) no sentinel remains inline in the generator source.
const generatorSrc = readFileSync(SCAFFOLD, 'utf8');
const stillInline = SENTINELS.filter((s) => generatorSrc.includes(s));
for (const s of stillInline) console.error(`     still inline in scaffold-workflow.cjs: "${s}"`);
ok(stillInline.length === 0, 'b. no sentinel remains inline in scaffold-workflow.cjs');

// (c) at least 12 template files, so a minimal 3-prompt extraction cannot go green.
ok(promptFiles.length >= 12,
  `c. scripts/prompts/ contains at least 12 files (found ${promptFiles.length})`);

// (d) substitution wiring — pinned baseline-observed sentinel sets still land in the outputs.
const delivery = gen(['--phases', 'Implement', '--profile', 'delivery', '--dod-file', DOD]);
const missingDelivery = DELIVERY_EXPECTED.filter((s) => !delivery.includes(s));
for (const s of missingDelivery) console.error(`     missing from delivery output: "${s}"`);
ok(missingDelivery.length === 0,
  `d1. delivery generation emits all ${DELIVERY_EXPECTED.length} pinned sentinels`);

const testgate = gen(['--phases', 'Work', '--enforce-tests']);
const missingTestgate = TESTGATE_EXPECTED.filter((s) => !testgate.includes(s));
for (const s of missingTestgate) console.error(`     missing from Work/--enforce-tests output: "${s}"`);
ok(missingTestgate.length === 0,
  `d2. Work/--enforce-tests generation emits all ${TESTGATE_EXPECTED.length} pinned sentinels (TestGate)`);

// (e) both generated scripts must parse.
let allParse = true;
for (const p of generated) {
  try { execFileSync('node', ['--check', p], { encoding: 'utf8' }); }
  catch (e) { allParse = false; console.error(`     node --check failed for ${p}: ${e.message}`); }
}
ok(allParse, 'e. both generated scripts pass node --check');

rmSync(TMP, { recursive: true, force: true });

if (failures) {
  console.error(`\ncheck RED: ${failures} assertion(s) failed — worker prompts are not yet extracted to scripts/prompts/.`);
  process.exit(1);
}
console.log('\ncheck GREEN: worker prompts live as data under scripts/prompts/ and the wiring holds.');
process.exit(0);
