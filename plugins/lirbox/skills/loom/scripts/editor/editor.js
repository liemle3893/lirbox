// loom graph editor.
//
// Validation here is a COURTESY — the server re-validates every POST and its answer
// is final. Importing the same graph-core the conductor inlines guarantees the
// message you see in the browser is the message the run would produce.
import { validateGraph, capFor } from './graph-core.mjs';

const { useState, useEffect, useCallback, createElement: h } = React;
const RF = window.ReactFlow;

let graph = null;
let readOnly = false;
let selected = null;
const comments = [];

const $ = (id) => document.getElementById(id);
const setStatus = (t) => { $('status').textContent = t; };
const showViolations = (list) => {
  $('violations').textContent = list && list.length
    ? 'Rejected:\n  - ' + list.join('\n  - ') : '';
};

// ---- graph <-> React Flow ------------------------------------------------

function toFlow(g) {
  // A fork is the one node kind whose out-edges are ALL taken, at the same time. If the
  // canvas draws it like an ordinary branch, the human approves a shape that does not
  // describe what runs — which is the entire point of this gate. So a fork gets its own
  // class, names its join in the label, and marks each out-edge as concurrent.
  const kindOf = new Map(g.nodes.map((n) => [n.id, n.kind]));
  const nodes = g.nodes.map((n, i) => ({
    id: n.id,
    position: n.pos || { x: 60, y: 40 + i * 90 },
    data: {
      label: n.id
        + (n.kind === 'fork' ? ` ⑂ join: ${n.join || '(none)'}` : '')
        + (n.locked ? ' 🔒' : ''),
    },
    className: (n.kind === 'gate' ? 'node-gate' : n.kind === 'fork' ? 'node-fork' : 'node-work')
      + (n.locked ? ' locked' : ''),
    draggable: !readOnly,
    deletable: !readOnly && !n.locked,
  }));
  const edges = g.edges.map((e, i) => ({
    id: `e${i}:${e.from}->${e.to}`,
    source: e.from, target: e.to,
    // `graph-spec.md` and `matches()` both treat 'always', undefined and null as the same
    // no-predicate edge — `e.when === 'always'` alone missed the other two and threw on
    // `e.when.field`, which crashes inside loadGraph().then(...) with no error surfaced:
    // setFlow never runs and the canvas stays blank. A planner graphPatch that legally
    // omits `when` bricked the approval gate.
    // A fork's out-edge is never a choice — labelling it with a predicate it is forbidden
    // to have would read as "sometimes". It always runs, in parallel with its siblings.
    label: kindOf.get(e.from) === 'fork' ? '∥ concurrent'
      : (!e.when || e.when === 'always') ? ''
        : `${e.when.field}=${JSON.stringify(e.when.eq ?? e.when.neq)}`,
    animated: !!e.carry || kindOf.get(e.from) === 'fork',
    deletable: !readOnly && !e.locked,
  }));
  return { nodes, edges };
}

function fromFlow(flowNodes, flowEdges) {
  const next = JSON.parse(JSON.stringify(graph));
  // Persist layout so the graph reopens the way you left it.
  for (const fn of flowNodes) {
    const n = next.nodes.find((x) => x.id === fn.id);
    if (n) n.pos = fn.position;
  }
  const keep = new Set(flowNodes.map((n) => n.id));
  next.nodes = next.nodes.filter((n) => keep.has(n.id));
  next.edges = flowEdges
    // Drop edges whose endpoints no longer exist, rather than trusting React Flow to have
    // cascaded the removal when a node was deleted. It documents that it does — but nothing
    // in this environment can execute the UI to confirm it fires in this exact setup, and
    // relying on unverifiable library behaviour for a correctness property is the wrong
    // trade when the guard is one filter. Without it a dangling edge reaches validateGraph
    // and the user gets a confusing "edge from unknown node" 422 instead of a clean save.
    .filter((fe) => keep.has(fe.source) && keep.has(fe.target))
    .map((fe) => {
      // Match by the ORIGINAL edge's position, not by (source, target). `graph.edges.find`
      // returns the FIRST edge between a pair — harmless with one edge between two nodes,
      // but two parallel edges (e.g. a gate's pass/fail predicates aren't the only shape;
      // DoDGate -> Implement can carry both a {passed:false} retry edge and a distinct
      // {severity:'soft'} edge) both resolved to the same first match, so the second
      // edge's real predicate was silently discarded and replaced by the first's on every
      // save. toFlow embeds the source index in the flow id (`e${i}:...`); use it to find
      // the exact edge this one came from. Endpoints are re-checked in case the id survived
      // a rewire (dragging an edge's end to a different node keeps its id) — if they no
      // longer match, this is effectively a new edge and falls through to 'always', same as
      // a genuinely new hand-drawn connection.
      const m = /^e(\d+):/.exec(fe.id);
      const idx = m ? Number(m[1]) : -1;
      const prior = idx >= 0 ? graph.edges[idx] : undefined;
      return (prior && prior.from === fe.source && prior.to === fe.target)
        ? prior : { from: fe.source, to: fe.target, when: 'always' };
    });
  return next;
}

// ---- server I/O ---------------------------------------------------------

async function loadGraph() {
  graph = await (await fetch('/graph')).json();
  return graph;
}

async function save(next) {
  // Local pre-check first: identical rules, instant feedback, no round trip.
  const local = validateGraph(next, graph, null);
  if (local.length) { showViolations(local); return false; }

  // Send the version this edit was based on. Without it two saves close together —
  // two tabs, or an auto-save racing a manual one — both return 200 and one edit is
  // silently discarded.
  const res = await fetch('/graph', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ baseVersion: graph.version, graph: next }),
  });
  if (res.status === 422) {
    const { violations } = await res.json();
    showViolations(violations);
    return false;
  }
  if (res.status === 409) {
    const { currentVersion } = await res.json();
    showViolations([
      `This graph changed underneath you (you edited v${graph.version}, current is v${currentVersion}).`,
      'Your edit was NOT saved. Reload to get the current graph, then re-apply it.',
    ]);
    return false;
  }
  if (res.status === 413) {
    showViolations(['Graph too large to save (over 4 MB).']);
    return false;
  }
  const body = await res.json();
  showViolations([]);
  graph = next;
  graph.version = body.version;
  setStatus(`saved v${body.version}`);
  return true;
}

async function action(kind) {
  const res = await fetch('/action', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: kind, comments }),
  });
  setStatus(res.ok ? `${kind} requested — return to the terminal` : `${kind} failed`);
}

// ---- live mode ----------------------------------------------------------

// The run is unattended by design: once it starts the editor is a viewer.
// Comments typed during a run are filed to the whetstone backlog, not applied here.
function startPolling(rerender) {
  setInterval(async () => {
    const st = await (await fetch('/state')).json();
    const running = st.status === 'running';
    // Re-render on the TRANSITION, not only when the graph version moves. `readOnly`
    // gates the Save button at click time, so saves are refused immediately either way —
    // but the per-node draggable/deletable props are computed in toFlow, which only re-runs
    // when `tick` changes. Gating rerender() on a version diff alone meant a run that
    // starts without an immediate graph patch left the canvas looking editable: nodes still
    // dragged and deleted locally while the code's own comment claims "once it starts the
    // editor is a viewer". Nothing persisted, but the UI lied about being locked.
    if (running !== readOnly) { readOnly = running; rerender(); }
    if (running) {
      setStatus(`running — at ${st.cursor} · visits ${JSON.stringify(st.visits || {})}`);
      const live = await (await fetch('/graph')).json();
      if (live.version !== (graph && graph.version)) { graph = live; rerender(); }
    }
  }, 2000);
}

// ---- app ----------------------------------------------------------------

function App() {
  const [flow, setFlow] = useState({ nodes: [], edges: [] });
  const [tick, setTick] = useState(0);

  // DELIBERATE TRADEOFF, not an accident: this refetches and overwrites the canvas
  // whenever `tick` bumps, which includes the read-only transition when a run starts.
  // Any UNSAVED local sketch in this tab is discarded at that moment, without warning.
  //
  // Nothing persisted is ever at risk — only an in-browser draft. In the primary flow it
  // cannot bite, because "Approve & run" saves first and only fires the action if that
  // save succeeded, so the running graph already matches the screen. The exposure is a
  // SECOND tab (or another person — this is loopback with no auth) approving a run while
  // this tab holds an unsaved edit.
  //
  // Accepted because once a run starts the run owns the graph, and showing a stale
  // editable canvas over a live run is worse than dropping a draft. If this ever needs
  // softening, the fix is to prompt before discarding — not to skip the refetch, which
  // would leave the canvas lying about a graph the run is actively patching.
  useEffect(() => { loadGraph().then((g) => setFlow(toFlow(g))); }, [tick]);
  useEffect(() => { startPolling(() => setTick((t) => t + 1)); }, []);

  const onSelect = useCallback((_, node) => {
    selected = graph.nodes.find((n) => n.id === node.id);
    renderPanel();
  }, []);

  useEffect(() => {
    // REFRESH THE CANVAS after every successful save, from the graph the SERVER accepted
    // (`graph`, updated by save() itself), not by re-deriving from the pre-save `flow`.
    // fromFlow matches a flow edge back to its graph edge by the index toFlow embedded in
    // its id (e${i}:...). save() re-indexes graph.edges server-side (a deleted mid-array
    // edge shifts every index after it), but nothing was re-running toFlow to hand out flow
    // ids for the NEW indices — so a second save (Save-then-Approve, or two Saves) matched
    // every edge against a stale index, missed, and fell through to 'always'. Measured: a
    // valid graph, delete one edge, Save, Approve -> the second call 422s with locked-gate
    // violations and 5 of 11 predicates silently collapsed to 'always'. Fails closed
    // (dominance catches it before anything corrupt reaches disk) but wedges the editor —
    // only a reload recovers. This is C1's symptom again through a different door: the fix
    // for the first bug assumed the canvas and the server never disagree about indices,
    // which a successful save was exactly the moment that stopped being true.
    $('save').onclick = async () => {
      if (readOnly) return setStatus('run in progress — editor is read-only');
      if (await save(fromFlow(flow.nodes, flow.edges))) setFlow(toFlow(graph));
    };
    $('replan').onclick = () => action('replan');
    $('approve').onclick = async () => {
      if (await save(fromFlow(flow.nodes, flow.edges))) { setFlow(toFlow(graph)); action('approve'); }
    };
  }, [flow]);

  return h(RF.ReactFlow, {
    nodes: flow.nodes, edges: flow.edges,
    onNodesChange: (c) => setFlow((f) => ({ ...f, nodes: RF.applyNodeChanges(c, f.nodes) })),
    onEdgesChange: (c) => setFlow((f) => ({ ...f, edges: RF.applyEdgeChanges(c, f.edges) })),
    onConnect: (p) => setFlow((f) => ({ ...f, edges: RF.addEdge(p, f.edges) })),
    onNodeClick: onSelect,
    fitView: true,
  }, h(RF.Background, null), h(RF.Controls, null));
}

// Escape EVERY dynamic value before it reaches innerHTML.
//
// Node ids and kinds are not trusted input. They arrive from a planner worker's
// graphPatch — LLM-generated text — so an id like
//   <img src=x onerror="fetch('/action',{method:'POST',body:'{\"action\":\"approve\"}'})">
// would execute inside the page that IS the human approval gate, with access to the
// loopback server. That converts a weird or prompt-injected planner output into
// "approve the graph without a human", defeating the control point the whole design
// rests on. Escaping only `prompt` (as an earlier revision did) is not enough.
const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function renderPanel() {
  if (!selected) return;
  const n = selected;
  const cap = capFor(graph, n.id);
  const locked = !!n.locked;
  $('detail').innerHTML = `
    <h3>${esc(n.id)} <small>${esc(n.kind || 'work')}${locked ? ' 🔒 locked' : ''}</small></h3>
    <label>Visit cap<br><input id="cap" type="number" min="0" value="${esc(cap)}"
      ${locked ? 'disabled' : ''}></label>
    <label>Prompt<br><textarea id="prompt" ${locked ? 'disabled' : ''}>${
      esc(n.prompt)}</textarea></label>
    <label>Comment for the replanner<br><textarea id="comment"
      placeholder="e.g. this needs a schema migration before it runs"></textarea></label>
    <button id="addComment">Add comment</button>
    ${locked ? '<p><em>Locked at approval — gates cannot be edited or removed.</em></p>' : ''}`;

  if (!locked) {
    $('cap').onchange = (e) => {
      // Visit caps have exactly ONE home so the validator has a single source.
      graph.invariants = graph.invariants || {};
      graph.invariants.visitCaps = graph.invariants.visitCaps || {};
      graph.invariants.visitCaps[n.id] = Number(e.target.value);
    };
    $('prompt').onchange = (e) => { n.prompt = e.target.value; };
  }
  $('addComment').onclick = () => {
    const text = $('comment').value.trim();
    if (!text) return;
    comments.push({ node: n.id, text });
    $('comment').value = '';
    setStatus(`${comments.length} comment(s) queued — press Replan`);
  };
}

// Exported for the regression net, so the round-trip through graph <-> React Flow can be
// tested by CALLING these functions with real data, not by regexing the source text for
// what they're supposed to do. `loadGraph` is exported alongside them because `fromFlow`
// reads the module-scoped `graph` it sets, rather than taking a graph parameter. An unused
// named export changes nothing for the browser.
// `graph` is exported as a live binding (ESM re-reads it on every access, it cannot be
// reassigned from outside) so a test can read the exact post-save state save() sets, rather
// than re-deriving it a different way than the app does.
export { toFlow, fromFlow, loadGraph, save, graph };

ReactDOM.createRoot($('canvas')).render(h(App));
