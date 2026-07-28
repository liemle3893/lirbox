// FLOOR (characterization) — SKILL.md is structurally a valid skill.
// Locked (evals/**): improvement loops may NEVER edit this file.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(HERE, '..', '..');
const dir = basename(SKILL_DIR);
const fm = (readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8').match(/^---\n([\s\S]*?)\n---/) || [, ''])[1];

let bad = 0;
const ok = (c, m) => { if (c) { console.log(`PASS floor: ${m}`); } else { console.error(`FAIL floor: ${m}`); bad++; } };

ok(!!fm, 'SKILL.md opens with a frontmatter block');
ok(/^name:\s*\S/m.test(fm), 'frontmatter declares name');
ok(/^description:\s*\S/m.test(fm), 'frontmatter declares a non-empty description');
const nameMatch = fm.match(/^name:\s*"?([A-Za-z0-9_-]+)"?/m);
ok(!!nameMatch && nameMatch[1] === dir, `name matches the skill directory (${dir})`);

for (const f of ['graph-core.mjs', 'scaffold-loom.cjs', 'graph-server.mjs',
                 'dod-freeze.mjs', 'loom-report.cjs', 'list-runs.cjs', 'test-loom.cjs']) {
  ok(existsSync(join(SKILL_DIR, 'scripts', f)), `scripts/${f} exists`);
}
for (const f of ['graph-spec.md', 'invariants.md']) {
  ok(existsSync(join(SKILL_DIR, 'references', f)), `references/${f} exists`);
}
for (const f of ['lite.json', 'delivery.json']) {
  ok(existsSync(join(SKILL_DIR, 'scripts', 'seeds', f)), `scripts/seeds/${f} exists`);
}

if (bad) { console.error(`\n00-structure: ${bad} assertion(s) failed`); process.exit(1); }
console.log('00-structure: ok');
