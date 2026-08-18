#!/usr/bin/env node
/*
 * HOSTILE-INPUT TEST — build the nastiest project input we can and prove the
 * repo's own tooling refuses it.
 *
 * Why this exists rather than a code review. Two of these scripts read a file
 * that whoever opened a pull request controls, and turn strings out of it into
 * paths and child processes:
 *
 *   * prove-checks.mjs reads every skill's evals/checks-manifest.json and runs
 *     .github/workflows/evals.yml over ALL of them on every PR. `file` was
 *     joined onto a path with nothing checking it, so
 *     `"file": "../../../../somewhere/else"` wrote through the scratch copy into
 *     the runner — and the run still printed "OK — every declared mutation
 *     produced a RED."
 *   * harbor-prep.mjs --catalog recursively deleted whatever path it was handed.
 *
 * Both are fixed. This is what keeps them fixed: the hostile manifest is built
 * here, in the test, so the refusal is measured and not asserted.
 *
 * Run:  node scripts/test-hostile-input.mjs
 * Exit: 0 iff every hostile input was refused AND the legitimate one still works.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const ok = (m) => console.log(`  ok    ${m}`);
const bad = (m) => { console.error(`  FAIL  ${m}`); failures++; };

const run = (args, cwd) => {
  try {
    return { code: 0, out: execFileSync('node', args, { cwd, encoding: 'utf8', stdio: 'pipe' }) };
  } catch (e) { return { code: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') }; }
};

// ---------------------------------------------------------------------------
// prove-checks.mjs — a hostile evals/checks-manifest.json
// ---------------------------------------------------------------------------
// A throwaway repo with the layout prove-checks derives its paths from, so the
// real tree is never a participant.
const tmp = mkdtempSync(join(tmpdir(), 'hostile-input-'));
const fake = join(tmp, 'repo');
const SKILL = join(fake, 'plugins/lirbox/skills/probe');
mkdirSync(join(SKILL, 'evals/checks'), { recursive: true });
mkdirSync(join(SKILL, 'scripts'), { recursive: true });
mkdirSync(join(fake, 'scripts'), { recursive: true });
cpSync(join(REPO, 'scripts/prove-checks.mjs'), join(fake, 'scripts/prove-checks.mjs'));

writeFileSync(join(SKILL, 'scripts/thing.txt'), 'INVARIANT_PRESENT\n');
// Goes RED exactly when the invariant is gone from the file it is pointed at.
writeFileSync(join(SKILL, 'evals/checks/probe.check.mjs'),
  `import { readFileSync } from 'node:fs';\n`
  + `const f = process.env.PROBE_FILE;\n`
  + `if (!f) { console.error('no PROBE_FILE'); process.exit(2); }\n`
  + `if (!readFileSync(f, 'utf8').includes('INVARIANT_PRESENT')) process.exit(1);\n`
  + `console.log('GREEN');\n`);

const VICTIM = join(tmp, 'VICTIM.txt');
const VICTIM_BODY = 'INVARIANT_PRESENT do-not-touch\n';
const manifest = (mutations) =>
  writeFileSync(join(SKILL, 'evals/checks-manifest.json'),
    JSON.stringify({ checks: { probe: { expect: 'green', mutations } } }, null, 2));
const proveChecks = (skill = 'probe') => run([join(fake, 'scripts/prove-checks.mjs'), '--skill', skill], fake);

const LEGIT = { why: 'probe', env: 'PROBE_FILE', file: 'scripts/thing.txt', find: 'INVARIANT_PRESENT', replace: 'GONE' };

console.log('── prove-checks.mjs: a manifest is input from whoever opened the PR');

// The one that actually happened.
writeFileSync(VICTIM, VICTIM_BODY);
manifest([{ ...LEGIT, file: '../../../../../VICTIM.txt' }]);
let r = proveChecks();
if (r.code !== 2) bad(`traversal in mutation.file was not refused (exit ${r.code})\n${r.out}`);
else if (readFileSync(VICTIM, 'utf8') !== VICTIM_BODY) bad('traversal was reported as refused but the file outside the tree was written anyway');
else ok("mutation.file with '..' is refused, and nothing outside the scratch copy is written");

for (const [label, mut, skill] of [
  ['an absolute mutation.file', { ...LEGIT, file: '/etc/hostname' }],
  ['mutation.env naming a loader variable (NODE_OPTIONS)', { ...LEGIT, env: 'NODE_OPTIONS' }],
  ['mutation.env naming LD_PRELOAD', { ...LEGIT, env: 'LD_PRELOAD' }],
  ['a lower-case mutation.env', { ...LEGIT, env: 'not a var name' }],
  ['a non-string mutation.find', { ...LEGIT, find: 12 }],
  ['an empty mutation.find (it would match everywhere)', { ...LEGIT, find: '' }],
  ['an unknown mutation key', { ...LEGIT, exec: 'rm -rf /' }],
  ['an unknown mutation.root', { ...LEGIT, root: 'elsewhere' }],
  ['a mutation that is not an object', 'just a string'],
]) {
  manifest([mut]);
  r = proveChecks(skill);
  if (r.code !== 2) bad(`${label} was not refused (exit ${r.code})\n${r.out}`);
  else ok(`${label} is refused`);
}

// A traversing --skill must not reach outside the skills directory either.
manifest([LEGIT]);
for (const s of ['../../..', '/etc', 'probe/../../..']) {
  r = proveChecks(s);
  if (r.code !== 2) bad(`--skill ${JSON.stringify(s)} was not refused (exit ${r.code})`);
  else ok(`--skill ${JSON.stringify(s)} is refused`);
}

// And the legitimate manifest still proves. A gate that refuses everything is
// not a gate, and this is the half that would go unnoticed.
r = proveChecks();
if (r.code !== 0 || !/PROVEN/.test(r.out)) bad(`a well-formed manifest no longer proves (exit ${r.code})\n${r.out}`);
else ok('a well-formed manifest still proves its mutation RED');
if (readFileSync(join(SKILL, 'scripts/thing.txt'), 'utf8') !== 'INVARIANT_PRESENT\n') {
  bad('prove-checks mutated the real skill tree instead of its scratch copy');
} else ok('the skill tree under test is left byte-identical');

// ---------------------------------------------------------------------------
// harbor-prep.mjs --catalog — a path argument that recursively deletes
// ---------------------------------------------------------------------------
console.log('\n── harbor-prep.mjs --catalog: the argument is a recursive delete');
const precious = join(tmp, 'precious');
mkdirSync(precious, { recursive: true });
writeFileSync(join(precious, 'work.txt'), 'six hours of it\n');

r = run([join(REPO, 'scripts/harbor-prep.mjs'), '--catalog', precious], REPO);
if (r.code !== 2) bad(`--catalog wiped a directory it did not create (exit ${r.code})`);
else if (!existsSync(join(precious, 'work.txt'))) bad('--catalog reported a refusal and deleted the contents anyway');
else ok('--catalog refuses a directory that is not one of its own catalogs');

r = run([join(REPO, 'scripts/harbor-prep.mjs'), '--catalog', join(REPO, 'scratch-catalog')], REPO);
if (r.code !== 2) bad(`--catalog accepted a destination inside the repo (exit ${r.code})`);
else ok('--catalog refuses a destination inside the repo');

const fresh = join(tmp, 'catalog');
r = run([join(REPO, 'scripts/harbor-prep.mjs'), '--catalog', fresh], REPO);
if (r.code !== 0) bad(`--catalog refused a fresh directory (exit ${r.code})\n${r.out}`);
else {
  r = run([join(REPO, 'scripts/harbor-prep.mjs'), '--catalog', fresh], REPO);
  if (r.code !== 0) bad(`--catalog refused to refresh its own catalog (exit ${r.code})\n${r.out}`);
  else ok('--catalog builds into a fresh directory and refreshes its own');
}

rmSync(tmp, { recursive: true, force: true });

console.log('');
if (failures) { console.error(`HOSTILE-INPUT RED — ${failures} refusal(s) missing`); process.exit(1); }
console.log('HOSTILE-INPUT GREEN — every hostile input refused, every legitimate one still works.');
