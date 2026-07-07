#!/usr/bin/env node
/*
 * Harvest whetstone backlog items from FAILING skill-train TRAIN tasks — SkillOpt's
 * trajectory-driven reflection, adapted to lirbox's gates: run every
 * <skill>/evals/tasks/train/*.test.mjs; each FAILURE becomes a feedback/<skill>.jsonl item whose
 * acceptanceCheck IS that task. A harvested item is therefore RED-on-baseline BY CONSTRUCTION
 * (it was just observed failing), so it sails through whetstone's discrimination gate, and its
 * check lives under evals/** — already in the locked set the fixer may never edit.
 *
 * TRAIN ONLY: harvesting the val split would leak the held-out judge into the loop (the fixer
 * would optimize directly against the tasks that decide keep) — --split val is refused.
 *
 * Idempotent: an item id already present in feedback/<skill>.jsonl is never re-filed, so re-runs
 * after partial fixes only add NEWLY failing tasks.
 *
 * Main-session tool (plain Node — fs/child_process are fine here; only the loop CONDUCTOR is
 * restricted). Requires the scored scaffold: scaffold-readiness.cjs --name <skill> --scored.
 *
 * Usage:
 *   node harvest-feedback.cjs <skill> [--skill-path <dir>] [--split train] [--dry-run]
 *     <skill>              required; the feedback/<skill>.jsonl key.
 *     --skill-path <dir>   skill dir (default: plugins/lirbox/skills/<skill>).
 *     --split <name>       must be `train` (the default) — anything else is refused.
 *     --dry-run            print what would be filed; write nothing.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

const skill = process.argv[2];
if (!skill || skill.startsWith('--')) { console.error('usage: harvest-feedback.cjs <skill> [--skill-path <dir>] [--split train] [--dry-run]'); process.exit(1); }
const skillPath = arg('skill-path', path.join('plugins', 'lirbox', 'skills', skill));
const split = arg('split', 'train');
const dryRun = arg('dry-run', false) === true;

// The anti-leak fence: only the train split may feed the fixer. val is the held-out judge.
if (split !== 'train') {
  console.error(`ERROR: --split must be train (got "${split}"). The val split is the HELD-OUT judge — harvesting it would let the loop optimize directly against the tasks that decide keep. See prospector/references/skill-train.md.`);
  process.exit(1);
}

const tasksDir = path.join(skillPath, 'evals', 'tasks', split);
let tasks;
try { tasks = fs.readdirSync(tasksDir).filter((f) => f.endsWith('.test.mjs')).sort(); }
catch { console.error(`ERROR: cannot read ${tasksDir} — scaffold the scored task set first: node scaffold-readiness.cjs --name ${skill} --scored`); process.exit(1); }
if (!tasks.length) { console.error(`ERROR: no *.test.mjs under ${tasksDir} — nothing to harvest from. Add train tasks first.`); process.exit(1); }

// One line of failure evidence per task: last non-empty output line, flattened + truncated.
const tail = (buf) => {
  const lines = String(buf || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const last = lines.length ? lines[lines.length - 1] : '(no output)';
  return last.length > 200 ? last.slice(0, 197) + '…' : last;
};

const failures = [];
for (const t of tasks) {
  const file = path.join(tasksDir, t);
  try { execFileSync('node', [file], { stdio: 'pipe' }); console.log(`task PASS  ${t}`); }
  catch (e) { console.log(`task FAIL  ${t}`); failures.push({ t, file, evidence: tail((e.stdout || '') + '\n' + (e.stderr || '')) }); }
}

const feedbackPath = path.join('feedback', skill + '.jsonl');
const existing = new Set();
try {
  for (const line of fs.readFileSync(feedbackPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { const o = JSON.parse(line); if (o && o.id) existing.add(o.id); } catch { /* tolerate a hand-mangled line */ }
  }
} catch { /* no backlog yet — append creates it */ }

let filed = 0, skipped = 0;
const out = [];
for (const f of failures) {
  const id = 'harvest-' + f.t.replace(/\.test\.mjs$/, '');
  if (existing.has(id)) { console.log(`skip (already filed)  ${id}`); skipped++; continue; }
  out.push(JSON.stringify({
    id, type: 'harvested',
    text: `Harvested from the ${split} split: task ${f.t} fails on the current skill — ${f.evidence}`,
    acceptanceCheck: `node "${f.file}"`,
  }));
  filed++;
}

if (dryRun) {
  for (const line of out) console.log(`would file  ${line}`);
} else if (out.length) {
  fs.mkdirSync(path.dirname(feedbackPath), { recursive: true });
  let prefix = '';
  try { const cur = fs.readFileSync(feedbackPath, 'utf8'); prefix = (cur.length && !cur.endsWith('\n')) ? '\n' : ''; } catch { /* new file */ }
  fs.appendFileSync(feedbackPath, prefix + out.join('\n') + '\n');
}

console.log(`\n${tasks.length} task(s): ${failures.length} failing, ${filed} ${dryRun ? 'would be filed' : 'filed'}, ${skipped} already in the backlog.`);
if (filed && !dryRun) console.log(`Next: /lirbox:whetstone ${skill}  (harvested checks are RED-on-baseline by construction and live in the locked evals/** set).`);
