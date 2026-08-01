#!/usr/bin/env node
/*
 * LIFT PROBE — measure the ±skill lift on ALL FOUR dimensions, under an identical contract.
 *
 * THE CONTRACT IS THE POINT. Both arms are handed the SAME deliverable list: branch it, document
 * it, record a verified definition of done. Grading docs/isolation/dod without asking the control
 * for them would score raw 0 by construction and measure "did you run conductor" rather than "did
 * you deliver well" — an artefact of the question, not a lift. So CONTRACT below is shared verbatim
 * and only the skill differs.
 *
 * Arms:
 *   raw        bare `claude -p` under the contract. No skill, no --plugin-dir.
 *   conductor  same contract, plus "use lirbox:conductor" and the foreground directive that
 *              headless runs require (a backgrounded Workflow orphans when the turn ends).
 *
 * Scored by multi-grade.mjs on: correctness · docs · isolation · dod. All deterministic.
 * Report the LIFT (conductor − raw) per dimension, never a raw score.
 *
 * Usage:
 *   node scripts/lift-probe.mjs --arm raw|conductor [--model <pinned>] [--cap 2700]
 *                               [--max-usd 25] [--task <id>] [--out <dir>]
 * Results stream to <out>/<arm>.json after every task.
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
const die = (m) => { console.error('lift-probe: ' + m); process.exit(2); };

const ARM = String(arg('arm', '')); if (!['raw', 'conductor'].includes(ARM)) die('--arm raw|conductor required');
const MODEL = String(arg('model', 'claude-sonnet-5'));
const CAP = Number(arg('cap', 2700));
const MAX_USD = Number(arg('max-usd', 25));
const ONLY = arg('task', null);
const OUT = String(arg('out', join(tmpdir(), 'lift-probe')));
if (/^(opus|sonnet|haiku|fable|default)$/i.test(MODEL)) die(`--model "${MODEL}" is a floating alias — pin an exact ID`);

// ==== SHARED CONTRACT — identical for both arms. Changing it invalidates comparison with any
// previously recorded arm, so treat it as frozen once a measurement exists. ====
const CONTRACT = `Deliver this as a reviewable unit of work, not just a code change:

1. Do the work on a new git branch and COMMIT it. Leave the working tree clean.
2. Write a short document describing what changed and why, referencing the files you touched, and commit it.
3. Record your definition of done as an explicit checklist, and mark each item once you have verified it.

Then stop. This session is headless and non-interactive — do not ask questions.`;

const graded = SUITE.tasks.filter((t) => t.graded && (!ONLY || ONLY === true || t.id === ONLY));
if (!graded.length) die('no tasks selected');
mkdirSync(OUT, { recursive: true });

console.log(`LIFT PROBE — arm=${ARM} model=${MODEL} cap=${CAP}s max=$${MAX_USD}`);
console.log(`grading: correctness · docs · isolation · dod  (identical contract on both arms)\n`);

const results = [];
let spent = 0;

for (const t of graded) {
  if (spent > MAX_USD) { console.log(`ABORT — $${spent.toFixed(2)} exceeded --max-usd ${MAX_USD}`); break; }

  const clone = join(OUT, `${ARM}--${t.id}`);
  if (existsSync(clone)) rmSync(clone, { recursive: true, force: true });
  execFileSync('git', ['clone', '-q', join(REPO, t.bundle), clone]);
  execFileSync('git', ['-C', clone, 'checkout', '-q', t.sha]);

  const taskText = readFileSync(join(REPO, t.taskFile), 'utf8'); // CONTENT inlined; graders never shipped
  const prompt = ARM === 'conductor'
    ? `Use the lirbox:conductor skill to deliver this change end-to-end. IMPORTANT: this session is headless — if you launch the conductor Workflow in the background and end your turn, the process exits and the run is lost. Invoke it with run_in_background: false and do not end your turn until delivery is finalized.\n\n${CONTRACT}\n\n${taskText}`
    : `${CONTRACT}\n\n${taskText}`;

  const args = ['-p', prompt, '--model', MODEL, '--permission-mode', 'auto', '--output-format', 'stream-json', '--verbose'];
  if (ARM === 'conductor') args.push('--plugin-dir', join(REPO, 'plugins/lirbox'));

  process.stdout.write(`  ${t.id} (${t.difficulty}) … `);
  const t0 = Date.now();
  const res = spawnSync('claude', args, { cwd: clone, timeout: CAP * 1000, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
  const secs = Math.round((Date.now() - t0) / 1000);
  writeFileSync(join(OUT, `${ARM}--${t.id}.trace`), (res.stdout || '') + (res.stderr || ''));

  let cost = null;
  for (const line of (res.stdout || '').split('\n')) {
    if (!line.trim().startsWith('{')) continue;
    try { const j = JSON.parse(line); if (typeof j.total_cost_usd === 'number') cost = j.total_cost_usd; } catch { /* partial */ }
  }
  if (cost != null) spent += cost;

  const timedOut = res.error && res.error.code === 'ETIMEDOUT';
  const mg = spawnSync('node', [join(ARENA, 'multi-grade.mjs'), '--task', t.id, '--repo', clone, '--json'], { encoding: 'utf8' });
  let rec = { task: t.id, difficulty: t.difficulty, arm: ARM, model: MODEL, secs, costUsd: cost, timedOut: !!timedOut };
  try { const j = JSON.parse(mg.stdout); rec.dimensions = j.dimensions; rec.mean = j.mean; rec.deliveryRef = j.deliveryRef; rec.evidence = j.evidence; }
  catch { rec.error = 'multi-grade-parse-error'; writeFileSync(join(OUT, `${ARM}--${t.id}.grade.stdout`), mg.stdout || ''); }

  results.push(rec);
  const d = rec.dimensions;
  console.log(d
    ? `corr ${d.correctness.toFixed(2)} docs ${d.docs.toFixed(2)} iso ${d.isolation.toFixed(2)} dod ${d.dod.toFixed(2)} | mean ${rec.mean.toFixed(2)} | ${secs}s ${cost != null ? '$' + cost.toFixed(2) : ''}${timedOut ? ' TIMEOUT' : ''}`
    : `GRADE ERROR ${secs}s`);
  writeFileSync(join(OUT, `${ARM}.json`), JSON.stringify({ arm: ARM, model: MODEL, cap: CAP, contract: CONTRACT, results, spentUsd: spent }, null, 2));
}

const scored = results.filter((r) => r.dimensions);
const avg = (k) => scored.length ? scored.reduce((s, r) => s + r.dimensions[k], 0) / scored.length : 0;
console.log(`\n=== ARM ${ARM} — mean over ${scored.length} task(s) ===`);
for (const k of ['correctness', 'docs', 'isolation', 'dod']) console.log(`  ${k.padEnd(12)} ${avg(k).toFixed(3)}`);
console.log(`  ${'MEAN'.padEnd(12)} ${((avg('correctness') + avg('docs') + avg('isolation') + avg('dod')) / 4).toFixed(3)}`);
console.log(`Spend: $${spent.toFixed(2)}  ·  ${join(OUT, ARM + '.json')}`);
