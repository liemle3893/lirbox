#!/usr/bin/env node
/*
 * Token / cost / duration report for one conductor run.
 * Runs in the MAIN session (plain Node — Date.now() etc. are fine here; only the
 * workflow CONDUCTOR is restricted).
 *
 * Usage:  node workflow-report.js <name> [--project-dir <dir>]
 *
 * Reads  .workflows/state/<name>.json  for startedAt/finishedAt, sums token usage from
 * this project's transcript JSONL files within that window, applies a pricing table,
 * and writes  .workflows/reports/<name>.md  (also prints it).
 *
 * CAVEATS (also printed in the report):
 *  - Attribution is by TIME WINDOW over all transcripts in the project dir. A concurrent
 *    unrelated session in the same window would be included. For a single active session
 *    (the normal case) this is accurate.
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
  return Object.keys(RATES).find((k) => m.includes(k)) ? RATES[Object.keys(RATES).find((k) => m.includes(k))] : null;
};

const name = process.argv[2];
if (!name) { console.error('usage: workflow-report.js <name> [--project-dir <dir>]'); process.exit(1); }

const state = JSON.parse(fs.readFileSync(path.join('.workflows', 'state', name + '.json'), 'utf8'));
const start = state.startedAt ? Date.parse(state.startedAt) : null;
const end = state.finishedAt ? Date.parse(state.finishedAt)
          : state.updatedAt ? Date.parse(state.updatedAt) : null;

const di = process.argv.indexOf('--project-dir');
const projDir = di > -1 ? process.argv[di + 1]
  : path.join(os.homedir(), '.claude', 'projects', process.cwd().replace(/\//g, '-'));

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

let md = `# Workflow report: ${name}\n\n`;
md += `- Status: ${state.status || '?'}\n`;
md += `- Duration: ${fmtDur(durMs)} (${state.startedAt || '?'} → ${state.finishedAt || state.updatedAt || '?'})\n`;
md += `- Phases done: ${(state.phasesDone || []).join(', ') || '—'}\n`;
md += `- Branch / worktree: ${state.branch || '—'} / ${state.worktree || '—'}\n\n`;
md += `## Tokens & estimated cost\n\n`;
md += `| Model | Input | Cache write | Cache read | Output | Est. cost (USD) |\n|---|--:|--:|--:|--:|--:|\n`;
for (const r of rows) md += `| ${r.model} | ${k(r.input)} | ${k(r.cacheWrite)} | ${k(r.cacheRead)} | ${k(r.output)} | ${r.cost != null ? '$' + r.cost.toFixed(2) : 'n/a (no rate)'} |\n`;
md += `| **Total** | ${k(grand.input)} | ${k(grand.cacheWrite)} | ${k(grand.cacheRead)} | ${k(grand.output)} | **$${grand.cost.toFixed(2)}** |\n\n`;
md += `> Estimate. Token attribution is by time window over transcripts in \`${projDir}\` `;
md += `(a concurrent unrelated session in the same window would inflate it). Rates are editable in this script or via the RATES_JSON env var.\n`;

fs.mkdirSync(path.join('.workflows', 'reports'), { recursive: true });
fs.writeFileSync(path.join('.workflows', 'reports', name + '.md'), md);
console.log(md);
