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
import { execFileSync, spawn } from 'node:child_process';
import http from 'node:http';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const ok = (m) => console.log(`  ok    ${m}`);
const bad = (m) => { console.error(`  FAIL  ${m}`); failures++; };

// The timeout is load-bearing, not hygiene. graph-server.mjs with an unchecked
// --name does not fail — it STARTS, listening, pointed at whatever path the name
// resolved to. Without a cap this suite hangs there instead of reporting it.
const run = (args, cwd) => {
  try {
    return { code: 0, out: execFileSync('node', args, { cwd, encoding: 'utf8', stdio: 'pipe', timeout: 15000 }) };
  } catch (e) {
    if (e.killed || e.signal) return { code: 124, out: `${(e.stdout || '')}${(e.stderr || '')}\n[timed out — the command did not exit]` };
    return { code: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') };
  }
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

// ---------------------------------------------------------------------------
// A name that keys a path — every entry point, not the four that had it
// ---------------------------------------------------------------------------
// Four scaffolds validated their --name as a slug. A dozen other entry points
// took the same name, joined it onto a path, and read or wrote there. The
// traversal is the same in all of them; only the coverage differed.
console.log('\n── a name keys a path: every entry point refuses a traversing one');
const S = join(REPO, 'plugins/lirbox/skills');
const NAME_ENTRYPOINTS = [
  ['arena-report',            [join(S, 'arena/scripts/arena-report.cjs'), '../../../../etc/x']],
  ['workflow-report',         [join(S, 'conductor/scripts/workflow-report.cjs'), '../../../../etc/x']],
  ['optimize-report',         [join(S, 'prospector/scripts/optimize-report.cjs'), '../../../../etc/x']],
  ['improve-report',          [join(S, 'whetstone/scripts/improve-report.cjs'), '../../../../etc/x']],
  ['loom-report',             [join(S, 'loom/scripts/loom-report.cjs'), '../../../../etc/x']],
  ['harvest-feedback',        [join(S, 'whetstone/scripts/harvest-feedback.cjs'), '../../../../etc/x']],
  ['check-val-contamination', [join(S, 'prospector/scripts/check-val-contamination.cjs'), '../../../../etc/x']],
  ['swe-grade',               [join(S, 'arena/scripts/swe-grade.mjs'), '--task', '../../../../etc/x']],
  ['swe-score',               [join(S, 'arena/scripts/swe-score.mjs'), '--cells', tmp, '--name', '../../../../etc/x']],
  ['graph-server',            [join(S, 'loom/scripts/graph-server.mjs'), '--name', '../../../../etc/x']],
  ['scaffold-arena',          [join(S, 'arena/scripts/scaffold-arena.cjs'), '--name', '../../../../tmp/pwn']],
];
for (const [label, args] of NAME_ENTRYPOINTS) {
  const res = run(args, tmp);
  // The refusal must NAME the problem. Several of these already exited non-zero
  // for an unrelated reason (no such state file), which is not a guard: it
  // stops nothing the moment the traversal points at a file that does exist.
  if (res.code === 0 || !/must be a (plain name|kebab slug)/.test(res.out)) {
    bad(`${label} did not refuse a traversing name (exit ${res.code})\n${res.out.slice(0, 300)}`);
  } else ok(`${label} refuses a traversing name`);
}

// ---------------------------------------------------------------------------
// A name that becomes CODE in a generated file
// ---------------------------------------------------------------------------
console.log('\n── a name or a title becomes code in the generated conductor');
{
  // scaffold-arena emitted `name: '<name>'` into the conductor it generates,
  // unquoted and unchecked, and the Workflow tool runs that file.
  const r2 = run([join(S, 'arena/scripts/scaffold-arena.cjs'), '--name', "x'; PWNED; '", '--out', join(tmp, 'a.js')], tmp);
  if (r2.code === 0) bad('scaffold-arena accepted a name that closes the string it is emitted into');
  else ok('scaffold-arena refuses a name carrying a quote');

  // A --phases title lands inside single-quoted strings in a dozen places.
  const r3 = run([join(S, 'conductor/scripts/scaffold-workflow.cjs'), '--name', 'probe',
    '--phases', "Work'); PWNED; ('", '--out', join(tmp, 'w.js')], tmp);
  if (r3.code === 0) bad('scaffold-workflow accepted a phase title that closes the string it is emitted into');
  else ok('scaffold-workflow refuses a phase title carrying a quote');

  // …and both still generate from ordinary input.
  const r4 = run([join(S, 'arena/scripts/scaffold-arena.cjs'), '--name', 'ok-run', '--out', join(tmp, 'ok.js')], tmp);
  const r5 = run([join(S, 'conductor/scripts/scaffold-workflow.cjs'), '--name', 'ok-run',
    '--phases', 'Work,Verify (fast)', '--out', join(tmp, 'okw.js')], tmp);
  if (r4.code !== 0 || r5.code !== 0) bad(`a scaffold refused ordinary input\n${r4.out}\n${r5.out}`);
  else ok('both scaffolds still generate from ordinary names and titles');
}

// ---------------------------------------------------------------------------
// dod-freeze.mjs — a JSON field that becomes an executable file's name
// ---------------------------------------------------------------------------
console.log('\n── dod-freeze.mjs: a criterion id names a file written 0755');
{
  const dodDir = join(tmp, 'dod');
  mkdirSync(join(dodDir, 'checks'), { recursive: true });
  const dodPath = join(dodDir, 'dod.json');
  const victim = join(tmp, 'DOD_VICTIM');
  writeFileSync(dodPath, JSON.stringify({ criteria: [
    { id: `../../${'DOD_VICTIM'}`, tier: 'checkable', script: 'echo pwned' }] }));
  const r6 = run([join(S, 'loom/scripts/dod-freeze.mjs'), '--dod', dodPath, '--checks-dir', join(dodDir, 'checks')], tmp);
  if (r6.code === 0) bad('dod-freeze accepted a criterion id containing ..');
  else if (existsSync(victim + '.sh')) bad('dod-freeze refused and wrote the executable outside anyway');
  else ok('dod-freeze refuses a criterion id that would escape --checks-dir');

  writeFileSync(dodPath, JSON.stringify({ criteria: [{ id: 'tests-pass', tier: 'checkable', script: 'npm test' }] }));
  const r7 = run([join(S, 'loom/scripts/dod-freeze.mjs'), '--dod', dodPath, '--checks-dir', join(dodDir, 'checks')], tmp);
  if (r7.code !== 0) bad(`dod-freeze refused an ordinary criterion\n${r7.out}`);
  else ok('dod-freeze still freezes an ordinary criterion');
}

// ---------------------------------------------------------------------------
// graph-server.mjs — a no-auth localhost server that writes the approval file
// ---------------------------------------------------------------------------
// Binding to 127.0.0.1 keeps it off the network, not away from a browser. Any
// page the user has open can POST to it, and POST /action writes the file loom
// polls to APPROVE a plan. editor.js already guards the in-page version of this
// (its `<img onerror>` note); this is the cross-origin one, which no escaping
// inside the page can reach.
console.log('\n── graph-server.mjs: a page the user is visiting must not drive it');
{
  const root = join(tmp, 'loomroot');
  mkdirSync(join(root, '.loom', 'state'), { recursive: true });
  const srv = spawn('node', [join(S, 'loom/scripts/graph-server.mjs'), '--name', 'probe', '--root', root],
    { stdio: ['ignore', 'pipe', 'pipe'] });
  const port = await new Promise((res, rej) => {
    let buf = '';
    const t = setTimeout(() => rej(new Error('server did not report a port')), 10000);
    srv.stdout.on('data', (c) => {
      buf += c;
      const m = buf.match(/LOOM_SERVER_PORT=(\d+)/);
      if (m) { clearTimeout(t); res(Number(m[1])); }
    });
    srv.on('exit', (code) => { clearTimeout(t); rej(new Error(`server exited ${code}`)); });
  }).catch((e) => { bad(`graph-server did not start: ${e.message}`); return null; });

  if (port) {
    const hit = async (headers) => {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/action`, {
          method: 'POST', headers, body: JSON.stringify({ action: 'approve' }),
        });
        return r.status;
      } catch (e) { return `error:${e.message}`; }
    };
    const SELF = { 'content-type': 'application/json', origin: `http://127.0.0.1:${port}` };

    const cross = await hit({ 'content-type': 'application/json', origin: 'https://evil.example' });
    if (cross !== 403) bad(`a cross-origin POST /action was not refused (status ${cross}) — any page the user has open could approve a plan`);
    else ok('a cross-origin POST /action is refused');

    // The bypass that makes an Origin check alone insufficient: a "simple"
    // content type needs no preflight, so the browser sends it regardless.
    const simple = await hit({ 'content-type': 'text/plain' });
    if (simple !== 415) bad(`a text/plain POST /action was accepted (status ${simple}) — a simple request needs no preflight, so this is reachable cross-origin`);
    else ok('a POST that would skip the CORS preflight is refused');

    // DNS rebinding: the attacker's hostname resolves to 127.0.0.1, so Origin
    // and the socket both look local — only Host still names the attacker.
    // Sent through node:http, not fetch: `Host` is a forbidden header name for
    // fetch, which drops it silently — the request then carries OUR host and
    // the case passes while testing nothing. (It did, before this note.)
    const rawPost = (headers) => new Promise((res) => {
      const body = JSON.stringify({ action: 'approve' });
      const rq = http.request({ host: '127.0.0.1', port, path: '/action', method: 'POST',
        headers: { 'content-length': Buffer.byteLength(body), ...headers } }, (rs) => {
        rs.resume(); res(rs.statusCode);
      });
      rq.on('error', (e) => res(`error:${e.message}`));
      rq.end(body);
    });
    const rebind = await rawPost({ 'content-type': 'application/json', host: `evil.example:${port}` });
    if (rebind !== 403) bad(`a request with a foreign Host was accepted (status ${rebind}) — DNS rebinding reaches this server`);
    else ok('a request with a rebound Host is refused');

    const self = await hit(SELF);
    if (self !== 200) bad(`the editor's own POST /action was refused (status ${self})`);
    else ok("the editor's own same-origin POST still works");
  }
  srv.kill();
}

rmSync(tmp, { recursive: true, force: true });

console.log('');
if (failures) { console.error(`HOSTILE-INPUT RED — ${failures} refusal(s) missing`); process.exit(1); }
console.log('HOSTILE-INPUT GREEN — every hostile input refused, every legitimate one still works.');
