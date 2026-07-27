#!/usr/bin/env node
/**
 * harbor-build.mjs — build Harbor tasks for ANY lirbox skill.
 *
 * The convention, which is the whole point: a skill declares its own Harbor tasks under
 *
 *     plugins/lirbox/skills/<skill>/harbor/
 *       harness.md                    the directive prepended to every instruction (optional)
 *       tasks/<id>/
 *         instruction.md              REQUIRED — what the agent is asked to do
 *         verify.sh                   REQUIRED — grades the result, writes /logs/verifier/reward.json
 *         files/                      optional — copied into /app before the agent runs
 *         task.toml                   optional — hand-tuned resources/network/artifacts; merged
 *
 * A new skill drops a directory in and is covered. Nothing here knows about conductor, or
 * flowchart, or any specific skill — discovery walks every skill dir for a harbor/tasks child.
 *
 *   node scripts/harbor-build.mjs                    # every skill that declares tasks
 *   node scripts/harbor-build.mjs --skill flowchart  # one skill
 *
 * Output: .harbor/tasks/<skill>__<id>/ (Harbor format) and .harbor/skills/ (pruned catalog).
 *
 * WHY THE PRUNE EXISTS. Harbor's --skill copies the tree into the container's
 * $CLAUDE_CONFIG_DIR/skills/, which Claude Code enumerates at startup. Any skill that keeps
 * eval material inside its own directory would hand the agent the answer key. Excludes are
 * therefore generic — every skill's evals/ and harbor/ — not a hardcoded list.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, rmSync, copyFileSync, statSync, chmodSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const SKILLS = join(REPO, 'plugins', 'lirbox', 'skills');

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const OUT = resolve(REPO, arg('out', '.harbor'));
const ONLY = arg('skill', null);

// --- pruned skill catalog ---------------------------------------------------
// Generic: no skill's eval or harbor material may reach the agent's discovery path.
const EXCLUDE_DIRS = new Set(['evals', 'harbor', 'arena']);
function excluded(rel) {
  const p = rel.split('/');
  // p[0] is the skill name; a top-level skill literally named "arena" must survive, so only
  // exclude these names when they appear BENEATH a skill, never as the skill itself.
  if (p.length > 1 && EXCLUDE_DIRS.has(p[1])) return true;
  return rel.endsWith('.bundle');
}
function copyTree(src, dst, rel = '') {
  for (const e of readdirSync(src)) {
    const r = rel ? `${rel}/${e}` : e;
    if (excluded(r)) continue;
    const s = join(src, e), d = join(dst, e);
    if (statSync(s).isDirectory()) { mkdirSync(d, { recursive: true }); copyTree(s, d, r); }
    else copyFileSync(s, d);
  }
}
function buildCatalog() {
  const dst = join(OUT, 'skills');
  rmSync(dst, { recursive: true, force: true });
  mkdirSync(dst, { recursive: true });
  copyTree(SKILLS, dst);
  const leaked = [];
  (function scan(dir, rel = '') {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e), r = rel ? `${rel}/${e}` : e;
      if (statSync(p).isDirectory()) scan(p, r);
      else if (/fail_to_pass|\.bundle$|verify\.sh$/.test(r)) leaked.push(r);
    }
  })(dst);
  if (leaked.length) { console.error(`harbor-build: PRUNE FAILED — eval material reachable:\n  ${leaked.join('\n  ')}`); process.exit(1); }
  return readdirSync(dst).filter((d) => existsSync(join(dst, d, 'SKILL.md'))).length;
}

// --- per-task build ---------------------------------------------------------
// Node + git + the skill's own scripts must be runnable; no network at trial time.
const DOCKERFILE = `FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \\
      git ca-certificates curl ripgrep \\
    && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /app
WORKDIR /app
COPY files/ /app/
`;

const DOCKERFILE_NOFILES = DOCKERFILE.replace('COPY files/ /app/\n', '');

function build(skill, id) {
  const src = join(SKILLS, skill, 'harbor', 'tasks', id);
  const instruction = join(src, 'instruction.md');
  const verify = join(src, 'verify.sh');
  if (!existsSync(instruction)) return { skip: 'no instruction.md' };
  if (!existsSync(verify)) return { skip: 'no verify.sh' };

  const name = `${skill}__${id}`;
  const dst = join(OUT, 'tasks', name);
  rmSync(dst, { recursive: true, force: true });
  mkdirSync(join(dst, 'tests'), { recursive: true });
  mkdirSync(join(dst, 'environment'), { recursive: true });

  // Harness directive: per-skill file if present, else a generic one naming the skill.
  // It names the SKILL but never the mode/tier — the skill's own triage stays under test.
  const harnessPath = join(SKILLS, skill, 'harbor', 'harness.md');
  const harness = existsSync(harnessPath)
    ? readFileSync(harnessPath, 'utf8').trim()
    : `Use the lirbox:${skill} skill to complete this task. This session is headless and non-interactive: do not end your turn until the work is finished and written to disk.`;
  writeFileSync(join(dst, 'instruction.md'), `${harness}\n\n---\n\n${readFileSync(instruction, 'utf8')}`);

  // The task owns its grading. We copy verify.sh verbatim — this file is the ONLY grader,
  // so there is no second implementation to drift against.
  copyFileSync(verify, join(dst, 'tests', 'test.sh'));
  chmodSync(join(dst, 'tests', 'test.sh'), 0o755);

  // A skill's own assets/ (validators, templates) are staged into the VERIFIER at
  // /tests/skill-assets. Deliberately a separate copy taken from the host at build time:
  // the agent gets the skill via --skill and could edit its copy, so a verifier that ran the
  // agent-visible validator would be gradeable by tampering. This copy it cannot reach.
  const assets = join(SKILLS, skill, 'assets');
  if (existsSync(assets)) {
    mkdirSync(join(dst, 'tests', 'skill-assets'), { recursive: true });
    copyTree(assets, join(dst, 'tests', 'skill-assets'));
  }

  const filesDir = join(src, 'files');
  const hasFiles = existsSync(filesDir);
  if (hasFiles) { mkdirSync(join(dst, 'environment', 'files'), { recursive: true }); copyTree(filesDir, join(dst, 'environment', 'files')); }
  writeFileSync(join(dst, 'environment', 'Dockerfile'), hasFiles ? DOCKERFILE : DOCKERFILE_NOFILES);

  const custom = join(src, 'task.toml');
  writeFileSync(join(dst, 'task.toml'), existsSync(custom) ? readFileSync(custom, 'utf8') : `[task]
name = "lirbox/${name}"
version = "1.0.0"
description = "${skill} skill task: ${id}"

[metadata]
skill = "${skill}"

[environment]
cpus = 2
memory_mb = 2048
build_timeout_sec = 900

[agent]
timeout_sec = 1800

[verifier]
timeout_sec = 300
`);
  return { name, hasFiles, custom: existsSync(custom) };
}

// --- main -------------------------------------------------------------------
mkdirSync(OUT, { recursive: true });
// A full build is AUTHORITATIVE: wipe tasks/ so a deleted declaration takes its built copy with
// it. Per-task rmSync alone cannot do this — the orphan simply never gets rebuilt and lingers,
// which is invisible to the drift gate (nothing changes on rebuild). A --skill build is scoped,
// so it must not touch other skills' tasks.
if (!ONLY) rmSync(join(OUT, 'tasks'), { recursive: true, force: true });
console.log(`skills catalog: ${buildCatalog()} skill(s) pruned into ${OUT}/skills`);

const skills = (ONLY ? [ONLY] : readdirSync(SKILLS))
  .filter((s) => existsSync(join(SKILLS, s, 'harbor', 'tasks')))
  .sort();

if (!skills.length) {
  console.log(`\nNo skill declares Harbor tasks yet.`);
  console.log(`Add plugins/lirbox/skills/<skill>/harbor/tasks/<id>/{instruction.md,verify.sh} and re-run.`);
  process.exit(0);
}

let total = 0;
for (const skill of skills) {
  const ids = readdirSync(join(SKILLS, skill, 'harbor', 'tasks')).sort();
  console.log(`\n${skill}`);
  for (const id of ids) {
    const r = build(skill, id);
    if (r.skip) { console.log(`  ${id.padEnd(28)} SKIPPED — ${r.skip}`); continue; }
    total++;
    console.log(`  ${r.name.padEnd(28)}${r.hasFiles ? ' +files' : ''}${r.custom ? ' +task.toml' : ''}`);
  }
}
console.log(`\n${total} task(s) -> ${OUT}/tasks`);
console.log(`run: harbor run -p ${OUT}/tasks/<name> -a claude-code -m <model> --skill ${OUT}/skills -e docker -y`);
console.log(`gate (free, no model calls): harbor run -p ${OUT}/tasks/<name> -a nop -e docker -y`);
