#!/usr/bin/env node
// List arena runs from .arena/state/*.json as a status table. `--all` includes finished runs.
const fs = require('fs');
const path = require('path');

const all = process.argv.indexOf('--all') > -1;
const dir = path.join('.arena', 'state');
let files = [];
try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && !f.startsWith('.')); } catch (e) { /* no runs yet */ }

if (!files.length) { console.log('No arena runs found (.arena/state/ is empty).'); process.exit(0); }

const rows = [];
for (const f of files) {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { continue; }
  const name = f.replace(/\.json$/, '');
  const status = s.finishedAt ? 'complete' : (s.updatedAt ? 'running' : 'new');
  if (!all && status === 'complete') continue;
  const plan = s.plan || {};
  const runs = Array.isArray(s.runs) ? s.runs.length : 0;
  rows.push({ name, status, cells: plan.cells || '?', runs, updated: s.updatedAt || '' });
}
if (!rows.length) { console.log(all ? 'No runs.' : 'No in-progress runs (use --all).'); process.exit(0); }

console.log(['NAME', 'STATUS', 'CELLS', 'RUNS', 'UPDATED'].join('\t'));
for (const r of rows) console.log([r.name, r.status, r.cells, r.runs, r.updated].join('\t'));
