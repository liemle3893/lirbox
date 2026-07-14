#!/usr/bin/env node
/*
 * Independent SWE-style benchmark run for ONE conductor config — the "just run the new version, then
 * compare scores" command. For every graded task in the frozen suite (× --runs), it:
 *   clone fixture bundle → run conductor HEADLESS (task CONTENT inlined — hidden graders stay hidden)
 *   → detect engagement (wf/ branch) → capture the wf/-branch diff → swe-grade → cell record,
 * then writes docs/arena/scores/<name>.json (with the suite fingerprint) and refreshes the scoreboard.
 *
 * Usage:
 *   node swe-run.mjs --name <label> --model <model> [--effort high] [--plugin-dir <lirbox-checkout>]
 *                    [--runs 1] [--cap 900] [--keep <dir>]
 *   --plugin-dir benchmarks a specific conductor VERSION (a lirbox checkout); omit for the installed one.
 *   --keep saves per-cell diffs/traces/grades there (else a temp dir, removed on success).
 *
 * Cells run SEQUENTIALLY (one conductor fleet at a time — predictable resource use); each is bounded by
 * --cap seconds. A cell that times out / doesn't engage conductor / doesn't resolve scores as failed —
 * it still COUNTS in the denominator. Exit 0 always (a low score is a result, not an error); exit 2 on
 * setup/usage errors only.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeScorecard } from './swe-score.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..', '..', '..');
const SUITE = JSON.parse(readFileSync(join(REPO, 'plugins', 'lirbox', 'skills', 'conductor', 'arena', 'suite.json'), 'utf8'));

function arg(name, def) { const i = process.argv.indexOf('--' + name); const v = process.argv[i + 1]; return i > -1 ? (v && !v.startsWith('--') ? v : true) : def; }
function die(msg) { console.error('swe-run: ' + msg); process.exit(2); }

const name = arg('name'); if (!name || name === true) die('--name <label> required');
const model = arg('model'); if (!model || model === true) die('--model <model> required');
// Floating aliases drift (tomorrow "opus" means a different model) and silently corrupt scorecard
// comparability — the scorecard must record the EXACT model that ran.
if (/^(opus|sonnet|haiku|fable|default)$/i.test(String(model))) die(`--model "${model}" is a floating alias — pin an exact model ID (e.g. claude-opus-4-8[1m])`);
const effort = String(arg('effort', 'high'));
const pluginDir = arg('plugin-dir', null);
const runs = Math.max(1, parseInt(arg('runs', '1'), 10) || 1);
const cap = Math.max(60, parseInt(arg('cap', '900'), 10) || 900);
const keep = arg('keep', null);

const graded = SUITE.tasks.filter((t) => t.graded);
if (!graded.length) die('no graded tasks in suite.json');
const work = keep && keep !== true ? resolve(String(keep)) : mkdtempSync(join(tmpdir(), 'swe-run-'));
mkdirSync(work, { recursive: true });

console.log(`swe-run "${name}": ${graded.length} task(s) × ${runs} run(s), model=${model} effort=${effort}${pluginDir ? ` plugin-dir=${pluginDir}` : ''}, cap=${cap}s`);
const cells = [];
for (const t of graded) {
  const taskText = readFileSync(join(REPO, t.taskFile), 'utf8'); // CONTENT inlined — never the path
  for (let r = 0; r < runs; r++) {
    const tag = `${t.id}--run${r}`;
    const clone = join(work, tag);
    execFileSync('git', ['clone', '-q', join(REPO, t.bundle), clone]);
    execFileSync('git', ['-C', clone, 'checkout', '-q', t.sha]);
    process.stdout.write(`  ${tag}: conductor… `);
    const claudeArgs = ['-p',
      `Use the lirbox:conductor skill to deliver this change end-to-end (durable multi-phase run):\n\n${taskText}`,
      '--model', String(model), '--effort', effort, '--permission-mode', 'auto',
      '--output-format', 'stream-json', '--verbose'];
    if (pluginDir && pluginDir !== true) claudeArgs.push('--plugin-dir', resolve(String(pluginDir)));
    const t0 = Date.now();
    const res = spawnSync('claude', claudeArgs, { cwd: clone, timeout: cap * 1000, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    writeFileSync(join(work, tag + '.trace'), (res.stdout || '') + (res.stderr || ''));
    const secs = Math.round((Date.now() - t0) / 1000);
    const timedOut = res.error && res.error.code === 'ETIMEDOUT';
    let wf = '';
    try { wf = execFileSync('git', ['-C', clone, 'branch', '--format=%(refname:short)'], { encoding: 'utf8' }).split('\n').find((b) => b.startsWith('wf/')) || ''; } catch (e) { /* clone broken */ }
    let cell = { task: t.id, run: r, secs, engaged: !!wf, resolved: false, f2p: { passed: 0, total: 0 } };
    if (timedOut) cell.reason = 'timeout';
    else if (!wf) cell.reason = 'no-conductor-engagement';
    else {
      const diffPath = join(work, tag + '.diff');
      writeFileSync(diffPath, execFileSync('git', ['-C', clone, 'diff', t.sha, wf], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
      const g = spawnSync('node', [join(HERE, 'swe-grade.mjs'), '--task', t.id, '--diff', diffPath], { encoding: 'utf8' });
      writeFileSync(join(work, tag + '.grade'), g.stdout || '{}');
      try { const gj = JSON.parse(g.stdout); cell.resolved = !!gj.resolved; cell.f2p = gj.f2p || cell.f2p; cell.p2p = gj.p2p; } catch (e) { cell.reason = 'grade-parse-error'; }
    }
    cells.push(cell);
    console.log(`${cell.resolved ? 'RESOLVED' : 'failed (' + (cell.reason || 'unresolved') + ')'} f2p=${cell.f2p.passed}/${cell.f2p.total} ${secs}s`);
  }
}

const card = writeScorecard({ name: String(name), config: { model: String(model), effort, pluginDir: pluginDir && pluginDir !== true ? String(pluginDir) : null, runs }, cells });
console.log(`\nscore: ${card.score.resolved}/${card.score.total} resolved (${Math.round(card.score.rate * 100)}%, 95% CI ${card.score.wilson95.map((x) => Math.round(x * 100) + '%').join('–')}) — suite ${card.suiteHash}`);
console.log(`scorecard: docs/arena/scores/${name}.json · scoreboard: docs/arena/scores/README.md`);
if (!keep) rmSync(work, { recursive: true, force: true });
