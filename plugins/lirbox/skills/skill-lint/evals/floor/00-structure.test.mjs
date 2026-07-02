// FLOOR (characterization) — the SKILL.md is structurally a valid skill. A real, green-on-baseline
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
const fm = (readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8').match(/^---\n([\s\S]*?)\n---/) || [, ''])[1];

let bad = 0;
const ok = (c, m) => { if (c) { console.log(`PASS floor: ${m}`); } else { console.error(`FAIL floor: ${m}`); bad++; } };
ok(!!fm, 'SKILL.md opens with a frontmatter block');
ok(/^name:\s*\S/m.test(fm), 'frontmatter declares name');
ok(/^description:\s*\S/m.test(fm), 'frontmatter declares a non-empty description');
const nameMatch = fm.match(/^name:\s*"?([A-Za-z0-9_-]+)"?/m);
ok(!!nameMatch && nameMatch[1] === dir, `name matches the skill directory (${dir})`);

if (bad) { console.error(`\n00-structure: ${bad} assertion(s) failed`); process.exit(1); }
console.log('00-structure: ok');
