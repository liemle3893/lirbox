#!/usr/bin/env node
/*
 * List whetstone improvement runs from .improve/state/*.json.
 * Runs in the MAIN session (plain Node). Usage: node list-improvements.cjs [--all]
 * By default shows only in-progress (running/failed/stopped); --all includes complete ones.
 * Forked from prospector's list-optimizations.cjs; columns: NAME / STATUS / ITEMS / KEPT / UNRESOLVED / DURATION.
 */
const fs = require('fs');
const path = require('path');

const showAll = process.argv.includes('--all');
const dir = path.join('.improve', 'state');
let files = [];
try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && !f.startsWith('.')); } catch {}
if (!files.length) { console.log('No improvements found in .improve/state/'); process.exit(0); }

const fmtDur = (a, b) => {
  if (!a) return '?';
  const end = b ? Date.parse(b) : Date.now();
  const s = Math.round((end - Date.parse(a)) / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return (h ? h + 'h ' : '') + (m ? m + 'm ' : '') + (s % 60) + 's';
};

// "in-progress" = a run that may still be resumed: running / failed / stopped. complete is done.
const inProgress = (st) => st === 'running' || st === 'failed' || st === 'stopped';

const rows = files.map((f) => {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch {}
  const items = Array.isArray(s.items) ? s.items : [];
  return {
    name: s.name || s.workflow || s.skill || f.replace(/\.json$/, ''),
    status: s.status || '?',
    items: items.length,
    kept: items.filter((e) => e && e.verdict === 'kept').length,
    unresolved: items.filter((e) => e && e.verdict === 'unresolved').length,
    duration: fmtDur(s.startedAt, s.finishedAt),
    updated: s.updatedAt || '',
  };
})
  .filter((r) => showAll || inProgress(r.status))
  .sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));

if (!rows.length) { console.log('No in-progress improvements. Use --all to include completed.'); process.exit(0); }

const pad = (s, n) => String(s).padEnd(n);
console.log(pad('NAME', 24) + pad('STATUS', 10) + pad('ITEMS', 7) + pad('KEPT', 6) + pad('UNRESOLVED', 12) + pad('DURATION', 12) + 'UPDATED');
for (const r of rows) console.log(pad(r.name, 24) + pad(r.status, 10) + pad(r.items, 7) + pad(r.kept, 6) + pad(r.unresolved, 12) + pad(r.duration, 12) + r.updated);
