// ACCEPTANCE CHECK (RED on baseline) — workflow-report.cjs must render the DoD scorecard + panel summary.
//
// Concern (feedback/conductor.jsonl → report-dod-scorecard): the run report built from a run's state
// file currently carries only tokens/cost. It must additionally render, from state.dod + state.results:
//   1. a "## Definition of done — 1/2 MET" section (2 criteria, dodGate verdicts MET + UNMET);
//   2. the baseline-honesty flag — "already met pre-work" for a criterion whose dodBaseline status is met;
//   3. a panel summary — "7 raw finding(s) → 5 deduped → 2 confirmed" for codeGate.panel {raw:7,deduped:5,confirmed:2}.
//
// Passes iff ALL three strings appear in the report the script produces.
//   - baseline (no DoD/panel section) → strings absent → exit 1  (RED — the discrimination gate wants this)
//   - after the fix                   → strings present → exit 0  (GREEN)
//
// Determinism: --project-dir points at an EMPTY dir so token attribution reads no transcripts; no network,
// no assertion on durations/tokens/costs. Locked (evals/**): the whetstone fixer may NEVER edit this file.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(HERE, '..', '..');                       // .../skills/conductor
const REPORT = resolve(SKILL_DIR, 'scripts', 'workflow-report.cjs');

// Synthetic state — reused verbatim from the plan (Task 3, Step 2 fixture).
const STATE = {
  workflow: 'demo', status: 'complete',
  startedAt: '2026-07-10T00:00:00Z', finishedAt: '2026-07-10T00:10:00Z',
  branch: 'wf/demo', worktree: '.worktrees/demo', phasesDone: ['Setup'],
  dod: { criteria: [
    { id: 'ac1', text: 'unit tests green', tier: 'checkable', check: 'yarn test' },
    { id: 'ac2', text: 'error message is clear', tier: 'judged' } ] },
  results: {
    dodBaseline: { baselines: [ { id: 'ac1', status: 'met' } ] },
    dodGate: { criteria: [
      { id: 'ac1', verdict: 'MET', evidence: 'yarn test exit 0' },
      { id: 'ac2', verdict: 'UNMET', evidence: 'message still says err 42' } ] },
    codeGate: { gatePassed: true, panel: { raw: 7, deduped: 5, confirmed: 2 } } },
};

const EXPECT = [
  '## Definition of done — 1/2 MET',
  'already met pre-work',
  '7 raw finding(s) → 5 deduped → 2 confirmed',
];

const tmp = mkdtempSync(join(tmpdir(), 'report-dod-'));
try {
  mkdirSync(join(tmp, '.workflows', 'state'), { recursive: true });
  mkdirSync(join(tmp, 'no-transcripts'), { recursive: true });
  writeFileSync(join(tmp, '.workflows', 'state', 'demo.json'), JSON.stringify(STATE));

  let out;
  try {
    out = execFileSync('node', [REPORT, 'demo', '--project-dir', join(tmp, 'no-transcripts')],
      { cwd: tmp, encoding: 'utf8' });
  } catch (e) {
    console.error(`check: workflow-report.cjs failed to run: ${e.message}`);
    process.exit(2);   // harness error, not a verdict
  }

  const ok = (cond, msg) => { if (!cond) { console.error(`check RED: ${msg}`); process.exitCode = 1; } };
  for (const s of EXPECT) ok(out.includes(s), `report is missing expected string: ${JSON.stringify(s)}`);

  if (process.exitCode === 1) {
    console.error('workflow-report.cjs renders no DoD/panel section yet — relocate the scorecard into the report.');
  } else {
    console.log('check GREEN: report renders the DoD scorecard (1/2 MET), baseline-honesty flag, and panel summary.');
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
