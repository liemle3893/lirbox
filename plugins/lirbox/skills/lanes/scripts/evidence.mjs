#!/usr/bin/env node
// The writer for evidence records. Lanes run this; they do not author JSON.
//
// Before it, both briefs handed a lane a JSON template and asked it to fill in
// the fields — including the three the contract explicitly does not trust:
//
//   gated_sha    "read it, do not copy it from this brief"
//   merged_sha   the same sentence, in the conductor brief
//   build_exit   "read, not taken on trust ... report the exit code you observed"
//
// Three paragraphs of prose asking a language model to be honest about numbers
// a script can simply take. `build_exit` is the sharpest: the entire gate exists
// to stop a reviewer reporting a green build it never ran, and the enforcement
// was a request. So the values are TAKEN here, never accepted:
//
//   gated_sha / merged_sha   git rev-parse HEAD, in the checkout that ran this
//   build_exit               this script RUNS --build and records what it got
//   gate_passed              derived from critical/high/build_exit, not a field
//   produced_by              the lane argument, not a line the lane retypes
//
// What stays authored is what only the lane knows and no script can derive:
// finding counts, phase outcomes, forks, a summary. Judgement in, bookkeeping
// taken.
//
// Same shape as notes.mjs, which already owns its files for the same reason.
//
//   evidence.mjs gate   <lane> --run <slug> --build "<cmd>" [--critical N] [--high N]
//                              [--skipped "title::reason"]... --summary S
//   evidence.mjs report <lane> --run <slug> --base <ref> [--state <path>]
//                              [--phase "name::outcome"]... [--fork "q::chosen::overturn"]...
//                              --summary S
//   evidence.mjs verify <lane> --run <slug> --check "label::cmd"... --summary S
//                              [--produced-by <who>]
//
// `verify` is why a deterministic criterion does not cost a lane. Independence
// exists so the party checking a result is not the party that produced it — a
// command with an exit code, re-run at the same sha, satisfies that with a
// different HAND; it does not need a different MIND. Re-running `go test` inside
// a fresh agent context buys nothing over re-running it here and costs a spawn,
// an install, a build and a context. What a verifier LANE is for is the part a
// re-run cannot do: breaking the check on purpose, and judging whether the green
// means what the criterion says. Spend a lane on that, in batches, not on
// re-typing an exit code.
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const argv = process.argv.slice(2);
const die = (m) => { console.error(`evidence: ${m}`); process.exit(1); };

const cmd = argv[0], lane = argv[1];
if (!cmd || !lane || lane.startsWith('--')) {
  die('usage: evidence.mjs gate|report|verify <lane> --run <slug> ...');
}
const flags = {}, many = {};
for (let i = 2; i < argv.length; i++) {
  if (!argv[i].startsWith('--')) die(`unexpected argument: ${argv[i]}`);
  const k = argv[i].slice(2), v = argv[i + 1];
  if (v === undefined || v.startsWith('--')) die(`--${k} needs a value`);
  if (['skipped', 'phase', 'fork', 'check'].includes(k)) (many[k] ??= []).push(v);
  else flags[k] = v;
  i++;
}

const run = flags.run || die('--run <slug> names the run this record belongs to');
const summary = flags.summary || die('--summary is the one line a board shows');

// The repo root of the checkout this was RUN IN — not a path passed in. A record
// written about a tree the lane was not standing in is the failure the gate's
// "you did not write this code" clause is about, one level down.
let root;
try {
  root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
} catch { die('not inside a git checkout — a record with no tree behind it says nothing'); }
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim();

// .orchestration lives in the MAIN repo, not in a lane's worktree: the run
// outlives any one checkout, and a record filed inside a worktree disappears
// with it.
const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'],
  { encoding: 'utf8' }).trim();
const mainRepo = resolve(common, '..');
const evid = join(mainRepo, '.orchestration', run, 'evidence');
mkdirSync(evid, { recursive: true });

const pairs = (key, n) => (many[key] || []).map((s) => {
  const parts = s.split('::');
  if (parts.length !== n) die(`--${key} takes ${n} fields separated by :: — got ${parts.length} in "${s}"`);
  return parts.map((p) => p.trim());
});

let record, out;
if (cmd === 'gate') {
  const build = flags.build || die('--build "<cmd>" is required: the exit code is TAKEN from '
    + 'running it here, never reported. A gate that passes over a build it did not run is the '
    + 'one failure the whole mechanism exists to stop.');
  const critical = Number(flags.critical ?? 0), high = Number(flags.high ?? 0);
  if (!Number.isInteger(critical) || !Number.isInteger(high) || critical < 0 || high < 0) {
    die('--critical and --high are counts of findings still UNRESOLVED after your fixes');
  }
  console.error(`evidence: running the build to take its exit code — ${build}`);
  const r = spawnSync(build, { shell: true, stdio: 'inherit', cwd: root });
  const buildExit = r.status ?? 1;
  record = {
    kind: 'code_gate', lane, produced_by: flags['produced-by'] || `gate-${lane}`,
    gated_sha: sha, branch,
    // Derived, not declared. A caller cannot hand this one in.
    gate_passed: critical === 0 && high === 0 && buildExit === 0,
    critical, high, build_cmd: build, build_exit: buildExit,
    skipped: pairs('skipped', 2).map(([title, reason]) => ({ title, reason })),
    summary, written_at: new Date().toISOString(),
  };
  out = join(evid, `gate-${lane}-code_gate.json`);
} else if (cmd === 'report') {
  const base = flags.base || die('--base <ref> is required: it is what "this branch is not empty" '
    + 'is measured against');
  // The merge-back, enforced instead of instructed. A conductor lane commits to
  // wf/<name>; if that never landed here, the branch the code gate reviews is
  // empty and the gate passes over nothing. Refuse to file a report that claims
  // work on a branch carrying none.
  let ahead;
  try {
    ahead = execFileSync('git', ['rev-list', '--count', `${base}..HEAD`], { encoding: 'utf8' }).trim();
  } catch { die(`base '${base}' does not resolve in ${root}`); }
  if (Number(ahead) === 0) {
    die(`branch '${branch}' is not ahead of '${base}' — it carries no commits.\n`
      + `  Nothing was filed. If a workflow committed to its own branch, merge it here first:\n`
      + `    git merge --no-ff <that branch>\n`
      + `  A report over an empty branch produces a code gate that reviews an empty diff\n`
      + `  and reports a clean pass.`);
  }
  record = {
    kind: 'report', lane, produced_by: flags['produced-by'] || lane,
    merged_sha: sha, branch, base, commits_ahead: Number(ahead),
    state_file: flags.state || null,
    phases: pairs('phase', 2).map(([name, outcome]) => ({ name, outcome })),
    forks: pairs('fork', 3).map(([fork, chosen, would_overturn]) => ({ fork, chosen, would_overturn })),
    summary, written_at: new Date().toISOString(),
  };
  out = join(evid, `${lane}-report.json`);
} else if (cmd === 'verify') {
  const checks = pairs('check', 2);
  if (!checks.length) die('--check "label::command" at least once — verifying nothing is not verifying');
  const producedBy = flags['produced-by'] || `verify@${process.env.USER || 'host'}`;
  if (producedBy === lane) {
    die(`--produced-by cannot be the lane itself (${lane}). A self-report never becomes verified, `
      + 'and that is the one transition the store refuses outright.');
  }
  // Verifying a tree that has moved is the failure this guards. The lane's own
  // report names the sha it filed; if HEAD is elsewhere, the numbers about to be
  // taken describe different code.
  const reportPath = join(evid, `${lane}-report.json`);
  if (existsSync(reportPath)) {
    let reported;
    try { reported = JSON.parse(readFileSync(reportPath, 'utf8')).merged_sha; } catch { reported = null; }
    if (reported && reported !== sha) {
      die(`the lane reported ${reported.slice(0, 8)} and this checkout is at ${sha.slice(0, 8)}.\n`
        + '  Whatever these checks return would describe different code than the one filed.\n'
        + `  Check out ${reported.slice(0, 8)} here, or have the lane re-report.`);
    }
  }
  const results = checks.map(([label, command]) => {
    console.error(`evidence: ${label} — ${command}`);
    const r = spawnSync(command, { shell: true, stdio: 'inherit', cwd: root });
    return { label, cmd: command, exit: r.status ?? 1 };
  });
  record = {
    kind: 'verification', lane, produced_by: producedBy,
    verified_sha: sha, branch,
    // Derived from the exits observed here. There is no field for a verdict.
    passed: results.every((r) => r.exit === 0),
    checks: results, summary, written_at: new Date().toISOString(),
  };
  out = join(evid, `${lane}-verification.json`);
} else {
  die(`unknown command '${cmd}' — gate | report | verify`);
}

writeFileSync(out, JSON.stringify(record, null, 2) + '\n');
console.log(out);
if (cmd === 'verify' && !record.passed) {
  const red = record.checks.filter((c) => c.exit !== 0).map((c) => `${c.label}=${c.exit}`).join(' ');
  console.error(`evidence: passed=false (${red}). Recorded, not hidden.`);
}
if (cmd === 'gate' && !record.gate_passed) {
  console.error(`evidence: gate_passed=false (critical=${record.critical} high=${record.high} `
    + `build_exit=${record.build_exit}). Recorded, not hidden.`);
}
