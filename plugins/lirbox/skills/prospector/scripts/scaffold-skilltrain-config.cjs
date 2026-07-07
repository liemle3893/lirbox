#!/usr/bin/env node
/*
 * Generate a prospector "skill-train" (SkillOpt) run config from a skill name — so the human never
 * has to hand-write the goal/surface/metric/gate prose. EVERY field is mechanically derivable from
 * the skill directory once `scaffold-readiness.cjs --scored` has laid down the scored eval set:
 *
 *   surface = SKILL.md + references/** + assets/** + scripts/**   (evals/** locked BY OMISSION)
 *   metric  = node <skillPath>/evals/run-scored.mjs --split val    (the held-out judge)
 *   gate    = node <skillPath>/evals/run.mjs                       (the whetstone floor)
 *   goal    = the fixed skill-train instruction, pointing the worker at --split train, never val
 *
 * This is a BUILD-TIME helper run in the main session (plain Node — fs/Date are fine here; it is NOT
 * the restricted conductor layer). It only WRITES the config; prospector measures the baseline and
 * confirms before launching. Recipe: plugins/lirbox/skills/prospector/references/skill-train.md.
 *
 * Usage:
 *   node scaffold-skilltrain-config.cjs --name <slug> [--skill-path <dir>] [--baseline <ref>]
 *                                       [--ts <YYYYMMDD-HHMMSS>] [--out <file>] [--force]
 *     --name <slug>       required; kebab slug; the skill to improve.
 *     --skill-path <dir>  skill dir (default: plugins/lirbox/skills/<slug>).
 *     --baseline <ref>    baseline branch/ref (default: origin/main).
 *     --ts <stamp>        pin the run timestamp (default: derived UTC now). Lets prospector reuse a name.
 *     --out <file>        write config here (default: .optimize/config/<name>-<ts>.json).
 *     --force             overwrite an existing config file (default: refuse).
 *
 * Prints (machine-readable, last lines):
 *   RUN=<name>-<ts>
 *   CONFIG=<path>
 */
const fs = require('fs');
const path = require('path');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}
function die(msg) { console.error('ERROR: ' + msg); process.exit(1); }

const name = arg('name');
if (!name || name === true) die('--name <slug> is required');
if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) die('--name must be a kebab slug (a-z0-9-)');
const skillPath = arg('skill-path', path.join('plugins', 'lirbox', 'skills', name));
const baseline = arg('baseline', 'origin/main');
const force = arg('force', false) === true;

// --- verify the skill + its scored eval set exist ------------------------------------------------
const skillMd = path.join(skillPath, 'SKILL.md');
if (!fs.existsSync(skillMd)) die(`no SKILL.md at ${skillMd}. Pass --skill-path <dir> or create the skill first.`);

const runScored = path.join(skillPath, 'evals', 'run-scored.mjs');
const floorRun = path.join(skillPath, 'evals', 'run.mjs');
const trainDir = path.join(skillPath, 'evals', 'tasks', 'train');
const valDir = path.join(skillPath, 'evals', 'tasks', 'val');
const READY_HINT = `Scaffold it first:\n  node plugins/lirbox/skills/whetstone/scripts/scaffold-readiness.cjs --name ${name} --scored\nthen author tasks under evals/tasks/{train,val}/ (recipe: prospector/references/skill-train.md).`;

if (!fs.existsSync(runScored) || !fs.existsSync(floorRun)) {
  die(`skill "${name}" is not skill-train-ready — missing evals/run-scored.mjs and/or evals/run.mjs.\n${READY_HINT}`);
}
const countTasks = (d) => {
  try { return fs.readdirSync(d).filter((f) => f.endsWith('.test.mjs')).length; }
  catch { return 0; }
};
const nTrain = countTasks(trainDir);
const nVal = countTasks(valDir);
const nTotal = nTrain + nVal;
// §1/§5 of skill-train.md: val >= 4 (a 1-task val flips 0<->100), total >= 8 (else the score is too
// coarse to hill-climb). Enforced here so a run never launches against an untrustworthy metric.
if (nVal < 4) die(`held-out val split has ${nVal} task(s); skill-train needs >= 4 (a tiny val flips 0<->100 and minDelta can't smooth it).\n${READY_HINT}`);
if (nTotal < 8) die(`only ${nTotal} scored task(s) total (train ${nTrain} + val ${nVal}); skill-train needs >= 8 — below that the score is too coarse to hill-climb. File concerns and use whetstone instead.`);

// --- derive the run name -------------------------------------------------------------------------
let ts = arg('ts', null);
if (!ts || ts === true) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  ts = `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}
if (!/^\d{8}-\d{6}$/.test(ts)) die('--ts must be YYYYMMDD-HHMMSS');
const run = `${name}-${ts}`;

// --- build the config ----------------------------------------------------------------------------
// Surface EXCLUDES evals/** (locked by omission — prospector's surface is include-only). The metric
// runs the VAL split; the goal points the worker at TRAIN. Gate = the whetstone floor (run.mjs; its
// 00-structure.test.mjs is the lenient quick_validate stand-in — always runnable, no placeholder).
const surface = [
  `${skillPath}/SKILL.md`,
  `${skillPath}/references/**`,
  `${skillPath}/assets/**`,
  `${skillPath}/scripts/**`,
].join(', ');

const config = {
  goal: `improve ${name}: raise the held-out task pass rate. To see what is failing, run \`node ${skillPath}/evals/run-scored.mjs --split train\` — NEVER run --split val (it is the held-out judge; using it is gaming the metric).`,
  surface,
  metric: { cmd: `node ${skillPath}/evals/run-scored.mjs --split val`, parse: 'score=([0-9.]+)', direction: 'max' },
  gate: { cmd: `node ${skillPath}/evals/run.mjs` },
  budgets: {
    evalCapSec: null,        // measured at baseline (~3x baseline gate+metric time)
    agentCapSec: 600,
    total: { experiments: 30 },
    plateauStop: 8,
    minDelta: 1,             // >= 1 percentage point (below that a val of n tasks can't distinguish signal)
    maxDiffLines: 120,       // textual "learning rate" — keep each step reviewable
  },
  baseline,
};

const outFile = arg('out', path.join('.optimize', 'config', `${run}.json`));
if (fs.existsSync(outFile) && !force) die(`${outFile} exists — pass --force to overwrite (or a fresh --ts).`);
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(config, null, 2) + '\n');

console.log(`Generated skill-train config for "${name}" (train ${nTrain} + val ${nVal} = ${nTotal} tasks).`);
console.log(`  surface: ${surface}`);
console.log(`  metric : ${config.metric.cmd}  (parse ${config.metric.parse}, ${config.metric.direction})`);
console.log(`  gate   : ${config.gate.cmd}`);
console.log(`  wrote  : ${outFile}`);
console.log(`RUN=${run}`);
console.log(`CONFIG=${outFile}`);
