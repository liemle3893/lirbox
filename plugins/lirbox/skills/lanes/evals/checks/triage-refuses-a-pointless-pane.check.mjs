#!/usr/bin/env node
// Frozen check: a verifier pane is refused when every criterion is a command and
// an expected value, and the refusal is escapable with a recorded reason.
//
// The invariant, in one line: triage classifies criteria, `start --role verifier
// --for <lane>` refuses on a lane whose criteria are ALL deterministic, and
// `--because` proceeds while writing a decision record.
//
// Why. A verifier lane exists so a result is judged by something that did not
// produce it. A criterion that is a command and an expected value is not judged,
// it is RE-RUN — and evidence.mjs does that in seconds. Spawning a pane to reach
// the same exit code costs a spawn, an install, a build and a context, once per
// lane. That is how a change involving almost no code takes hours, and prose has
// already failed to stop it: "Size the run first" has been in the orchestrator
// prompt as a ladder the whole time.
//
// Four arms, one per way this can break:
//   1. an all-deterministic lane still gets its pane — nothing was gated
//   2. the escape disappears, so a check that may not be able to fail cannot be
//      given a pane at all, and the refusal starts being routed around
//   3. --because proceeds without recording why — a waiver, not a decision
//   4. a lane WITH a judgemental criterion is refused, which would deny exactly
//      the pane that is worth paying for
//
// And one on the classifier's failure direction: unclassifiable must count as
// judgemental. Wrong that way costs a spawn and is visible; wrong the other way
// means nobody ever looks at the criterion, and that is silent.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const plugin = join(here, '..', '..', '..', '..');
const script = process.env.ORCH_LANE_OVERRIDE || join(plugin, 'scripts', 'orch-lane.sh');

const tmp = mkdtempSync(join(tmpdir(), 'triage-pane-'));
const repo = join(tmp, 'repo'), home = join(tmp, 'home'), bin = join(tmp, 'bin');
const cleanup = () => rmSync(tmp, { recursive: true, force: true });
const fail = (m) => { cleanup(); throw new Error(m); };

mkdirSync(repo, { recursive: true }); mkdirSync(bin, { recursive: true });
const git = (...a) => execFileSync('git', ['-C', repo, ...a], { stdio: 'pipe' });
execFileSync('git', ['init', '-q', '-b', 'main', repo], { stdio: 'pipe' });
git('config', 'user.email', 'c@example.invalid'); git('config', 'user.name', 'check');
writeFileSync(join(repo, 'f'), 'x'); git('add', '-A'); git('commit', '-qm', 'base');

const key = execFileSync('git', ['-C', repo, 'rev-parse', '--path-format=absolute',
  '--git-common-dir'], { encoding: 'utf8' }).trim();
const slug = createHash('sha1').update(key).digest('hex').slice(0, 12);
const cfgDir = join(home, '.claude', 'lirbox-orchestrator');
mkdirSync(cfgDir, { recursive: true });
mkdirSync(join(home, '.claude', 'lirbox-lanes'), { recursive: true });
writeFileSync(join(cfgDir, `${slug}.json`), JSON.stringify({
  default_profile: 'gp',
  lanes: { base_branch: 'main', ready_timeout_ms: 60000, gate_profile: 'gp' },
  profiles: { gp: { kind: 'claude', model: 'claude-opus-5', agent: 'general-purpose' } },
  setup: { test: 'true', baseline: 'true  exit: 0' },
}, null, 2));

const runDir = join(repo, '.orchestration', 't1');
mkdirSync(join(runDir, 'dispatch'), { recursive: true });
mkdirSync(join(runDir, 'criteria'), { recursive: true });
writeFileSync(join(runDir, 'items.md'), '1. the only item — blocks: none   touches: src/a.ts\n');
writeFileSync(join(runDir, 'baseline.txt'), 'true   exit: 0\n');

// Every criterion is a command and an expected value: re-running answers all of them.
const detPath = join(runDir, 'criteria', 'det.md');
writeFileSync(detPath, '- `npm test` exits 0\n- `npm run lint` exit: 0\n');
// One of these cannot be re-run into an answer.
const mixPath = join(runDir, 'criteria', 'mix.md');
writeFileSync(mixPath, '- `npm test` exits 0\n- the check is anchored to the invariant, not a nearby token\n');
for (const [lane, contract] of [['det', detPath], ['mix', mixPath]]) {
  writeFileSync(join(runDir, 'dispatch', `${lane}.json`), JSON.stringify({
    lane, agent_name: lane, branch: lane, profile: 'gp', contract, state: 'dispatched',
  }, null, 2));
}

writeFileSync(join(bin, 'herdr'), `#!/bin/sh
case "$1 $2 $3" in
  "agent start --help")
    echo '      --kind <KIND>  [possible values: claude, omp, opencode, codex]'
    exit 0 ;;
esac
case "$1 $2" in
  "worktree create") echo SPAWNED >> ${join(tmp, 'spawns')} ; exit 1 ;;
esac
exit 0
`);
chmodSync(join(bin, 'herdr'), 0o755);

// TRIAGE_OVERRIDE rides through to the script under test so a mutation of the
// classifier is observable from here; unset in every real run.
const env = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` };
const run = (...args) => {
  try {
    return { code: 0, out: execFileSync('zsh', [script, ...args],
      { cwd: repo, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) { return { code: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') }; }
};
const spawned = () => (existsSync(join(tmp, 'spawns')) ? readFileSync(join(tmp, 'spawns'), 'utf8') : '');

// -- 1. an all-deterministic lane gets no pane --------------------------------
let d = run('start', 'v-det', '--profile', 'gp', '--run', 't1', '--role', 'verifier', '--for', 'det');
if (d.code === 0) {
  fail('a verifier pane was cut for a lane whose criteria are every one a command and an '
     + 'expected value. Re-running them is what verifies them, and evidence.mjs does that in '
     + `seconds — the pane costs a spawn, an install, a build and a context:\n${d.out}`);
}
if (spawned()) fail('the refusal came AFTER a worktree was cut — the cost it exists to avoid was '
  + 'already paid, and a checkout is left behind for a human to clean up.');
if (!/--because/.test(d.out)) {
  fail('the refusal never names the escape. A refusal with no stated way through gets routed '
     + 'around silently instead of on the record.');
}
if (!/evidence\.mjs verify/.test(d.out)) {
  fail('the refusal never says what to do instead. "No" without the cheaper path is how a gate '
     + 'gets read as an obstacle.');
}

// -- 2. --because proceeds, and RECORDS ---------------------------------------
d = run('start', 'v-det', '--profile', 'gp', '--run', 't1', '--role', 'verifier', '--for', 'det',
        '--because', 'the check has never been seen failing');
const decision = join(runDir, 'decisions', 'verifier-det.json');
if (!existsSync(decision)) {
  fail('--because let the pane through without writing a decision record. That is a waiver, not '
     + 'a decision: a replacement orchestrator inherits a pane nobody can explain.');
}
const rec = JSON.parse(readFileSync(decision, 'utf8'));
for (const field of ['fork', 'options', 'chosen', 'reason', 'would_overturn']) {
  if (!rec[field]) fail(`the decision record has no ${field}. would_overturn is the one that makes `
    + 'a resume actionable — "chose option 1" cannot be acted on.');
}
if (!/never been seen failing/.test(rec.reason)) {
  fail('the recorded reason is not the one that was given, so the record explains nothing.');
}
if (!spawned()) fail('--because recorded the decision and then did not start the lane');

// -- 3. a lane with a judgemental criterion is NOT refused --------------------
rmSync(join(tmp, 'spawns'), { force: true });
d = run('start', 'v-mix', '--profile', 'gp', '--run', 't1', '--role', 'verifier', '--for', 'mix');
if (/no criterion that needs judging/.test(d.out)) {
  fail('a lane carrying a criterion that cannot be re-run into an answer was refused its pane. '
     + 'That denies exactly the verification worth paying for — the classifier must fail toward '
     + 'judgemental, because being wrong that way costs a spawn and being wrong the other way '
     + 'means nobody ever looks at the criterion.');
}
if (!spawned()) fail(`the mixed lane never reached the spawn path:\n${d.out}`);

// -- 4. an ordinary lane is untouched by any of this --------------------------
rmSync(join(tmp, 'spawns'), { force: true });
d = run('start', 'impl', '--profile', 'gp', '--run', 't1');
if (!spawned()) fail(`a plain implementor lane was blocked by the verifier guard:\n${d.out}`);

// -- 5. absence does not raise the ceiling ------------------------------------
// The rung is what the MEASUREMENTS support. A run with nothing on record has
// measured nothing, so it must not land on the most expensive rung — that
// inversion makes the un-scoped run the costly one, which is the habit this
// protocol exists to break.
const triage = process.env.TRIAGE_OVERRIDE
  || join(plugin, 'skills', 'lanes', 'scripts', 'triage.mjs');
const bare = join(repo, '.orchestration', 'bare');
mkdirSync(join(bare, 'dispatch'), { recursive: true });
writeFileSync(join(bare, 'items.md'), '1. one item — blocks: none   touches: src/a.ts\n');
for (const lane of ['a', 'b']) {
  writeFileSync(join(bare, 'dispatch', `${lane}.json`), JSON.stringify({
    lane, agent_name: lane, branch: lane, profile: 'gp', state: 'dispatched',
  }, null, 2));
}
let t;
try {
  t = JSON.parse(execFileSync('node', [triage, '--run', 'bare', '--json'],
    { cwd: repo, env, encoding: 'utf8' }));
} catch (e) { fail(`triage.mjs could not report on a run with no criteria: ${e.message}`); }
if (t.rung === 'verifier-pane') {
  fail('a run with no criteria on record was put on the verifier-pane rung. Nothing was '
     + 'measured, so nothing supports that rung — and letting absence escalate makes the '
     + 'un-scoped run the most expensive kind, which is the inversion this exists to stop.');
}
for (const l of Object.values(t.lanes)) {
  if (l.verifier_pane !== 'allowed') {
    fail('a lane with no criteria on file was refused its pane. Nothing is known about it, so '
       + 'nothing can be refused — the protocol gates on positive evidence, never on silence.');
  }
}

cleanup();
console.log('PASS triage-refuses-a-pointless-pane');
