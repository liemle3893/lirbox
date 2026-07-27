#!/usr/bin/env node
/*
 * Generator for loom conductors.
 *
 *   node scaffold-loom.cjs --name <name> --graph <graph.json> [--out <path>] [--force]
 *
 * Emits a Workflow script that is a GRAPH INTERPRETER: the graph travels as DATA and
 * graph-core.mjs is INLINED as source, because the generated conductor is a restricted
 * layer with no module loader and no fs/git/crypto/clock. Never hand-edit the output —
 * change this generator and regenerate with --force.
 */
const fs = require('fs');
const path = require('path');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return dflt;
  const next = process.argv[i + 1];
  return (next === undefined || next.startsWith('--')) ? true : next;
}
function die(msg) { console.error('ERROR: ' + msg); process.exit(1); }

const name = arg('name', '');
const graphPath = arg('graph', '');
const force = arg('force', false) === true;
if (!name || name === true) die('--name is required');
if (!graphPath || graphPath === true) die('--graph <graph.json> is required');
const outPath = arg('out', path.join('.loom', name + '.js'));

let graph;
try { graph = JSON.parse(fs.readFileSync(graphPath, 'utf8')); }
catch (e) { die('--graph not readable or not valid JSON: ' + e.message); }

// Strip the single trailing `export { ... };` line. The test net asserts the
// remainder appears verbatim in the emitted file, so there is exactly one
// implementation of the graph math in the repo.
function inlineCore(srcText) {
  return srcText.replace(/^export \{[^}]*\};?\s*$/m, '').trimEnd();
}
const corePath = path.join(__dirname, 'graph-core.mjs');
const coreSrc = inlineCore(fs.readFileSync(corePath, 'utf8'));

// Validate the graph with the same code the conductor will use, so a graph that
// violates its own invariants can never reach a run.
(async () => {
  const core = await import('file://' + corePath);
  const violations = core.validateGraph(graph, graph, null);
  if (violations.length) {
    die('graph violates its own invariants:\n  - ' + violations.join('\n  - '));
  }

  if (fs.existsSync(outPath) && !force) {
    die(outPath + ' exists — pass --force to overwrite (never hand-edit generated scripts)');
  }

  const tpl = (f) => fs.readFileSync(path.join(__dirname, 'prompts', f), 'utf8');
  // Escape a prompt template for embedding in an emitted template literal.
  // Escaping the dollar-brace sequence is NOT optional. Prompt templates contain literal
  // placeholder markers that are substituted at RUNTIME. Left unescaped they become real
  // interpolations in the generated script — which still PARSES, so `node --check` passes
  // and the restricted-layer scan passes, and then the conductor throws
  // "ReferenceError: nodeId is not defined" the first time a workflow actually runs.
  const esc = (s) => s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');

  // NOTE: the matching `sub()` helper is emitted INTO the conductor (see the generated
  // source below), because substitution happens at conductor runtime with runtime values.

  // meta MUST be a pure literal. It lists the APPROVED nodes; nodes added by a
  // runtime patch simply get their own progress group from the Workflow engine.
  const phaseLines = graph.nodes
    .filter((n) => n.id !== graph.terminal)
    .map((n) => `    { title: '${n.id}', detail: '${(n.kind || 'work')} node' },`)
    .join('\n');

  const src = `export const meta = {
  name: ${JSON.stringify('loom-' + name)},
  description: ${JSON.stringify((graph.goal || name).slice(0, 160))},
  phases: [
${phaseLines}
  ],
}

// ============================ graph-core (INLINED) ============================
// Source of truth: plugins/lirbox/skills/loom/scripts/graph-core.mjs
// Inlined because this layer has no module loader. test-loom.cjs asserts this
// block matches the module byte-for-byte — edit the module, regenerate, never
// patch it here.
${coreSrc}
// ========================== end graph-core (INLINED) ==========================

const NAME = ${JSON.stringify(name)}
const WORKTREE = ${JSON.stringify('.worktrees/' + name)}
const BRANCH = ${JSON.stringify('wf/' + name)}
const GRAPH_V0 = ${JSON.stringify(graph, null, 2).replace(/\n/g, '\n')}

// Resume restores STRUCTURE (the patched graph), not just progress.
let graph   = (args && args.graph)   ? args.graph   : GRAPH_V0
let visits  = (args && args.visits)  ? args.visits  : {}
let results = (args && args.results) ? args.results : {}
let carry   = (args && args.carry)   ? args.carry   : {}
let trace   = (args && args.trace)   ? args.trace   : []
let node    = (args && args.cursor)  ? args.cursor  : graph.start

// Substitute placeholder markers in a prompt template.
// split/join, NOT String.replace: replace() with a string pattern swaps only the FIRST
// occurrence, and expands special replacement patterns (dollar-ampersand, dollar-backtick,
// dollar-quote, dollar-digit) found in the REPLACEMENT — so a node prompt or a JSON
// payload containing one would be silently corrupted or splice in unrelated text.
function sub(text, vars) {
  let out = text
  for (const k of Object.keys(vars)) {
    const v = vars[k] === undefined || vars[k] === null ? '' : String(vars[k])
    out = out.split('\${' + k + '}').join(v)
  }
  return out
}

// A gate is "satisfied" once its most recent visit returned passed === true.
function unsatisfiedGates() {
  const out = []
  for (const g of (graph.invariants && graph.invariants.mustCross) || []) {
    let last = null
    for (const t of trace) if (t.node === g && t.verdict !== undefined) last = t.verdict
    if (last !== true) out.push(g)
  }
  return out
}

async function checkpoint(cursor) {
  const payload = JSON.stringify({
    workflow: NAME, status: 'running', graphVersion: graph.version || 0,
    graph, cursor, visits, results, carry, trace,
  }, null, 2)
  await agent(
    sub(\`${esc(tpl('checkpoint.txt'))}\`, { name: NAME, payload }),
    { label: 'checkpoint:' + cursor, phase: 'Checkpoint' },
  )
}

while (node && node !== graph.terminal) {
  const n = graph.nodes.find((x) => x.id === node)
  if (!n) throw new Error('unknown node: ' + node)

  const visit = (visits[node] || 0) + 1
  const cap = capFor(graph, node)
  if (visit > cap) {
    throw new Error('visit cap exceeded at ' + node + ' (' + visit + ' > ' + cap + ')')
  }
  visits[node] = visit

  phase(node)
  const key = node + '#' + visit
  let r
  if (results[key] !== undefined) {
    log(key + ' already complete (resumed)')
    r = results[key]
  } else {
    const carryIn = carry[node] || {}
    const carryText = Object.keys(carryIn).length
      ? 'CARRIED FORWARD from the edge that sent you here:\\n' + JSON.stringify(carryIn, null, 2)
      : ''
    const prompt = sub(\`${esc(tpl('node-lead.txt'))}\`, {
      WORKTREE, BRANCH, nodeId: node, visit: String(visit), cap: String(cap),
      carryText, nodePrompt: n.prompt || '', terminal: graph.terminal })
    r = await agent(prompt, {
      label: key, phase: node,
      ...(n.agentType ? { agentType: n.agentType } : {}),
      ...(n.model ? { model: n.model } : {}),
      ...(n.schema ? { schema: n.schema } : {}),
    })
    results[key] = r
  }

  if (r && r.graphPatch) {
    const next = applyPatchTo(graph, r.graphPatch)
    const viol = validateGraph(next, graph, { node, unsatisfiedGates: unsatisfiedGates() })
    if (viol.length) {
      log('patch REJECTED at ' + node + ': ' + viol.join('; '))
      trace.push({ node, visit, patch: 'rejected', violations: viol })
    } else {
      graph = next
      graph.version = (graph.version || 0) + 1
      log('patch accepted at ' + node + ' -> graph v' + graph.version)
      trace.push({ node, visit, patch: 'accepted', version: graph.version })
    }
  }

  const edge = pickEdge(graph, node, r)
  const nextNode = edge ? edge.to : graph.terminal
  if (edge) carry[nextNode] = carryFor(edge, r)
  trace.push({ node, visit, verdict: r ? r.passed : undefined, to: nextNode })

  await checkpoint(nextNode)
  node = nextNode
}

return { graph, visits, results, carry, trace, cursor: graph.terminal }
`;

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, src);
  process.stdout.write(`Wrote ${outPath}\n`);
  process.stdout.write(`Nodes: ${graph.nodes.map((n) => n.id).join(' -> ')}\n`);
})();
