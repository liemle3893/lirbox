#!/usr/bin/env node
/*
 * dod-gate.mjs — a run's definition of done, frozen before the work, and the gate that holds the
 * run to it. Deterministic, no model.
 *
 *   node dod-gate.mjs freeze  --run <slug> --dod <file|-> --by WHO
 *   node dod-gate.mjs verdict --run <slug> --id <criterion> --met yes|no --evidence TEXT --by WHO
 *   node dod-gate.mjs gate    --run <slug> [--in <worktree>]
 *   node dod-gate.mjs status  --run <slug>
 *
 * Store: .orchestration/<slug>/{dod.json, verdicts.json, gate.json}, at the caller's repo root.
 * Docs the gate demands: docs/changes/<slug>/{summary.md, implementation-notes.md}. On a pass it
 * writes docs/changes/<slug>/dod.json — the frozen criteria with each one's verdict and evidence.
 * `--in <worktree>`: a lane's work lives in its own worktree, so checks run there and docs are read
 * and written there — while the store stays here, out of the implementor's checkout.
 *
 * Exit: 0 passed · 1 unmet, rounds left · 3 escalated, the budget is spent · 2 usage or refused.
 *
 * Why a script and not the model: the old conductor's gate lived inside a generated workflow and
 * was strong because nothing in the loop could talk its way past it. Folding the phases into one
 * session moved the WORK into the model; the gate stays out of it. A DoD the loop can amend, a
 * round count it keeps itself, or a verdict it writes about its own diff is a self-report.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Three rounds, then stop and hand it to a human. A fourth round of the same loop against the same
// criteria is the run that burns a day — the old conductor's fix-loop cap, kept.
export const MAX_ROUNDS = 3;
const TIERS = ['checkable', 'judged'];
const ID = /^[A-Za-z0-9._-]+$/;

const die = (msg) => { console.error(`dod-gate: ${msg}`); process.exit(2); };

function parseArgs(argv) {
  const out = { cmd: argv[0] };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) die(`unexpected argument ${a}`);
    const v = argv[++i];
    if (v === undefined || v.startsWith('--')) die(`${a} needs a value`);
    out[a.slice(2)] = v;
  }
  return out;
}

// The repo is the one the CALLER is in, resolved as intake.mjs resolves it, so route.json and
// dod.json for one slug land side by side.
const ROOT = (() => {
  const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  return top.status === 0 && top.stdout.trim() ? top.stdout.trim() : process.cwd();
})();

const runDir = (slug) => join(ROOT, '.orchestration', slug);
const docsDir = (slug, base = ROOT) => join(base, 'docs', 'changes', slug);
const readJson = (f, dflt) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : dflt);
const writeJson = (f, v) => writeFileSync(f, JSON.stringify(v, null, 2) + '\n');
const hash = (criteria) => createHash('sha256').update(JSON.stringify(criteria)).digest('hex');

function runCheck(check, cwd = ROOT) {
  const r = spawnSync('sh', ['-c', check], { cwd, encoding: 'utf8' });
  const out = `${r.stdout || ''}${r.stderr || ''}`.trim().split('\n').slice(-20).join('\n');
  return { met: r.status === 0, evidence: `exit ${r.status ?? 'signal ' + r.signal}${out ? '\n' + out : ''}` };
}

function validate(dod) {
  const list = dod && dod.criteria;
  if (!Array.isArray(list) || list.length === 0) die('dod needs a non-empty "criteria" array');
  const seen = new Set();
  return list.map((c, i) => {
    const where = `criteria[${i}]`;
    if (!c || typeof c.id !== 'string' || !ID.test(c.id)) die(`${where}.id must match ${ID}`);
    if (seen.has(c.id)) die(`duplicate criterion id ${c.id}`);
    seen.add(c.id);
    if (!TIERS.includes(c.tier)) die(`${c.id}: tier must be one of ${TIERS.join(', ')}`);
    if (typeof c.text !== 'string' || !c.text.trim()) die(`${c.id}: needs "text" — the scorecard reads it`);
    if (c.tier === 'checkable') {
      if (typeof c.check !== 'string' || !c.check.trim()) die(`${c.id}: a checkable criterion needs a "check" command`);
      return { id: c.id, tier: c.tier, text: c.text, check: c.check };
    }
    return { id: c.id, tier: c.tier, text: c.text };
  });
}

// Every read of the DoD goes through here. The hash is taken at freeze over the criteria alone, so
// an edit to a criterion — a loosened check, a judged item quietly dropped — is caught, not obeyed.
function loadDod(slug) {
  const f = join(runDir(slug), 'dod.json');
  if (!existsSync(f)) die(`no frozen DoD for ${slug} — run freeze first`);
  const dod = JSON.parse(readFileSync(f, 'utf8'));
  if (hash(dod.criteria) !== dod.sha256) {
    die(`${f} no longer matches the hash it was frozen with — a frozen DoD is never edited; start a new run`);
  }
  return dod;
}

function freeze(slug, args) {
  if (!args.dod) die('freeze needs --dod <file|->');
  if (!args.by) die('freeze needs --by — the implementor, so a verdict from the same name can be refused');
  const f = join(runDir(slug), 'dod.json');
  if (existsSync(f)) die(`${slug} already has a frozen DoD — it is never re-frozen; start a new run`);
  const raw = readFileSync(args.dod === '-' ? 0 : args.dod, 'utf8');
  let parsed;
  try { parsed = JSON.parse(raw); } catch (e) { die(`--dod is not JSON: ${e.message}`); }
  const criteria = validate(parsed);

  // Baseline: a check that already passes before any work proves nothing about the work.
  const baseline = {};
  for (const c of criteria) if (c.tier === 'checkable') baseline[c.id] = runCheck(c.check).met;

  mkdirSync(runDir(slug), { recursive: true });
  writeJson(f, { implementor: args.by, criteria, baseline_met: baseline, sha256: hash(criteria) });
  console.log(`frozen ${criteria.length} criteria for ${slug}`);
  for (const [id, met] of Object.entries(baseline)) {
    if (met) console.log(`WARN ${id}: already met before any work — non-discriminating`);
  }
}

function verdict(slug, args) {
  const dod = loadDod(slug);
  const c = dod.criteria.find((x) => x.id === args.id);
  if (!c) die(`no criterion ${JSON.stringify(args.id)} in ${slug}`);
  if (c.tier !== 'judged') die(`${c.id} is checkable — its command decides it, not a verdict`);
  if (!args.by) die('verdict needs --by');
  if (args.by === dod.implementor) {
    die(`--by "${args.by}" is the run's implementor — a verdict on your own work is a self-report`);
  }
  if (args.met !== 'yes' && args.met !== 'no') die('--met must be yes or no');
  if (!args.evidence || !args.evidence.trim()) die('a verdict needs --evidence: what was run or read');
  const f = join(runDir(slug), 'verdicts.json');
  const v = readJson(f, {});
  v[c.id] = { met: args.met === 'yes', evidence: args.evidence, by: args.by };
  writeJson(f, v);
  console.log(`recorded ${c.id}: ${args.met} (by ${args.by})`);
}

function docsProblems(slug, base) {
  const problems = [];
  const summary = join(docsDir(slug, base), 'summary.md');
  const notes = join(docsDir(slug, base), 'implementation-notes.md');
  if (!existsSync(summary)) problems.push(`missing ${summary}`);
  else {
    const m = readFileSync(summary, 'utf8').match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
    if (!m) problems.push(`${summary} has no frontmatter block`);
    else if (!m[1].trim()) problems.push(`${summary} has frontmatter and no body`);
  }
  if (!existsSync(notes) || !readFileSync(notes, 'utf8').trim()) {
    problems.push(`missing or empty ${notes} — promote implementation-notes/${slug}.md`);
  }
  return problems;
}

function gate(slug, args) {
  const dod = loadDod(slug);
  const work = args.in ? resolve(args.in) : ROOT;
  if (!existsSync(work) || !statSync(work).isDirectory()) die(`--in ${args.in} is not a directory`);
  const gf = join(runDir(slug), 'gate.json');
  const state = readJson(gf, { status: 'open', rounds: [] });
  if (state.status === 'passed') { report(slug, state); process.exit(0); }
  if (state.status === 'escalated') {
    report(slug, state);
    console.log(`\nescalated: ${MAX_ROUNDS} rounds spent — a human decides what happens next`);
    process.exit(3);
  }

  const vf = join(runDir(slug), 'verdicts.json');
  const verdicts = readJson(vf, {});
  const results = dod.criteria.map((c) => {
    if (c.tier === 'checkable') return { id: c.id, tier: c.tier, ...runCheck(c.check, work) };
    const v = verdicts[c.id];
    if (!v) return { id: c.id, tier: c.tier, met: false, evidence: 'no verdict from an independent verifier this round' };
    return { id: c.id, tier: c.tier, met: v.met, evidence: v.evidence, by: v.by };
  });
  // A round consumes its verdicts. After a fix the code is different, and a verdict on the code
  // before the fix is a verdict on something that no longer exists.
  rmSync(vf, { force: true });

  const docs = docsProblems(slug, work);
  const passed = results.every((r) => r.met) && docs.length === 0;
  state.rounds.push({ n: state.rounds.length + 1, passed, results, docs });

  if (passed) {
    state.status = 'passed';
    mkdirSync(docsDir(slug, work), { recursive: true });
    writeJson(join(docsDir(slug, work), 'dod.json'), {
      run: slug,
      rounds: state.rounds.length,
      criteria: dod.criteria.map((c) => {
        const r = results.find((x) => x.id === c.id);
        return { ...c, baseline_met: dod.baseline_met[c.id] ?? null, met: r.met, evidence: r.evidence, by: r.by ?? 'dod-gate' };
      }),
    });
  } else if (state.rounds.length >= MAX_ROUNDS) {
    state.status = 'escalated';
  }
  writeJson(gf, state);
  report(slug, state);

  if (state.status === 'passed') process.exit(0);
  if (state.status === 'escalated') {
    console.log(`\nescalated: ${MAX_ROUNDS} rounds spent — a human decides what happens next`);
    process.exit(3);
  }
  console.log(`\nround ${state.rounds.length} of ${MAX_ROUNDS}: fix the unmet rows, then gate again`);
  process.exit(1);
}

function report(slug, state) {
  const last = state.rounds[state.rounds.length - 1];
  console.log(`run: ${slug}  status: ${state.status}  rounds: ${state.rounds.length}/${MAX_ROUNDS}`);
  if (!last) return;
  for (const r of last.results) {
    console.log(`${r.met ? 'MET  ' : 'UNMET'}  ${r.tier.padEnd(9)}  ${r.id}  — ${String(r.evidence).split('\n')[0]}`);
  }
  for (const p of last.docs) console.log(`DOCS   ${p}`);
}

function status(slug) {
  const dod = loadDod(slug);
  const state = readJson(join(runDir(slug), 'gate.json'), { status: 'open', rounds: [] });
  console.log(`implementor: ${dod.implementor}  criteria: ${dod.criteria.length}`);
  for (const c of dod.criteria) console.log(`  ${c.tier.padEnd(9)}  ${c.id}  ${c.text}`);
  report(slug, state);
}

const args = parseArgs(process.argv.slice(2));
if (!args.run) die('--run <slug> is required');
// The slug is path-joined. Same alphabet as an id, so `--run ../..` cannot walk out of the store.
if (!ID.test(args.run) || /^\.+$/.test(args.run)) die(`--run slug must match ${ID} and not be all dots`);
if (args.cmd === 'freeze') freeze(args.run, args);
else if (args.cmd === 'verdict') verdict(args.run, args);
else if (args.cmd === 'gate') gate(args.run, args);
else if (args.cmd === 'status') status(args.run);
else die('usage: dod-gate.mjs freeze|verdict|gate|status --run <slug> ...');
