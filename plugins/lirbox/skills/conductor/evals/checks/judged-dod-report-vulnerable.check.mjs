// ACCEPTANCE CHECK (RED on baseline) — the DoDGate VERIFY prompt must not let a judged-tier
// criterion pass on worker reports alone.
//
// Concern (feedback/conductor.jsonl → judged-dod-report-vulnerable): a judged-tier DoD criterion
// can be scored MET (or waved through as "deferred") on the strength of worker reports /
// implementation-notes, with no code behind it. Observed live: the spec required TOTP, DoDGate
// ran, the main agent relayed "feature was deferred", and not one line of TOTP code existed.
//
// Fix layer this check targets: the DoDGate worker prompt for judged criteria (emitted from
// scripts/prompts/dodgate-verify.txt via scaffold-workflow.cjs) must, for judged verdicts,
//   (a) require verification against the actual diff / artifacts in the worktree (artifact
//       evidence — not a self-report);
//   (b) explicitly treat worker reports / implementation-notes as UNTRUSTED claims that cannot
//       satisfy a criterion by themselves;
//   (c) hard-fail (UNMET) any criterion whose feature was deferred / descoped, i.e. a deferral is
//       tied to a failing verdict — not silently accepted.
//
// Assertions run against the emitted DoDGate VERIFY prompt segment ONLY (extracted from the
// generated .js), because words like "diff"/"artifact"/"human" appear in OTHER phase prompts
// (CodeGate/Review/panel-lead) and must not leak a false GREEN.
//
// Baseline (dodgate-verify.txt has none of the three directives): all three FAIL → exit 1 (RED).
// After the fix (directives added to the DoDGate verify prompt): all three hold → exit 0 (GREEN).
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
const GEN = resolve(REPO, 'plugins/lirbox/skills/conductor/scripts/scaffold-workflow.cjs');

const TMP = mkdtempSync(join(tmpdir(), 'judged-dod-check-'));

// --- fixtures the check writes itself (never under evals/fixtures) ---
const promptsFile = join(TMP, 'prompts.json');
writeFileSync(promptsFile, JSON.stringify({ Work: 'Do the work.' }));

// A judged-tier criterion — the exact shape the live failure abused (TOTP, no checkable command).
const dodFile = join(TMP, 'dod-judged.json');
writeFileSync(dodFile, JSON.stringify({ criteria: [
  { id: 'totp', text: 'TOTP-based 2FA is implemented and enforced at login', tier: 'judged' },
] }));

// Generate the workflow (with --pr so Writeup exists and DoDGate sits before it) and read it back.
const outFile = join(TMP, 'judged.js');
let src = '';
try {
  execFileSync('node', [GEN, '--name', 'judged', '--out', outFile, '--force',
    '--prompts-file', promptsFile, '--phases', 'Work', '--pr', '--dod-file', dodFile],
    { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  src = readFileSync(outFile, 'utf8');
} catch (e) {
  src = '';
  console.error('generator failed:', (e.stdout || '') + (e.stderr || ''));
}

// Extract the DoDGate VERIFY prompt segment ONLY (the backtick template handed to the verify
// agent). Scoping here is load-bearing: "diff"/"artifact"/"human" live in other phase prompts.
const m = src.match(/dodLast = await agent\(\s*`([\s\S]*?)`\s*,\s*\{\s*label:\s*`dodgate:verify/);
const seg = m ? m[1] : '';

const results = [];
function ok(pass, label) {
  results.push({ pass, label });
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${label}`);
}

// Precondition: we actually found the verify prompt. If not, the three directive checks below are
// meaningless — surface it as its own failure rather than reporting three misleading FAILs.
ok(seg !== '', '0. DoDGate verify prompt segment extracted from the emitted script');

// (a) Judged verdicts must be grounded in the actual diff / artifacts in the worktree — not a
//     self-report. Baseline verify prompt contains neither "diff" nor "artifact".
const artifactEvidence = /\b(diff|artifacts?)\b/i.test(seg);
ok(artifactEvidence,
  '(a) verify prompt grounds judged verdicts in the actual diff/artifacts in the worktree');

// (b) Worker reports / implementation-notes are UNTRUSTED claims that cannot satisfy a criterion
//     by themselves. Needs BOTH: a reference to reports/notes AND a distrust directive.
const mentionsReports = /\b(report|reports|implementation-notes|self-report)\b/i.test(seg);
const treatsUntrusted = /\b(untrust|untrusted|do not trust|don'?t trust|not be trusted|not trusted|claim|claims|are not evidence|is not evidence|cannot (satisfy|prove|substitute)|by (themselves|itself)|on (their|its) own|alone)\b/i.test(seg);
ok(mentionsReports && treatsUntrusted,
  '(b) verify prompt marks worker reports/implementation-notes as untrusted claims (cannot satisfy a criterion alone)');

// (c) A deferred / descoped feature must be scored NOT MET — a deferral is tied to a failing
//     verdict, not silently accepted. Baseline verify prompt never mentions deferral at all.
const mentionsDeferral = /\b(defer|deferred|descope|descoped|de-scope|de-scoped)\b/i.test(seg);
const failsVerdict = /\b(UNMET|not\s+MET|not\s+met|fail|fails|failing)\b/i.test(seg);
ok(mentionsDeferral && failsVerdict,
  '(c) verify prompt hard-fails (UNMET) a deferred/descoped criterion');

rmSync(TMP, { recursive: true, force: true });

const failed = results.filter((r) => !r.pass);
if (failed.length) {
  console.error(`\ncheck RED: ${failed.length}/${results.length} assertion(s) failed — the DoDGate verify prompt lets a judged criterion pass on worker reports alone (no artifact-evidence / untrusted-reports / deferral-fails directives).`);
  process.exit(1);
}
console.log(`\ncheck GREEN: all ${results.length} judged-DoD-grounding assertions passed.`);
process.exit(0);
