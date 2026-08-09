#!/usr/bin/env node
/*
 * Generator for loom conductors.
 *
 *   node scaffold-loom.cjs --name <name> --graph <graph.json> [--out <path>] [--force]
 *     [--model-mode auto|inherit]   auto (default) tags every worker by what the node does
 *     [--model-think <m>]           strong tier: mustCross nodes + plan nodes (default opus)
 *     [--model-work <m>]            everything else (default sonnet)
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

// --- model selection (--model-mode) ---
// auto (DEFAULT) : every worker gets a `model:` opt chosen by what the node DOES — the strong
//                  tier for nodes that adjudicate or plan, the work tier for the rest. Without
//                  this every worker inherited the session model, so a whole run of mechanical
//                  nodes billed at whatever the human happened to be running.
// inherit        : emit no policy at all — byte-equivalent to the pre-policy generator. A node's
//                  own `model` field is still honoured, because that is graph DATA a human
//                  approved, not a generator default.
const MODEL_VALUES = ['sonnet', 'opus', 'haiku', 'fable'];
const modelMode = arg('model-mode', 'auto');
if (modelMode !== 'auto' && modelMode !== 'inherit') {
  die(`--model-mode must be 'auto' (the default) or 'inherit' (got '${modelMode}')`);
}
// Under `inherit` no policy is emitted, so these would be silently ignored. Say so instead.
if (modelMode === 'inherit') {
  for (const flag of ['--model-think', '--model-work']) {
    if (process.argv.includes(flag)) {
      die(`${flag} requires the auto model mode (it is ignored under --model-mode inherit) — `
        + 'drop the flag or drop --model-mode inherit');
    }
  }
}
// --- plan-check on rejected re-entry (--plan-check) ---
// on (DEFAULT): when an ENFORCED gate rejects the work and routes the run backwards, the node
// it lands on re-verifies the plan (via the lirbox:plan-check skill, autofix applied) BEFORE
// doing any work. Re-implementing against a plan that was just proven wrong is how a run
// spends its whole visit budget arriving at the same verdict repeatedly.
// off: emit no such block. Each triggered check costs a full plan-check pass, so a run over a
// plan that is known-good but noisy may legitimately want it out of the way.
const planCheckMode = arg('plan-check', 'on');
if (planCheckMode !== 'on' && planCheckMode !== 'off') {
  die(`--plan-check must be 'on' (the default) or 'off' (got '${planCheckMode}')`);
}
const modelThink = arg('model-think', 'opus');
const modelWork = arg('model-work', 'sonnet');
for (const [flag, val] of [['--model-think', modelThink], ['--model-work', modelWork]]) {
  if (val === true || !MODEL_VALUES.includes(val)) {
    die(`${flag} must be one of: ${MODEL_VALUES.join(', ')}`);
  }
}

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
    die('graph violates its own invariants:\n  - ' + core.messages(violations).join('\n  - '));
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

// PERSIST BY OWNER. The conductor checkpoints only what the CONDUCTOR owns — topology,
// position, visit counters, carry, trace. All of that is bounded by the SHAPE of the graph
// and does not grow with how much work the nodes did.
//
// \`results\` is deliberately NOT here. It is every worker's full return value, and putting it
// in this payload made checkpointing O(n^2) in tokens: each node re-sent everything every
// earlier node had returned, into a fresh subagent prompt, on the session model, to write one
// file. On an observed 17-node run that was ~2.15M of 5.7M tokens — 38% of the run.
//
// Each worker now writes its own results entry instead (see node-lead.txt): it already holds
// the value and already has a Write tool, so that costs no new input tokens. The resume path
// folds those files back into \`args.results\`.
//
// The cheap model is not a micro-optimisation. This agent's entire job is one file write, and
// with no \`model\` opt it inherits whatever the session runs on.
async function checkpoint(cursor) {
  const payload = JSON.stringify({
    workflow: NAME, status: 'running', graphVersion: graph.version || 0,
    graph, cursor, visits, carry, trace,
  })
  await agent(
    sub(\`${esc(tpl('checkpoint.txt'))}\`, { name: NAME, payload }),
    { label: 'checkpoint:' + cursor, phase: 'Checkpoint', model: 'haiku', effort: 'low' },
  )
}

// MODEL POLICY. Resolved at RUNTIME from the LIVE graph, never baked into a table at
// generation time: a runtime graphPatch can add nodes that did not exist when this script was
// written, and a frozen table would leave every one of them silently inheriting.
//
// The strong tier is keyed on invariants.mustCross — NOT on kind === 'gate'. Per the graph
// spec, \`kind\` is DESCRIPTIVE for every value except 'fork': calling a node "gate" does not
// make it one, and an enforced gate is free to be labelled anything at all. Keying on the
// label would hand the strong model to a node that adjudicates nothing, while the node whose
// verdict actually decides whether the run may terminate ran on the cheap tier. mustCross is
// the enforced truth, so that is what this reads.
//
// kind === 'plan' gets the strong tier too, but purely as a COST heuristic. Being wrong about
// a descriptive label there wastes money; it cannot weaken a gate, which is why it is
// acceptable to key on the label for that one and not for the other.
const MODEL_MODE = ${JSON.stringify(modelMode)}
const MODEL_THINK = ${JSON.stringify(modelThink)}
const MODEL_WORK = ${JSON.stringify(modelWork)}

function modelOpts(n) {
  const out = {}
  if (MODEL_MODE === 'auto') {
    const must = (graph.invariants && graph.invariants.mustCross) || []
    const think = must.indexOf(n.id) !== -1 || n.kind === 'plan'
    out.model = think ? MODEL_THINK : MODEL_WORK
    if (think) out.effort = 'high'
  }
  // An explicitly authored model always wins. It is a decision a human made and approved in
  // the graph itself; the policy is only a default for the nodes that did not make one.
  if (n.model) out.model = n.model
  if (n.effort) out.effort = n.effort
  return out
}

const PLAN_CHECK = ${JSON.stringify(planCheckMode)}

// Did an ENFORCED gate reject the work and send the run back to this node? Derived from the
// trace rather than stored in its own field, so a resume reconstructs it for free instead of
// carrying yet another thing that can go stale.
//
// Keyed on invariants.mustCross for the same reason the model policy is: a node merely
// labelled "gate" adjudicates nothing, and an enforced gate is free to be labelled anything.
// A non-passing verdict from a node that is not enforced is an ordinary branch, not a
// rejection, and must not trigger a plan-check the human never asked to pay for.
function rejectedInto(id) {
  const must = (graph.invariants && graph.invariants.mustCross) || []
  for (let i = trace.length - 1; i >= 0; i--) {
    const t = trace[i]
    if (t.to === id) {
      return must.indexOf(t.node) !== -1 && t.verdict !== true ? t.node : null
    }
  }
  return null
}

// THE RUN BRIEF. Every worker is a fresh context that knows nothing about why the run exists.
// Before this, a node's entire instruction could be "Implement the goal in the worktree" with
// the goal itself appearing nowhere in the prompt, so each worker opened by rediscovering the
// run's purpose from the repository — and the next worker did it again.
//
// Read at RUNTIME from the live graph rather than baked in at generation time, for the same
// reason the model policy is: a runtime graphPatch may rewrite the graph this conductor walks.
//
// BOUNDED, and the bound is the point rather than tidiness. The cost this skill just finished
// removing was O(n^2): every worker's output re-sent into every later prompt. A brief that is
// O(1) in the length of the run cannot decay into that. An UNBOUNDED string spliced into every
// worker prompt could — paste a 200KB spec into graph.goal and it is re-sent once per node.
// GOAL_MAX is what keeps the O(1) true regardless of what a human put in the field.
const GOAL_MAX = 600
function runGoal() {
  const g = String(graph.goal || '').trim()
  if (!g) return '(no goal recorded in the graph — read the DoD file below)'
  return g.length > GOAL_MAX ? g.slice(0, GOAL_MAX) + ' ... [truncated]' : g
}

// The plan node's most recent recorded result — the artifact plan-check re-verifies. Each
// worker persists its own result, so this path exists on disk by the time any re-entry
// happens; there is nothing for the conductor to read or pass through.
function planResultKey() {
  const p = graph.nodes.find((x) => x.kind === 'plan')
  if (!p) return ''
  const v = visits[p.id] || 0
  return v ? p.id + '#' + v : ''
}

// Visit accounting. \`visits\` is whichever counter map the caller owns — a region is
// handed its OWN, which is what makes accounting per-region rather than global.
function bumpVisit(id, visits, base) {
  const visit = (visits[id] || 0) + 1
  // The cap is a property of the AUTHORED node, so every fan-out instance gets its own full
  // allowance rather than N instances sharing one budget and starving the last of them.
  const cap = capFor(graph, base || id)
  if (visit > cap) {
    throw new Error('visit cap exceeded at ' + id + ' (' + visit + ' > ' + cap + ')')
  }
  visits[id] = visit
  return visit
}

// Execute ONE node: visit accounting, the resume cache, the worker call, and any graph
// patch it returns. Shared by the sequential walk and the region's dataflow runner, so
// there is exactly one place where a node is run and one definition of what that costs.
// \`id\` is the ACCOUNTING identity — for a fan-out instance that is \`Node@3\`, while the
// prompt, schema and visit cap all come from the base node \`Node\`. Keeping the two apart is
// what makes instance-level accounting exact instead of a shared counter.
async function runNode(id, visits, inRegion) {
  const base = baseId(id)
  const n = graph.nodes.find((x) => x.id === base)
  if (!n) throw new Error('unknown node: ' + base)
  const visit = bumpVisit(id, visits, base)
  const cap = capFor(graph, base)

  // phase() mutates a single global progress cursor, so concurrent region nodes calling
  // it race each other's grouping. Inside a region the per-agent phase option passed to
  // agent() below is the only grouping that is safe.
  if (!inRegion) phase(id)

  const key = id + '#' + visit
  let r
  if (results[key] !== undefined) {
    log(key + ' already complete (resumed)')
    r = results[key]
  } else {
    const carryIn = carry[id] || {}
    const carryText = Object.keys(carryIn).length
      ? 'CARRIED FORWARD from the edge that sent you here:\\n' + JSON.stringify(carryIn, null, 2)
      : ''
    // \`resultKey\` is the SAME key this conductor caches under, handed to the worker so the
    // file it writes is the file a resume looks up. Any other naming makes the persistence
    // real but unreachable.
    // Re-verify the plan before redoing work an enforced gate just rejected. Needs a plan
    // node that has actually run: with no recorded plan there is no artifact to check, and
    // inventing one to check would be worse than skipping.
    const gateId = PLAN_CHECK === 'on' && !inRegion ? rejectedInto(id) : null
    const planKey = gateId ? planResultKey() : ''
    if (gateId && !planKey) {
      log(id + ': ' + gateId + ' rejected the previous attempt, but no plan node result is '
        + 'recorded — skipping plan-check rather than checking an imagined plan')
    }
    const planCheckText = (gateId && planKey)
      ? sub(\`${esc(tpl('plan-check.txt'))}\`, { name: NAME, planKey, gateId })
      : ''
    const prompt = sub(\`${esc(tpl('node-lead.txt'))}\`, {
      WORKTREE, BRANCH, name: NAME, nodeId: id, resultKey: key, planCheckText,
      visit: String(visit), cap: String(cap), goal: runGoal(),
      carryText, nodePrompt: n.prompt || '', terminal: graph.terminal })
    r = await agent(prompt, {
      label: key, phase: id,
      ...(n.agentType ? { agentType: n.agentType } : {}),
      ...modelOpts(n),
      ...(n.schema ? { schema: n.schema } : {}),
    })
    results[key] = r
  }

  // A NO-GO is a REFUSAL, not a verdict to route on. Every other loom refusal — fan-out over
  // its bound, an unmatched edge, an incomplete region, a blown visit cap — aborts rather
  // than continuing quietly, and this is the same shape: the plan the run is about to execute
  // has been found unsafe, so routing onward would send it straight back into the work the
  // check just condemned. Enforced here rather than left to the worker's own instructions,
  // because "the agent was told to stop" is not a guarantee that it did.
  //
  // This fires on a CACHED result too, so a resume replays the refusal instead of sailing
  // past it. To get past a NO-GO, fix the plan and delete that result file — deliberately a
  // human action.
  // Abort on the FACT, not only on the label. plan-check's rule is that NO-GO means exactly
  // "a REFUTED row sits on a critical path", and autofix never touches REFUTED rows — so a
  // surviving count is the ground truth and the verdict string is a summary of it. Trusting
  // the summary alone would leave the whole gate resting on a worker correctly recomputing a
  // verdict after autofix: get that one step wrong and a plan with live REFUTED rows arrives
  // labelled GO-WITH-CONDITIONS and sails straight through. Checking both means the two have
  // to agree, and disagreement fails closed.
  const refuted = r && typeof r.refuted === 'number' ? r.refuted : 0
  if (r && (r.planCheck === 'NO-GO' || refuted > 0)) {
    throw new Error('plan-check refused the plan at ' + id + ' (verdict '
      + (r.planCheck || '(none)') + ', ' + refuted + ' REFUTED on a critical path) — refusing '
      + 'to re-implement against a plan just found unsafe. Autofix cannot clear a NO-GO, only '
      + 'shrink one, so this needs a human. Report: ' + (r.report || '(none written)'))
  }

  if (r && r.graphPatch) {
    if (inRegion) {
      // A region node reshaping the graph while its siblings are being scheduled against
      // that same structure is a data race on the thing every concurrent worker reads.
      // Refuse it here rather than validate a graph someone else is already walking.
      const why = 'a node inside a fork region may not reshape the graph while sibling '
        + 'nodes are running against it — patch from the join or after it'
      log('patch REJECTED at ' + id + ': ' + why)
      trace.push({ node: id, visit, patch: 'rejected', violations: [why] })
    } else {
      const next = applyPatchTo(graph, r.graphPatch)
      const viol = validateGraph(next, graph, { node: id, unsatisfiedGates: unsatisfiedGates() })
      if (viol.length) {
        // The log line stays prose for the human tailing the run; the TRACE keeps the
        // structured violations, so the rejected worker (and loom-report) get the code,
        // the offending node/edge and any suggested fix rather than a sentence to parse.
        log('patch REJECTED at ' + id + ': ' + messages(viol).join('; '))
        trace.push({ node: id, visit, patch: 'rejected', violations: viol })
      } else {
        graph = next
        graph.version = (graph.version || 0) + 1
        log('patch accepted at ' + id + ' -> graph v' + graph.version)
        trace.push({ node: id, visit, patch: 'accepted', version: graph.version })
      }
    }
  }
  return r
}

// The sequential walk: one cursor, one successor per node, exactly as before. It hands
// off to the DAG runner when it meets a fork and resumes at that fork's join.
//
// \`stopAt\` is a boundary it must not cross (null on the main line). Returns the boundary
// it stopped on plus the last result and the edge that reached it.
async function walk(from, stopAt, visits, inRegion) {
  let node = from
  while (node && node !== stopAt && node !== graph.terminal) {
    const n = graph.nodes.find((x) => x.id === node)
    if (!n) throw new Error('unknown node: ' + node)

    // ---- fork: run the region as a DAG ------------------------------------------
    //
    // Inside a region an edge means DEPENDS ON, not go-to-next. So this is not a set of
    // parallel lanes being awaited — it is dataflow: every node is a memoised promise
    // that first awaits its in-region predecessors. A node with two predecessors waits
    // for both; a node with one waits only for that one and does not block on its
    // sibling. Maximum concurrency falls out of the dependency structure itself, and
    // each node runs exactly ONCE per region entry because the promise is memoised.
    if (n.kind === 'fork') {
      const visit = bumpVisit(node, visits)
      const region = regionNodes(graph, n)
      // Re-checked at RUNTIME, not trusted from pre-flight: a runtime graphPatch could
      // have introduced a cycle since approval, and a cycle here is a deadlock — every
      // node waiting on another, with no verdict able to break it.
      if (!regionOrder(graph, region)) {
        throw new Error('fork ' + node + ' region contains a dependency cycle — refusing '
          + 'to schedule it, every node would wait on another forever')
      }
      log(node + ': region of ' + region.size + ' node(s) as a DAG -> ' + n.join)
      trace.push({ node, visit, fork: [...region], join: n.join })

      // PER-REGION visit accounting. The region counts in its own map; its nodes are
      // reachable only through this fork, so merging back cannot collide with the outer
      // walk, and the merged numbers are exact rather than a max over a shared counter.
      // Seeded from the OUTER counts, not from zero. A region can be re-entered (a gate
      // after the join fails and routes back to the fork); starting fresh would make the
      // second pass reuse id#1 and hit the resume cache, replaying the first pass's
      // results as if the work had been redone, while every visit cap silently reset.
      const regionVisits = {}
      for (const id of region) if (visits[id]) regionVisits[id] = visits[id]

      // FAN-OUT. With no spec there is exactly one instance and \`suffix\` is empty, so the
      // static path below IS the fan-out path with N = 1 — one scheduler, not two.
      const spec = fanOutOf(n)
      let items = [null]
      if (spec) {
        const carried = (carry[node] || {})[spec.field]
        if (!Array.isArray(carried)) {
          throw new Error('fork ' + node + ' fans out over "' + spec.field + '" but the carry '
            + 'held ' + JSON.stringify(carried) + ' — refusing to run zero instances and '
            + 'report the region done')
        }
        if (carried.length > spec.max) {
          // NO SILENT TRUNCATION. The approved bound is the whole basis on which a human
          // signed off a shape whose size was not knowable; quietly dropping the tail
          // reports success for work that never ran.
          throw new Error('fork ' + node + ' would fan out ' + carried.length + ' times but '
            + 'the approved bound is ' + spec.max + ' — refusing to truncate. Re-approve with '
            + 'a higher fanOut.max, or narrow the list upstream.')
        }
        if (carried.length === 0) {
          throw new Error('fork ' + node + ' fanned out over an EMPTY "' + spec.field + '" — '
            + 'a region that ran zero times cannot have done the work the join expects')
        }
        items = carried
      }
      const instances = items.map((item, i) => ({ item, i, suffix: spec ? '@' + i : '' }))
      if (spec) {
        log(node + ': fanning the region over ' + instances.length + ' item(s), bound '
          + spec.max)
      }

      const started = {}
      const runRegionNode = (id, inst) => {
        const key = id + inst.suffix
        if (!started[key]) {
          started[key] = (async () => {
            const preds = regionPreds(graph, region, id)
            const done = await Promise.all(preds.map((e) =>
              runRegionNode(e.from, inst).then((res) => ({ e, res }))))
            // Carry keyed BY PREDECESSOR, never flat-merged: two dependencies carrying
            // the same field name would silently overwrite each other and the node could
            // not tell which one it was reading. Entry nodes inherit the fork's own carry.
            if (done.length) {
              const from = {}
              for (const d of done) from[d.e.from + inst.suffix] = carryFor(d.e, d.res)
              carry[key] = { from }
            } else {
              // An entry node inherits the fork's own carry, plus — when fanning out — THE
              // ITEM it exists to process. Without \`item\` every instance would receive an
              // identical prompt and do identical work N times.
              const inherited = carry[node] ? Object.assign({}, carry[node]) : {}
              if (inst.item !== null) inherited.item = inst.item
              carry[key] = inherited
            }
            return await runNode(key, regionVisits, true)
          })()
        }
        return started[key]
      }

      // Running the sinks pulls in every other region node through its dependencies —
      // validateGraph has proven every region node reaches the join.
      const sinks = regionSinks(graph, region, n.join)
      // Every sink of every instance, all in flight together — instances are no more
      // serialised against each other than the DAG inside one of them is.
      const work = []
      for (const inst of instances) for (const id of sinks) work.push({ id, inst })
      const outs = await parallel(work.map((w) => () =>
        runRegionNode(w.id, w.inst).then((res) => ({ id: w.id + w.inst.suffix, res }))))

      const from = {}
      for (let i = 0; i < outs.length; i++) {
        // parallel() resolves a failed thunk to null. Crossing the join with a node
        // missing would hand the join a partial region and report it as done.
        if (!outs[i]) {
          throw new Error('fork ' + node + ' region node ' + work[i].id + work[i].inst.suffix
            + ' did not complete — refusing to cross the join ' + n.join
            + ' with an incomplete region')
        }
        const e = outEdges(graph, work[i].id).find((x) => x.to === n.join)
        from[outs[i].id] = carryFor(e, outs[i].res)
      }
      for (const k of Object.keys(regionVisits)) visits[k] = regionVisits[k]

      carry[n.join] = { from }
      trace.push({ node, visit, joined: Object.keys(from), to: n.join,
        instances: spec ? instances.length : undefined })
      if (!inRegion) await checkpoint(n.join)
      node = n.join
      continue
    }

    const r = await runNode(node, visits, inRegion)
    const visit = visits[node]

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
