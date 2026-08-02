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
const RUNS = Number(arg('runs', 1));
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

const cells = [];
for (const t of graded) for (let r = 0; r < RUNS; r++) cells.push({ t, r });

for (const { t, r: runIdx } of cells) {
  if (spent > MAX_USD) { console.log(`ABORT — $${spent.toFixed(2)} exceeded --max-usd ${MAX_USD}`); break; }

  const clone = join(OUT, `${ARM}--${t.id}--run${runIdx}`);
  if (existsSync(clone)) rmSync(clone, { recursive: true, force: true });
  execFileSync('git', ['clone', '-q', join(REPO, t.bundle), clone]);
  execFileSync('git', ['-C', clone, 'checkout', '-q', t.sha]);

  const taskText = readFileSync(join(REPO, t.taskFile), 'utf8'); // CONTENT inlined; graders never shipped
  const prompt = ARM === 'conductor'
    ? `Use the lirbox:conductor skill to deliver this change end-to-end. IMPORTANT: this session is headless — if you launch the conductor Workflow in the background and end your turn, the process exits and the run is lost. Invoke it with run_in_background: false and do not end your turn until delivery is finalized.\n\n${CONTRACT}\n\n${taskText}`
    : `${CONTRACT}\n\n${taskText}`;

  const args = ['-p', prompt, '--model', MODEL, '--permission-mode', 'auto', '--output-format', 'stream-json', '--verbose'];
  if (ARM === 'conductor') args.push('--plugin-dir', join(REPO, 'plugins/lirbox'));

  process.stdout.write(`  ${t.id}${RUNS > 1 ? ' run' + runIdx : ''} (${t.difficulty}) … `);
  const t0 = Date.now();
  const res = spawnSync('claude', args, { cwd: clone, timeout: CAP * 1000, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
  const secs = Math.round((Date.now() - t0) / 1000);
  writeFileSync(join(OUT, `${ARM}--${t.id}--run${runIdx}.trace`), (res.stdout || '') + (res.stderr || ''));

  let cost = null;
  for (const line of (res.stdout || '').split('\n')) {
    if (!line.trim().startsWith('{')) continue;
    try { const j = JSON.parse(line); if (typeof j.total_cost_usd === 'number') cost = j.total_cost_usd; } catch { /* partial */ }
  }
  if (cost != null) spent += cost;

  const timedOut = res.error && res.error.code === 'ETIMEDOUT';
  const mg = spawnSync('node', [join(ARENA, 'multi-grade.mjs'), '--task', t.id, '--repo', clone, '--json'], { encoding: 'utf8' });
  let rec = { task: t.id, run: runIdx, difficulty: t.difficulty, arm: ARM, model: MODEL, secs, costUsd: cost, timedOut: !!timedOut };
  try {
    const j = JSON.parse(mg.stdout);
    rec.dimensions = j.dimensions; rec.mean = j.mean; rec.deliveryRef = j.deliveryRef; rec.evidence = j.evidence;
    // ENGAGEMENT, measured — never assumed. A `conductor` cell that produced no wf/ branch never ran
    // the skill: it is a RAW delivery wearing the conductor label, and averaging it into the arm
    // silently mixes the two populations. This is the confound arena #41 fixed for swe-run and that
    // this grader reintroduced by being arm-agnostic. Tri-state: null where the concept
    // does not apply (the raw arm has no branch convention to satisfy).
    rec.engaged = ARM === 'conductor' ? /^wf\//.test(j.deliveryRef || '') : null;
  }
  catch { rec.error = 'multi-grade-parse-error'; writeFileSync(join(OUT, `${ARM}--${t.id}--run${runIdx}.grade.stdout`), mg.stdout || ''); }

  results.push(rec);
  const d = rec.dimensions;
  console.log(d
    ? `corr ${d.correctness.toFixed(2)} docs ${d.docs.toFixed(2)} iso ${d.isolation.toFixed(2)} dod ${d.dod.toFixed(2)} | mean ${rec.mean.toFixed(2)} | ${secs}s ${cost != null ? '$' + cost.toFixed(2) : ''}${timedOut ? ' TIMEOUT' : ''}`
    : `GRADE ERROR ${secs}s`);
  writeFileSync(join(OUT, `${ARM}.json`), JSON.stringify({ arm: ARM, model: MODEL, cap: CAP, contract: CONTRACT, results, spentUsd: spent }, null, 2));
}

const all = results.filter((r) => r.dimensions);
const notEngaged = all.filter((r) => r.engaged === false);
// Means are computed over ENGAGED cells only; non-engaged ones are reported, never averaged in.
const scored = all.filter((r) => r.engaged !== false);
const avg = (k) => scored.length ? scored.reduce((s, r) => s + r.dimensions[k], 0) / scored.length : 0;
const spread = (k) => { const v = scored.map((r) => r.dimensions[k]); return { min: Math.min(...v), max: Math.max(...v) }; };
console.log(`\n=== ARM ${ARM} — ${scored.length} engaged cell(s) of ${all.length} ===`);
if (notEngaged.length) {
  console.log(`  !! ${notEngaged.length} cell(s) NEVER ENGAGED the skill (no wf/ branch) and are EXCLUDED from the means:`);
  for (const r of notEngaged) console.log(`     run${r.run} ref='${r.deliveryRef}' ${r.secs}s $${(r.costUsd || 0).toFixed(2)} — a raw delivery under the conductor label`);
  console.log(`  engagement rate: ${all.length - notEngaged.length}/${all.length}`);
}
for (const k of ['correctness', 'docs', 'isolation', 'dod']) {
  const sp = spread(k);
  // The MEAN is the least interesting number here. Insurance lives in the spread: a dimension that
  // is sometimes 1 and sometimes 0 is a catastrophe an arm may or may not prevent; a dimension that
  // is always the same value cannot be insured against, whatever its mean.
  console.log(`  ${k.padEnd(12)} mean ${avg(k).toFixed(3)}   min ${sp.min.toFixed(2)}  max ${sp.max.toFixed(2)}${sp.min !== sp.max ? '   <-- VARIES' : ''}`);
}
if (RUNS > 1) {
  const costs = scored.map((r) => r.costUsd).filter((c) => typeof c === 'number');
  const secs = scored.map((r) => r.secs);
  if (costs.length) console.log(`  cost         $${Math.min(...costs).toFixed(2)}–$${Math.max(...costs).toFixed(2)}`);
  console.log(`  wallclock    ${Math.min(...secs)}s–${Math.max(...secs)}s`);
  const varying = ['correctness', 'docs', 'isolation', 'dod'].filter((k) => spread(k).min !== spread(k).max);
  console.log(varying.length
    ? `\nVARIANCE DETECTED on: ${varying.join(', ')} — there IS something for an arm to insure against.`
    : `\nNO variance detected at n=${scored.length}. NOTE: low n DETECTS variance, it does not RULE IT OUT — a 20%-per-run failure rate shows zero failures in 5 runs about a third of the time.`);
}
console.log(`  ${'MEAN'.padEnd(12)} ${((avg('correctness') + avg('docs') + avg('isolation') + avg('dod')) / 4).toFixed(3)}`);
console.log(`Spend: $${spent.toFixed(2)}  ·  ${join(OUT, ARM + '.json')}`);
