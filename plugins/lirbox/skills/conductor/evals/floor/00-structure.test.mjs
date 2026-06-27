// FLOOR (characterization) — the conductor SKILL.md is structurally a valid skill.
//
// Lenient stand-in for skill-creator's quick_validate.py, which hard-fails on conductor's
// (valid Claude Code) `argument-hint` frontmatter key. Asserts the load-bearing structure only:
// a parseable frontmatter block with name / description / allowed-tools, and name === dir.
// Tolerates extra keys (argument-hint). PASSES on baseline; a whetstone fix that corrupts the
// frontmatter goes RED here and is reverted.
//
// Locked (evals/**): the whetstone fixer may NEVER edit this file.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(HERE, '..', '..');             // .../skills/conductor
const SKILL = join(SKILL_DIR, 'SKILL.md');
const dir = basename(SKILL_DIR);                          // 'conductor'

const src = readFileSync(SKILL, 'utf8');
let failures = 0;
const ok = (c, m) => { if (c) { console.log(`PASS floor: ${m}`); } else { console.error(`FAIL floor: ${m}`); failures++; } };

const m = src.match(/^---\n([\s\S]*?)\n---/);
ok(!!m, 'SKILL.md opens with a frontmatter block');
const fm = m ? m[1] : '';
ok(/^name:\s*\S/m.test(fm), 'frontmatter declares name');
ok(/^description:\s*\S/m.test(fm), 'frontmatter declares a non-empty description');
ok(/^allowed-tools:/m.test(fm), 'frontmatter declares allowed-tools');
const nameMatch = fm.match(/^name:\s*"?([A-Za-z0-9_-]+)"?/m);
ok(!!nameMatch && nameMatch[1] === dir, `name matches the skill directory (${dir})`);

if (failures) { console.error(`\n00-structure: ${failures} assertion(s) failed`); process.exit(1); }
console.log('00-structure: ok');
