#!/usr/bin/env node
/*
 * HEADROOM PROBE — the RAW (control) arm: no skill, no conductor, no --plugin-dir.
 *
 * WHY THIS EXISTS. The repo rule is *report the lift, never the raw score* — and lift is bounded at
 * ZERO on any task the control arm already resolves. A saturated task cannot discriminate a skill, a
 * config, a model or a version, at any budget, so every scorecard built on one measures the
 * fixtures' difficulty rather than the thing under test. This probe is how you find out, cheaply,
 * BEFORE spending on a comparison.
 *
 *   raw RESOLVES -> SATURATED. Retire the task from the lift suite (mark `graded: false`, keep the
 *                   files — it may regain headroom against a weaker tier later).
 *   raw FAILS    -> HEADROOM. The task can measure whether the skill helps.
 *
 * Mirrors swe-run.mjs's clone/grade path exactly so results are comparable with the scoreboard:
 * clone the fixture bundle -> checkout the base sha -> `claude -p` with the task CONTENT inlined
 * (hidden graders are never shipped to the agent) -> capture the diff -> swe-grade.mjs.
 * Three deliberate differences, and only these: no conductor preamble, no --plugin-dir, and the
 * diff comes from the WORKING TREE because a raw session has no `wf/` branch to diff against.
 *
 * RUN THE FREE GATE FIRST. For each task you intend to probe:
 *   node plugins/lirbox/skills/arena/scripts/swe-grade.mjs --task <id> --validate
 * It must report p2pGreenOnBase and every f2p RED with no leaks. Otherwise a "raw failed" result is
 * the grader failing, not the agent, and you have paid for noise.
 *
 * Usage:
 *   node scripts/raw-headroom-probe.mjs [--model <pinned-id>] [--cap 1800] [--max-usd 20]
 *                                       [--out <dir>] [--task <id>] [--skip <id,id>]
 *   --model     MUST be an exact ID; floating aliases (`sonnet`) drift and are rejected.
 *   --skip      tasks already answered elsewhere — do not re-buy recorded data.
 *   --max-usd   hard stop checked before each task starts.
 *
 * Results stream to <out>/results.json after EVERY task, so an interrupted run loses at most one.
 * Result recorded 2026-08-01, sonnet-5: 7/7 SATURATED, $2.12 — see docs/arena/experiments.md.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const ARENA = join(REPO, 'plugins/lirbox/skills/arena/scripts');
const SUITE = JSON.parse(readFileSync(join(REPO, 'plugins/lirbox/skills/conductor/arena/suite.json'), 'utf8'));

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); const v = process.argv[i + 1]; return i > -1 ? (v && !v.startsWith('--') ? v : true) : d; };
const die = (m) => { console.error('raw-headroom-probe: ' + m); process.exit(2); };

const MODEL = String(arg('model', 'claude-sonnet-5'));
const CAP = Number(arg('cap', 1800));
const MAX_USD = Number(arg('max-usd', 20));
const ONLY = arg('task', null);
const SKIP = new Set(String(arg('skip', '')).split(',').filter(Boolean));
const OUT = String(arg('out', join(tmpdir(), 'raw-headroom-probe')));

// A floating alias means a different model tomorrow, which silently breaks comparability with the
// row this probe is about to justify retiring. Same rule swe-run.mjs enforces.
if (/^(opus|sonnet|haiku|fable|default)$/i.test(MODEL)) die(`--model "${MODEL}" is a floating alias — pin an exact ID (e.g. claude-sonnet-5)`);

const graded = SUITE.tasks.filter((t) => t.graded);
const targets = graded.filter((t) => !SKIP.has(t.id) && (!ONLY || ONLY === true || t.id === ONLY));
if (!targets.length) die('no tasks selected');
mkdirSync(OUT, { recursive: true });

console.log(`RAW HEADROOM PROBE — model=${MODEL} cap=${CAP}s max=$${MAX_USD}`);
if (SKIP.size) console.log(`skipping (already answered): ${[...SKIP].join(', ')}`);
console.log(`probing ${targets.length} of ${graded.length} registered graded task(s)\n`);

const results = [];
let spent = 0;

for (const t of targets) {
  if (spent > MAX_USD) { console.log(`ABORT — spend $${spent.toFixed(2)} exceeded --max-usd ${MAX_USD}`); break; }

  const clone = join(OUT, t.id);
  if (existsSync(clone)) rmSync(clone, { recursive: true, force: true });
  execFileSync('git', ['clone', '-q', join(REPO, t.bundle), clone]);
  execFileSync('git', ['-C', clone, 'checkout', '-q', t.sha]);

  const taskText = readFileSync(join(REPO, t.taskFile), 'utf8'); // CONTENT inlined, never the path
  process.stdout.write(`  ${t.id} (${t.difficulty}) … `);

  const t0 = Date.now();
  const res = spawnSync('claude', [
    '-p',
    `This session is headless and non-interactive. Implement the following change directly in this repository, then stop. Do not ask questions.\n\n${taskText}`,
    '--model', MODEL, '--permission-mode', 'auto',
    '--output-format', 'stream-json', '--verbose',
  ], { cwd: clone, timeout: CAP * 1000, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

  const secs = Math.round((Date.now() - t0) / 1000);
  writeFileSync(join(OUT, t.id + '.trace'), (res.stdout || '') + (res.stderr || ''));

  let cost = null;
  for (const line of (res.stdout || '').split('\n')) {
    if (!line.trim().startsWith('{')) continue;
    try { const j = JSON.parse(line); if (typeof j.total_cost_usd === 'number') cost = j.total_cost_usd; } catch { /* partial line */ }
  }
  if (cost != null) spent += cost;

  const timedOut = res.error && res.error.code === 'ETIMEDOUT';
  const rec = { task: t.id, difficulty: t.difficulty, model: MODEL, secs, costUsd: cost, timedOut: !!timedOut };

  if (timedOut) {
    rec.label = 'HEADROOM';
    rec.reason = `timeout at ${CAP}s — raw did not finish, so raw does not resolve it`;
  } else {
    const diffPath = join(OUT, t.id + '.diff');
    execFileSync('git', ['-C', clone, 'add', '-A']); // untracked files are part of the delivery
    writeFileSync(diffPath, execFileSync('git', ['-C', clone, 'diff', '--cached', t.sha], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
    const g = spawnSync('node', [join(ARENA, 'swe-grade.mjs'), '--task', t.id, '--diff', diffPath], { encoding: 'utf8' });
    try {
      const grade = JSON.parse(g.stdout);
      rec.resolved = !!grade.resolved;
      rec.f2p = grade.f2p;
      rec.p2p = grade.p2p;
      rec.label = grade.resolved ? 'SATURATED' : 'HEADROOM';
      rec.reason = grade.resolved
        ? 'a bare unaided session resolves it — lift is bounded at zero'
        : `raw failed ${grade.f2p.total - grade.f2p.passed}/${grade.f2p.total} criteria — measurable headroom`;
    } catch {
      // An unparseable grade is NOT a pass and NOT a fail — say so rather than picking one.
      rec.label = 'INDETERMINATE';
      rec.reason = 'grade-parse-error — inspect <out>/<task>.grade.stdout';
      writeFileSync(join(OUT, t.id + '.grade.stdout'), g.stdout || '');
    }
  }

  results.push(rec);
  console.log(`${rec.label}  ${rec.f2p ? rec.f2p.passed + '/' + rec.f2p.total : '—'}  ${secs}s  ${cost != null ? '$' + cost.toFixed(2) : 'cost?'}`);
  writeFileSync(join(OUT, 'results.json'), JSON.stringify({ model: MODEL, cap: CAP, skipped: [...SKIP], results, spentUsd: spent }, null, 2));
}

console.log(`\n=== VERDICT ===`);
for (const r of results) console.log(`  ${r.label.padEnd(13)} ${r.task.padEnd(22)} ${r.f2p ? r.f2p.passed + '/' + r.f2p.total : ''}  ${r.reason}`);
const headroom = results.filter((r) => r.label === 'HEADROOM').length;
const indet = results.filter((r) => r.label === 'INDETERMINATE').length;
console.log(`\nHEADROOM ${headroom} · SATURATED ${results.length - headroom - indet} · INDETERMINATE ${indet}  (of ${results.length} probed; ${graded.length} registered)`);
console.log(`Spend: $${spent.toFixed(2)}  ·  results: ${join(OUT, 'results.json')}`);
if (indet) console.log('NOTE: an INDETERMINATE task is unanswered — do not count it either way.');
