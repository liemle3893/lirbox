#!/usr/bin/env node
/*
 * Absolute SWE-bench-style SCORECARD for conductor — so runs are independent and comparable over time:
 * benchmark a new version alone, then compare recorded scores. No baseline re-runs.
 *
 * Score (headline) = resolution rate over the frozen suite (resolved cells / total cells), with a 95%
 * Wilson interval (small n must be visible). Secondary: F2P partial credit + engagement rate.
 *
 * Comparability contract: a scorecard embeds the SUITE FINGERPRINT (hash over suite.json + every graded
 * task's task.md + repo.ref + grader files). Scores are ONLY comparable when fingerprints match —
 * changing a task, grader, or pin changes the hash and starts a new comparison era (SWE-bench's
 * Lite/Verified versioning problem, handled up front).
 *
 * Usage:
 *   node swe-score.mjs --cells <dir> --name <label> --config '<json>' [--filter <substr>]
 *       # <dir> holds per-cell "<task>--….grade" JSON files (swe-grade output); --filter selects a
 *       # config's files by substring. Writes docs/arena/scores/<label>.json and refreshes the index.
 *   node swe-score.mjs --index          # regenerate docs/arena/scores/README.md from all scorecards
 *   node swe-score.mjs --fingerprint    # print the current suite fingerprint
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..', '..', '..');
const SUITE = join(REPO, 'plugins', 'lirbox', 'skills', 'conductor', 'arena', 'suite.json');
const TASKS_DIR = join(REPO, 'plugins', 'lirbox', 'skills', 'conductor', 'arena', 'tasks');
const SCORES = join(REPO, 'docs', 'arena', 'scores');

function arg(name, def) { const i = process.argv.indexOf('--' + name); const v = process.argv[i + 1]; return i > -1 ? (v && !v.startsWith('--') ? v : true) : def; }

// --- suite fingerprint: hash over suite.json + each graded task's contract files (sorted, content) ---
export function suiteFingerprint() {
  const suite = JSON.parse(readFileSync(SUITE, 'utf8'));
  const h = createHash('sha256');
  h.update(readFileSync(SUITE));
  const graded = suite.tasks.filter((t) => t.graded).map((t) => t.id).sort();
  for (const id of graded) {
    const dir = join(TASKS_DIR, id);
    const files = ['task.md', 'repo.ref'];
    const f2p = join(dir, 'grader', 'fail_to_pass');
    for (const f of readdirSync(f2p).sort()) files.push(join('grader', 'fail_to_pass', f));
    for (const f of files) { h.update(id + '/' + f); h.update(readFileSync(join(dir, f))); }
  }
  return { hash: h.digest('hex').slice(0, 12), tasks: graded };
}

// --- 95% Wilson interval for a binomial proportion (honest small-n bounds) ---
export function wilson95(k, n) {
  if (!n) return [0, 0];
  const z = 1.96, p = k / n, z2 = z * z;
  const den = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / den;
  const half = (z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / den;
  return [Math.max(0, centre - half), Math.min(1, centre + half)].map((x) => Math.round(x * 1000) / 1000);
}

// --- scorecard from cell grade records ---
export function computeScore(cells) {
  const total = cells.length;
  const resolved = cells.filter((c) => c.resolved).length;
  const f2pPassed = cells.reduce((a, c) => a + (c.f2p?.passed || 0), 0);
  const f2pTotal = cells.reduce((a, c) => a + (c.f2p?.total || 0), 0);
  const engaged = cells.filter((c) => c.engaged !== false).length;
  return {
    resolved, total,
    rate: total ? Math.round((resolved / total) * 1000) / 1000 : 0,
    wilson95: wilson95(resolved, total),
    f2pPassed, f2pTotal,
    engagementRate: total ? Math.round((engaged / total) * 1000) / 1000 : 0,
  };
}

function loadCells(dir, filter) {
  const cells = [];
  for (const f of readdirSync(dir).sort()) {
    if (!f.endsWith('.grade')) continue;
    if (filter && !f.includes(filter)) continue;
    const g = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    cells.push({ task: g.task, file: basename(f), engaged: true, resolved: !!g.resolved, f2p: g.f2p, p2p: g.p2p });
  }
  return cells;
}

function renderIndex() {
  mkdirSync(SCORES, { recursive: true });
  const cards = readdirSync(SCORES).filter((f) => f.endsWith('.json')).sort()
    .map((f) => JSON.parse(readFileSync(join(SCORES, f), 'utf8')));
  const cur = suiteFingerprint();
  const rows = cards.map((c) => {
    const cmp = c.suiteHash === cur.hash ? '' : ' ⚠️stale-suite';
    const ci = c.score.wilson95.map((x) => Math.round(x * 100) + '%').join('–');
    return `| ${c.name} | ${c.date} | \`${c.suiteHash}\`${cmp} | ${c.config.model || '?'} / ${c.config.effort || '?'}${c.config.pluginDir ? ' / ' + c.config.pluginDir : ''} | **${c.score.resolved}/${c.score.total} (${Math.round(c.score.rate * 100)}%)** | ${ci} | ${c.score.f2pPassed}/${c.score.f2pTotal} |`;
  });
  const md = `# Conductor scoreboard — absolute SWE-style scores

**Score = resolution rate over the frozen suite** (hidden F2P turn green + fixture P2P stays green,
per cell). Runs are INDEPENDENT: benchmark a new config/version alone, compare against the rows below.
**Only rows with the same suite hash are comparable** (current: \`${cur.hash}\`, tasks: ${cur.tasks.join(', ')});
⚠️stale-suite rows predate a suite change. Wilson 95% CI shown — with few cells the interval is wide;
treat overlapping intervals as "not distinguished yet," and raise runs to tighten.

| Run | Date | Suite | Config | Resolved | 95% CI | F2P tests |
|---|---|---|---|---|---|---|
${rows.join('\n')}

Produce a new row: \`node plugins/lirbox/skills/arena/scripts/swe-run.mjs --name <label> --model <m> --effort <e> [--plugin-dir <lirbox-checkout>] [--runs N]\`
Quality-beyond-correctness (style, coverage, thoroughness) is NOT in this score — that stays pairwise
(the arena's judge layer, among resolved runs only).
`;
  writeFileSync(join(SCORES, 'README.md'), md);
  return cards.length;
}

export function writeScorecard({ name, config, cells, date }) {
  const fp = suiteFingerprint();
  const card = {
    name, date: date || new Date().toISOString().slice(0, 10),
    suiteHash: fp.hash, suiteTasks: fp.tasks,
    config, cells, score: computeScore(cells),
  };
  mkdirSync(SCORES, { recursive: true });
  writeFileSync(join(SCORES, name + '.json'), JSON.stringify(card, null, 2));
  renderIndex();
  return card;
}

// --- CLI ---
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (arg('fingerprint', false)) {
    console.log(JSON.stringify(suiteFingerprint()));
  } else if (arg('index', false)) {
    console.log(`indexed ${renderIndex()} scorecard(s) → docs/arena/scores/README.md`);
  } else {
    const dir = arg('cells'); const name = arg('name'); const filter = arg('filter', null);
    if (!dir || dir === true || !name || name === true) { console.error('usage: swe-score.mjs --cells <dir> --name <label> --config <json> [--filter <substr>] | --index | --fingerprint'); process.exit(2); }
    const config = JSON.parse(arg('config', '{}') === true ? '{}' : arg('config', '{}'));
    const cells = loadCells(resolve(String(dir)), filter === true ? null : filter);
    if (!cells.length) { console.error('no .grade cells matched'); process.exit(2); }
    const card = writeScorecard({ name: String(name), config, cells });
    console.log(JSON.stringify({ name: card.name, suiteHash: card.suiteHash, score: card.score }));
  }
}
