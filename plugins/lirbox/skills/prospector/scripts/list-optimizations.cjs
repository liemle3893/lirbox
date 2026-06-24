#!/usr/bin/env node
/*
 * List prospector optimization runs from .optimize/state/*.json.
 * Runs in the MAIN session (plain Node). Usage: node list-optimizations.cjs [--all]
 * By default shows only in-progress (running/failed/stopped); --all includes complete ones.
 * Mirrors conductor's list-workflows.cjs; columns: NAME / STATUS / BEST / RAN / KEPT / DURATION.
 */
const fs = require('fs');
const path = require('path');

const showAll = process.argv.includes('--all');
const dir = path.join('.optimize', 'state');
let files = [];
try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch {}
if (!files.length) { console.log('No optimizations found in .optimize/state/'); process.exit(0); }

const fmtDur = (a, b) => {
  if (!a) return '?';
  const end = b ? Date.parse(b) : Date.now();
  const s = Math.round((end - Date.parse(a)) / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return (h ? h + 'h ' : '') + (m ? m + 'm ' : '') + (s % 60) + 's';
};
const fmtMetric = (m) => (typeof m === 'number' && isFinite(m)) ? String(m) : '—';

// "in-progress" = a run that may still be resumed: running / failed / stopped. complete is done.
const inProgress = (st) => st === 'running' || st === 'failed' || st === 'stopped';

const rows = files.map((f) => {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch {}
  const experiments = Array.isArray(s.experiments) ? s.experiments : [];
  return {
    name: s.name || s.workflow || f.replace(/\.json$/, ''),
    status: s.status || '?',
    best: fmtMetric(s.best && s.best.metric),
    ran: experiments.length,
    kept: experiments.filter((e) => e && e.kept).length,
    duration: fmtDur(s.startedAt, s.finishedAt),
    updated: s.updatedAt || '',
  };
})
  .filter((r) => showAll || inProgress(r.status))
  .sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));

if (!rows.length) { console.log('No in-progress optimizations. Use --all to include completed.'); process.exit(0); }

const pad = (s, n) => String(s).padEnd(n);
console.log(pad('NAME', 24) + pad('STATUS', 10) + pad('BEST', 14) + pad('RAN', 6) + pad('KEPT', 6) + pad('DURATION', 12) + 'UPDATED');
for (const r of rows) console.log(pad(r.name, 24) + pad(r.status, 10) + pad(r.best, 14) + pad(r.ran, 6) + pad(r.kept, 6) + pad(r.duration, 12) + r.updated);
