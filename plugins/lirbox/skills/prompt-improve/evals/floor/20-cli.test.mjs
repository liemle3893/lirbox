// Floor: the bundled CLI runs offline — list, template, assemble, the Haiku fallback's questions → judge --answers,
// and judge with no Jev key exits 3 instead of grading.
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync, mkdtempSync, cpSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';

// jev.mjs falls back to the .env beside lirbox and at the caller's git root, so run a copy laid out like
// the plugin, from a cwd outside any repo, with no .env above it.
const skillDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const box = join(mkdtempSync(join(tmpdir(), 'pi-')), 'plugins', 'lirbox');
mkdirSync(join(box, 'scripts'), { recursive: true });
cpSync(join(skillDir, '..', '..', 'scripts', 'jev.mjs'), join(box, 'scripts', 'jev.mjs'));
cpSync(join(skillDir, 'scripts'), join(box, 'skills', 'prompt-improve', 'scripts'), { recursive: true });
const cli = join(box, 'skills', 'prompt-improve', 'scripts', 'brief.mjs');
const env = { ...process.env };
delete env.TYPESAFE_API_KEY;
const run = (args, input) => execFileSync('node', [cli, ...args], { input, env, cwd: box, encoding: 'utf8' });

const list = JSON.parse(run(['list', '--json']));
assert.ok(list.some((t) => t.id === 'feature'), 'list has feature');
const tpl = JSON.parse(run(['template', 'feature']));
assert.ok(tpl.parts.some((p) => p.id === 'goal'), 'template has goal');

const text = run(['assemble', '--template', 'feature', '--json'], JSON.stringify({ parts: { goal: 'Add dark mode to the settings page for every user.' } }));
assert.match(JSON.parse(text).text, /dark mode/);

const prompt = 'Add dark mode to the settings page so night readers stop squinting.';
const q = JSON.parse(run(['questions', '--template', 'feature', '--on', 'goal,verify'], prompt));
assert.deepEqual(q.on, ['goal', 'verify']);
assert.ok(q.questions.part_goal && q.questions.clarity, 'questions carry parts and clarity');

const answers = { part_goal: { type: 'score', score: 3 }, part_verify: { type: 'score', score: 1 },
  over_direction: { type: 'score', score: 4 }, clarity: { type: 'noul', noul: 0.9 } };
const f = join(mkdtempSync(join(tmpdir(), 'pi-')), 'answers.json');
writeFileSync(f, JSON.stringify(answers));
const card = JSON.parse(run(['judge', '--template', 'feature', '--on', 'goal,verify', '--answers', f, '--json'], prompt));
assert.equal(card.by, 'haiku');
assert.equal(card.parts.goal.score, 3);
assert.equal(card.parts.verify.score, 1);

const noJev = spawnSync('node', [cli, 'judge', '--template', 'feature', '--json'], { input: prompt, env, cwd: box, encoding: 'utf8' });
assert.equal(noJev.status, 3, `judge without Jev must exit 3 (got ${noJev.status}: ${noJev.stderr})`);
assert.equal(noJev.stdout, '', 'judge without Jev must print no scorecard');
