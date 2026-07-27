#!/usr/bin/env node
/**
 * harbor-port.mjs — derive Harbor tasks from conductor's frozen arena suite.
 *
 * This is a CONVERTER, not a fork: nothing under plugins/ is modified, and no
 * fixture is duplicated into git. Output lands in .harbor/ (gitignored) and is
 * regenerated from the arena tasks on every run.
 *
 *   node scripts/harbor-port.mjs                 # all tasks on disk
 *   node scripts/harbor-port.mjs --task <id>     # one task
 *   node scripts/harbor-port.mjs --out <dir>     # default .harbor
 *
 * Emits, per task:
 *   .harbor/tasks/<id>/task.toml
 *                     /instruction.md            <- the task's task.md, verbatim
 *                     /environment/Dockerfile     <- clones repo.bundle at the pinned sha
 *                     /environment/data/repo.bundle
 *                     /tests/test.sh              <- P2P (npm test) + hidden F2P -> reward.json
 *                     /tests/fail_to_pass/*.test.cjs
 *
 * And once, the leak fix:
 *   .harbor/skills/                              <- lirbox catalog MINUS eval fixtures
 *
 * WHY THE PRUNE EXISTS. Harbor's `--skill <dir>` copies the tree into the
 * container's $CLAUDE_CONFIG_DIR/skills/, which Claude Code enumerates at
 * startup. conductor ships its arena fixtures INSIDE its own skill directory,
 * so injecting the catalog unpruned puts every task's hidden
 * grader/fail_to_pass/*.test.cjs in the agent's own discovery path — it can
 * read the answer key. Verified empirically, not theorised. Always inject
 * .harbor/skills, never plugins/lirbox/skills.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, rmSync, copyFileSync, statSync, chmodSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const TASKS_DIR = join(REPO, 'plugins/lirbox/skills/conductor/arena/tasks');
const SKILLS_SRC = join(REPO, 'plugins/lirbox/skills');

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
};
const OUT = resolve(REPO, arg('out', '.harbor'));
const ONLY = arg('task', null);

// --- skill catalog prune (the leak fix) -------------------------------------
// Anchored excludes: drop conductor's own arena/ tree and every skill's evals/,
// plus any stray fixture bundle. An UNANCHORED 'arena' exclude would also drop
// the top-level `arena` SKILL, which is a different thing and must survive.
const SKILL_EXCLUDE_DIRS = new Set(['evals']);
function isExcluded(relPath) {
  const parts = relPath.split('/');
  if (parts[0] === 'conductor' && parts[1] === 'arena') return true;   // fixtures + graders
  if (parts.some((p, i) => i > 0 && SKILL_EXCLUDE_DIRS.has(p))) return true; // frozen checks
  if (relPath.endsWith('.bundle')) return true;
  return false;
}

function copyTree(src, dst, rel = '') {
  for (const entry of readdirSync(src)) {
    const childRel = rel ? `${rel}/${entry}` : entry;
    if (isExcluded(childRel)) continue;
    const s = join(src, entry);
    const d = join(dst, entry);
    if (statSync(s).isDirectory()) {
      mkdirSync(d, { recursive: true });
      copyTree(s, d, childRel);
    } else {
      copyFileSync(s, d);
    }
  }
}

function buildSkills() {
  const dst = join(OUT, 'skills');
  rmSync(dst, { recursive: true, force: true });
  mkdirSync(dst, { recursive: true });
  copyTree(SKILLS_SRC, dst);
  const kept = readdirSync(dst).filter((d) => existsSync(join(dst, d, 'SKILL.md')));
  // Fail loudly rather than silently shipping a leaky catalog.
  const leaked = [];
  (function scan(dir, rel = '') {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      const r = rel ? `${rel}/${e}` : e;
      if (statSync(p).isDirectory()) scan(p, r);
      else if (/fail_to_pass|\.bundle$/.test(r)) leaked.push(r);
    }
  })(dst);
  if (leaked.length) {
    console.error(`harbor-port: PRUNE FAILED — eval material still present:\n  ${leaked.join('\n  ')}`);
    process.exit(1);
  }
  return kept;
}

// --- per-task conversion ----------------------------------------------------
function fixtureNeedsInstall(bundlePath) {
  const tmp = mkdtempSync(join(tmpdir(), 'harbor-port-'));
  try {
    execFileSync('git', ['clone', '-q', bundlePath, join(tmp, 'r')], { stdio: 'pipe' });
    const pkgPath = join(tmp, 'r', 'package.json');
    if (!existsSync(pkgPath)) return false;
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    const n = Object.keys(pkg.dependencies || {}).length + Object.keys(pkg.devDependencies || {}).length;
    return n > 0;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// Verbatim parity with the prompt swe-run.mjs builds around each task's text.
// Keep these two sentences in sync with swe-run.mjs if that prompt ever changes,
// or the two harnesses stop measuring the same thing.
const HARNESS_DIRECTIVE = `Use the lirbox:conductor skill to deliver this change end-to-end (durable multi-phase run). IMPORTANT: this session is headless and non-interactive — if you launch the conductor Workflow in the background and end your turn, the process exits and the run is lost. Invoke the Workflow with run_in_background: false and do not end your turn until the workflow has completed and the delivery is finalized on the wf/ branch.`;

const DOCKERFILE = (needsInstall) => `FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \\
      git ca-certificates curl ripgrep \\
    && rm -rf /var/lib/apt/lists/*

# The fixture arrives as a git bundle pinned to a sha, mirroring the arena
# suite. Cloning from a local bundle keeps the commit frozen and fetches
# nothing from the network at build time.
COPY data/repo.bundle /tmp/repo.bundle
RUN git clone /tmp/repo.bundle /app && rm /tmp/repo.bundle
WORKDIR /app
${needsInstall ? `
# This fixture has real dependencies. Install at BUILD time so the trial itself
# needs no network and the agent's clock is not spent on npm.
RUN npm install --no-audit --no-fund
` : ''}`;

// Generic verifier: mirrors swe-grade.mjs semantics exactly.
//   P2P  = the fixture's own \`npm test\` must STAY green
//   F2P  = hidden graders, RED on base, GREEN iff the feature is built
//   resolved = p2p green AND every f2p green
// Emits per-criterion keys for partial credit AND a scalar \`reward\`, because
// Harbor's pass@k silently returns {} for any reward that is not a single 0/1.
const TEST_SH = `#!/bin/bash
set -uo pipefail
OUT=/logs/verifier
mkdir -p "$OUT"
cd /app || exit 1

if npm test >"$OUT/p2p.log" 2>&1; then P2P=1; else P2P=0; fi

PASSED=0
TOTAL=0
CRITERIA=""
for t in /tests/fail_to_pass/*.test.cjs; do
  [ -e "$t" ] || continue
  TOTAL=$((TOTAL + 1))
  key=$(basename "$t" .test.cjs)
  if node "$t" >>"$OUT/f2p.log" 2>&1; then
    PASSED=$((PASSED + 1))
    CRITERIA="$CRITERIA  \\"f2p_\${key}\\": 1,"$'\\n'
  else
    CRITERIA="$CRITERIA  \\"f2p_\${key}\\": 0,"$'\\n'
  fi
done

if [ "$TOTAL" -gt 0 ] && [ "$PASSED" -eq "$TOTAL" ] && [ "$P2P" -eq 1 ]; then
  RESOLVED=1
else
  RESOLVED=0
fi

if [ "$TOTAL" -gt 0 ]; then
  FRACTION=$(awk "BEGIN{printf \\"%.4f\\", $PASSED/$TOTAL}")
else
  FRACTION=0
fi

{
  echo "{"
  printf '%s' "$CRITERIA"
  echo "  \\"p2p\\": $P2P,"
  echo "  \\"f2p_passed\\": $PASSED,"
  echo "  \\"f2p_total\\": $TOTAL,"
  echo "  \\"f2p_fraction\\": $FRACTION,"
  echo "  \\"reward\\": $RESOLVED"
  echo "}"
} >"$OUT/reward.json"

cat "$OUT/reward.json"
exit 0
`;

function portTask(id) {
  const src = join(TASKS_DIR, id);
  const f2pDir = join(src, 'grader', 'fail_to_pass');
  if (!existsSync(f2pDir)) return { id, skipped: 'no grader/fail_to_pass' };
  const graders = readdirSync(f2pDir).filter((f) => f.endsWith('.test.cjs')).sort();
  if (!graders.length) return { id, skipped: 'no *.test.cjs' };

  const ref = JSON.parse(readFileSync(join(src, 'repo.ref'), 'utf8'));
  const bundle = join(src, ref.bundle || 'repo.bundle');
  const needsInstall = fixtureNeedsInstall(bundle);

  const dst = join(OUT, 'tasks', id);
  rmSync(dst, { recursive: true, force: true });
  mkdirSync(join(dst, 'environment', 'data'), { recursive: true });
  mkdirSync(join(dst, 'tests', 'fail_to_pass'), { recursive: true });

  copyFileSync(bundle, join(dst, 'environment', 'data', 'repo.bundle'));
  // instruction.md = HARNESS DIRECTIVE + task.md verbatim. The directive is not
  // task content — it is parity with swe-run.mjs, which wraps the same two lines
  // around taskText for every cell. Dropping it is not a neutral simplification:
  // measured on gemma4:e2b-mlx, an instruction.md carrying only task.md produced
  // a run that never invoked conductor at all (no Skill call in the trajectory),
  // called Workflow, got "launched in background", ended its turn — orphaning the
  // run — and then reported success. Both lines are load-bearing.
  //
  // Note what the directive does NOT say: it names the SKILL but never the TIER
  // (bare/lite/delivery), so conductor's own triage still has to pick. Same
  // contract as swe-run.mjs.
  writeFileSync(join(dst, 'instruction.md'), `${HARNESS_DIRECTIVE}\n\n---\n\n${readFileSync(join(src, 'task.md'), 'utf8')}`);
  for (const g of graders) copyFileSync(join(f2pDir, g), join(dst, 'tests', 'fail_to_pass', g));

  writeFileSync(join(dst, 'environment', 'Dockerfile'), DOCKERFILE(needsInstall));
  writeFileSync(join(dst, 'tests', 'test.sh'), TEST_SH);
  chmodSync(join(dst, 'tests', 'test.sh'), 0o755);

  writeFileSync(join(dst, 'task.toml'), `[task]
name = "lirbox/${id}"
version = "1.0.0"
description = "conductor arena task ${id}, ported to the Harbor task format"

[metadata]
source_suite = "plugins/lirbox/skills/conductor/arena"
source_sha = "${ref.sha}"
f2p_criteria = ${graders.length}

[environment]
cpus = 2
memory_mb = 4096
build_timeout_sec = 1800

[agent]
timeout_sec = 3600

[verifier]
timeout_sec = 600
`);

  return { id, criteria: graders.length, needsInstall, sha: ref.sha };
}

// --- main -------------------------------------------------------------------
mkdirSync(OUT, { recursive: true });
const kept = buildSkills();
console.log(`skills: ${kept.length} pruned into ${OUT}/skills (eval fixtures excluded)`);

const ids = (ONLY ? [ONLY] : readdirSync(TASKS_DIR)).filter((d) => statSync(join(TASKS_DIR, d)).isDirectory()).sort();
let criteria = 0;
for (const id of ids) {
  const r = portTask(id);
  if (r.skipped) { console.log(`  ${id.padEnd(24)} SKIPPED — ${r.skipped}`); continue; }
  criteria += r.criteria;
  console.log(`  ${id.padEnd(24)} ${String(r.criteria).padStart(2)} criteria  sha=${r.sha.slice(0, 8)}${r.needsInstall ? '  (npm install at build)' : ''}`);
}
console.log(`\n${ids.length} task(s), ${criteria} F2P criteria -> ${OUT}/tasks`);
console.log(`run: harbor run -p ${OUT}/tasks/<id> -a claude-code -m <model> --skill ${OUT}/skills`);
