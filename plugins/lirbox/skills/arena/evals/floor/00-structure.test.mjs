// Floor: SKILL.md frontmatter is valid (name === 'arena', non-empty description). Throws on failure.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const skill = readFileSync(join(here, '..', '..', 'SKILL.md'), 'utf8');

const fm = skill.match(/^---\n([\s\S]*?)\n---/);
if (!fm) throw new Error('SKILL.md: no frontmatter block');
const name = fm[1].match(/^name:\s*(.+)$/m);
const desc = fm[1].match(/^description:\s*(.+)$/m);
if (!name || name[1].trim() !== 'arena') throw new Error(`SKILL.md: name must be 'arena' (got ${name && name[1]})`);
if (!desc || desc[1].trim().replace(/^["']|["']$/g, '').length < 20) throw new Error('SKILL.md: description missing/too short');
