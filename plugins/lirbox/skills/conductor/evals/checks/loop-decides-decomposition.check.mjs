// ACCEPTANCE CHECK (RED on baseline) — the LOOP decides how to split the work, not the caller.
//
// Concern (feedback/conductor.jsonl → loop-decides-decomposition): conductor currently asks the
// caller to author the decomposition BEFORE anything has read the code — step 1d makes the advisor
// fill in a `depends on` table, and the `--independent` flag turns that guess into structure. Both
// are the wrong layer. The runtime planner (added by dynamic-fanout-within-phase) already derives
// items and their edges from a worker that has actually read the repo, and dispatches them by
// dependency level with each item's dependencies merged into its branch point.
//
// The principle: the human declares the GOAL and the DEFINITION OF DONE; the loop decides the
// DECOMPOSITION. `--independent` also has no surviving niche — a caller who wants a specific item
// list states it in the prompt and the planner returns those items; the flag only adds a way to be
// wrong, and mis-declaring one edge silently yields a clean git merge over semantically broken code
// (all `--independent` items branch off the same base and never see each other's output).
//
// Fix contract:
//   1. `--independent` is REJECTED (non-zero exit) with stderr pointing at the default planner path.
//   2. SKILL.md has NO caller-facing decomposition step — no step-1 heading about decomposition or
//      dependencies, and no `depends on` table.
//   3. SKILL.md states that decomposition happens at runtime, by the planner.
//   4. The default (no flags) still emits the planner fan-out — the surviving mechanism is pinned.
//   5. `--no-plan-fanout` still works: the single escape hatch for forcing one serial worker.
//   6. references/generator-flags.md no longer offers `--independent` as a flag to pass.
//
// REQUIRES HUMAN PREP (evals/** is locked to the fixer): retire `independent-fanout-never-chosen`
// (it asserts the 1d MUST rule this item deletes) and `independent-work-needs-per-worker-worktrees`
// (it asserts a flag this item removes). Without that the floor goes RED and the loop reverts the
// fix. Per-worker worktree isolation stays covered by dynamic-fanout-within-phase assertion 6.
//
// Deterministic only — no network, no LLM. Generation surprises exit 2 (harness error), never 1.
//
// Locked (evals/**): the whetstone fixer may NEVER edit this file.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(HERE, '..', '..');
const REPO = resolve(SKILL_DIR, '..', '..', '..', '..');
const GEN = join(SKILL_DIR, 'scripts', 'scaffold-workflow.cjs');
const SKILL = join(SKILL_DIR, 'SKILL.md');
const FLAGS_DOC = join(SKILL_DIR, 'references', 'generator-flags.md');
const TMP = mkdtempSync(join(tmpdir(), 'loop-decides-'));

const results = [];
const ok = (pass, label) => { results.push({ pass, label }); console.log(`${pass ? 'PASS' : 'FAIL'}: ${label}`); };
const bail = (code, msg) => { console.error(msg); process.exit(code); };

function gen(tag, extra) {
  const out = join(TMP, tag + '.js');
  try {
    execFileSync('node', [GEN, '--name', 'g', '--out', out, '--force', '--phases', 'Implement', ...extra],
      { cwd: REPO, stdio: 'pipe' });
    return { code: 0, stderr: '', src: readFileSync(out, 'utf8') };
  } catch (e) {
    return { code: typeof e.status === 'number' ? e.status : 1, stderr: String(e.stderr || ''), src: '' };
  }
}

// ---------- 1. --independent is rejected ----------
const indep = gen('indep', ['--independent']);
ok(indep.code !== 0 && /planner|decompos|runtime/i.test(indep.stderr),
  `1. \`--independent\` is rejected and points at the planner default `
  + `[exit ${indep.code}; stderr: ${(indep.stderr.trim().split('\n')[0] || '(none)').slice(0, 90)}]`);

// ---------- 4/5. the surviving mechanisms still work (measured, not assumed) ----------
const dflt = gen('default', []);
if (dflt.code !== 0) bail(2, `PRECONDITION FAILED: default generation exited ${dflt.code}\n${dflt.stderr}`);
ok(/label: 'plan:/.test(dflt.src) && /await parallel/.test(dflt.src),
  '4. the default still emits the runtime planner + fan-out');

const noplan = gen('noplan', ['--no-plan-fanout']);
ok(noplan.code === 0 && !/label: 'plan:/.test(noplan.src),
  `5. \`--no-plan-fanout\` still forces a single serial worker [exit ${noplan.code}]`);

// ---------- 2/3. SKILL.md no longer asks the caller to decompose ----------
const md = readFileSync(SKILL, 'utf8');

const decomposeHeadings = [...md.matchAll(/^###\s*1[a-z]?\..*$/gm)].filter((m) => /decompos|dependenc/i.test(m[0]));
const hasDependsTable = /\|\s*depends on\s*\|/i.test(md) || /`depends on`/i.test(md);
ok(decomposeHeadings.length === 0 && !hasDependsTable,
  `2. SKILL.md has no caller-facing decomposition step `
  + `[headings: ${decomposeHeadings.map((m) => m[0].trim()).join(' / ') || 'none'}; `
  + `depends-on table: ${hasDependsTable}]`);

ok(/planner/i.test(md) && /(at runtime|runtime)/i.test(md),
  '3. SKILL.md states that decomposition happens at runtime, by the planner');

// ---------- 6. the flag is no longer offered in the flag reference ----------
if (!existsSync(FLAGS_DOC)) {
  bail(2, `PRECONDITION FAILED: ${FLAGS_DOC} is missing — structure changed unexpectedly.`);
}
const flagsDoc = readFileSync(FLAGS_DOC, 'utf8');
// A removal note that names the flag is fine; a bullet OFFERING it is not.
const offersFlag = /^\s*[-*]\s*`--independent`/m.test(flagsDoc);
ok(!offersFlag, `6. references/generator-flags.md no longer offers \`--independent\` as a flag to pass`);

const failed = results.filter((r) => !r.pass);
if (failed.length) {
  console.error(`\nRED: ${failed.length}/${results.length} assertion(s) failed — the caller is still asked to decide the decomposition.`);
  process.exit(1);
}
console.log(`\nGREEN: all ${results.length} assertions hold — the loop decides the decomposition; the caller declares only the goal.`);
