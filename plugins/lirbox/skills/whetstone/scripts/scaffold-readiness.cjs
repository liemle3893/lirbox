#!/usr/bin/env node
/*
 * Scaffold the eval FLOOR that makes a skill `lirbox:whetstone`-ready.
 *
 * Whetstone can only improve a skill that has a deterministic floor (green on baseline) + a place
 * for per-concern acceptance-checks (red on baseline). This writes that scaffolding for a target
 * skill — idempotently (never clobbers an existing file) — so you only have to add real
 * characterization tests + file concerns. It is a BUILD-TIME helper run in the main session (plain
 * Node — NOT the restricted conductor layer), so fs is fine here.
 *
 * It writes, under <skillPath>/evals/:
 *   run.mjs                  the floor runner (runs floor/*.test.mjs, exit 0 iff all green)
 *   floor/00-structure.test.mjs   a lenient frontmatter check — a REAL, green-on-baseline floor
 *   checks/.gitkeep          where whetstone drafts acceptance-checks
 *   README.md                the floor command + conventions
 * and feedback/<skill>.jsonl (empty backlog) at the repo root.
 *
 * It does NOT invent fake behavior tests. The frontmatter check is a genuine (thin) floor; you MUST
 * add >=1 behavior characterization test under evals/floor/ before relying on whetstone.
 *
 * Usage:
 *   node scaffold-readiness.cjs --name <slug> [--skill-path <dir|agent.md>] [--force] [--scored]
 *     --name <slug>        required; kebab slug; the skill name (and feedback/<slug>.jsonl key).
 *     --skill-path <p>     skill dir (default: plugins/lirbox/skills/<slug>) — OR a single-file
 *                          plugin agent (plugins/<plugin>/agents/<slug>.md). Agent mode: editable
 *                          = that one file; evals seed into the SIBLING dir agents/evals/<slug>/
 *                          (a .md file can't contain a directory); the floor is
 *                          `claude plugin validate .` + the seeded characterization tests.
 *     --force              overwrite existing scaffold files (default: skip + report).
 *     --scored             ALSO scaffold the prospector skill-train metric: evals/run-scored.mjs
 *                          + tasks/{train,val}/ (SkillOpt-style scored task set with a held-out
 *                          val split). Recipe: prospector/references/skill-train.md.
 *                          Skill dirs only — rejected for an agent-file surface.
 */
const fs = require('fs');
const path = require('path');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

const name = arg('name');
if (!name || name === true) { console.error('ERROR: --name <slug> is required'); process.exit(1); }
if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) { console.error('ERROR: --name must be a kebab slug (a-z0-9-)'); process.exit(1); }
const skillPath = arg('skill-path', path.join('plugins', 'lirbox', 'skills', name));
const force = arg('force', false) === true;
const scored = arg('scored', false) === true;

// Agent FILE surface: --skill-path may point at a single-file plugin agent
// (plugins/<plugin>/agents/<name>.md). Editable = that ONE file; the evals layout seeds into a
// SIBLING dir, agents/evals/<name>/ — a .md file cannot contain a directory.
const agentMode = skillPath.endsWith('.md') && fs.existsSync(skillPath) && fs.statSync(skillPath).isFile();
if (agentMode && path.basename(skillPath, '.md') !== name) {
  console.error(`ERROR: --name (${name}) must match the agent file basename (${path.basename(skillPath, '.md')}).`);
  process.exit(1);
}
if (agentMode && scored) {
  console.error('ERROR: --scored (prospector skill-train) applies to skill dirs only, not an agent-file surface.');
  process.exit(1);
}

const skillMd = agentMode ? skillPath : path.join(skillPath, 'SKILL.md');
if (!fs.existsSync(skillMd)) {
  console.error(`ERROR: no SKILL.md at ${skillMd}. Pass --skill-path <dir> to the skill (or <agent>.md for a plugin agent), or create the skill first.`);
  process.exit(1);
}

// Where the evals layout lives: inside the skill dir, or beside the agent file.
const evalsBase = agentMode
  ? path.join(path.dirname(skillPath), 'evals', name)
  : path.join(skillPath, 'evals');

// Detect frontmatter keys quick_validate would reject → recommend a custom floor (no quick_validate).
// (Agent mode never uses quick_validate — its structural floor is `claude plugin validate .`.)
const fmBlock = (fs.readFileSync(skillMd, 'utf8').match(/^---\n([\s\S]*?)\n---/) || [, ''])[1];
const REJECTED = ['argument-hint', 'disable-model-invocation'];
const offending = agentMode ? [] : REJECTED.filter((k) => new RegExp('^' + k + ':', 'm').test(fmBlock));
const customFloor = offending.length > 0;

// ---- file templates -------------------------------------------------------
const RUN_MJS = `#!/usr/bin/env node
// FLOOR RUNNER (scaffolded by scaffold-readiness.cjs). Runs every floor/*.test.mjs and exits 0 iff
// all pass. The floor is whetstone's always-on correctness fence: GREEN on baseline, kept green on
// every kept change. Acceptance-checks live separately under checks/ (RED on baseline) and are run
// one-at-a-time by the loop — they must NOT live in floor/.
//
// Locked (evals/**): the whetstone fixer may NEVER edit this file.
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
let tests;
try { tests = readdirSync(join(HERE, 'floor')).filter((f) => f.endsWith('.test.mjs')).sort(); }
catch (e) { console.error('floor runner: cannot read floor/: ' + e.message); process.exit(1); }
if (!tests.length) { console.error('floor runner: no *.test.mjs under floor/ — a floor with no tests is not a floor'); process.exit(1); }

let failed = 0;
for (const t of tests) {
  try { execFileSync('node', [join(HERE, 'floor', t)], { stdio: 'inherit' }); console.log(\`floor PASS  \${t}\`); }
  catch { console.error(\`floor FAIL  \${t}\`); failed++; }
}
if (failed) { console.error(\`\\nFloor RED: \${failed} test(s) failed.\`); process.exit(1); }
console.log(\`\\nFloor GREEN: all \${tests.length} characterization test(s) passed.\`);
`;

const STRUCTURE_TEST = `// FLOOR (characterization) — the SKILL.md is structurally a valid skill. A real, green-on-baseline
// floor test (lenient stand-in for skill-creator's quick_validate.py, which rejects valid keys like
// argument-hint). It asserts the load-bearing structure only; a fix that corrupts the frontmatter
// goes RED here and is reverted.
//
// NOTE: this is a THIN floor. Add >=1 behavior characterization test alongside it (e.g. run this
// skill's validator/generator/asset and assert its output) before relying on whetstone.
//
// Locked (evals/**): the whetstone fixer may NEVER edit this file.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(HERE, '..', '..');
const dir = basename(SKILL_DIR);
const fm = (readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8').match(/^---\\n([\\s\\S]*?)\\n---/) || [, ''])[1];

let bad = 0;
const ok = (c, m) => { if (c) { console.log(\`PASS floor: \${m}\`); } else { console.error(\`FAIL floor: \${m}\`); bad++; } };
ok(!!fm, 'SKILL.md opens with a frontmatter block');
ok(/^name:\\s*\\S/m.test(fm), 'frontmatter declares name');
ok(/^description:\\s*\\S/m.test(fm), 'frontmatter declares a non-empty description');
const nameMatch = fm.match(/^name:\\s*"?([A-Za-z0-9_-]+)"?/m);
ok(!!nameMatch && nameMatch[1] === dir, \`name matches the skill directory (\${dir})\`);

if (bad) { console.error(\`\\n00-structure: \${bad} assertion(s) failed\`); process.exit(1); }
console.log('00-structure: ok');
`;

// Agent-file variant of the structural floor test: pins the agent's frontmatter (name/description)
// and that the body is non-empty. Resolves the agent .md RELATIVE to the seeded evals dir
// (agents/evals/<name>/floor → ../../../<name>.md) so the layout is relocatable.
const AGENT_STRUCTURE_TEST = `// FLOOR (characterization) — the agent .md is structurally a valid plugin subagent. A real,
// green-on-baseline floor test. It asserts the load-bearing structure only; a fix that corrupts the
// frontmatter goes RED here and is reverted. Pair it with \`claude plugin validate .\` (the full
// agent-mode floor command — see README.md).
//
// NOTE: this is a THIN floor. Agent-prompt behavior is proven with claude -p A/B acceptance-checks,
// not static greps — but add any further deterministic characterization you can alongside this.
//
// Locked (evals/**): the whetstone fixer may NEVER edit this file.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));            // .../agents/evals/${name}/floor
const AGENT_MD = resolve(HERE, '..', '..', '..', '${name}.md');  // .../agents/${name}.md
const src = readFileSync(AGENT_MD, 'utf8');
const fm = (src.match(/^---\\n([\\s\\S]*?)\\n---/) || [, ''])[1];
const body = src.replace(/^---\\n[\\s\\S]*?\\n---/, '').trim();

let bad = 0;
const ok = (c, m) => { if (c) { console.log(\`PASS floor: \${m}\`); } else { console.error(\`FAIL floor: \${m}\`); bad++; } };
ok(!!fm, 'agent .md opens with a frontmatter block');
const nameMatch = fm.match(/^name:\\s*"?([A-Za-z0-9_-]+)"?/m);
ok(!!nameMatch && nameMatch[1] === '${name}', 'frontmatter name matches the agent file (${name})');
ok(/^description:\\s*\\S/m.test(fm), 'frontmatter declares a non-empty description');
ok(body.length > 0, 'agent has a non-empty prompt body');

if (bad) { console.error(\`\\n00-structure: \${bad} assertion(s) failed\`); process.exit(1); }
console.log('00-structure: ok');
`;

// SCORED RUNNER (--scored): the prospector "skill-train" metric — runs every tasks/<split>/*.test.mjs
// and prints one machine-parseable `score=<pct>` line. It exits 0 whenever it RAN (a score below 100
// is a valid measurement, not an error); non-zero only on structural problems (bad split, no tasks).
// The TRAIN/VAL split is the SkillOpt-style overfitting control: the keep decision runs on --split
// val, and only train failures may be shown to the propose/fix worker.
const RUN_SCORED_MJS = `#!/usr/bin/env node
// SCORED RUNNER (scaffolded by scaffold-readiness.cjs --scored) — the prospector skill-train metric.
// Runs every tasks/<split>/*.test.mjs and prints ONE machine-parseable line:
//     score=<pass-percentage> (passed=<k>/<n>, split=<split>)
// prospector metric config (recipe: prospector/references/skill-train.md):
//     { "cmd": "node ${skillPath}/evals/run-scored.mjs --split val", "parse": "score=([0-9.]+)", "direction": "max" }
// TRAIN/VAL SPLIT: the keep decision MUST run on --split val (held out); only --split train results
// may be shown to the propose/fix worker — otherwise the skill overfits the tasks that judge it.
// Exit 0 iff the score was measured (any pass rate); non-zero only for structural errors.
//
// Locked (evals/**): a loop worker may NEVER edit this file or the tasks.
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const i = process.argv.indexOf('--split');
const split = i > -1 ? process.argv[i + 1] : 'val';
if (split !== 'train' && split !== 'val') { console.error('run-scored: --split must be train|val'); process.exit(1); }
let tests;
try { tests = readdirSync(join(HERE, 'tasks', split)).filter((f) => f.endsWith('.test.mjs')).sort(); }
catch (e) { console.error('run-scored: cannot read tasks/' + split + '/: ' + e.message); process.exit(1); }
if (!tests.length) { console.error('run-scored: no *.test.mjs under tasks/' + split + '/ — a score over zero tasks is meaningless'); process.exit(1); }

let passed = 0;
for (const t of tests) {
  try { execFileSync('node', [join(HERE, 'tasks', split, t)], { stdio: 'pipe' }); passed++; console.log(\`task PASS  \${t}\`); }
  catch { console.log(\`task FAIL  \${t}\`); }
}
console.log(\`score=\${(100 * passed / tests.length).toFixed(2)} (passed=\${passed}/\${tests.length}, split=\${split})\`);
`;

const floorCmd = agentMode
  ? `claude plugin validate . && node ${evalsBase}/run.mjs`
  : customFloor
    ? `node ${skillPath}/evals/run.mjs`
    : `python3 <skill-creator>/scripts/quick_validate.py ${skillPath} && node ${skillPath}/evals/run.mjs`;

const AGENT_README_MD = `# ${name} evals — the whetstone floor + acceptance-checks (agent-file surface)

The contract \`lirbox:whetstone\` judges the plugin agent \`${name}\` against. **Committed source,
not runtime state** — it is in whetstone's locked set (the fixer may never edit \`evals/**\` or
\`feedback/${name}.jsonl\`). Do NOT gitignore it.

## Surface

- **Editable:** the ONE agent file, \`${path.join(path.dirname(skillPath), name + '.md')}\`.
- **Locked:** this evals dir (\`${evalsBase}/\`) + \`feedback/${name}.jsonl\`.

(The evals live in this SIBLING dir — \`agents/evals/${name}/\` — because a .md file cannot
contain a directory.)

## Floor (characterization — GREEN on baseline)

\`run.mjs\` runs every \`floor/*.test.mjs\` and exits 0 iff all pass. **The whetstone floor command:**

\`\`\`
${floorCmd}
\`\`\`

Current floor:
- \`floor/00-structure.test.mjs\` — agent .md frontmatter is valid (name/description; name === file).
- \`claude plugin validate .\` — the marketplace/plugin manifest still validates.

## Acceptance-checks (RED on baseline — one per backlog item)

\`checks/*.check.mjs\` are the per-concern checks whetstone drafts during setup, one per
\`feedback/${name}.jsonl\` item. Each MUST fail on the unmodified agent (the discrimination gate)
and pass once the fix lands. Run one-at-a-time by the loop, never by \`run.mjs\`.

> ⚠️ Agent-prompt concerns are BEHAVIORAL: prefer a \`claude -p\` A/B check (run the task with the
> baseline vs fixed agent prompt and assert the observable outcome) over a static grep of the .md —
> greps of prompt text are gameable and prove nothing about behavior.
`;

const README_MD = `# ${name} evals — the whetstone floor + acceptance-checks

The contract \`lirbox:whetstone\` judges \`${name}\` against. **Committed source, not runtime state**
(it survives baseline/worktree operations and is in whetstone's locked set — the fixer may never
edit \`evals/**\`). Do NOT gitignore it.

## Floor (characterization — GREEN on baseline)

\`run.mjs\` runs every \`floor/*.test.mjs\` and exits 0 iff all pass. **The whetstone floor command:**

\`\`\`
${floorCmd}
\`\`\`
${customFloor ? `
> This skill uses a frontmatter key skill-creator's \`quick_validate.py\` rejects (${offending.join(', ')}),
> so the floor SKIPS quick_validate; \`floor/00-structure.test.mjs\` is the lenient structural stand-in.
` : ''}
Current floor:
- \`floor/00-structure.test.mjs\` — SKILL.md frontmatter is valid (name/description; name === dir).

> ⚠️ This is a THIN floor — it only pins frontmatter validity. **Add at least one behavior
> characterization test** under \`floor/\` (run this skill's validator/generator/asset and assert its
> output) before relying on whetstone, or a kept fix could silently break behavior the floor doesn't
> watch.

## Acceptance-checks (RED on baseline — one per backlog item)

\`checks/*.check.mjs\` are the per-concern checks whetstone drafts during setup, one per
\`feedback/${name}.jsonl\` item. Each MUST fail on the unmodified skill (the discrimination gate) and
pass once the fix lands. Run one-at-a-time by the loop, never by \`run.mjs\`. None are committed yet.
`;

// ---- write (idempotent) ---------------------------------------------------
const targets = [
  [path.join(evalsBase, 'run.mjs'), RUN_MJS],
  [path.join(evalsBase, 'floor', '00-structure.test.mjs'), agentMode ? AGENT_STRUCTURE_TEST : STRUCTURE_TEST],
  [path.join(evalsBase, 'checks', '.gitkeep'), '# whetstone drafts acceptance-checks (*.check.mjs) here, one per feedback/' + name + '.jsonl item.\n'],
  [path.join(evalsBase, 'README.md'), agentMode ? AGENT_README_MD : README_MD],
  [path.join('feedback', name + '.jsonl'), ''],
];
if (scored) {
  targets.push(
    [path.join(evalsBase, 'run-scored.mjs'), RUN_SCORED_MJS],
    [path.join(evalsBase, 'tasks', 'train', '.gitkeep'), '# skill-train TRAIN tasks (*.test.mjs) — failures here may be shown to the propose/fix worker.\n'],
    [path.join(evalsBase, 'tasks', 'val', '.gitkeep'), '# skill-train VAL tasks (*.test.mjs) — HELD OUT: the keep decision runs here; never show these to the worker.\n'],
  );
}

let created = 0, skipped = 0;
for (const [file, content] of targets) {
  if (fs.existsSync(file) && !force) { console.log(`skip (exists)  ${file}`); skipped++; continue; }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  console.log(`wrote          ${file}`);
  created++;
}

console.log(`\n${created} written, ${skipped} skipped.${customFloor ? ' (custom floor — quick_validate skipped: ' + offending.join(', ') + ')' : ''}`);
if (agentMode) {
  console.log(`\nAgent-file surface: editable = ${skillPath} (the ONE file); locked = ${evalsBase} + feedback/${name}.jsonl`);
}
console.log('\nNext:');
if (agentMode) {
  console.log(`  1. Add >=1 behavior characterization test under ${path.join(evalsBase, 'floor')}/ (drive the agent, assert output). It MUST pass today.`);
  console.log(`  2. Verify the floor is green:  ${floorCmd}`);
  console.log(`  3. File concerns in feedback/${name}.jsonl. Agent-prompt concerns are BEHAVIORAL — acceptance-checks should be claude -p A/B runs, not static greps of the .md.`);
  console.log(`  4. Run:  /lirbox:whetstone ${name}`);
} else {
  console.log(`  1. Add >=1 behavior characterization test under ${skillPath}/evals/floor/ (run the skill's surface, assert output). It MUST pass today.`);
  console.log(`  2. Verify the floor is green:  ${floorCmd}`);
  console.log(`  3. File concerns in feedback/${name}.jsonl (narrow, decided, each a deterministic check that's broken NOW).`);
  console.log(`  4. Run:  /lirbox:whetstone ${name}`);
}
if (scored) {
  console.log(`\nSkill-train (--scored) extras:`);
  console.log(`  5. Add task checks under ${skillPath}/evals/tasks/train/ and tasks/val/ (*.test.mjs; val is HELD OUT).`);
  console.log(`  6. Verify the metric runs:  node ${skillPath}/evals/run-scored.mjs --split val`);
  console.log(`  7. Hill-climb with prospector — recipe: plugins/lirbox/skills/prospector/references/skill-train.md`);
}
