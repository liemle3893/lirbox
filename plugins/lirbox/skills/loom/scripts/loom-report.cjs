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
const st = JSON.parse(fs.readFileSync(p, 'utf8'));

const out = [];
out.push(`loom run: ${st.workflow}`);
out.push(`status:   ${st.status}${st.finishedAt ? ` (finished ${st.finishedAt})` : ''}`);
out.push(`started:  ${st.startedAt || 'unknown'}`);
out.push(`cursor:   ${st.cursor}`);
out.push(`graph:    v${st.graphVersion || 0}, ${(st.graph && st.graph.nodes || []).length} nodes`);
out.push('');

out.push('VISITS');
for (const [node, n] of Object.entries(st.visits || {})) {
  const cap = ((st.graph && st.graph.invariants && st.graph.invariants.visitCaps) || {})[node]
    ?? ((st.graph && st.graph.invariants && st.graph.invariants.visitCaps) || {})['*'] ?? 3;
  out.push(`  ${node.padEnd(16)} ${n}/${cap}${n > 1 ? '   <- revisited' : ''}`);
}
out.push('');

out.push('PATH');
for (const t of st.trace || []) {
  if (t.patch === 'rejected') {
    out.push(`  ${t.node}#${t.visit}  PATCH REJECTED: ${(t.violations || []).join('; ')}`);
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
