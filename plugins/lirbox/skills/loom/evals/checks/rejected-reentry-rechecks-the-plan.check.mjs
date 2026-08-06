// CHECK — when an enforced gate rejects the work, the node it routes back to re-verifies the
// PLAN before redoing anything, and a NO-GO stops the run rather than being routed on.
//
// The failure this prevents. loom's whole reason to exist is that a gate failure sends the run
// backwards into real work instead of into a local retry. But the plan the run re-implements
// against is the same plan that just produced rejected work. Without a re-check the loop is:
// implement -> rejected -> implement the same wrong thing -> rejected -> visit cap. The run
// burns its entire budget arriving at the same verdict repeatedly, and every structural check
// stays green while it happens.
//
// Two halves, and the second is the one that is easy to fake:
//
//   1. the re-entered worker is TOLD to run plan-check, with the plan artifact's path and
//      with autofix applied rather than merely offered;
//   2. a NO-GO actually ABORTS. Instructing a worker to stop is not a guarantee that it did,
//      so the conductor enforces it. A check that only asserted the prompt text would pass a
//      build where NO-GO was routed onward like any other result — straight back into the
//      work the check just condemned.
//
// The trigger is keyed on invariants.mustCross, not on kind === 'gate', for the same reason
// the model policy is: `kind` is descriptive, and a node merely labelled "gate" adjudicates
// nothing. Assertion 3 is that distinction — a non-passing verdict from an UNENFORCED node is
// an ordinary branch, and must not bill the run for a plan-check nobody asked for.
// Locked (evals/**): improvement loops may NEVER edit this file.
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
// Mutation hatches for scripts/prove-checks.mjs — both resolve back to the copy's scripts/ dir
// so the generator reads the copy's (possibly mutated) prompt templates.
const genOverride = process.env.LOOM_SCAFFOLD_OVERRIDE;
const promptOverride = process.env.LOOM_PLAN_CHECK_TXT_OVERRIDE;
const SCRIPTS = genOverride ? dirname(genOverride)
  : promptOverride ? resolve(dirname(promptOverride), '..')
    : resolve(HERE, '..', '..', 'scripts');
const genFile = join(SCRIPTS, 'scaffold-loom.cjs');

let bad = 0;
const ok = (c, m) => { if (c) { console.log(`PASS ${m}`); } else { console.error(`FAIL ${m}`); bad++; } };

// Judge is ENFORCED (mustCross) and rejects once, routing back to Build.
// Sift is a decoy: it also has a false-edge routing backwards, but it is NOT enforced.
const GRAPH = {
  name: 'replancheck', goal: 'plan re-check on rejected re-entry',
  start: 'Plan', terminal: 'Done',
  nodes: [
    { id: 'Plan', kind: 'plan' },
    { id: 'Draft', kind: 'work' },
    { id: 'Sift', kind: 'gate' },
    { id: 'Build', kind: 'work' },
    { id: 'Judge', kind: 'work', locked: true },
    { id: 'Done', kind: 'terminal' },
  ],
  edges: [
    { from: 'Plan', to: 'Draft', when: 'always' },
    { from: 'Draft', to: 'Sift', when: 'always' },
    { from: 'Sift', to: 'Build', when: { field: 'passed', eq: true } },
    { from: 'Sift', to: 'Draft', when: { field: 'passed', eq: false }, carry: ['findings'] },
    { from: 'Build', to: 'Judge', when: 'always' },
    { from: 'Judge', to: 'Done', when: { field: 'passed', eq: true }, locked: true },
    { from: 'Judge', to: 'Build', when: { field: 'passed', eq: false }, carry: ['findings'] },
  ],
  invariants: { mustCross: ['Judge'], visitCaps: { Draft: 4, Build: 4, Judge: 4, Sift: 4 } },
};
const core = await import(pathToFileURL(join(SCRIPTS, 'graph-core.mjs')).href);
GRAPH.invariants.lockedHash = core.lockedFingerprint(GRAPH);

function generate(extraArgs) {
  const tmp = mkdtempSync(join(tmpdir(), 'replan-check-'));
  try {
    const gf = join(tmp, 'graph.json');
    const of = join(tmp, 'out.js');
    writeFileSync(gf, JSON.stringify(GRAPH));
    execFileSync('node', [genFile, '--name', 'replancheck', '--graph', gf, '--out', of,
      ...(extraArgs || [])], { stdio: 'pipe' });
    return readFileSync(of, 'utf8');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const parallel = (thunks) => Promise.all(thunks.map((t) => {
  try { return Promise.resolve(t()).catch(() => null); } catch { return Promise.resolve(null); }
}));

// `verdicts` maps a result key to what that worker returns, so a run can be scripted:
// which node fails, on which visit, and what the re-entered node reports back.
async function exercise(emitted, verdicts) {
  const cut = emitted.indexOf('\n}\n');
  const run = new AsyncFunction('agent', 'parallel', 'log', 'phase', 'args', emitted.slice(cut + 3));
  const prompts = {};
  const agent = async (prompt, opts) => {
    const o = opts || {};
    const label = String(o.label || '');
    if (label.startsWith('checkpoint:')) return {};
    prompts[label] = prompt;
    if (Object.prototype.hasOwnProperty.call(verdicts, label)) return verdicts[label];
    return { passed: true, note: label.split('#')[0] };
  };
  let threw = null;
  try { await run(agent, parallel, () => {}, () => {}, undefined); }
  catch (e) { threw = e.message; }
  return { prompts, threw };
}

// ---- 1. an enforced rejection makes the re-entered node re-check the plan -------------
const emitted = generate();
const r1 = await exercise(emitted, { 'Judge#1': { passed: false, findings: ['wrong approach'] } });

ok(!r1.threw, `a rejected-then-passing run completes (threw: ${r1.threw})`);
const reentry = r1.prompts['Build#2'];
ok(!!reentry, 'the run actually re-entered Build after Judge rejected it');
if (reentry) {
  ok(/plan-check/.test(reentry),
    'the re-entered worker is told to run plan-check before doing the work again');
  ok(/results\/Plan#1\.json/.test(reentry),
    'it is given the PLAN NODE\'s recorded result as the artifact to verify');
  ok(/Judge/.test(reentry), 'it is told which enforced gate rejected the previous attempt');
  ok(/autofix/i.test(reentry) && /applied/i.test(reentry),
    'autofix is APPLIED, not merely offered — the ask was for it to be on by default');
  ok(/NO-GO/.test(reentry), 'and it is told what a NO-GO obliges it to do');
}

// ---- 2. a first visit pays for none of this -------------------------------------------
const first = r1.prompts['Build#1'];
ok(!!first && !/plan-check/.test(first),
  'a node reached normally does NOT carry the plan-check block — it is not free');

// ---- 3. the trigger follows ENFORCEMENT, not the "gate" label --------------------------
// Sift is kind:'gate' with a false-edge routing backwards, but is absent from mustCross.
const r3 = await exercise(generate(), { 'Sift#1': { passed: false, findings: ['nit'] } });
const decoy = r3.prompts['Draft#2'];
ok(!!decoy, 'the decoy re-entry happened (otherwise this proves nothing)');
ok(decoy && !/plan-check/.test(decoy),
  'a non-passing verdict from a node merely LABELLED "gate" does not trigger a plan-check');

// ---- 4. NO-GO ABORTS — the half that instructions alone cannot guarantee ---------------
const r4 = await exercise(emitted, {
  'Judge#1': { passed: false, findings: ['wrong approach'] },
  'Build#2': { planCheck: 'NO-GO', report: '/tmp/plan-check.html', findings: ['unsafe'] },
});
ok(!!r4.threw, 'a NO-GO aborts the run instead of being routed onward like any other result');
ok(r4.threw && /NO-GO/.test(r4.threw) && /plan-check\.html/.test(r4.threw),
  `the abort names the verdict and the report path (got: ${r4.threw})`);

// ---- 5. GO proceeds ---------------------------------------------------------------------
const r5 = await exercise(emitted, {
  'Judge#1': { passed: false, findings: ['wrong approach'] },
  'Build#2': { passed: true, planCheck: 'GO', refuted: 0, report: '/tmp/plan-check.html' },
});
ok(!r5.threw, `a GO verdict with no REFUTED rows lets the run continue (threw: ${r5.threw})`);

// ---- 5b. THE LABEL IS NOT THE FACT -------------------------------------------------------
// plan-check says NO-GO means exactly "a REFUTED row is on a critical path", and that autofix
// never touches REFUTED. So autofix cannot legitimately turn NO-GO into GO-WITH-CONDITIONS.
// But plan-check is prose executed by an agent, not a deterministic script: an agent that
// mis-recomputes the verdict after autofix hands back a passing LABEL over a plan that still
// has live REFUTED rows. Abort on the count as well and the two have to agree — disagreement
// fails closed instead of open.
const upgraded = await exercise(emitted, {
  'Judge#1': { passed: false, findings: ['wrong approach'] },
  'Build#2': {
    passed: true, planCheck: 'GO-WITH-CONDITIONS', refuted: 2,
    report: '/tmp/plan-check.html',
  },
});
ok(!!upgraded.threw,
  'a passing verdict that still reports REFUTED rows on a critical path ABORTS — autofix '
  + 'cannot clear a NO-GO, so the label disagreeing with the count fails closed');
ok(upgraded.threw && /2 REFUTED/.test(upgraded.threw),
  `the abort reports the count that contradicted the verdict (got: ${upgraded.threw})`);

// and the honest version of the same verdict is still allowed through
const conditional = await exercise(emitted, {
  'Judge#1': { passed: false, findings: ['wrong approach'] },
  'Build#2': {
    passed: true, planCheck: 'GO-WITH-CONDITIONS', refuted: 0,
    report: '/tmp/plan-check.html',
  },
});
ok(!conditional.threw,
  `GO-WITH-CONDITIONS with zero REFUTED proceeds — conditions are not a refusal `
  + `(threw: ${conditional.threw})`);

// ---- 6. the escape hatch escapes --------------------------------------------------------
const r6 = await exercise(generate(['--plan-check', 'off']),
  { 'Judge#1': { passed: false, findings: ['wrong approach'] } });
ok(r6.prompts['Build#2'] && !/plan-check/.test(r6.prompts['Build#2']),
  '--plan-check off emits no block');

if (bad) { console.error(`\nrejected-reentry-rechecks-the-plan: ${bad} failed`); process.exit(1); }
console.log('rejected-reentry-rechecks-the-plan: ok');
