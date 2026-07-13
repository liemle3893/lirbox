#!/usr/bin/env node
/*
 * Render an arena run's durable state into a self-contained leaderboard.html + report.md.
 * `renderLeaderboard(state)` is PURE (no fs) so the regression net can unit-test it; `main` reads
 * .arena/state/<name>.json and writes both files under docs/arena/<name>/ (the tracked, promoted path).
 *
 * state shape: { name, ratings:{hash:number}, matrix:{hash:{hash:number|null}}, tallies:[{a,b,aWins,bWins,ties}],
 *                runs?:[{taskId,configHash,runIndex,forfeit,...}], plan?:{...} }
 */
const fs = require('fs');
const path = require('path');

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function pct(x) { return (x == null) ? '—' : (Math.round(x * 1000) / 10) + '%'; }
function num(x) { return (typeof x === 'number') ? (Math.round(x * 1000) / 1000) : '—'; }

// Pure: state → { html, md }. Configs ranked by Bradley-Terry rating (desc). Higher-rated first.
function renderLeaderboard(state) {
  const ratings = state.ratings || {};
  const matrix = state.matrix || {};
  const runs = Array.isArray(state.runs) ? state.runs : [];
  const ranked = Object.keys(ratings).sort((a, b) => ratings[b] - ratings[a]);
  const forfeits = runs.filter((r) => r.forfeit);

  // --- report.md ---
  const md = [];
  md.push('# Arena leaderboard — ' + (state.name || ''));
  md.push('');
  md.push('## Ranking (Bradley-Terry)');
  md.push('');
  md.push('| Rank | Config | Rating |');
  md.push('|---|---|---|');
  ranked.forEach((h, i) => md.push('| ' + (i + 1) + ' | `' + h + '` | ' + num(ratings[h]) + ' |'));
  md.push('');
  md.push('## Win-rate matrix');
  md.push('');
  md.push('Row config\'s win-rate vs column config (ties = 0.5).');
  md.push('');
  md.push('| | ' + ranked.map((h) => '`' + h + '`').join(' | ') + ' |');
  md.push('|' + '---|'.repeat(ranked.length + 1));
  for (const i of ranked) {
    md.push('| `' + i + '` | ' + ranked.map((j) => (i === j ? '—' : pct((matrix[i] || {})[j]))).join(' | ') + ' |');
  }
  md.push('');
  md.push('## Runs');
  md.push('');
  md.push('- total runs: ' + runs.length + ' · forfeited: ' + forfeits.length);
  if (forfeits.length) {
    md.push('- ⚠️ forfeited cells (excluded from scoring, NOT silently dropped):');
    for (const f of forfeits) md.push('  - `' + f.taskId + '` / `' + f.configHash + '` run ' + f.runIndex + (f.forfeitReason ? ' — ' + f.forfeitReason : ''));
  }
  md.push('');

  // --- leaderboard.html (self-contained) ---
  const rows = ranked.map((h, i) =>
    '<tr><td>' + (i + 1) + '</td><td><code>' + esc(h) + '</code></td><td>' + num(ratings[h]) + '</td></tr>').join('');
  const mhead = '<tr><th></th>' + ranked.map((h) => '<th><code>' + esc(h) + '</code></th>').join('') + '</tr>';
  const mrows = ranked.map((i) =>
    '<tr><th><code>' + esc(i) + '</code></th>' +
    ranked.map((j) => '<td>' + (i === j ? '—' : pct((matrix[i] || {})[j])) + '</td>').join('') + '</tr>').join('');
  const forfeitHtml = forfeits.length
    ? '<h2>Forfeited cells</h2><ul>' + forfeits.map((f) => '<li><code>' + esc(f.taskId) + '</code> / <code>' + esc(f.configHash) + '</code> run ' + esc(f.runIndex) + (f.forfeitReason ? ' — ' + esc(f.forfeitReason) : '') + '</li>').join('') + '</ul>'
    : '<p>No forfeited cells.</p>';
  const html = [
    '<!doctype html><meta charset="utf-8"><title>Arena — ' + esc(state.name || '') + '</title>',
    '<style>body{font:15px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;max-width:900px;margin:2rem auto;padding:0 1rem}',
    'table{border-collapse:collapse;margin:1rem 0}th,td{border:1px solid #ccc;padding:6px 10px;text-align:center}',
    'code{background:#f0f0f0;padding:1px 5px;border-radius:4px}h1{font-size:1.6rem}</style>',
    '<h1>Arena leaderboard — ' + esc(state.name || '') + '</h1>',
    '<h2>Ranking (Bradley-Terry)</h2>',
    '<table><tr><th>Rank</th><th>Config</th><th>Rating</th></tr>' + rows + '</table>',
    '<h2>Win-rate matrix</h2><p>Row vs column (ties = 0.5).</p>',
    '<table>' + mhead + mrows + '</table>',
    forfeitHtml,
    '<p>Runs: ' + runs.length + ' · forfeited: ' + forfeits.length + '</p>',
  ].join('\n');

  return { html, md: md.join('\n') };
}

module.exports = { renderLeaderboard };

if (require.main === module) {
  const name = process.argv[2];
  if (!name) { console.error('usage: arena-report.cjs <name>'); process.exit(1); }
  const state = JSON.parse(fs.readFileSync(path.join('.arena', 'state', name + '.json'), 'utf8'));
  const { html, md } = renderLeaderboard(state);
  const dir = path.join('docs', 'arena', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'leaderboard.html'), html);
  fs.writeFileSync(path.join(dir, 'report.md'), md);
  console.log('wrote ' + dir + '/leaderboard.html and report.md');
}
