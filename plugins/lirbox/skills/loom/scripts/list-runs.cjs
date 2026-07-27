#!/usr/bin/env node
/*
 * Table of loom runs.
 *
 *   node list-runs.cjs [--all]
 *
 * Also surfaces the recorded server port so a session that died without stopping
 * its editor server leaves a visible, killable trace rather than an orphan.
 */
const fs = require('fs');
const path = require('path');

const all = process.argv.includes('--all');
const dir = path.join(process.cwd(), '.loom', 'state');
if (!fs.existsSync(dir)) { process.stdout.write('no loom runs\n'); process.exit(0); }

const rows = [];
for (const f of fs.readdirSync(dir)) {
  if (!f.endsWith('.json')) continue;
  let st;
  try { st = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
  if (!all && st.status === 'complete') continue;
  rows.push({
    name: st.workflow || f.replace(/\.json$/, ''),
    status: st.status || '?',
    cursor: st.cursor || '-',
    visits: Object.values(st.visits || {}).reduce((a, b) => a + b, 0),
    port: st.port || '-',
  });
}

if (!rows.length) { process.stdout.write('no loom runs\n'); process.exit(0); }
const pad = (s, n) => String(s).padEnd(n);
process.stdout.write(
  `${pad('NAME', 24)}${pad('STATUS', 20)}${pad('CURSOR', 16)}${pad('STEPS', 7)}PORT\n`);
for (const r of rows) {
  process.stdout.write(
    `${pad(r.name, 24)}${pad(r.status, 20)}${pad(r.cursor, 16)}${pad(r.visits, 7)}${r.port}\n`);
}
if (rows.some((r) => r.port !== '-')) {
  process.stdout.write('\nA PORT on a non-running row is a stale editor server: kill it with\n');
  process.stdout.write('  lsof -ti tcp:<port> | xargs kill\n');
}
