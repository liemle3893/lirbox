#!/usr/bin/env node
// Frozen check: with Jev not set up, `judge` must refuse (exit 3, no scorecard) so the skill switches to the
// Haiku fallback, and a fallback grade must say it came from Haiku. A silent grade or a Haiku card labelled
// Jev both pass off an unmeasured or different-judge score as Jev's.
//
// PI_BRIEF_OVERRIDE points at the brief.mjs under test (set by prove-checks for mutation-testing).
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const brief = process.env.PI_BRIEF_OVERRIDE || join(here, '..', '..', 'scripts', 'brief.mjs');
const repoScripts = join(here, '..', '..', '..', '..', 'scripts');

// A copy laid out like the plugin, run from outside any repo, so no .env can supply a key.
const box = join(mkdtempSync(join(tmpdir(), 'pi-check-')), 'plugins', 'lirbox');
const skillScripts = join(box, 'skills', 'prompt-improve', 'scripts');
mkdirSync(join(box, 'scripts'), { recursive: true });
cpSync(join(repoScripts, 'jev.mjs'), join(box, 'scripts', 'jev.mjs'));
cpSync(join(here, '..', '..', 'scripts'), skillScripts, { recursive: true });
cpSync(brief, join(skillScripts, 'brief.mjs'));
const env = { ...process.env }; delete env.TYPESAFE_API_KEY;
const run = (args) => spawnSync('node', [join(skillScripts, 'brief.mjs'), ...args],
  { input: 'Add dark mode to the settings page so night readers stop squinting.', env, cwd: box, encoding: 'utf8' });

const failures = [];
const noJev = run(['judge', '--template', 'feature', '--on', 'goal', '--json']);
if (noJev.status !== 3) failures.push(`judge without Jev exited ${noJev.status}, not 3`);
if (noJev.stdout.trim()) failures.push('judge without Jev printed a scorecard');

const f = join(box, 'answers.json');
writeFileSync(f, JSON.stringify({ part_goal: { type: 'score', score: 3 }, over_direction: { type: 'score', score: 4 }, clarity: { type: 'noul', noul: 0.9 } }));
const fb = run(['judge', '--template', 'feature', '--on', 'goal', '--answers', f, '--json']);
let card = null;
try { card = JSON.parse(fb.stdout); } catch { failures.push(`judge --answers printed no JSON (exit ${fb.status}: ${fb.stderr.trim()})`); }
if (card && card.by !== 'haiku') failures.push(`a fallback grade is labelled "${card.by}", not "haiku"`);

if (failures.length) {
  console.error('RED no-fake-grade:\n  - ' + failures.join('\n  - '));
  process.exit(1);
}
console.log('GREEN no-fake-grade');
