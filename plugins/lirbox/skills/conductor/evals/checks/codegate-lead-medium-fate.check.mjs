// ACCEPTANCE CHECK (RED on baseline) — confirmed Medium/Low panel findings must have a fate.
//
// Concern (feedback/conductor.jsonl → codegate-lead-medium-fate): the panel CodeGate's confidence
// scorers filter on confidence only (confidence >= 80) with no severity criterion, so
// verified-real Medium/Low findings reach the lead — but the lead prompt only instructs "FIX
// every Critical and High" and permits skipping a finding "ONLY with an explicit reason it is
// wrong", so a confirmed Medium has no legal disposition and silently vanishes from the run's
// audit trail. Expected fix: a lead-prompt line giving Medium/Low a disposition (fix only when
// trivial and zero-risk; otherwise return them untouched as known-open with file:line), a
// knownOpen array in the lead schema (items with at least file, line, severity, title) riding
// the existing { ...last } spread into results.codeGate, and a known-open line rendered by
// workflow-report.cjs.
//
//   - baseline: the lead-prompt block mentions only Critical/High and 'knownOpen' appears
//     nowhere in the generated script nor in workflow-report.cjs → assertions a, b1, c fail
//     (b2, the { ...last } spread regression guard, passes today) → exit 1 (RED)
//   - after the fix (prompt disposition + schema knownOpen + report render, spread intact)
//     → all four pass → exit 0 (GREEN)
//
// Scoping is load-bearing: assertion (a) tests ONLY the lead-prompt block (the substring between
// 'review-panel LEAD' and 'FINDINGS (JSON)') — the dimension prompt and the findings-schema
// severity enum already contain 'Medium' today, so an unscoped grep would pass on baseline and
// break the RED claim.
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

const TMP = mkdtempSync(join(tmpdir(), 'medium-fate-'));
const PROMPTS = join(TMP, 'prompts.json');
writeFileSync(PROMPTS, JSON.stringify({ Implement: 'Do the work.' }));

let failures = 0;
function ok(cond, msg) {
  if (cond) { console.log(`  ok   ${msg}`); }
  else { failures++; console.error(`  FAIL ${msg}`); }
}

// Harness error (exit 2): the check cannot even locate the structure it is scoped to —
// the generator output shape changed, so neither RED nor GREEN would be meaningful.
function harnessError(msg) {
  console.error(`check: ${msg} — generator output shape changed; re-derive the check`);
  rmSync(TMP, { recursive: true, force: true });
  process.exit(2);
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

// --- Generate the panel workflow and verify the slice boundaries exist before slicing ---
const src = gen(['--phases', 'Implement', '--profile', 'delivery', '--no-dod']);

const leadPromptStart = src.indexOf('review-panel LEAD');
if (leadPromptStart < 0) harnessError("needle 'review-panel LEAD' not found in the generated script");
const leadPromptEnd = src.indexOf('FINDINGS (JSON)', leadPromptStart);
if (leadPromptEnd < 0) harnessError("needle 'FINDINGS (JSON)' not found after 'review-panel LEAD'");
const promptBlock = src.slice(leadPromptStart, leadPromptEnd);

const labelIdx = src.indexOf('codegate:lead-r', leadPromptEnd);
if (labelIdx < 0) harnessError("needle 'codegate:lead-r' not found after the lead prompt");
const schemaIdx = src.indexOf('schema:', labelIdx);
if (schemaIdx < 0) harnessError("needle 'schema:' not found after 'codegate:lead-r'");

// (a) The lead-prompt block gives Medium/Low a disposition and names the known-open path.
// Scoped to the block between 'review-panel LEAD' and 'FINDINGS (JSON)' — see header.
const aMedium = /[Mm]edium/.test(promptBlock);
const aKnown = /known[- ]?open/i.test(promptBlock);
const aNote = aMedium && aKnown ? ''
  : ` — lead-prompt block is missing ${[!aMedium && "/[Mm]edium/", !aKnown && '/known[- ]?open/i'].filter(Boolean).join(' and ')}`;
ok(aMedium && aKnown,
  `a. lead-prompt block (review-panel LEAD → FINDINGS (JSON)) gives Medium a known-open disposition${aNote}`);

// (b1) The lead schema declares a knownOpen ARRAY whose item schema includes file, line,
// severity, title.
let b1Pass = false, b1Note = '';
const schemaLit = braced(src, schemaIdx);
if (!schemaLit) harnessError("could not extract a balanced schema literal after 'codegate:lead-r'");
const kMatch = schemaLit.match(/["']?knownOpen["']?\s*:/);
if (!kMatch) {
  b1Note = ' — lead schema has no knownOpen property';
} else {
  const sub = braced(schemaLit, kMatch.index + kMatch[0].length);
  let ko = null;
  try { ko = JSON.parse(sub); } catch { b1Note = ' — knownOpen sub-schema is not parseable JSON'; }
  if (ko) {
    const itemProps = (ko.items && ko.items.properties) || {};
    const missing = ['file', 'line', 'severity', 'title'].filter((k) => !(k in itemProps));
    b1Pass = ko.type === 'array' && missing.length === 0;
    if (!b1Pass) b1Note = ko.type !== 'array'
      ? ' — knownOpen is not an array schema'
      : ` — knownOpen item schema is missing: ${missing.join(', ')}`;
  }
}
ok(b1Pass, `b1. lead schema declares a knownOpen array whose items include file, line, severity, title${b1Note}`);

// (b2) REGRESSION GUARD (must pass on baseline AND stay green): the lead result still rides the
// { ...last } spread into results.codeGate — that spread is how knownOpen reaches the state file.
ok(/results\.codeGate = \{ \.\.\.last/.test(src),
  'b2. results.codeGate still spreads the lead result (regression guard: /results\\.codeGate = \\{ \\.\\.\\.last/)');

// (c) workflow-report.cjs references knownOpen and renders a fixture state's known-open entry.
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
      summary: 'panel: 3 raw, 1 confirmed',
      panel: { raw: 3, deduped: 2, confirmed: 1 },
      knownOpen: [{ file: 'src/widget.js', line: 42, severity: 'Medium', title: 'FIXTURE-KNOWN-OPEN' }],
    },
  },
}, null, 2));

let cPass = false, cNote = '';
const reportSrc = readFileSync(REPORT, 'utf8');
if (!/knownOpen/.test(reportSrc)) {
  cNote = ' — workflow-report.cjs never references knownOpen';
} else {
  try {
    const md = execFileSync('node', [REPORT, 'fixture', '--project-dir', projDir],
      { cwd: TMP, encoding: 'utf8' });
    cPass = md.includes('FIXTURE-KNOWN-OPEN');
    if (!cPass) cNote = " — report ran but did not render the fixture's known-open entry";
  } catch (e) {
    cNote = ` — workflow-report.cjs errored on the fixture state: ${String(e.message).split('\n')[0]}`;
  }
}
ok(cPass, `c. workflow-report.cjs references knownOpen and renders the FIXTURE-KNOWN-OPEN entry${cNote}`);

rmSync(TMP, { recursive: true, force: true });

if (failures) {
  console.error(`\ncheck RED: ${failures} assertion(s) failed — confirmed Medium/Low findings still vanish without a disposition.`);
  process.exit(1);
}
console.log('\ncheck GREEN: Medium/Low findings get a known-open disposition that survives into the state and the run report.');
process.exit(0);
