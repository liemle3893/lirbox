#!/usr/bin/env node
// The triage PROTOCOL. Not an agent: an agent spawned to decide whether to spend
// agents adds the cost it exists to remove, and the cases that hurt are exactly
// the small ones. Same call conductor's triage.cjs already made, one level up —
// "it decides whether the human is consulted at all, and prose cannot be gated."
//
// "Size the run first" has been in the orchestrator prompt as a ladder for a
// while and gets ignored, because a ladder in a prompt competes with a task that
// looks big and loses. This computes the rung from what is MEASURED, and
// orch-lane.sh refuses anything above it without a written reason.
//
// It defaults DOWN. The failure on record is over-orchestration: a change
// involving almost no code costing N spawns, N installs, N builds and N contexts.
// So the ceiling is what the evidence supports, and escalating past it costs
// `--because`, recorded — never a silent upgrade because the work "looked hard".
//
//   triage.mjs --run <slug> [--lane <name>] [--json]
//
// The one thing it does NOT decide is risk that file counts cannot see: three
// lines of auth is not three lines of README. That is the judgement `--because`
// exists for, and why this refuses rather than forbids.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const die = (m) => { console.error(`triage: ${m}`); process.exit(1); };
const flags = {};
for (let i = 0; i < argv.length; i++) {
  if (!argv[i].startsWith('--')) die(`unexpected argument: ${argv[i]}`);
  const k = argv[i].slice(2);
  if (k === 'json') { flags.json = true; continue; }
  const v = argv[++i];
  if (v === undefined || v.startsWith('--')) die(`--${k} needs a value`);
  flags[k] = v;
}
const run = flags.run || die('--run <slug> is required');

let root;
try {
  const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'],
    { encoding: 'utf8' }).trim();
  root = join(common, '..');
} catch { die('not inside a git checkout'); }
const runDir = join(root, '.orchestration', run);
if (!existsSync(runDir)) die(`no run at ${runDir}`);

// ---- what is measured -------------------------------------------------------
const itemsPath = join(runDir, 'items.md');
const itemLines = existsSync(itemsPath)
  ? readFileSync(itemsPath, 'utf8').split('\n').filter((l) => /^\s*\d+[.)]/.test(l))
  : [];
// `touches: a/b.ts, c/d.ts` — the column the decomposition already carries. Two
// segments, because one is a repo's top directory and says nothing: everything
// in a monorepo touches `plugins/`.
const areas = new Set();
for (const l of itemLines) {
  const m = l.match(/touches:\s*(.+)$/i);
  if (!m) continue;
  for (const p of m[1].split(',')) {
    const seg = p.trim().split('/').filter(Boolean).slice(0, 2).join('/');
    if (seg && !/^—|^-$/.test(seg)) areas.add(seg);
  }
}

// ---- classify a criterion ---------------------------------------------------
// Deterministic means: it names a command AND an expected value, so re-running it
// answers it. The orchestrator prompt already draws this line — "Criteria are
// numbers or exit codes. 'Tests pass' is not one. '736/736, exit 0' is."
//
// Unclassifiable counts as JUDGEMENTAL, deliberately. The consequence of this
// function being wrong is asymmetric: a judgemental criterion mistaken for
// deterministic means nobody ever looks at it, and that is silent. A
// deterministic one mistaken for judgemental costs one spawn, and is visible.
const hasCommand = (l) => /`[^`]+`/.test(l) || /^\s*\$\s+\S/.test(l) || /\b(node|npm|pnpm|yarn|go|cargo|make|pytest|jest|python)\b/.test(l);
const hasExpectation = (l) => /\bexit\s*[:=]?\s*\d+/i.test(l) || /\b\d+\s*\/\s*\d+\b/.test(l) || /\bexits?\s+\d+/i.test(l);
const classify = (text) => {
  const lines = text.split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^#/.test(l) && !/^[-=]{3,}$/.test(l));
  const det = [], jud = [];
  for (const l of lines) {
    // Only a line that states a criterion, not prose around it.
    if (!/^[-*\d]/.test(l) && !hasCommand(l)) continue;
    (hasCommand(l) && hasExpectation(l) ? det : jud).push(l);
  }
  return { deterministic: det, judgemental: jud };
};

// ---- per-lane ---------------------------------------------------------------
const dispatchDir = join(runDir, 'dispatch');
const laneNames = flags.lane ? [flags.lane]
  : existsSync(dispatchDir)
    ? readdirSync(dispatchDir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5))
    : [];
const lanes = {};
for (const name of laneNames) {
  const rec = join(dispatchDir, `${name}.json`);
  let contract = null;
  if (existsSync(rec)) {
    try { contract = JSON.parse(readFileSync(rec, 'utf8')).contract || null; } catch { /* unreadable */ }
  }
  if (!contract) {
    // No criteria on file is not "all deterministic". Nothing is known, so
    // nothing is refused.
    lanes[name] = { contract: null, deterministic: 0, judgemental: 0,
      verifier_pane: 'allowed', why: 'no criteria file on record — nothing measured, nothing refused' };
    continue;
  }
  if (!existsSync(contract)) {
    lanes[name] = { contract, deterministic: 0, judgemental: 0, verifier_pane: 'allowed',
      why: `criteria file named but missing: ${contract}` };
    continue;
  }
  const { deterministic, judgemental } = classify(readFileSync(contract, 'utf8'));
  const allDet = deterministic.length > 0 && judgemental.length === 0;
  lanes[name] = {
    contract, deterministic: deterministic.length, judgemental: judgemental.length,
    verifier_pane: allDet ? 'refused' : 'allowed',
    why: allDet
      ? `all ${deterministic.length} criteria are a command and an expected value — `
        + 'evidence.mjs verify re-runs them here in seconds; a pane would re-derive an '
        + 'environment to reach the same exit codes'
      : judgemental.length
        ? `${judgemental.length} criterion(s) need judging, not re-running`
        : 'no criteria parsed from the contract',
  };
}

// ---- the rung ---------------------------------------------------------------
// Cumulative, and it is a CEILING: what the measurements support, not a target.
const items = itemLines.length, areaCount = areas.size;
let rung, why;
if (items <= 1 && areaCount <= 1) {
  rung = 'one-lane';
  why = `${items} item(s) over ${areaCount || 'no declared'} area(s) — one lane and a diff review `
      + 'beats a run you have to administer';
} else {
  rung = 'store';
  why = `${items} items over ${areaCount} area(s) — concurrent lanes need dispatch records to be `
      + 'findable again';
}
// Escalate only on a COUNTED judgemental criterion. "verifier_pane: allowed"
// also covers "no criteria on record", and letting absence raise the ceiling
// would make an unmeasured run the most expensive kind — the exact inversion
// this is built to stop.
const judged = Object.values(lanes).reduce((n, l) => n + l.judgemental, 0);
if (judged > 0) {
  rung = 'verifier-pane';
  why = `${judged} criterion(s) across ${Object.keys(lanes).length} lane(s) need judging rather `
      + 'than re-running — that is what a pane is for, batched one per wave';
}

const out = {
  run, rung, why, items, areas: [...areas],
  lanes,
  note: 'This is a CEILING, not a plan. Going above it costs --because, recorded as a decision.',
};
if (flags.json) { console.log(JSON.stringify(out, null, 2)); process.exit(0); }

console.log(`run ${run}`);
console.log(`  items: ${items}   areas: ${areaCount ? [...areas].join(', ') : '(none declared)'}`);
console.log(`  ceiling: ${rung}`);
console.log(`    ${why}`);
for (const [name, l] of Object.entries(lanes)) {
  console.log(`  lane ${name}: ${l.deterministic} deterministic, ${l.judgemental} judgemental`);
  console.log(`    verifier pane: ${l.verifier_pane.toUpperCase()} — ${l.why}`);
}
console.log('\n  A ceiling, not a plan. Above it costs --because, recorded.');
