#!/usr/bin/env node
/*
 * Run report for one prospector optimization run.
 * Runs in the MAIN session (plain Node — Date.now() etc. are fine here; only the loop
 * CONDUCTOR is restricted). Mirrors conductor's workflow-report.cjs, but reports the
 * optimization ledger (spec §5): baseline → best (% improvement), experiments run/kept,
 * plateau, duration, tokens, est cost.
 *
 * Usage:  node optimize-report.cjs <name> [--project-dir <dir>]
 *
 * Reads  .optimize/state/<name>.json  for the ledger (baseline/best/experiments) and
 * startedAt/finishedAt, reads  .optimize/config/<name>.json  for metric.direction (so the
 * % improvement carries the right sign), sums token usage from this project's transcript
 * JSONL files within [startedAt, finishedAt], applies a pricing table, and writes
 * .optimize/reports/<name>.md  (also prints it).
 *
 * CAVEATS (also printed in the report):
 *  - Token attribution is by TIME WINDOW over all transcripts in the project dir. A concurrent
 *    unrelated session in the same window would be included. For a single active session
 *    (the normal case) this is accurate. The ledger's per-experiment `tokens` (when present)
 *    is the in-loop figure and is shown separately.
 *  - RATES are editable placeholders (USD per 1M tokens). Verify against current pricing;
 *    override the whole table via the RATES_JSON env var.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

// --- Pricing: USD per 1,000,000 tokens. EDIT or override via RATES_JSON. Keyed by model substring. ---
const DEFAULT_RATES = {
  opus:   { input: 15,  cacheWrite: 18.75, cacheRead: 1.5,  output: 75 },
  sonnet: { input: 3,   cacheWrite: 3.75,  cacheRead: 0.3,  output: 15 },
  haiku:  { input: 0.8, cacheWrite: 1.0,   cacheRead: 0.08, output: 4 },
};
const RATES = process.env.RATES_JSON ? JSON.parse(process.env.RATES_JSON) : DEFAULT_RATES;
const rateFor = (model) => {
  const m = String(model || '').toLowerCase();
  const key = Object.keys(RATES).find((k) => m.includes(k));
  return key ? RATES[key] : null;
};

const name = process.argv[2];
if (!name || name.startsWith('--')) { console.error('usage: optimize-report.cjs <name> [--project-dir <dir>]'); process.exit(1); }

const statePath = path.join('.optimize', 'state', name + '.json');
let state;
try { state = JSON.parse(fs.readFileSync(statePath, 'utf8')); }
catch { console.error(`ERROR: cannot read ${statePath} — no such optimization run`); process.exit(1); }

// metric.direction lives in the CONFIG, not the state file — read it so % improvement is signed right.
let direction = 'min';
try {
  const cfg = JSON.parse(fs.readFileSync(path.join('.optimize', 'config', name + '.json'), 'utf8'));
  if (cfg && cfg.metric && (cfg.metric.direction === 'max' || cfg.metric.direction === 'min')) direction = cfg.metric.direction;
} catch { /* no config → assume min (lower better) */ }

const start = state.startedAt ? Date.parse(state.startedAt) : null;
const end = state.finishedAt ? Date.parse(state.finishedAt)
          : state.updatedAt ? Date.parse(state.updatedAt) : null;

const di = process.argv.indexOf('--project-dir');
const projDir = di > -1 ? process.argv[di + 1]
  : path.join(os.homedir(), '.claude', 'projects', process.cwd().replace(/\//g, '-'));

// --- Ledger-derived figures (spec §5) ---
const baseline = state.baseline || null;
const best = state.best || null;
const experiments = Array.isArray(state.experiments) ? state.experiments : [];
const ran = experiments.length;
const kept = experiments.filter((e) => e && e.kept).length;

// % improvement of best vs baseline, with the right sign for the direction.
// min → improvement = (base - best) / base; max → (best - base) / base.
function pctImprovement(base, b, dir) {
  if (typeof base !== 'number' || !isFinite(base) || base === 0) return null;
  if (typeof b !== 'number' || !isFinite(b)) return null;
  const raw = dir === 'max' ? (b - base) / base : (base - b) / base;
  return raw * 100;
}
const baseMetric = baseline && typeof baseline.metric === 'number' ? baseline.metric : null;
const bestMetric = best && typeof best.metric === 'number' ? best.metric : null;
const pct = pctImprovement(baseMetric, bestMetric, direction);

// Plateau: trailing run of experiments with no KEPT (the sequential stop signal, spec §3).
let plateau = 0;
for (let i = experiments.length - 1; i >= 0; i--) { if (experiments[i] && experiments[i].kept) break; plateau++; }

// In-loop token total from the ledger's per-experiment `tokens` (separate from the time-window sum).
const ledgerTokens = experiments.reduce((s, e) => s + (e && typeof e.tokens === 'number' ? e.tokens : 0), 0);

// --- Token usage by time window over transcripts (same method as workflow-report.cjs) ---
function collectJsonl(dir) {
  let out = [];
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory() && e.name !== 'memory') out = out.concat(collectJsonl(p));
    else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(p);
  }
  return out;
}

const totals = {};
function add(model, u) {
  const t = (totals[model || 'unknown'] = totals[model || 'unknown'] || { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 });
  t.input += u.input_tokens || 0;
  t.cacheWrite += u.cache_creation_input_tokens || 0;
  t.cacheRead += u.cache_read_input_tokens || 0;
  t.output += u.output_tokens || 0;
}

for (const file of collectJsonl(projDir)) {
  let lines;
  try { lines = fs.readFileSync(file, 'utf8').split('\n'); } catch { continue; }
  for (const line of lines) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    const ts = o.timestamp ? Date.parse(o.timestamp) : null;
    if (start && ts && ts < start) continue;
    if (end && ts && ts > end) continue;
    const msg = o.message || o;
    if (msg && msg.usage) add(msg.model || o.model, msg.usage);
  }
}

const grand = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0, cost: 0 };
const rows = [];
for (const [model, t] of Object.entries(totals)) {
  const r = rateFor(model);
  const cost = r ? (t.input * r.input + t.cacheWrite * r.cacheWrite + t.cacheRead * r.cacheRead + t.output * r.output) / 1e6 : null;
  rows.push({ model, ...t, cost });
  grand.input += t.input; grand.cacheWrite += t.cacheWrite; grand.cacheRead += t.cacheRead; grand.output += t.output;
  if (cost) grand.cost += cost;
}

const durMs = start && end ? end - start : null;
const fmtDur = (ms) => {
  if (ms == null) return 'n/a';
  const s = Math.round(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return (h ? h + 'h ' : '') + (m ? m + 'm ' : '') + (s % 60) + 's';
};
const k = (n) => n.toLocaleString();
const fmtMetric = (m) => (typeof m === 'number' && isFinite(m)) ? String(m) : 'n/a';

let md = `# Optimization report: ${name}\n\n`;
md += `- Goal: ${state.goal || '—'}\n`;
md += `- Status: ${state.status || '?'}\n`;
md += `- Surface: \`${state.surface || '—'}\`\n`;
md += `- Branch / worktree: ${state.branch || '—'} / ${state.worktree || '—'}\n`;
md += `- Duration: ${fmtDur(durMs)} (${state.startedAt || '?'} → ${state.finishedAt || state.updatedAt || '?'})\n\n`;

md += `## Result (baseline → best)\n\n`;
md += `| | Metric | Source | Direction |\n|---|--:|---|---|\n`;
md += `| Baseline | ${fmtMetric(baseMetric)} | ${(baseline && baseline.sha) ? baseline.sha.slice(0, 12) : '—'} | ${direction === 'max' ? 'higher better' : 'lower better'} |\n`;
md += `| **Best** | **${fmtMetric(bestMetric)}** | ${(best && best.sha) ? best.sha.slice(0, 12) : '—'} (exp ${best && best.experiment != null ? best.experiment : '—'}) | |\n\n`;
md += `- Improvement: ${pct != null ? (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%' : 'n/a'}`;
md += pct != null ? ` (${direction === 'max' ? 'higher' : 'lower'} is better)\n` : `\n`;

md += `\n## Experiments\n\n`;
md += `- Run: ${ran}\n`;
md += `- Kept: ${kept}${ran ? ` (${(100 * kept / ran).toFixed(0)}% keep rate)` : ''}\n`;
md += `- Discarded: ${ran - kept}\n`;
md += `- Trailing plateau (experiments since last KEPT): ${plateau}\n\n`;

if (ran) {
  md += `| g | change | metric | gate | kept | sec | tokens |\n|--:|---|--:|:--:|:--:|--:|--:|\n`;
  for (const e of experiments) {
    md += `| ${e.g != null ? e.g : '?'} | ${(e.change || '').replace(/\|/g, '\\|')} | ${fmtMetric(e.metric)} | ${e.gate || '?'} | ${e.kept ? 'KEPT' : '—'} | ${e.sec != null ? e.sec : '—'} | ${e.tokens != null ? k(e.tokens) : '—'} |\n`;
  }
  md += `\n`;
}

md += `## Tokens & estimated cost\n\n`;
if (rows.length) {
  md += `| Model | Input | Cache write | Cache read | Output | Est. cost (USD) |\n|---|--:|--:|--:|--:|--:|\n`;
  for (const r of rows) md += `| ${r.model} | ${k(r.input)} | ${k(r.cacheWrite)} | ${k(r.cacheRead)} | ${k(r.output)} | ${r.cost != null ? '$' + r.cost.toFixed(2) : 'n/a (no rate)'} |\n`;
  md += `| **Total** | ${k(grand.input)} | ${k(grand.cacheWrite)} | ${k(grand.cacheRead)} | ${k(grand.output)} | **$${grand.cost.toFixed(2)}** |\n\n`;
} else {
  md += `_No transcript usage found in the run window._\n\n`;
}
if (ledgerTokens) md += `In-loop tokens recorded in the ledger (per-experiment, sum): ${k(ledgerTokens)}.\n\n`;
md += `> Estimate. Time-window token attribution is over transcripts in \`${projDir}\` `;
md += `(a concurrent unrelated session in the same window would inflate it). Rates are editable in this script or via the RATES_JSON env var. `;
md += `Review the change with \`git diff ${state.baseline ? '' : '<baseline>..'}${state.branch || 'opt/' + name}\`; nothing is auto-merged.\n`;

fs.mkdirSync(path.join('.optimize', 'reports'), { recursive: true });
fs.writeFileSync(path.join('.optimize', 'reports', name + '.md'), md);
console.log(md);
