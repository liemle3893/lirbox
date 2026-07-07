#!/usr/bin/env node
/*
 * Run report for one whetstone improvement run.
 * Runs in the MAIN session (plain Node — Date.now() etc. are fine here; only the loop
 * CONDUCTOR is restricted). Forked from prospector's optimize-report.cjs, but reports the
 * improver ledger (spec §5): baseline (floor pass) → per-item verdicts (kept/reverted/
 * unresolved) + human-only items + duration, tokens, est cost.
 *
 * Usage:  node improve-report.cjs <name> [--project-dir <dir>]
 *
 * Reads  .improve/state/<name>.json  for the ledger (baseline/items/humanOnly) and
 * startedAt/finishedAt, sums token usage from this project's transcript JSONL files within
 * [startedAt, finishedAt], applies a pricing table, and writes .improve/reports/<name>.md
 * (also prints it).
 *
 * CAVEATS (also printed in the report):
 *  - Token attribution is by TIME WINDOW over all transcripts in the project dir. A concurrent
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
  const key = Object.keys(RATES).find((k) => m.includes(k));
  return key ? RATES[key] : null;
};

const name = process.argv[2];
if (!name || name.startsWith('--')) { console.error('usage: improve-report.cjs <name> [--project-dir <dir>]'); process.exit(1); }

const statePath = path.join('.improve', 'state', name + '.json');
let state;
try { state = JSON.parse(fs.readFileSync(statePath, 'utf8')); }
catch { console.error(`ERROR: cannot read ${statePath} — no such improvement run`); process.exit(1); }

const start = state.startedAt ? Date.parse(state.startedAt) : null;
const end = state.finishedAt ? Date.parse(state.finishedAt)
          : state.updatedAt ? Date.parse(state.updatedAt) : null;

const di = process.argv.indexOf('--project-dir');
const projDir = di > -1 ? process.argv[di + 1]
  : path.join(os.homedir(), '.claude', 'projects', process.cwd().replace(/\//g, '-'));

// --- Ledger-derived figures (spec §5) ---
const baseline = state.baseline || null;
const items = Array.isArray(state.items) ? state.items : [];
const humanOnly = Array.isArray(state.humanOnly) ? state.humanOnly : [];
const kept = items.filter((e) => e && e.verdict === 'kept').length;
const reverted = items.filter((e) => e && e.verdict === 'reverted').length;
const unresolved = items.filter((e) => e && e.verdict === 'unresolved').length;

// In-loop token total from the ledger's per-item `tokens` (separate from the time-window sum).
const ledgerTokens = items.reduce((s, e) => s + (e && typeof e.tokens === 'number' ? e.tokens : 0), 0);

// Skill-size trajectory (SkillOpt-style compactness telemetry): baseline skillTokens vs the last
// measured value in the ledger. Makes accretion visible in the morning review — the consolidate
// pass exists to push this back down.
const sizeBase = (baseline && typeof baseline.skillTokens === 'number' && isFinite(baseline.skillTokens)) ? baseline.skillTokens : null;
let sizeFinal = null;
for (let i = items.length - 1; i >= 0; i--) {
  const t = items[i] && items[i].skillTokens;
  if (typeof t === 'number' && isFinite(t)) { sizeFinal = t; break; }
}

// --- Token usage by time window over transcripts (same method as optimize-report.cjs) ---
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
const cell = (v) => String(v == null ? '—' : v).replace(/\|/g, '\\|');

const branch = state.branch || 'improve/' + name;
const baseRef = state.baseline && typeof state.baseline === 'string' ? state.baseline
  : (baseline && baseline.sha) ? baseline.sha : null;
const diffCmd = `git diff ${baseRef ? baseRef + '..' : ''}${branch}`;

let md = `# Improvement report: ${name}\n\n`;
md += `- Skill: ${state.skill || name}${state.skillPath ? ` (\`${state.skillPath}\`)` : ''}\n`;
md += `- Status: ${state.status || '?'}\n`;
md += `- Branch / worktree: ${state.branch || '—'} / ${state.worktree || '—'}\n`;
md += `- Baseline floor: ${baseline && baseline.floorPassed ? 'passed' : '— (not recorded)'}\n`;
if (sizeBase != null || sizeFinal != null) {
  const delta = (sizeBase != null && sizeFinal != null) ? sizeFinal - sizeBase : null;
  md += `- Skill size (est. tokens): ${sizeBase != null ? sizeBase : '?'} → ${sizeFinal != null ? sizeFinal : '?'}`;
  if (delta != null) md += ` (${delta >= 0 ? '+' : ''}${delta}${sizeBase ? `, ${(100 * delta / sizeBase).toFixed(1)}%` : ''})`;
  md += `\n`;
}
md += `- Duration: ${fmtDur(durMs)} (${state.startedAt || '?'} → ${state.finishedAt || state.updatedAt || '?'})\n\n`;

md += `## Verdicts\n\n`;
md += `- Items attempted: ${items.length}\n`;
md += `- Kept: ${kept}${items.length ? ` (${(100 * kept / items.length).toFixed(0)}% keep rate)` : ''}\n`;
md += `- Reverted: ${reverted}\n`;
md += `- Unresolved (floor+surface ok but check never went green after retries): ${unresolved}\n`;
md += `- Human-only (no deterministic check — reported, not attempted): ${humanOnly.length}${humanOnly.length ? ` — ${humanOnly.map((x) => `\`${x}\``).join(', ')}` : ''}\n\n`;

if (items.length) {
  md += `| id | type | verdict | floor | check | change | sha |\n|---|---|:--:|:--:|:--:|---|---|\n`;
  for (const e of items) {
    md += `| ${cell(e.id)} | ${cell(e.type)} | ${cell(e.verdict)} | ${cell(e.floor)} | ${cell(e.check)} | ${cell(e.change)} | ${e.sha ? String(e.sha).slice(0, 12) : '—'} |\n`;
  }
  md += `\n`;
} else {
  md += `_No items in the ledger._\n\n`;
}

md += `## Tokens & estimated cost\n\n`;
if (rows.length) {
  md += `| Model | Input | Cache write | Cache read | Output | Est. cost (USD) |\n|---|--:|--:|--:|--:|--:|\n`;
  for (const r of rows) md += `| ${r.model} | ${k(r.input)} | ${k(r.cacheWrite)} | ${k(r.cacheRead)} | ${k(r.output)} | ${r.cost != null ? '$' + r.cost.toFixed(2) : 'n/a (no rate)'} |\n`;
  md += `| **Total** | ${k(grand.input)} | ${k(grand.cacheWrite)} | ${k(grand.cacheRead)} | ${k(grand.output)} | **$${grand.cost.toFixed(2)}** |\n\n`;
} else {
  md += `_No transcript usage found in the run window._\n\n`;
}
if (ledgerTokens) md += `In-loop tokens recorded in the ledger (per-item, sum): ${k(ledgerTokens)}.\n\n`;
md += `> Estimate. Time-window token attribution is over transcripts in \`${projDir}\` `;
md += `(a concurrent unrelated session in the same window would inflate it). Rates are editable in this script or via the RATES_JSON env var. `;
md += `Review the kept changes with \`${diffCmd}\`; nothing is auto-merged.\n`;

fs.mkdirSync(path.join('.improve', 'reports'), { recursive: true });
fs.writeFileSync(path.join('.improve', 'reports', name + '.md'), md);
console.log(md);
