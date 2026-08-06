// CHECK — a fanning region runs once per item, and REFUSES rather than quietly doing less.
//
// A `fork` may declare `fanOut: { field, max }`. Its region then becomes a TEMPLATE,
// instantiated once per item in the list carried into the fork. This is the one place loom
// lets the running shape differ from the shape a human approved, so the terms have to hold
// exactly or the approval gate stops meaning anything:
//
//   * the human approved a template and a BOUND, not a node count — so a list longer than
//     `max` is refused outright. Truncating would report success for work that never ran,
//     and it would look identical in the report to a run that did everything.
//   * an absent, non-array or empty list is refused for the same reason: a region that ran
//     zero times cannot have produced what the join is about to be told it produced.
//   * each instance carries ITS OWN item. Without that every instance gets an identical
//     prompt and does the same work N times, which is not fan-out, it is waste.
//   * visit caps are per INSTANCE, taken from the authored node. N instances sharing one
//     budget would starve the last of them for no reason a reader could see.
//
// Like its sibling check, this does not grep the generator: it EXECUTES the emitted
// conductor with stub agent/parallel and reads what actually happened.
// Locked (evals/**): improvement loops may NEVER edit this file.
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = resolve(HERE, '..', '..', 'scripts');
const genFile = process.env.LOOM_SCAFFOLD_OVERRIDE || join(SCRIPTS, 'scaffold-loom.cjs');

let bad = 0;
const ok = (c, m) => { if (c) { console.log(`PASS ${m}`); } else { console.error(`FAIL ${m}`); bad++; } };

// Plan reports `targets`; the edge into Fan carries it; Fan fans the template
// (Migrate -> Verify) over it, bounded at 4.
const GRAPH = {
  name: 'fanoutcheck', goal: 'runtime fan-out check',
  start: 'Plan', terminal: 'Done',
  nodes: [
    { id: 'Plan', kind: 'plan',
      schema: { type: 'object', properties: { targets: { type: 'array' } },
        required: ['targets'] } },
    { id: 'Fan', kind: 'fork', join: 'Integrate', fanOut: { field: 'targets', max: 4 } },
    { id: 'Migrate', kind: 'work' }, { id: 'Verify', kind: 'work' },
    { id: 'Integrate', kind: 'work' },
    { id: 'Review', kind: 'gate' },
    { id: 'Done', kind: 'terminal' },
  ],
  edges: [
    { from: 'Plan', to: 'Fan', when: 'always', carry: ['targets'] },
    { from: 'Fan', to: 'Migrate', when: 'always' },
    { from: 'Migrate', to: 'Verify', when: 'always', carry: ['note'] },
    { from: 'Verify', to: 'Integrate', when: 'always', carry: ['note'] },
    { from: 'Integrate', to: 'Review', when: 'always' },
    { from: 'Review', to: 'Done', when: { field: 'passed', eq: true } },
    { from: 'Review', to: 'Integrate', when: { field: 'passed', eq: false } },
  ],
  invariants: { visitCaps: { Migrate: 2, Verify: 2 } },
};

const tmp = mkdtempSync(join(tmpdir(), 'runtime-fanout-'));
let emitted;
try {
  const gf = join(tmp, 'graph.json');
  const of = join(tmp, 'out.js');
  writeFileSync(gf, JSON.stringify(GRAPH));
  execFileSync('node', [genFile, '--name', 'fanoutcheck', '--graph', gf, '--out', of],
    { stdio: 'pipe' });
  emitted = readFileSync(of, 'utf8');
} catch (e) {
  console.error(`FAIL could not generate a fan-out conductor: ${e.message}`);
  rmSync(tmp, { recursive: true, force: true });
  process.exit(1);
}
rmSync(tmp, { recursive: true, force: true });

const cut = emitted.indexOf('\n}\n');
ok(cut > 0, 'emitted conductor has the meta header');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
let run;
try {
  run = new AsyncFunction('agent', 'parallel', 'log', 'phase', 'args', emitted.slice(cut + 3));
} catch (e) {
  console.error(`FAIL emitted conductor body is not executable: ${e.message}`);
  process.exit(1);
}

const parallel = (thunks) => Promise.all(thunks.map((t) => {
  try { return Promise.resolve(t()).catch(() => null); } catch { return Promise.resolve(null); }
}));

async function exercise(targets) {
  let maxLive = 0;
  const live = new Set();
  const ran = [];
  const seenItems = {};
  const agent = async (prompt, opts) => {
    const label = String((opts && opts.label) || '');
    if (label.startsWith('checkpoint:')) return {};
    const id = label.split('#')[0];
    ran.push(id);
    live.add(id);
    if (live.size > maxLive) maxLive = live.size;
    // The worker prompt is where an instance learns which item it owns.
    const m = /"item":\s*("(?:[^"\\]|\\.)*"|\d+)/.exec(prompt);
    if (m) seenItems[id] = m[1].replace(/^"|"$/g, '');
    await new Promise((r) => setTimeout(r, 3));
    live.delete(id);
    if (id === 'Plan') return { targets };
    if (id === 'Review') return { passed: true, note: id };
    return { note: id };
  };
  return { out: await run(agent, parallel, () => {}, () => {}, undefined), maxLive, ran, seenItems };
}

// ---- 1. one instance per item, each with its own item ------------------------------
let r = null;
try { r = await exercise(['users', 'orders', 'invoices']); }
catch (e) { ok(false, `a bounded fan-out must run to completion (threw: ${e.message})`); }

if (r) {
  const inst = r.ran.filter((x) => x.startsWith('Migrate@')).sort();
  ok(inst.join(',') === 'Migrate@0,Migrate@1,Migrate@2',
    `three items produced three template instances (got ${JSON.stringify(inst)})`);
  ok(r.ran.filter((x) => x.startsWith('Verify@')).length === 3,
    'the whole template is instantiated, not only its entry node');
  ok(r.ran.filter((x) => x === 'Integrate').length === 1,
    'the join still runs ONCE for the whole region, not once per instance');

  const items = ['Migrate@0', 'Migrate@1', 'Migrate@2'].map((k) => r.seenItems[k]);
  ok(new Set(items).size === 3 && items.every(Boolean),
    `each instance received its OWN item (got ${JSON.stringify(items)})`);
  ok(items.sort().join(',') === 'invoices,orders,users',
    `the items are the carried list, in full (got ${JSON.stringify(items.sort())})`);

  ok(r.maxLive >= 2, `instances ran concurrently (max concurrent = ${r.maxLive})`);

  // Per-INSTANCE accounting, from the authored node's cap.
  const visits = (r.out && r.out.visits) || {};
  ok(visits['Migrate@0'] === 1 && visits['Migrate@1'] === 1 && visits['Migrate@2'] === 1,
    `each instance is counted separately (got ${JSON.stringify(visits)})`);
  ok(visits.Migrate === undefined,
    'instances do not also accumulate onto the template id — that would be double counting');

  const from = ((r.out && r.out.carry) || {}).Integrate || {};
  ok(from.from && Object.keys(from.from).sort().join(',') === 'Verify@0,Verify@1,Verify@2',
    `the join sees every instance, keyed by instance (got ${JSON.stringify(from.from && Object.keys(from.from))})`);

  const trace = (r.out && r.out.trace) || [];
  ok(trace.some((t) => t.instances === 3),
    'the trace records how many instances ran, so the report can say what the shape became');
}

// ---- 2. over the bound: REFUSE, never truncate --------------------------------------
let refused = null;
try { await exercise(['a', 'b', 'c', 'd', 'e']); }
catch (e) { refused = e.message; }
ok(!!refused, 'a list longer than fanOut.max aborts the run rather than silently truncating');
ok(refused && /approved bound is 4/.test(refused) && /refusing to truncate/i.test(refused),
  `the refusal names the approved bound (got: ${refused})`);

// ---- 3. nothing to fan out over: also REFUSE ----------------------------------------
for (const [label, targets] of [['an empty list', []], ['a missing list', undefined],
  ['a non-array', 'users']]) {
  let threw = false;
  try { await exercise(targets); } catch { threw = true; }
  ok(threw, `${label} aborts rather than crossing the join having done nothing`);
}

if (bad) { console.error(`\nruntime-fanout-honours-its-bound: ${bad} failed`); process.exit(1); }
console.log('runtime-fanout-honours-its-bound: ok');