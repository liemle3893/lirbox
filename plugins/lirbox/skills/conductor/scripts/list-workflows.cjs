#!/usr/bin/env node
/*
 * List durable workflows from .workflows/state/*.json.
 * Runs in the MAIN session (plain Node). Usage: node list-workflows.js [--all]
 * By default shows only in-progress (running/failed); --all includes complete ones.
 */
const fs = require('fs');
const path = require('path');

const showAll = process.argv.includes('--all');
const dir = path.join('.workflows', 'state');
let files = [];
try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch {}
if (!files.length) { console.log('No workflows found in .workflows/state/'); process.exit(0); }

const fmtDur = (a, b) => {
  if (!a) return '?';
  const end = b ? Date.parse(b) : Date.now();
  const s = Math.round((end - Date.parse(a)) / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return (h ? h + 'h ' : '') + (m ? m + 'm ' : '') + (s % 60) + 's';
};

const rows = files.map((f) => {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch {}
  return {
    name: s.workflow || f.replace(/\.json$/, ''),
    status: s.status || '?',
    phases: (s.phasesDone || []).length,
    duration: fmtDur(s.startedAt, s.finishedAt),
    updated: s.updatedAt || '',
  };
})
  .filter((r) => showAll || r.status === 'running' || r.status === 'failed')
  .sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));

if (!rows.length) { console.log('No in-progress workflows. Use --all to include completed.'); process.exit(0); }

const pad = (s, n) => String(s).padEnd(n);
console.log(pad('NAME', 28) + pad('STATUS', 10) + pad('PHASES', 8) + pad('DURATION', 12) + 'UPDATED');
for (const r of rows) console.log(pad(r.name, 28) + pad(r.status, 10) + pad(r.phases, 8) + pad(r.duration, 12) + r.updated);
