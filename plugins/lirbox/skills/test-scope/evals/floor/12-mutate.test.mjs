// mutate: function-entry mutants of the changed functions. Files are ALWAYS restored.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { commit, git, ts, write, SCRIPT } from './_fixture.mjs';
import { makeJsRepo, edit, A0, JS_PARTS } from './_js.mjs';

const range = ['mutate', '--changed', 'HEAD~1', '--to', 'HEAD'];
const read = (dir, rel = 'src/a.js') => fs.readFileSync(path.join(dir, rel), 'utf8');
const withCmd = (cmd) => { const p = JSON.parse(JSON.stringify(JS_PARTS)); p.packages.app.cmd = cmd; return p; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('mutate: a function a selected test asserts is CAUGHT; one no selected test asserts SURVIVES (exit 1)', () => {
  const { dir } = makeJsRepo();
  commit(dir, 'change both', { 'src/a.js': edit('both') });
  const r = ts(dir, range);
  assert.equal(r.code, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /foo: CAUGHT/);
  assert.match(r.stdout, /bar: SURVIVED/);
  assert.match(r.stdout, /SURVIVED  src\/a\.js:4 bar: no selected test fails when this function throws/);
  assert.equal(read(dir), edit('both'), 'the file is exactly as committed afterwards');
  assert.equal(git(dir, 'status', '--porcelain'), '');
  commit(dir, 'change foo', { 'src/a.js': A0 });
  commit(dir, 'change foo again', { 'src/a.js': edit('foo') });
  const ok = ts(dir, range);
  assert.equal(ok.code, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /summary: caught 1, survived 0/);
});

test('mutate refuses target files with uncommitted changes (and leaves them alone) unless --allow-dirty', () => {
  const { dir } = makeJsRepo();
  commit(dir, 'change foo', { 'src/a.js': edit('foo') });
  const dirty = edit('foo') + '// wip\n';
  write(dir, 'src/a.js', dirty);
  const r = ts(dir, range);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /refusing: target file\(s\) have uncommitted changes/);
  assert.equal(read(dir), dirty);
  const base = ts(dir, ['mutate', '--changed', 'HEAD~1', '--allow-dirty']);
  assert.equal(base.code, 0, base.stdout + base.stderr);
  assert.equal(read(dir), dirty, 'the dirty content is put back byte for byte');
});

test('restore: the test command is KILLED mid-run (SIGKILL) and a hang is stopped by the timeout; the file is back both times', () => {
  const kill = "-e \"if (require('fs').readFileSync('src/a.js','utf8').includes('TSMUT')) process.kill(process.pid,'SIGKILL')\" {tests}";
  const { dir } = makeJsRepo({ parts: withCmd(`node ${kill}`) });
  commit(dir, 'change foo', { 'src/a.js': edit('foo') });
  const r = ts(dir, range);
  assert.match(r.stdout, /foo: INCONCLUSIVE/, r.stdout + r.stderr);
  assert.equal(read(dir), edit('foo'), 'killed mid-run, file restored');
  assert.doesNotMatch(read(dir), /TSMUT/);

  const hang = "-e \"if (require('fs').readFileSync('src/a.js','utf8').includes('TSMUT')) setInterval(()=>{},1000)\" {tests}";
  const h = makeJsRepo({ parts: withCmd(`node ${hang}`) });
  commit(h.dir, 'change foo', { 'src/a.js': edit('foo') });
  const t0 = Date.now();
  const r2 = ts(h.dir, [...range, '--timeout', '1']);
  assert.match(r2.stdout, /foo: TIMEOUT/, r2.stdout + r2.stderr);
  assert.ok(Date.now() - t0 < 20000, 'bounded');
  assert.equal(read(h.dir), edit('foo'), 'timed out, file restored');
});

// a runner that signals "mutant is on disk" and then waits, so the test can signal mutate itself
function slowRepo() {
  const flag = (dir) => path.join(dir, 'mutated.flag');
  const cmd = "-e \"const fs=require('fs');if(fs.readFileSync('src/a.js','utf8').includes('TSMUT')){fs.writeFileSync('mutated.flag','1');setTimeout(()=>{},8000)}\" {tests}";
  const { dir } = makeJsRepo({ parts: withCmd(`node ${cmd}`) });
  commit(dir, 'change foo', { 'src/a.js': edit('foo'), '.gitignore': 'cov/\nmutated.flag\n' });
  return { dir, flag: flag(dir) };
}
async function untilFlag(flag) { for (let i = 0; i < 200 && !fs.existsSync(flag); i++) await sleep(50); assert.ok(fs.existsSync(flag), 'the mutant never reached the runner'); }
const { NODE_TEST_CONTEXT, ...cleanEnv } = process.env;

test('restore: SIGTERM to mutate itself while a mutant is on disk puts the file back and exits 143', async () => {
  const { dir, flag } = slowRepo();
  const child = spawn(process.execPath, [SCRIPT, ...range, '--timeout', '60'], { cwd: dir, env: cleanEnv, stdio: 'ignore' });
  const exited = new Promise((r) => child.on('close', (code, sig) => r({ code, sig })));
  await untilFlag(flag);
  assert.match(read(dir), /TSMUT/, 'precondition: the file really was mutated');
  child.kill('SIGTERM');
  const { code } = await exited;
  assert.equal(code, 143);
  assert.equal(read(dir), edit('foo'));
});

test('restore: after a SIGKILL of mutate itself (no handler can run) the next run replays the journal first', async () => {
  const { dir, flag } = slowRepo();
  const child = spawn(process.execPath, [SCRIPT, ...range, '--timeout', '60'], { cwd: dir, env: cleanEnv, stdio: 'ignore' });
  const exited = new Promise((r) => child.on('close', r));
  await untilFlag(flag);
  child.kill('SIGKILL');
  await exited;
  assert.match(read(dir), /TSMUT/, 'SIGKILL left the mutant on disk (this is what the journal is for)');
  const r = ts(dir, ['mutate', '--changed', 'HEAD~1', '--to', 'HEAD', '--dry-run']);
  assert.match(r.stdout, /restored 1 file\(s\) left mutated by an interrupted run: src\/a\.js/);
  assert.equal(read(dir), edit('foo'));
  assert.equal(git(dir, 'status', '--porcelain'), '');
});

test('--prove-irrelevant: an excluded test that fails with the mutant marker is RELEVANT (exit 1); one that never does is irrelevant', () => {
  const { dir } = makeJsRepo();
  commit(dir, 'change both', { 'src/a.js': edit('both') });
  const r = ts(dir, [...range, '--prove-irrelevant', 'tests/b.test.js,tests/c.test.js']);
  assert.equal(r.code, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /RELEVANT\s+tests\/b\.test\.js\s+fails when src\/a\.js:4 bar throws/);
  assert.doesNotMatch(r.stdout, /RELEVANT\s+tests\/c\.test\.js/);
  assert.match(r.stdout, /irrelevant \(no mutant failed them\): 1 of 2/);
  assert.equal(read(dir), edit('both'));
  write(dir, 'excluded.txt', '# the tests selection skipped\ntests/c.test.js\n');
  const ok = ts(dir, [...range, '--prove-irrelevant', '@excluded.txt']);
  assert.equal(ok.code, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /irrelevant \(no mutant failed them\): 1 of 1/);
  assert.equal(ts(dir, [...range, '--prove-irrelevant', 'tests/a.test.js']).code, 64, 'a selected test is not a candidate');
});

test('mutants are capped round-robin and the dropped ones are logged', () => {
  const { dir } = makeJsRepo();
  commit(dir, 'change both', { 'src/a.js': edit('both') });
  const r = ts(dir, [...range, '--max-mutants', '1', '--dry-run']);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /2 changed function\(s\) -> 1 mutant\(s\); DROPPED 1 over the cap of 1 \(--max-mutants\): src\/a\.js:4 bar/);
});

test('restore never clobbers a foreign edit: a file changed during the run is left as is, its original kept in the journal (in .git, not /tmp)', async () => {
  const { dir, flag } = slowRepo();
  const child = spawn(process.execPath, [SCRIPT, ...range, '--timeout', '2'], { cwd: dir, env: cleanEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  let err = '';
  child.stderr.on('data', (d) => { err += d; });
  const exited = new Promise((r) => child.on('close', r));
  await untilFlag(flag);
  write(dir, 'src/a.js', 'someone else saved this\n');
  const code = await exited;
  assert.equal(code, 2, err);
  assert.match(err, /changed by something else during the run: NOT overwritten/);
  assert.equal(read(dir), 'someone else saved this\n', 'the foreign edit survives');
  const journal = path.join(dir, '.git', 'test-scope-mutate.json');
  assert.equal(JSON.parse(fs.readFileSync(journal, 'utf8')).files[path.join(dir, 'src/a.js')].orig, edit('foo'), 'the original is in the journal');
  const next = ts(dir, [...range, '--dry-run', '--allow-dirty']);
  assert.match(next.stdout, /journal names file\(s\) edited since; they were NOT touched\. Originals: .*test-scope-mutate\.json\.\d+/);
  assert.equal(read(dir), 'someone else saved this\n');
  assert.ok(!fs.existsSync(journal), 'set aside, not replayed again');

  // a foreign edit that KEEPS the mutant (a formatter step in the test command appends): only the mutant is removed
  const fmt = makeJsRepo({ parts: withCmd('sh -c "grep -q TSMUT src/a.js && echo // formatted >> src/a.js; node --test $0 $@" {tests}') });
  commit(fmt.dir, 'change foo', { 'src/a.js': edit('foo') });
  const f = ts(fmt.dir, range);
  assert.equal(f.code, 0, f.stdout + f.stderr);
  assert.match(f.stderr, /src\/a\.js was changed by something else during the run: restored \(foreign edit kept\)/);
  assert.match(f.stdout, /foo: CAUGHT/);
  assert.doesNotMatch(read(fmt.dir), /TSMUT/, 'no mutant left in the file');
  assert.equal(read(fmt.dir), edit('foo') + '// formatted\n', 'the foreign edit is kept');
  assert.ok(!fs.existsSync(path.join(fmt.dir, '.git', 'test-scope-mutate.json')), 'nothing left journaled');

  // via doctor: a foreign edit that drops the mutant text is reported with its reason (exit 2 inside doctor is not silent)
  const rep = makeJsRepo({ parts: withCmd('sh -c "grep -q TSMUT src/a.js && echo replaced > src/a.js; node --test $0 $@" {tests}') });
  commit(rep.dir, 'change foo', { 'src/a.js': edit('foo') });
  const d = ts(rep.dir, ['doctor', '--changed', 'HEAD~1', '--to', 'HEAD', '--no-changecov']);
  assert.equal(d.code, 1, d.stdout + d.stderr);
  assert.match(d.stdout, /\[FAIL\] mutate \(sample\)[\s\S]*src\/a\.js was changed by something else during the run: NOT overwritten/);
  assert.equal(read(rep.dir), 'replaced\n', 'the foreign edit survives');
});
