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
  const nodes = g.nodes.map((n, i) => ({
    id: n.id,
    position: n.pos || { x: 60, y: 40 + i * 90 },
    data: { label: n.id + (n.locked ? ' 🔒' : '') },
    className: (n.kind === 'gate' ? 'node-gate' : 'node-work') + (n.locked ? ' locked' : ''),
    draggable: !readOnly,
    deletable: !readOnly && !n.locked,
  }));
  const edges = g.edges.map((e, i) => ({
    id: `e${i}:${e.from}->${e.to}`,
    source: e.from, target: e.to,
    label: e.when === 'always' ? '' : `${e.when.field}=${JSON.stringify(e.when.eq ?? e.when.neq)}`,
    animated: !!e.carry,
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
      const prior = graph.edges.find((e) => e.from === fe.source && e.to === fe.target);
      return prior || { from: fe.source, to: fe.target, when: 'always' };
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

  useEffect(() => { loadGraph().then((g) => setFlow(toFlow(g))); }, [tick]);
  useEffect(() => { startPolling(() => setTick((t) => t + 1)); }, []);

  const onSelect = useCallback((_, node) => {
    selected = graph.nodes.find((n) => n.id === node.id);
    renderPanel();
  }, []);

  useEffect(() => {
    $('save').onclick = async () => {
      if (readOnly) return setStatus('run in progress — editor is read-only');
      await save(fromFlow(flow.nodes, flow.edges));
    };
    $('replan').onclick = () => action('replan');
    $('approve').onclick = async () => {
      if (await save(fromFlow(flow.nodes, flow.edges))) action('approve');
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

ReactDOM.createRoot($('canvas')).render(h(App));
