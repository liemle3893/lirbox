// Floor: SKILL.md is well-formed, its <scripts> verbs exist in the script, the script has no dependencies,
// and every file the skill points at exists.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const skill = read('SKILL.md');
const script = read('scripts/test-scope.mjs');

test('frontmatter: name matches directory and the description is a trigger', () => {
  const fm = skill.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(fm, 'no frontmatter block');
  const name = fm[1].match(/^name:\s*(.+)$/m);
  const desc = fm[1].match(/^description:\s*(.+)$/m);
  assert.equal(name && name[1].trim(), 'test-scope');
  assert.equal(path.basename(root), 'test-scope');
  assert.ok(desc && desc[1].length >= 40, 'description missing/too short');
  assert.match(desc[1], /only affected tests|only run affected tests|CI is too slow|test selection/i, 'description must carry user trigger phrasing');
});

test('XML structural tags balanced exactly once', () => {
  for (const tag of ['purpose', 'model', 'hard-rules', 'scripts', 'init', 'improve', 'measure', 'per-change']) {
    const open = (skill.match(new RegExp(`<${tag}>`, 'g')) || []).length;
    const close = (skill.match(new RegExp(`</${tag}>`, 'g')) || []).length;
    assert.deepEqual([open, close], [1, 1], `<${tag}> unbalanced`);
  }
});

test('no absolute machine paths in the skill or its references', () => {
  for (const f of ['SKILL.md', ...fs.readdirSync(path.join(root, 'references')).map((x) => `references/${x}`)]) {
    assert.doesNotMatch(read(f), /\/(Users|home)\/[a-z]/i, `${f}: absolute machine path`);
  }
});

test('every subcommand in <scripts> is implemented by the script', () => {
  const block = skill.match(/<scripts>([\s\S]*?)<\/scripts>/)[1];
  const verbs = [...block.matchAll(/node \$TS\s+(\w+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(verbs)].sort(), ['changecov', 'coverage', 'detect', 'doctor', 'hubs', 'measure', 'misses', 'mutate', 'replay', 'rules', 'run', 'select', 'trace']);
  const r = spawnSync(process.execPath, [path.join(root, 'scripts/test-scope.mjs'), 'help'], { encoding: 'utf8' });
  for (const v of verbs) assert.ok(r.stdout.includes(v), `script usage does not mention ${v}`);
  for (const v of verbs) assert.ok(new RegExp(`'${v}'`).test(script) || new RegExp(`sub === '${v}'`).test(script), `no handler for ${v}`);
});

test('zero dependencies: only node: built-ins and relative imports', () => {
  for (const f of fs.readdirSync(path.join(root, 'scripts')).filter((x) => x.endsWith('.mjs'))) {
    for (const m of read(`scripts/${f}`).matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)) assert.match(m[1], /^(node:|\.)/, `${f} imports ${m[1]}`);
  }
  const py = read('scripts/py_related.py');
  const std = new Set(['ast', 'json', 'os', 'sys']);
  for (const m of py.matchAll(/^import (\w+)/gm)) assert.ok(std.has(m[1]), `py_related.py imports ${m[1]}`);
});

test('the script parses (node --check) and every referenced file exists and parses', () => {
  for (const f of fs.readdirSync(path.join(root, 'scripts')).filter((x) => x.endsWith('.mjs'))) {
    assert.equal(spawnSync(process.execPath, ['--check', path.join(root, 'scripts', f)]).status, 0, `${f} does not parse`);
  }
  for (const f of ['references/parts-schema.md', 'references/adapters.md', 'references/hidden-links.md', 'references/case-study.md', 'references/measurement.md', 'scripts/py_related.py', 'scripts/esbuild_graph.mjs']) assert.ok(fs.existsSync(path.join(root, f)), `missing ${f}`);
  for (const f of ['assets/parts.example.json', 'assets/rules.source.example.json']) assert.doesNotThrow(() => JSON.parse(read(f)), `${f} is not JSON`);
  for (const ref of skill.matchAll(/`(references\/[\w.-]+)`/g)) assert.ok(fs.existsSync(path.join(root, ref[1])), `SKILL.md points at missing ${ref[1]}`);
});

test('SKILL.md sections name a command in every step: <measure> and <per-change>', () => {
  const sec = (t) => skill.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`))[1];
  const measure = sec('measure');
  const steps = measure.split(/^(?=[1-5]\. )/m).filter((b) => /^[1-5]\. /.test(b));
  assert.equal(steps.length, 5, 'measure has plan / baseline / change / after / report');
  for (const step of steps) assert.match(step, /`[^`]+`/, `measure step names no command: ${step}`);
  assert.match(measure, /measure --label before/);
  assert.match(measure, /measure --label after/);
  assert.match(measure, /measure --compare before after/);
  const rows = sec('per-change').split('\n').filter((l) => /^\|/.test(l) && !/^\|[-| ]+\|$/.test(l)).slice(1);
  assert.ok(rows.length >= 7, 'per-change table lost rows');
  for (const row of rows) assert.match(row.split('|')[2], /`[^`]+`/, `per-change row names no command: ${row}`);
  for (const section of ['init', 'improve']) assert.match(sec(section), /measure/, `<${section}> must reference measure`);
  assert.match(sec('init'), /--label baseline/);
});

test('SKILL.md stays lean (detail lives in references/) and the case study is anonymised', () => {
  assert.ok(skill.split(/\s+/).filter(Boolean).length <= Math.floor(1066 * 1.4), 'SKILL.md grew past ~40% over its 1066-word baseline: move detail into references/');
  const names = ['ms' + 'n', 'mas' + 'an', 'crown' + 'x', 'work' + 'book'];
  for (const f of ['references/case-study.md', 'references/measurement.md']) for (const n of names) assert.ok(!read(f).toLowerCase().includes(n), `${f} names ${n}`);
});

test('example parts file is accepted by the script (schema smoke)', async () => {
  const { loadConfig } = await import(path.join(root, 'scripts/test-scope.mjs'));
  const cfg = loadConfig(root, path.join(root, 'assets/parts.example.json'));
  assert.deepEqual(Object.keys(cfg.packages), ['server', 'web']);
  assert.deepEqual(cfg.parts.db.tests.server.length, 2);
  assert.deepEqual(cfg.warnings, []);
});
