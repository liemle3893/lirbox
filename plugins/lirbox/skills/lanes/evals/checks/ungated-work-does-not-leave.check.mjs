#!/usr/bin/env node
// Frozen check: ungated work does not leave the machine.
//
// The invariant, in one line: push, PR and merge-into-base are refused for a
// lane branch whose code gate is missing, self-produced, or failing.
//
// Why the hook and not transition.mjs. conductor's CodeGate is unskippable
// because its conductor is pure JS with no `fs` — the program decides and a
// failed gate throws. lanes has no program; the orchestrator IS the agent,
// holding Bash, and SKILL.md says so: "loom's gates are structural. Ours are
// procedural." A PreToolUse hook is the one exception, which is why the spawn
// door lives in one. A clause in transition.mjs would enforce nothing when
// nobody opens the door — and in the 2026-08 run transitions.jsonl stopped two
// days before the session ended.
//
// The pass condition is conductor's, field for field:
//     passed = gate_passed && build_exit === 0
// The flag is never trusted alone. A gate that reports gate_passed on a build
// that exited 1 is the single failure this mechanism exists to stop, so that
// combination gets its own arm below.
//
// Plus lanes' own rule, which conductor does not need: the producer may not be
// the implementor. A self-report can never be a gate, exactly as it can never
// become `verified`.
//
// GATE_GUARD_OVERRIDE points at the hook under test (set by prove-checks).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const hook = process.env.GATE_GUARD_OVERRIDE
  || join(here, '..', '..', '..', '..', 'hooks', 'gate-guard.sh');

// A hook that is not executable never runs: hooks.json invokes it as a bare
// path, the shell answers 126, and only exit 2 denies. This check invokes it as
// `zsh <file>`, which READS the file and bypasses the mode entirely — so the
// mode is invisible to every other arm here and to every declared mutation,
// because the mutation space is the script's text and this defect is its bits.
// Stat the REAL hook, never the override: the override points at prove-checks'
// temp mutant, whose mode says nothing about what ships.
const shippedHook = join(here, '..', '..', '..', '..', 'hooks', 'gate-guard.sh');
if (!(statSync(shippedHook).mode & 0o111)) {
  throw new Error(`${shippedHook} is not executable. hooks.json runs it as a bare path, so the `
    + 'shell returns 126 and the gate never denies anything. Every other arm below passes '
    + 'regardless, because they invoke it through `zsh <file>`. chmod +x and commit the mode.');
}

const tmp  = mkdtempSync(join(tmpdir(), 'gate-guard-'));
const repo = join(tmp, 'repo');
const home = join(tmp, 'home');
const cleanup = () => rmSync(tmp, { recursive: true, force: true });
const fail = (m) => { cleanup(); throw new Error(m); };

mkdirSync(repo, { recursive: true });
const git = (...a) => execFileSync('git', ['-C', repo, ...a], { stdio: 'pipe' });
git('init', '-q', '-b', 'main');
git('config', 'user.email', 'c@example.invalid');
git('config', 'user.name', 'check');
writeFileSync(join(repo, 'f'), 'x');
git('add', '-A'); git('commit', '-qm', 'base');
git('branch', 'lane-kb');

const root = execFileSync('git', ['-C', repo, 'rev-parse', '--show-toplevel'],
  { encoding: 'utf8' }).trim();
const key = execFileSync('git', ['-C', repo, 'rev-parse', '--path-format=absolute',
  '--git-common-dir'], { encoding: 'utf8' }).trim();
const slug = createHash('sha1').update(key).digest('hex').slice(0, 12);
mkdirSync(join(home, '.claude', 'lirbox-orchestrator'), { recursive: true });
writeFileSync(join(home, '.claude', 'lirbox-orchestrator', `${slug}.json`),
  JSON.stringify({ lanes: { base_branch: 'main' }, profiles: {} }, null, 2));

const env = { ...process.env, HOME: home };
const runDir = join(root, '.orchestration', 'r1');
const evid = join(runDir, 'evidence');

const verdict = (command, cwd = root) => {
  try {
    execFileSync('zsh', [hook], {
      input: JSON.stringify({
        agent_type: 'lirbox:lirbox-herdr-orchestrator', cwd, tool_input: { command },
      }),
      env, stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { code: 0, msg: '' };
  } catch (e) { return { code: e.status ?? 1, msg: (e.stderr || '').toString() }; }
};

// Every gate verdict is bound to the sha it reviewed. Default to the branch's
// real HEAD so each arm below isolates the thing it is actually testing; the
// binding itself gets its own arms at the end.
const laneSha = execFileSync('git', ['-C', repo, 'rev-parse', 'lane-kb'], { encoding: 'utf8' }).trim();
const setGate = (o) => {
  mkdirSync(evid, { recursive: true });
  writeFileSync(join(evid, 'g-code_gate.json'),
    JSON.stringify({ gated_sha: laneSha, ...o }));
};

// -- 0. no run store: the hook is invisible ---------------------------------
// Most repos never run a lane. A gate that fires there is a gate that gets
// disabled, and then it is not a gate anywhere.
if (verdict('git push origin lane-kb').code !== 0) {
  fail('the hook fired in a repo with no run store at all. It must be invisible '
     + 'outside a lane run — a guard that blocks ordinary work gets turned off.');
}

mkdirSync(join(runDir, 'dispatch'), { recursive: true });
writeFileSync(join(runDir, 'dispatch', 'kb.json'), JSON.stringify({
  lane: 'kb', agent_name: 'kb', branch: 'lane-kb', pane_id: 'wZ:p1', state: 'dispatched',
}));

const setTransitions = (rows) => writeFileSync(join(runDir, 'transitions.jsonl'),
  rows.map((x) => JSON.stringify(x)).join('\n') + '\n');
const DURABLE = [
  { lane: 'kb', from: 'dispatched', to: 'reported', reason: 'r', at: '2026-08-19T00:00:00Z' },
  { lane: 'kb', from: 'reported', to: 'durable', reason: 'committed', at: '2026-08-19T00:02:00Z' },
];
// Recorded from the start, so every arm below isolates ONE reason to deny.
// Without this the store arm masks them: a check that goes red for the wrong
// reason passes while the rule it names is gone. (prove-checks caught exactly
// that here, twice.)
setTransitions(DURABLE);

// -- 1. no gate artifact: nothing leaves ------------------------------------
for (const cmd of [
  'git push origin lane-kb',
  'gh pr create --base main --head lane-kb --title x --body y',
]) {
  const r = verdict(cmd, root);
  if (r.code !== 2) fail(`\`${cmd}\` was ALLOWED for a lane with no code gate at all.`);
  if (!/orch-lane\.sh gate/.test(r.msg)) {
    fail(`the denial does not name the way through: ${r.msg.trim()}`);
  }
}

// -- 2. a self-produced gate is not a gate ----------------------------------
setGate({ kind: 'code_gate', lane: 'kb', produced_by: 'kb',
  gate_passed: true, critical: 0, high: 0, build_cmd: 'make', build_exit: 0 });
let r = verdict('git push origin lane-kb');
if (r.code !== 2) {
  fail('a code gate produced BY the implementing lane was accepted. A self-report '
     + 'can never be a gate — the same rule that refuses reported -> verified.');
}
// Exit 2 alone does not prove the SELF rule is doing the work: with that branch
// removed, the same input falls through to the generic failure path and is
// denied anyway, for the wrong reason. Anchor on the reason, or this arm passes
// while the rule it names is gone. (Found by prove-checks as a false-green.)
if (!/self-report/i.test(r.msg)) {
  fail('the self-produced gate was refused, but not AS a self-report — the '
     + `denial never says so, so the independence rule may not be firing: ${r.msg.trim()}`);
}

// -- 3. THE ARM THAT MATTERS: gate_passed=true over a red build -------------
// conductor never trusts the flag alone; neither may this. A reviewer that
// reports success for a build it did not run is the exact failure mode.
setGate({ kind: 'code_gate', lane: 'kb', produced_by: 'gate-kb',
  gate_passed: true, critical: 0, high: 0, build_cmd: 'make', build_exit: 1 });
r = verdict('git push origin lane-kb');
if (r.code !== 2) {
  fail('gate_passed=true was accepted with build_exit=1. The flag alone is the '
     + 'honour system; conductor cross-checks a numeric build exit for exactly '
     + 'this reason, and so must this.');
}
// Anchor on the reason: denied-for-something-else would pass this arm while the
// build cross-check was gone.
if (!/build_exit=1/.test(r.msg)) {
  fail(`the red build was not what refused it — the denial does not report `
     + `build_exit=1, so the cross-check may not be firing: ${r.msg.trim()}`);
}

// -- 3c. the command parser, not just the verdict ---------------------------
// The first cut matched the ADJACENT pair `git push` and read the operand from
// a fixed slot. Every spelling below reached a lane with 2 Criticals and a red
// build. They are here because the check tested exactly the two spellings its
// author happened to write.
setGate({ lane: 'kb', kind: 'code_gate', produced_by: 'gate-kb',
  gate_passed: false, critical: 2, high: 1, build_cmd: 'make', build_exit: 1 });
for (const cmd of [
  'git push -u origin lane-kb',                      // a flag before the remote
  'git push --force-with-lease origin lane-kb',
  'git push origin HEAD:lane-kb',                    // a refspec
  'git push origin lane-kb:main',                    // lane written onto base
  `git -C ${repo} push origin lane-kb`,              // a git global option
  'gh pr create -H lane-kb --fill',                  // the short flag
  'gh pr merge lane-kb --squash',                    // no case arm at all
  'gh pr merge 12 --admin',                          // a PR number: fail closed
  'git merge --no-ff lane-kb',
  'git merge --squash lane-kb',
]) {
  if (verdict(cmd).code !== 2) {
    fail(`\`${cmd}\` was ALLOWED against a lane with 2 Criticals and a red build. `
       + 'The parser must resolve the ref structurally — skipping flags and global options, '
       + 'splitting refspecs — and FAIL CLOSED when it cannot, because an unparseable command '
       + 'becoming "not a lane" is an allow.');
  }
}

// -- 3d. and it must not over-block ----------------------------------------
// A guard that blocks ordinary work gets turned off, and then it guards nothing.
git('checkout', '-q', '-b', 'not-a-lane');
for (const cmd of ['git status', 'git log --oneline -5', 'git fetch origin', 'herdr agent list']) {
  if (verdict(cmd).code !== 0) fail(`\`${cmd}\` was denied — it moves nothing outward`);
}
git('checkout', '-q', 'main');
if (verdict('git push origin not-a-lane').code !== 0) {
  fail('a branch no dispatch record claims was gated; that is not this hook\'s business');
}

// -- 4. unresolved findings do not pass ------------------------------------
setGate({ kind: 'code_gate', lane: 'kb', produced_by: 'gate-kb',
  gate_passed: false, critical: 2, high: 1, build_cmd: 'make', build_exit: 0 });
if (verdict('git push origin lane-kb').code !== 2) {
  fail('a failing gate (2 Critical, 1 High) was pushed past');
}

// -- 5. the gate can pass and the STORE still not know ----------------------
// The store in the 2026-08 run was not wrong, it was EMPTY: transitions.jsonl
// stopped two days before the session ended. Nothing arriving as context fixes
// empty — only a door does. A reviewed, build-green lane the run never recorded
// is a lane the board cannot show and a successor would find still open.
setGate({ kind: 'code_gate', lane: 'kb', produced_by: 'gate-kb',
  gate_passed: true, critical: 0, high: 0, build_cmd: 'make', build_exit: 0 });

// The emptiest possible store: no transitions file at all.
rmSync(join(runDir, 'transitions.jsonl'));
r = verdict('git push origin lane-kb');
if (r.code !== 2) {
  fail('a lane whose gate passed but which the store never recorded was pushed. '
     + 'transitions.jsonl does not exist at all here.');
}
if (!/transition\.mjs/.test(r.msg)) {
  fail(`the denial does not name the command that records it: ${r.msg.trim()}`);
}

// Reaching `reported` is not reaching `durable`. Committed is the claim a push
// makes, so that is the row required.
setTransitions([
  { lane: 'kb', from: 'dispatched', to: 'reported', reason: 'r', at: '2026-08-19T00:00:00Z' },
]);
if (verdict('git push origin lane-kb').code !== 2) {
  fail('a lane recorded only as `reported` was pushed. durable is committed, and '
     + 'a push claims committed.');
}

// Bounded: ANOTHER lane's durable row must not satisfy this one. The predicate
// asks one question about the one branch being pushed — that boundedness is
// what keeps it from becoming the blocks-forever rule that inverting the Stop
// gate would have been.
setTransitions([
  { lane: 'kb', from: 'dispatched', to: 'reported', reason: 'r', at: '2026-08-19T00:00:00Z' },
  { lane: 'other', from: 'reported', to: 'durable', reason: 'r', at: '2026-08-19T00:01:00Z' },
]);
if (verdict('git push origin lane-kb').code !== 2) {
  fail("another lane's durable row satisfied this lane's requirement — the "
     + 'predicate is not scoped to the branch being pushed');
}

// -- 5b. recorded, gated, green: it goes through ---------------------------
setTransitions(DURABLE);
r = verdict('git push origin lane-kb');
if (r.code !== 0) {
  fail(`a lane with an independent, passing, build-green gate AND a durable row `
     + `was still blocked. A gate that blocks its own sanctioned path is the `
     + `reason the last one got routed around: ${r.msg.trim()}`);
}

// -- 5c. the gate is bound to the CODE it reviewed, not just to the lane ------
// This is what a reshapeable flow costs. A fixed pipeline gates once at the
// end; an orchestrator that can loop back through implementation can pass the
// gate, commit more, and still present the old PASS. Only the sha notices.
setGate({ lane: 'kb', kind: 'code_gate', produced_by: 'gate-kb',
  gate_passed: true, critical: 0, high: 0, build_cmd: 'make', build_exit: 0,
  gated_sha: '0000000000000000000000000000000000000000' });
r = verdict('git push origin lane-kb');
if (r.code !== 2) {
  fail('a gate verdict for a DIFFERENT commit was accepted. Loop back through implementation, '
     + 'commit, and the stale PASS ships — which is exactly the failure a dynamic flow makes '
     + 'reachable and a fixed pipeline does not.');
}
if (!/STALE|moved since/i.test(r.msg)) {
  fail(`refused, but not as STALE — the operator cannot tell a moved branch from a failed `
     + `review: ${r.msg.trim()}`);
}

// A verdict naming no sha cannot be checked against anything, so it is refused
// rather than trusted. Trusting it would reopen the hole for every old artifact.
mkdirSync(evid, { recursive: true });
writeFileSync(join(evid, 'g-code_gate.json'), JSON.stringify({
  lane: 'kb', kind: 'code_gate', produced_by: 'gate-kb',
  gate_passed: true, critical: 0, high: 0, build_cmd: 'make', build_exit: 0 }));
r = verdict('git push origin lane-kb');
if (r.code !== 2) {
  fail('a gate verdict with no gated_sha was accepted. Nothing says which code it reviewed, so '
     + 'it cannot be invalidated by a later commit — the binding becomes optional and therefore '
     + 'absent.');
}
// Anchor on the reason. With the UNBOUND branch removed, a null gated_sha falls
// through to the STALE comparison and is refused anyway — for the wrong reason,
// leaving this arm green while the rule it names is gone.
if (!/UNBOUND|names no gated_sha/i.test(r.msg)) {
  fail(`refused, but not as UNBOUND — a verdict that names no sha is being reported as something `
     + `else, so the missing-binding rule may not be firing at all: ${r.msg.trim()}`);
}
setGate({ lane: 'kb', kind: 'code_gate', produced_by: 'gate-kb',
  gate_passed: true, critical: 0, high: 0, build_cmd: 'make', build_exit: 0 });

// -- 6. a frozen DoD is held to, and only when the run declared one ----------
writeFileSync(join(runDir, 'dod.json'), JSON.stringify({ criteria: [] }));
if (verdict('gh pr create --base main --head lane-kb --title x --body y').code !== 2) {
  fail('a run that froze a definition of done published with no dod_gate artifact');
}
// A FAILING DoD was never tested: both arms (artifact absent / all_passed true)
// are satisfied by a hook that only asks whether the artifact EXISTS. The
// declared mutation for this rule reported PROVEN by dying on the absent-arm.
writeFileSync(join(evid, 'd-dod_gate.json'),
  JSON.stringify({ kind: 'dod_gate', all_passed: false, failed: ['criterion-2'] }));
r = verdict('gh pr create --base main --head lane-kb --title x --body y');
if (r.code !== 2) fail('a frozen DoD reporting all_passed:false was published anyway');
if (!/dod_gate\s+FAIL/.test(r.msg)) {
  fail(`refused, but not for the DoD — the denial does not report the DoD as FAIL, so the `
     + `all_passed predicate may not be firing: ${r.msg.trim()}`);
}

writeFileSync(join(evid, 'd-dod_gate.json'),
  JSON.stringify({ kind: 'dod_gate', all_passed: true }));
if (verdict('gh pr create --base main --head lane-kb --title x --body y').code !== 0) {
  fail('a run with a passing frozen DoD was still refused');
}

// -- 7. scope: routine work is not gated ------------------------------------
// Merging base INTO a lane is how a lane stays current. Gating it would make
// the guard fire constantly, and a guard that fires constantly gets overridden
// by reflex — at which point it stops guarding the case it was built for.
git('checkout', '-q', 'lane-kb');
if (verdict('git merge main').code !== 0) {
  fail('merging the base branch INTO a lane was gated. That is routine; only a '
     + 'merge that LANDS on the base branch is an outward act.');
}
git('checkout', '-q', 'main');
setGate({ kind: 'code_gate', lane: 'kb', produced_by: 'gate-kb',
  gate_passed: false, critical: 1, high: 0, build_cmd: 'make', build_exit: 0 });
if (verdict('git merge lane-kb').code !== 2) {
  fail('a failing lane was merged INTO the base branch — the one merge that is '
     + 'an outward act, and the one this guard exists for');
}

// -- 8. the escape is stated, not silent ------------------------------------
if (verdict('git push origin lane-kb # POLICY-OVERRIDE: hotfix, gate lane is wedged').code !== 0) {
  fail('POLICY-OVERRIDE was refused; a gate with no stated escape gets worked '
     + 'around silently instead of on the record');
}

cleanup();
console.log('ungated-work-does-not-leave: OK');
