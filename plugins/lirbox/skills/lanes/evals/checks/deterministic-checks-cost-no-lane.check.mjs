#!/usr/bin/env node
// Frozen check: every evidence record is FILED BY A COMMAND, and a deterministic
// criterion does not cost a pane.
//
// The invariant, in one line: the orchestrator prompt names every command
// evidence.mjs answers to, and says that re-running a deterministic check is one
// of them rather than a lane.
//
// Why. Two failures, one root. The first is authorship: the fields the contract
// distrusts — gated_sha, build_exit, merged_sha — were handed to a language model
// as a JSON template with a paragraph asking it to be honest about them. The
// second is economics: "never verify with your own hands" made independence a
// property of the HAND, so re-running `go test` cost a spawn, an install, a build
// and a context, once per lane. A change involving almost no code then takes
// hours, and the 9-90 minute end-to-end suite gets re-run to confirm a change it
// could not detect.
//
// Independence is about minds. A command with an exit code, re-run at the same
// sha, is verified by a different hand; what needs a different mind is whether
// the check can fail at all and whether the green means what the criterion says.
// So the split has to be in the prompt, and the mechanism has to exist.
//
// Derived, never a hardcoded list: a command added to evidence.mjs that the
// prompt never names is invisible to the orchestrator, which is exactly how
// `orch-lane.sh gate` shipped.
//
// EVIDENCE_OVERRIDE / ORCH_AGENT_OVERRIDE point at the files under test.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const plugin = join(here, '..', '..', '..', '..');
const evidencePath = process.env.EVIDENCE_OVERRIDE
  || join(plugin, 'skills', 'lanes', 'scripts', 'evidence.mjs');
const agentPath = process.env.ORCH_AGENT_OVERRIDE
  || join(plugin, 'agents', 'lirbox-herdr-orchestrator.md');

const fail = (m) => { throw new Error(m); };
const evidence = readFileSync(evidencePath, 'utf8');
const agent = readFileSync(agentPath, 'utf8');

// ---- derive: the commands evidence.mjs answers to ---------------------------
const cmds = [...evidence.matchAll(/cmd === '([a-z][a-z-]*)'/g)].map((m) => m[1]);
const uniq = [...new Set(cmds)];
if (uniq.length < 2) {
  fail(`only ${uniq.length} command(s) derived from evidence.mjs — the parse is broken, and a `
     + 'broken derivation makes this check vacuous rather than red.');
}

// ---- assert: the record-writing commands exist ------------------------------
for (const need of ['gate', 'report', 'verify']) {
  if (!uniq.includes(need)) {
    fail(`evidence.mjs no longer answers to '${need}'. Without it the record it wrote goes back to `
       + 'a JSON template a lane fills in by hand — including the fields the contract says not to '
       + 'trust, which is a request rather than a mechanism.');
  }
}

// ---- assert: the values that must be TAKEN are not accepted as flags --------
// The whole point is that these come from the checkout and from running the
// command. A flag for any of them is the template returning under another name.
for (const taken of ['gated_sha', 'merged_sha', 'build_exit', 'gate_passed', 'verified_sha']) {
  const flag = taken.replace(/_/g, '-');
  if (new RegExp(`flags\\['${flag}'\\]|flags\\.${taken}`).test(evidence)) {
    fail(`evidence.mjs accepts '${flag}' as a caller-supplied flag. That value is taken from the `
       + 'checkout or from running the command precisely because a caller reporting it is the '
       + 'failure the record exists to catch.');
  }
}
// Imported AND called. A token surviving somewhere in the file is not execution:
// the import can be cut while every call site still reads plausibly, and the
// record then carries numbers nothing ran.
if (!/import \{[^}]*\bspawnSync\b[^}]*\} from 'node:child_process'/.test(evidence)) {
  fail('evidence.mjs no longer imports spawnSync. build_exit and the verify exits become numbers '
     + 'it was told rather than values it took, which is where this started.');
}
if ((evidence.match(/spawnSync\(/g) || []).length < 2) {
  fail('evidence.mjs calls spawnSync fewer than twice — the gate build and the verify checks are '
     + 'both meant to be RUN here. One of them went back to being self-reported.');
}

// ---- assert: the orchestrator knows every one of them -----------------------
const missing = uniq.filter((c) => !new RegExp(`evidence\\.mjs\\s+${c}\\b`).test(agent));
if (missing.length) {
  fail(`the orchestrator prompt never names these evidence.mjs command(s): ${missing.join(', ')}.\n`
     + `  Derived from ${evidencePath}\n`
     + '  A command the prompt has never heard of is a command the orchestrator will not run — it\n'
     + '  will hand the lane a JSON shape instead, which is the thing this replaced.');
}

// ---- assert: the split is stated, and stated as costing no lane -------------
// Every mention gets a window, and one of them has to carry the rule. Anchoring
// on the FIRST occurrence is what broke agent-names-every-door when a second
// mention was added earlier in the file: the anchor moved, the window moved with
// it, and a check that was measuring something started measuring prose.
const windows = [...agent.matchAll(/evidence\.mjs verify/g)]
  .map((m) => agent.slice(Math.max(0, m.index - 1500), m.index + 1500));
if (!windows.length) fail('the prompt never names `evidence.mjs verify`');
const somewhere = (re) => windows.some((w) => re.test(w));
if (!somewhere(/deterministic/i)) {
  fail('the prompt names `evidence.mjs verify` but never says which criteria it is for. Without '
     + 'the deterministic/judgemental split the default stays one verifier pane per task, and a '
     + 'change involving almost no code costs N spawns, N installs and N builds for N exit codes.');
}
// Two invariants, asserted separately. As one OR they collapse: the prompt keeps
// saying a deterministic check needs no pane while the batching rule quietly goes,
// and one verifier per task returns under a sentence that reads like it forbade it.
if (!somewhere(/(does not need a pane|not need a pane|costs no pane)/)) {
  fail('the prompt never says a deterministic check costs no pane. Naming the command is not '
     + 'enough — the rule it replaces ("never verify with your own hands") reads as forbidding '
     + 'exactly this, so the prompt has to say which one wins.');
}
if (!/per WAVE, not per lane|per wave, not per lane/i.test(agent)) {
  fail('the prompt no longer batches verifiers per wave. One verifier pane per task is how a '
     + 'change involving almost no code costs N spawns, N installs, N builds and N contexts for '
     + 'N exit codes a script could have re-run in one.');
}
if (!/smallest scope that could go red|smallest scope/i.test(agent)) {
  fail('the prompt no longer scopes the re-run. Without it a 9-90 minute end-to-end suite gets '
     + 're-run per lane to confirm a change it could not detect — latency, not evidence.');
}
if (/Never verify with your own hands/.test(agent)) {
  fail('the prompt still carries "Never verify with your own hands". That makes independence a '
     + 'property of the hand rather than the mind, and it is what forced a spawn, an install, a '
     + 'build and a context for every `go test` that already had an exit code.');
}

console.log(`deterministic-checks-cost-no-lane: OK  (${uniq.length} evidence command(s), derived)`);
