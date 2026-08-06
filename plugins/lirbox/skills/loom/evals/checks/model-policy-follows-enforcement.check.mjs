// CHECK — every worker is tagged with a model, and the strong tier follows ENFORCEMENT
// rather than a label anyone can type.
//
// The gap this closes. loom had no model policy at all: `runNode` emitted a `model:` opt only
// when the graph author had hand-written one, which across both shipped seeds is two nodes.
// Everything else — including the gate whose verdict decides whether the run may terminate —
// inherited whatever model the human's session happened to be running. conductor has had a
// think/work policy since it shipped; loom simply never got one.
//
// Why the strong tier is keyed on `invariants.mustCross` and NOT on `kind === 'gate'`.
// references/graph-spec.md is explicit: `kind` is DESCRIPTIVE for every value except 'fork'.
// "Calling something \"gate\" does not make it one." Whether a node is actually enforced comes
// from `invariants.mustCross`, and the two are free to disagree — they coincide in the stock
// seeds by convention, not by any rule. Keying the policy on the label would therefore do the
// exact wrong thing in both directions at once: a decorative node labelled "gate" would draw
// the expensive model, while a genuinely enforced node labelled "work" would adjudicate the
// terminal on the cheap tier. Assertion 2 is that pair, and it is the point of this check.
//
// The policy is also resolved at RUNTIME against the live graph, not frozen into a table when
// the script is generated — because a runtime graphPatch adds nodes that no generation-time
// table could contain (assertion 5).
// Locked (evals/**): improvement loops may NEVER edit this file.
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
// Mutation hatch for scripts/prove-checks.mjs (see checkpoint-cost-is-bounded for the shape).
const genOverride = process.env.LOOM_SCAFFOLD_OVERRIDE;
const SCRIPTS = genOverride ? dirname(genOverride) : resolve(HERE, '..', '..', 'scripts');
const genFile = join(SCRIPTS, 'scaffold-loom.cjs');

let bad = 0;
const ok = (c, m) => { if (c) { console.log(`PASS ${m}`); } else { console.error(`FAIL ${m}`); bad++; } };

// The fixture deliberately DIVORCES the label from the enforcement:
//   Judge  — kind 'work',  but listed in mustCross  → genuinely enforced, must get the strong tier
//   Fake   — kind 'gate',  but NOT in mustCross     → decorative, must NOT get the strong tier
//   Cheap  — an authored model: 'haiku'             → the human's choice, must survive the policy
const GRAPH = {
  name: 'modelpolicy', goal: 'model policy check',
  start: 'Plan', terminal: 'Done',
  nodes: [
    { id: 'Plan', kind: 'plan' },
    { id: 'Cheap', kind: 'work', model: 'haiku' },
    { id: 'Fake', kind: 'gate' },
    { id: 'Build', kind: 'work' },
    { id: 'Judge', kind: 'work', locked: true },
    { id: 'Done', kind: 'terminal' },
  ],
  edges: [
    { from: 'Plan', to: 'Cheap', when: 'always' },
    { from: 'Cheap', to: 'Fake', when: 'always' },
    { from: 'Fake', to: 'Build', when: 'always' },
    { from: 'Build', to: 'Judge', when: 'always' },
    { from: 'Judge', to: 'Done', when: { field: 'passed', eq: true }, locked: true },
    { from: 'Judge', to: 'Build', when: { field: 'passed', eq: false }, carry: ['findings'] },
  ],
  invariants: { mustCross: ['Judge'], visitCaps: { Build: 3, Judge: 3 } },
};

// An enforced gate is only valid once the approval freeze has been stamped, so do here what
// step 3 of the skill does: lock the gate and its passing edge (above) and record the
// fingerprint. Without it the graph is rejected before any model policy is reachable.
const core = await import(pathToFileURL(join(SCRIPTS, 'graph-core.mjs')).href);
GRAPH.invariants.lockedHash = core.lockedFingerprint(GRAPH);

function generate(extraArgs) {
  const tmp = mkdtempSync(join(tmpdir(), 'model-policy-'));
  try {
    const gf = join(tmp, 'graph.json');
    const of = join(tmp, 'out.js');
    writeFileSync(gf, JSON.stringify(GRAPH));
    execFileSync('node', [genFile, '--name', 'modelpolicy', '--graph', gf, '--out', of,
      ...(extraArgs || [])], { stdio: 'pipe' });
    return readFileSync(of, 'utf8');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const parallel = (thunks) => Promise.all(thunks.map((t) => {
  try { return Promise.resolve(t()).catch(() => null); } catch { return Promise.resolve(null); }
}));

// `patchAt` lets one worker reshape the graph mid-run, so a node that did not exist at
// generation time still has to be tagged by the policy.
async function exercise(emitted, patchAt) {
  const cut = emitted.indexOf('\n}\n');
  const run = new AsyncFunction('agent', 'parallel', 'log', 'phase', 'args', emitted.slice(cut + 3));
  const seen = {};
  const agent = async (prompt, opts) => {
    const o = opts || {};
    const label = String(o.label || '');
    if (label.startsWith('checkpoint:')) return {};
    const id = label.split('#')[0];
    seen[id] = o;
    const res = { passed: true, note: id };
    if (patchAt && patchAt.at === id && !seen.__patched) { seen.__patched = true; res.graphPatch = patchAt.patch; }
    return res;
  };
  await run(agent, parallel, () => {}, () => {}, undefined);
  return seen;
}

// ---- auto mode (the default: no flag at all) ---------------------------------------
let auto;
try { auto = await exercise(generate()); }
catch (e) { console.error(`FAIL auto mode must run to completion (threw: ${e.message})`); process.exit(1); }

// 1. every worker is tagged — no node silently inherits the session model
const untagged = Object.keys(auto).filter((k) => k !== '__patched' && !auto[k].model);
ok(untagged.length === 0, `every worker carries a model opt (untagged: ${JSON.stringify(untagged)})`);

// 2. THE POINT: enforcement decides the tier, not the label
// The truthiness guards are not decoration: without them `undefined === undefined` makes
// these pass on a build that tags NOTHING, which is precisely the state this check exists to
// reject.
ok(auto.Judge && !!auto.Judge.model && auto.Judge.model === auto.Plan.model,
  `an ENFORCED node gets the strong tier even though its kind is "work" `
  + `(Judge=${auto.Judge && auto.Judge.model}, Plan=${auto.Plan && auto.Plan.model})`);
ok(auto.Judge && auto.Judge.effort === 'high',
  'the enforced node also gets the stronger reasoning budget');
ok(auto.Fake && auto.Fake.model !== auto.Judge.model,
  `a node merely LABELLED "gate" but absent from mustCross does NOT draw the strong tier `
  + `(Fake=${auto.Fake && auto.Fake.model})`);
ok(auto.Build && !!auto.Build.model && auto.Build.model === auto.Fake.model && !auto.Build.effort,
  'ordinary work nodes share the work tier and carry no effort opt');
ok(auto.Judge.model !== auto.Build.model,
  'the two tiers are actually different — a policy that collapses them is not a policy');

// 3. an authored model is a human decision and outranks the policy
ok(auto.Cheap && auto.Cheap.model === 'haiku',
  `an explicitly authored node.model survives the policy (got ${auto.Cheap && auto.Cheap.model})`);

// ---- inherit mode: the escape hatch has to actually escape ---------------------------
let inherited;
try { inherited = await exercise(generate(['--model-mode', 'inherit'])); }
catch (e) { ok(false, `inherit mode must run (threw: ${e.message})`); }
if (inherited) {
  const policyTagged = Object.keys(inherited)
    .filter((k) => k !== '__patched' && k !== 'Cheap' && inherited[k].model);
  ok(policyTagged.length === 0,
    `--model-mode inherit emits NO policy (still tagged: ${JSON.stringify(policyTagged)})`);
  ok(inherited.Cheap && inherited.Cheap.model === 'haiku',
    'but an authored node.model is graph DATA and is still honoured under inherit');
}

// ---- 5. the policy is resolved at runtime, so patched-in nodes are covered ------------
let patched;
try {
  patched = await exercise(generate(), {
    at: 'Build',
    patch: {
      addNodes: [{ id: 'Extra', kind: 'work' }],
      addEdges: [{ from: 'Build', to: 'Extra', when: 'always' },
        { from: 'Extra', to: 'Judge', when: 'always' }],
      removeEdges: [{ from: 'Build', to: 'Judge' }],
    },
  });
} catch (e) { ok(false, `a run that patches in a node must complete (threw: ${e.message})`); }
if (patched) {
  ok(!!patched.Extra, 'the patched-in node actually ran (otherwise this proves nothing)');
  ok(patched.Extra && !!patched.Extra.model,
    'a node added by a RUNTIME patch is tagged too — the policy reads the live graph, not a '
    + 'table frozen when the script was generated');
}

// ---- 6. a flag that cannot take effect is rejected, not ignored -----------------------
let rejected = false;
try { generate(['--model-mode', 'inherit', '--model-think', 'opus']); }
catch { rejected = true; }
ok(rejected, '--model-think under --model-mode inherit is refused rather than silently ignored');

if (bad) { console.error(`\nmodel-policy-follows-enforcement: ${bad} failed`); process.exit(1); }
console.log('model-policy-follows-enforcement: ok');
