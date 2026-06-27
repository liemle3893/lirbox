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
 *   node scaffold-readiness.cjs --name <slug> [--skill-path <dir>] [--force]
 *     --name <slug>        required; kebab slug; the skill name (and feedback/<slug>.jsonl key).
 *     --skill-path <dir>   skill dir (default: plugins/lirbox/skills/<slug>).
 *     --force              overwrite existing scaffold files (default: skip + report).
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

const skillMd = path.join(skillPath, 'SKILL.md');
if (!fs.existsSync(skillMd)) {
  console.error(`ERROR: no SKILL.md at ${skillMd}. Pass --skill-path <dir> to the skill, or create the skill first.`);
  process.exit(1);
}

// Detect frontmatter keys quick_validate would reject → recommend a custom floor (no quick_validate).
const fmBlock = (fs.readFileSync(skillMd, 'utf8').match(/^---\n([\s\S]*?)\n---/) || [, ''])[1];
const REJECTED = ['argument-hint', 'disable-model-invocation'];
const offending = REJECTED.filter((k) => new RegExp('^' + k + ':', 'm').test(fmBlock));
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

const floorCmd = customFloor
  ? `node ${skillPath}/evals/run.mjs`
  : `python3 <skill-creator>/scripts/quick_validate.py ${skillPath} && node ${skillPath}/evals/run.mjs`;

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
  [path.join(skillPath, 'evals', 'run.mjs'), RUN_MJS],
  [path.join(skillPath, 'evals', 'floor', '00-structure.test.mjs'), STRUCTURE_TEST],
  [path.join(skillPath, 'evals', 'checks', '.gitkeep'), '# whetstone drafts acceptance-checks (*.check.mjs) here, one per feedback/' + name + '.jsonl item.\n'],
  [path.join(skillPath, 'evals', 'README.md'), README_MD],
  [path.join('feedback', name + '.jsonl'), ''],
];

let created = 0, skipped = 0;
for (const [file, content] of targets) {
  if (fs.existsSync(file) && !force) { console.log(`skip (exists)  ${file}`); skipped++; continue; }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  console.log(`wrote          ${file}`);
  created++;
}

console.log(`\n${created} written, ${skipped} skipped.${customFloor ? ' (custom floor — quick_validate skipped: ' + offending.join(', ') + ')' : ''}`);
console.log('\nNext:');
console.log(`  1. Add >=1 behavior characterization test under ${skillPath}/evals/floor/ (run the skill's surface, assert output). It MUST pass today.`);
console.log(`  2. Verify the floor is green:  ${floorCmd}`);
console.log(`  3. File concerns in feedback/${name}.jsonl (narrow, decided, each a deterministic check that's broken NOW).`);
console.log(`  4. Run:  /lirbox:whetstone ${name}`);
