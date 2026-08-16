// Floor: SKILL.md frontmatter is valid and the trigger is specific. Throws on failure.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const skill = readFileSync(join(here, '..', '..', 'SKILL.md'), 'utf8');

const fm = skill.match(/^---\n([\s\S]*?)\n---/);
if (!fm) throw new Error('SKILL.md: no frontmatter block');
const name = fm[1].match(/^name:\s*(.+)$/m);
const desc = fm[1].match(/^description:\s*(.+)$/m);
if (!name || name[1].trim() !== 'lane-config') throw new Error(`SKILL.md: name must be 'lane-config' (got ${name && name[1]})`);
if (!desc || desc[1].trim().length < 40) throw new Error('SKILL.md: description missing/too short — it is the trigger');

// The description decides when Claude invokes this. A trigger with no user
// phrasing in it fires on nothing.
if (!/reconfigure|configure lanes/i.test(desc[1])) {
  throw new Error('SKILL.md: description must name the reconfigure trigger');
}

const machine = skill.match(/\/Users\/[a-z]/i);
if (machine) throw new Error(`SKILL.md: absolute machine path (${machine[0]}…) — use \${CLAUDE_PLUGIN_ROOT}`);

for (const tag of ['purpose', 'hard-rules', 'scripts', 'flow', 'questions', 'reconfigure', 'failure-modes']) {
  const open = (skill.match(new RegExp(`<${tag}>`, 'g')) || []).length;
  const close = (skill.match(new RegExp(`</${tag}>`, 'g')) || []).length;
  if (open !== 1 || close !== 1) throw new Error(`SKILL.md: <${tag}> unbalanced (${open} open, ${close} close)`);
}
