#!/usr/bin/env node
// Frozen check: every brief `assemble` builds ends with the keep-going line ("Don't stop until you're done: …",
// Boris Cherny's close), exactly once, except a plan-only brief, which must not carry it. Without it a long run
// ends turns announcing its next step instead of taking it; on a plan it would push past the plan into building.
//
// PI_CATALOG_OVERRIDE points at the catalog.mjs under test (set by prove-checks for mutation-testing).
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const scripts = join(mkdtempSync(join(tmpdir(), 'pi-keep-')), 'scripts');
cpSync(join(here, '..', '..', 'scripts'), scripts, { recursive: true });
if (process.env.PI_CATALOG_OVERRIDE) cpSync(process.env.PI_CATALOG_OVERRIDE, join(scripts, 'catalog.mjs'));
const { assemble } = await import(pathToFileURL(join(scripts, 'engine.mjs')));
const { TEMPLATE } = await import(pathToFileURL(join(scripts, 'catalog.mjs')));

const KEEP = /don['’]t stop until you['’]re done/i;
const failures = [];
const brief = (name, o) => ({ name, text: assemble({ parts: TEMPLATE[o.tplId].example.parts, ...o }).text });
for (const b of [
  brief('overnight, Opus, unattended', { tplId: 'overnight', model: 'opus', effort: 'high', opts: { unattended: true } }),
  brief('cli, Sonnet max (another report guard)', { tplId: 'cli', model: 'sonnet', effort: 'max' }),
  brief('game with the report part off', { tplId: 'game', on: ['goal', 'verify'], model: 'opus' }),
]) {
  const n = b.text.split(KEEP).length - 1, last = b.text.trim().split(/\n\n+/).pop();
  if (n !== 1) failures.push(`${b.name}: the keep-going line appears ${n} times, not once`);
  else if (!KEEP.test(last)) failures.push(`${b.name}: the keep-going line is not the final line (ends "${last.slice(0, 60)}…")`);
}
const plan = brief('plan, Opus', { tplId: 'plan', model: 'opus' });
if (KEEP.test(plan.text)) failures.push('a plan-only brief carries the keep-going line');

if (failures.length) {
  console.error('RED keep-going-last:\n  - ' + failures.join('\n  - '));
  process.exit(1);
}
console.log('GREEN keep-going-last');
