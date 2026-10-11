// Floor: SKILL.md frontmatter is valid, the trigger is specific, and every command it names points at the bundled CLI.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const skill = readFileSync(join(here, '..', '..', 'SKILL.md'), 'utf8');

const fm = skill.match(/^---\n([\s\S]*?)\n---/);
if (!fm) throw new Error('SKILL.md: no frontmatter block');
const name = fm[1].match(/^name:\s*(.+)$/m);
const desc = fm[1].match(/^description:\s*(.+)$/m);
if (!name || name[1].trim() !== 'prompt-improve') throw new Error(`SKILL.md: name must be 'prompt-improve' (got ${name && name[1]})`);
if (!desc || !/\/prompt-improve|improve this prompt/i.test(desc[1])) throw new Error('SKILL.md: description must name its trigger phrases');

const machine = skill.match(/\/Users\/[a-z]/i);
if (machine) throw new Error(`SKILL.md: absolute machine path (${machine[0]}…) — use \${CLAUDE_PLUGIN_ROOT}`);
if (/brief-api\.mjs|scripts\/brief-api/.test(skill)) throw new Error('SKILL.md: still names the daily-news brief-api.mjs');
if (!skill.includes('${CLAUDE_PLUGIN_ROOT}/skills/prompt-improve/scripts/brief.mjs')) throw new Error('SKILL.md: commands do not point at the bundled brief.mjs');
