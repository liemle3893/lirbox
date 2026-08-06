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

const capsOf = (st) =>
  (st.graph && st.graph.invariants && st.graph.invariants.visitCaps) || {};
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
// Mirrors capFor() in graph-core.mjs. hasOwnProperty, not `??`: an explicitly-null cap
// must display as what the runtime will enforce, not fall through to the default.
const capOf = (caps, node) =>
  has(caps, node) ? caps[node] : has(caps, '*') ? caps['*'] : 3;

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
const caps = capsOf(st);
for (const [node, n] of Object.entries(st.visits || {})) {
  const cap = capOf(caps, node);
  // Flag reaching the cap, not merely being revisited: a run that stopped here almost
  // certainly stopped BECAUSE of it, and making the operator notice the two numbers match
  // is exactly the kind of omission that wastes incident time.
  const mark = n >= cap ? '   <- AT CAP' : n > 1 ? '   <- revisited' : '';
  out.push(`  ${node.padEnd(16)} ${n}/${cap}${mark}`);
}
out.push('');

out.push('PATH');
for (const t of st.trace || []) {
  const where = `${t.node ?? '(unnamed node)'}#${t.visit ?? '?'}`;
  if (t.patch === 'rejected') {
    const why = (t.violations || []).join('; ') || '(no reason recorded in state)';
    out.push(`  ${where}  PATCH REJECTED: ${why}`);
  } else if (t.patch === 'accepted') {
    out.push(`  ${where}  patch accepted -> graph v${t.version}`);
  } else {
    const v = t.verdict === true ? 'pass' : t.verdict === false ? 'FAIL' : '-';
    out.push(`  ${where}  ${v.padEnd(5)} -> ${t.to}`);
  }
}
out.push('');

const carry = st.carry || {};
const carried = Object.entries(carry)
  .filter(([, c]) => Object.keys(c || {}).length)
  .map(([node, c]) => `  ${node}: ${JSON.stringify(c)}`);
if (carried.length) {
  out.push('CARRIED FORWARD');
  out.push(...carried);
  out.push('');
}

out.push('RESUME');
if (cursorMissing) {
  out.push('  NOT AVAILABLE — the cursor above is not a node in the stored graph, so there');
  out.push('  is no valid node to resume from. Fix the cursor or the graph in the state file');
  out.push('  first; any resume attempted as stored throws "unknown node" immediately.');
} else {
  out.push('  *** PASS THE PATCHED GRAPH FROM THE STATE FILE — NEVER THE SEED. ***');
  out.push('      Re-seeding discards every accepted patch and every visit count: the run');
  out.push('      restarts from the original graph and the work already done is lost.');
  out.push('');
  out.push(`  Workflow({ scriptPath: ".loom/${name}.js",`);
  out.push('             args: <the graph/visits/carry/trace/cursor fields');
  out.push(`                    of .loom/state/${name}.json,`);
  out.push('                    plus results: the union of every');
  out.push(`                    .loom/state/${name}/results/<key>.json,`);
  out.push('                    keyed by that file\'s <key>> })');
  out.push('');
  out.push('  The state file has no "results" field by design — each worker persists its');
  out.push('  own. Omit the fold and the resume re-runs every completed node.');
}

process.stdout.write(out.join('\n') + '\n');
