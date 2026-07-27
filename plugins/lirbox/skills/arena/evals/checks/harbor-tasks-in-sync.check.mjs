#!/usr/bin/env node
/**
 * harbor-tasks-in-sync — the drift gate for tracked Harbor tasks.
 *
 * .harbor/tasks/ is TRACKED, first-class content: hand-tunable (resource caps, network
 * policy, artifacts, multi-step) and reviewed in PRs. scripts/harbor-port.mjs is a
 * MIGRATION tool that seeds it, not a build step that owns it.
 *
 * That creates the obvious hazard: an arena task changes and the Harbor task silently
 * goes stale, so a Harbor run scores against a fixture or a grader that no longer
 * matches the suite. Nothing else in the repo would notice.
 *
 * So this asserts SEMANTIC agreement only — the payload that must be identical for a
 * Harbor score to mean the same thing as an arena score:
 *
 *   - every graded arena task has a Harbor task
 *   - the fixture bundle is byte-identical
 *   - every hidden grader is byte-identical
 *   - instruction.md contains the arena task.md verbatim
 *   - instruction.md carries the harness directive (naming the skill, withholding the tier)
 *
 * It deliberately does NOT diff task.toml or the Dockerfile: those are exactly where
 * hand-tuning belongs, and a byte-diff there would make the tracked copy unmaintainable.
 *
 * exit 0 = in sync · exit 1 = drift
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
// checks -> evals -> arena -> skills -> lirbox -> plugins -> repo
const REPO = resolve(HERE, '..', '..', '..', '..', '..', '..');
const ARENA_TASKS = join(REPO, 'plugins/lirbox/skills/conductor/arena/tasks');
const HARBOR_TASKS = join(REPO, '.harbor/tasks');

const fails = [];
const fail = (m) => fails.push(m);
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 16);

if (!existsSync(HARBOR_TASKS)) {
  console.log('SKIP: .harbor/tasks not present — run `node scripts/harbor-port.mjs` to seed it');
  process.exit(0);
}

const arenaIds = readdirSync(ARENA_TASKS)
  .filter((d) => statSync(join(ARENA_TASKS, d)).isDirectory())
  .filter((d) => existsSync(join(ARENA_TASKS, d, 'grader', 'fail_to_pass')))
  .sort();

for (const id of arenaIds) {
  const a = join(ARENA_TASKS, id);
  const h = join(HARBOR_TASKS, id);

  if (!existsSync(h)) {
    fail(`arena task "${id}" has no Harbor task — .harbor/tasks is stale, re-run scripts/harbor-port.mjs`);
    continue;
  }

  // --- fixture bundle must be identical, else the two harnesses grade different code
  const aBundle = join(a, 'repo.bundle');
  const hBundle = join(h, 'environment', 'data', 'repo.bundle');
  if (existsSync(aBundle)) {
    if (!existsSync(hBundle)) fail(`${id}: Harbor task has no fixture bundle`);
    else if (sha(aBundle) !== sha(hBundle)) fail(`${id}: fixture bundle DRIFTED — arena ${sha(aBundle)} vs harbor ${sha(hBundle)}`);
  }

  // --- hidden graders must be identical, else the scores are not comparable
  const aF2p = join(a, 'grader', 'fail_to_pass');
  const hF2p = join(h, 'tests', 'fail_to_pass');
  const aFiles = readdirSync(aF2p).filter((f) => f.endsWith('.test.cjs')).sort();
  const hFiles = existsSync(hF2p) ? readdirSync(hF2p).filter((f) => f.endsWith('.test.cjs')).sort() : [];
  if (aFiles.join(',') !== hFiles.join(',')) {
    fail(`${id}: grader set DRIFTED — arena [${aFiles}] vs harbor [${hFiles}]`);
  } else {
    for (const f of aFiles) {
      if (sha(join(aF2p, f)) !== sha(join(hF2p, f))) fail(`${id}: grader "${f}" DRIFTED — content differs from the arena source`);
    }
  }

  // --- instruction must contain the arena task text verbatim, plus the harness directive
  const hInstr = join(h, 'instruction.md');
  if (!existsSync(hInstr)) { fail(`${id}: Harbor task has no instruction.md`); continue; }
  const instr = readFileSync(hInstr, 'utf8');
  const taskMd = readFileSync(join(a, 'task.md'), 'utf8');
  if (!instr.includes(taskMd.trim())) {
    fail(`${id}: instruction.md no longer contains task.md verbatim — the two harnesses are asking for different work`);
  }
  // The directive is harness parity with swe-run.mjs. Without it a run may never invoke the
  // skill at all, background its workflow and report false success — measured, not theoretical.
  if (!/Use the lirbox:\S+ skill/.test(instr)) fail(`${id}: instruction.md is missing the harness directive naming the skill`);
  if (!/run_in_background: false/.test(instr)) fail(`${id}: instruction.md is missing the foreground directive`);
  // It must NOT name the tier — conductor's own triage stays under test.
  if (/\b(bare|lite|delivery)\s+tier\b/i.test(instr)) fail(`${id}: instruction.md names a conductor TIER — triage must stay under test`);
}

// --- no orphans: a Harbor task with no arena source is unowned
for (const id of readdirSync(HARBOR_TASKS).filter((d) => statSync(join(HARBOR_TASKS, d)).isDirectory())) {
  if (!arenaIds.includes(id)) fail(`Harbor task "${id}" has no arena source — orphaned, nothing keeps it honest`);
}

if (fails.length) {
  for (const f of fails) console.log(`FAIL: ${f}`);
  process.exit(1);
}
console.log(`PASS: ${arenaIds.length} Harbor task(s) in sync with the arena suite (bundles, graders and instructions byte-identical)`);
process.exit(0);
