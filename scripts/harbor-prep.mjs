#!/usr/bin/env node
/**
 * harbor-prep.mjs — materialize a Harbor task's DERIVED build inputs, in place.
 *
 *   node scripts/harbor-prep.mjs <skill>/<task-id>        # one task
 *   node scripts/harbor-prep.mjs --all                    # every task that needs it
 *
 * A task is its declaration: plugins/lirbox/skills/<skill>/harbor/tasks/<id>/. Harbor runs THAT
 * directory — there is no staging copy, because a staging copy means the thing you edit is not the
 * thing that runs, and a stale copy silently scores a paid run against the old grader.
 *
 * Exactly one input cannot be tracked: `environment/skill/`, the copy of the skill under test that
 * the Dockerfile installs for the agent. It must be PRUNED — `evals/`, `harbor/`, `arena/` and any
 * `*.bundle` stripped — because those hold the graders the run is scored against, and an agent that
 * can read its answer key is measuring nothing. It is derived from tracked files, so it is
 * gitignored and rebuilt by this script rather than committed (committing it duplicates every
 * grading file with nothing keeping the copies in sync).
 *
 * Re-run after touching the skill. Cheap and idempotent: it wipes and re-copies.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS = join(REPO, 'plugins/lirbox/skills');

// Never ship these into a task image: they ARE the grading material.
const PRUNE = new Set(['evals', 'harbor', 'arena']);
const isBundle = (n) => n.endsWith('.bundle');

function prunedCopy(from, to) {
  rmSync(to, { recursive: true, force: true });
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from)) {
    if (PRUNE.has(entry) || isBundle(entry)) continue;
    cpSync(join(from, entry), join(to, entry), { recursive: true });
  }
  // Belt and braces: a grader smuggled in via a nested path would defeat the point of the prune.
  const leaked = [];
  const walk = (dir, rel = '') => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      const r = rel ? `${rel}/${e}` : e;
      if (statSync(p).isDirectory()) { if (PRUNE.has(e)) leaked.push(r); else walk(p, r); }
      else if (e === 'test.sh' || e === 'checks-manifest.json' || isBundle(e)) leaked.push(r);
    }
  };
  walk(to);
  if (leaked.length) {
    console.error(`REFUSING: grading material survived the prune in ${to}:\n  ${leaked.join('\n  ')}`);
    process.exit(1);
  }
}

function tasksNeedingPrep() {
  const out = [];
  for (const skill of readdirSync(SKILLS)) {
    const tasks = join(SKILLS, skill, 'harbor/tasks');
    if (!existsSync(tasks)) continue;
    for (const id of readdirSync(tasks)) {
      const df = join(tasks, id, 'environment/Dockerfile');
      if (existsSync(df) && /^COPY\s+skill\b/m.test(readFileSync(df, 'utf8'))) {
        out.push({ skill, id, dir: join(tasks, id) });
      }
    }
  }
  return out;
}

const argv = process.argv.slice(2);
if (!argv.length) {
  console.error('usage: harbor-prep.mjs <skill>/<task-id> | --all | --catalog <outdir>');
  process.exit(2);
}

// --catalog: a pruned copy of EVERY skill, for a behavioural run's `--skill` flag. Takes an explicit
// path (use a temp dir) so this never grows a second tree inside the repo.
if (argv[0] === '--catalog') {
  const out = argv[1];
  if (!out) { console.error('usage: harbor-prep.mjs --catalog <outdir>'); process.exit(2); }
  const dest = resolve(out);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  for (const skill of readdirSync(SKILLS)) prunedCopy(join(SKILLS, skill), join(dest, skill));
  console.log(`pruned skill catalog → ${dest}\nPass it as:  --skill ${dest}`);
  process.exit(0);
}

const all = tasksNeedingPrep();
const wanted = argv[0] === '--all' ? all : all.filter((t) => `${t.skill}/${t.id}` === argv[0]);

if (!wanted.length) {
  const known = all.map((t) => `${t.skill}/${t.id}`).join(', ') || '(none)';
  console.error(`no task matched '${argv[0]}'. Tasks needing prep: ${known}`);
  process.exit(2);
}

for (const t of wanted) {
  prunedCopy(join(SKILLS, t.skill), join(t.dir, 'environment/skill'));
  console.log(`prepared ${t.skill}/${t.id} → environment/skill (pruned: evals, harbor, arena, *.bundle)`);
}
console.log(`\nRun it:  harbor run -p plugins/lirbox/skills/<skill>/harbor/tasks/<id> -a nop -y`);
