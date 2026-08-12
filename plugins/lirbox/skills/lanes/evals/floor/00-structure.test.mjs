// Floor: SKILL.md frontmatter is valid (name === 'lanes', non-empty description). Throws on failure.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const skill = readFileSync(join(here, '..', '..', 'SKILL.md'), 'utf8');

const fm = skill.match(/^---\n([\s\S]*?)\n---/);
if (!fm) throw new Error('SKILL.md: no frontmatter block');
const name = fm[1].match(/^name:\s*(.+)$/m);
const desc = fm[1].match(/^description:\s*(.+)$/m);
if (!name || name[1].trim() !== 'lanes') throw new Error(`SKILL.md: name must be 'lanes' (got ${name && name[1]})`);
if (!desc || desc[1].trim().replace(/^["']|["']$/g, '').length < 20) throw new Error('SKILL.md: description missing/too short');

// No absolute machine paths. The layout rule forbids them, and the example-run assets carried
// /Users/<someone>/... into a public repo once already.
const machine = skill.match(/\/Users\/[a-z]/i);
if (machine) throw new Error(`SKILL.md: absolute machine path (${machine[0]}…) — use \${CLAUDE_PLUGIN_ROOT}`);
