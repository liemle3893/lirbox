#!/usr/bin/env node
/*
 * Render a loom run from its durable state.
 *
 *   node loom-report.cjs <name>
 *
 * The trace is the point: it shows the PATH actually taken, including revisits and
 * every patch the validator rejected. A linear phase list cannot show either.
 */
const fs = require('fs');
const path = require('path');

const name = process.argv[2];
if (!name) { console.error('usage: loom-report.cjs <name>'); process.exit(1); }

const p = path.join(process.cwd(), '.loom', 'state', `${name}.json`);
if (!fs.existsSync(p)) { console.error(`no such run: ${p}`); process.exit(1); }
let st;
try { st = JSON.parse(fs.readFileSync(p, 'utf8')); }
catch (e) {
  // An operator hitting this is mid-incident. A raw JSON parser stack trace tells them
  // nothing actionable; name the file and what is wrong with it.
  console.error(`state file for run '${name}' is not readable JSON: ${p}`);
  console.error(`  ${e.message}`);
  console.error('  the run may still be recoverable — inspect the file before deleting it');
  process.exit(1);
}

const out = [];
out.push(`loom run: ${st.workflow}`);
out.push(`status:   ${st.status}${st.finishedAt ? ` (finished ${st.finishedAt})` : ''}`);
out.push(`started:  ${st.startedAt || 'unknown'}`);
const nodeIds = new Set(((st.graph && st.graph.nodes) || []).map((n) => n.id));
const cursorMissing = st.cursor && nodeIds.size > 0 && !nodeIds.has(st.cursor);
out.push(`cursor:   ${st.cursor}${cursorMissing ? '   *** NOT IN THE STORED GRAPH ***' : ''}`);
if (cursorMissing) {
  // This state cannot be resumed — the interpreter throws "unknown node" immediately.
  // Rendering it as ordinary would send an operator to re-run something that cannot start.
  out.push('          this run is NOT resumable as stored: the interpreter will throw');
  out.push('          "unknown node" on the first step. The graph or the cursor is wrong.');
}
out.push(`graph:    v${st.graphVersion || 0}, ${(st.graph && st.graph.nodes || []).length} nodes`);
out.push('');

out.push('VISITS');
for (const [node, n] of Object.entries(st.visits || {})) {
  const cap = ((st.graph && st.graph.invariants && st.graph.invariants.visitCaps) || {})[node]
    ?? ((st.graph && st.graph.invariants && st.graph.invariants.visitCaps) || {})['*'] ?? 3;
  // Flag reaching the cap, not merely being revisited: a run that stopped here almost
  // certainly stopped BECAUSE of it, and making the operator notice the two numbers match
  // is exactly the kind of omission that wastes incident time.
  const mark = n >= cap ? '   <- AT CAP' : n > 1 ? '   <- revisited' : '';
  out.push(`  ${node.padEnd(16)} ${n}/${cap}${mark}`);
}
out.push('');

out.push('PATH');
for (const t of st.trace || []) {
  if (t.patch === 'rejected') {
    const why = (t.violations || []).join('; ') || '(no reason recorded in state)';
    out.push(`  ${t.node}#${t.visit}  PATCH REJECTED: ${why}`);
  } else if (t.patch === 'accepted') {
    out.push(`  ${t.node}#${t.visit}  patch accepted -> graph v${t.version}`);
  } else {
    const v = t.verdict === true ? 'pass' : t.verdict === false ? 'FAIL' : '-';
    out.push(`  ${t.node}#${t.visit}  ${v.padEnd(5)} -> ${t.to}`);
  }
}
out.push('');

const carry = st.carry || {};
if (Object.keys(carry).length) {
  out.push('CARRIED FORWARD');
  for (const [node, c] of Object.entries(carry)) {
    if (Object.keys(c || {}).length) out.push(`  ${node}: ${JSON.stringify(c)}`);
  }
  out.push('');
}

out.push('RESUME');
out.push(`  Workflow({ scriptPath: ".loom/${name}.js", args: <the graph/visits/results/carry/trace/cursor`);
out.push(`             fields of .loom/state/${name}.json — the PATCHED graph, not the seed> })`);

process.stdout.write(out.join('\n') + '\n');
