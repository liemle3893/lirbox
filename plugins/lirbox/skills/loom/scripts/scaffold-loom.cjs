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
  // A `fork` node spawns no worker, so it never opens a progress group.
  const phaseLines = graph.nodes
    .filter((n) => n.id !== graph.terminal && n.kind !== 'fork')
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

// THE WALK IS RECURSIVE so that a fork's branches can run under parallel().
//
// \`stopAt\` is the boundary this walk must not cross: the join id when walking a branch,
// null on the main line. \`visits\` is the caller's counter map — a branch is handed its
// OWN, which is what makes visit accounting per-branch rather than global.
// \`inRegion\` marks a walk running concurrently with siblings; three things are unsafe
// there and are refused rather than silently raced (see below).
//
// Returns the boundary it stopped on plus the last result and the edge that reached the
// boundary, so a fork can build the join's carry from what each branch actually reported.
async function walk(from, stopAt, visits, inRegion) {
  let node = from
  while (node && node !== stopAt && node !== graph.terminal) {
    const n = graph.nodes.find((x) => x.id === node)
    if (!n) throw new Error('unknown node: ' + node)

    const visit = (visits[node] || 0) + 1
    const cap = capFor(graph, node)
    if (visit > cap) {
      throw new Error('visit cap exceeded at ' + node + ' (' + visit + ' > ' + cap + ')')
    }
    visits[node] = visit

    // ---- fork: every out-edge, concurrently -------------------------------------
    if (n.kind === 'fork') {
      const branches = outEdges(graph, node)
      log(node + ': forking ' + branches.length + ' concurrent branches -> ' + n.join)
      trace.push({ node, visit, fork: branches.map((e) => e.to), join: n.join })

      // PER-BRANCH visit accounting. Each branch counts in its own map; validateGraph
      // has already proven the branches node-disjoint, so merging back cannot collide
      // and the merged numbers are exact — not a max or a sum over a shared counter.
      const branchVisits = branches.map(() => ({}))
      const outs = await parallel(branches.map((e, i) => () =>
        walk(e.to, n.join, branchVisits[i], true).then((res) => ({ entry: e.to, res }))))

      const merged = {}
      for (let i = 0; i < outs.length; i++) {
        // parallel() resolves a failed thunk to null. Advancing past the join with a
        // branch missing would hand the join node a partial region and call it done.
        if (!outs[i]) {
          throw new Error('fork ' + node + ' branch ' + branches[i].to + ' did not complete '
            + '— refusing to cross the join ' + n.join + ' with an incomplete region')
        }
        for (const k of Object.keys(branchVisits[i])) visits[k] = branchVisits[i][k]
        merged[outs[i].entry] = carryFor(outs[i].res.edge, outs[i].res.result)
      }

      // Keyed BY BRANCH, never flat-merged. Two branches carrying the same field name
      // would silently overwrite each other, and the join node would never know which
      // branch it was reading.
      carry[n.join] = { branches: merged }
      trace.push({ node, visit, joined: branches.map((e) => e.to), to: n.join })
      if (!inRegion) await checkpoint(n.join)
      node = n.join
      continue
    }

    // phase() mutates a single global progress cursor, so concurrent branches calling it
    // race each other's grouping. Inside a region the per-agent \`phase\` option below is
    // the only grouping that is safe.
    if (!inRegion) phase(node)

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
      if (inRegion) {
        // A branch reshaping the graph while its siblings are walking that same graph is
        // a data race on the one structure every concurrent worker is reading. Refuse it
        // here rather than validate a graph that is already being read by someone else.
        const why = 'a node inside a fork branch may not reshape the graph while sibling '
          + 'branches are walking it — patch from the join or after it'
        log('patch REJECTED at ' + node + ': ' + why)
        trace.push({ node, visit, patch: 'rejected', violations: [why] })
      } else {
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
    }

    // NO SILENT FALLBACK TO THE TERMINAL. pickEdge returns null when no declared
    // predicate matches the result, and predicates compare with ===. Routing to
    // graph.terminal in that case skips EVERY remaining gate — no patch and no
    // adversary required, just an agent returning {passed:'true'} instead of
    // {passed:true}, or omitting the field, or returning null. Six of eight
    // plausible off-shape results reached the terminal this way. The graph is
    // un-bypassable by construction (Task 3); the walk of it must be too.
    const edge = pickEdge(graph, node, r)
    if (!edge) {
      throw new Error('no edge matched at ' + node + ' for result '
        + JSON.stringify(r) + ' — refusing to advance. Routing onward from an '
        + 'unmatched result would skip every remaining gate. Fix the node schema '
        + 'or add an explicit fallthrough edge (when: "always") to this node.')
    }
    const nextNode = edge.to
    trace.push({ node, visit, verdict: r ? r.passed : undefined, to: nextNode })

    // The join's carry is owned by the fork that opened the region — every branch would
    // otherwise write the same key and the last one home would win.
    if (nextNode === stopAt) return { at: nextNode, result: r, edge }
    carry[nextNode] = carryFor(edge, r)

    // Checkpointing is the run's single state file. Concurrent branches writing it would
    // interleave partial states, so a region checkpoints at its boundaries only: a kill
    // inside one replays the region, and results[] makes every completed node free.
    if (!inRegion) await checkpoint(nextNode)
    node = nextNode
  }
  return { at: node, result: null, edge: null }
}

await walk(node, null, visits, false)

return { graph, visits, results, carry, trace, cursor: graph.terminal }
`;

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, src);
  process.stdout.write(`Wrote ${outPath}\n`);
  process.stdout.write(`Nodes: ${graph.nodes.map((n) => n.id).join(' -> ')}\n`);
})();
