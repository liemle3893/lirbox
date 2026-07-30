#!/usr/bin/env node
// PROVE-CHECKS — mutation-test the frozen acceptance checks.
//
// The gap this closes. `floor/06-checks-manifest.test.mjs` enforces that a check labelled `green`
// exits 0. It cannot tell a check that PASSES because the behaviour is present from one that passes
// because it stopped looking. Both happened in this repo:
//
//   * dodgate-plan-of-record #7 claimed "a null item result hard-fails the phase". When the
//     behaviour became record-and-continue it kept passing on a substring match (`deadItems` near
//     some `throw`) — a FALSE GREEN that survived a full whetstone run.
//   * judged-dod-report-vulnerable anchored on `dodLast = await agent(`; a refactor moved the call
//     into a parallel() thunk and it reported a regression in a prompt nobody had touched — a FALSE
//     RED.
//
// Both were assertions coupled to INCIDENTAL structure (a variable name, a nearby token) rather than
// to an invariant. A check is only trustworthy if you have seen it fail for the right reason, and
// that has to be re-established after every refactor — not once, when it was written.
//
// How it works. For each `mutations` entry in a skill's checks-manifest.json:
//   1. copy the whole skill tree to a scratch dir (the real tree is never touched),
//   2. apply one literal find/replace to a file in the COPY — the mutation must match exactly once,
//      so a stale mutation fails loudly instead of silently doing nothing,
//   3. run the check with `env` pointed at the mutated file,
//   4. require exit 1 (RED). Exit 0 means the check did not notice — it is not measuring.
//      Exit >=2 is harness rot: it failed to run at all, which proves nothing either way.
//
// Manifest shape (optional per check; absent = UNPROVEN, reported, never a hard failure yet):
//
//   "dodgate-plan-of-record": {
//     "expect": "green",
//     "mutations": [
//       { "why": "assertion 7 must notice the ok flag disappearing",
//         "env": "GEN_OVERRIDE",
//         "file": "scripts/scaffold-workflow.cjs",
//         "find": "ok: it.ok,", "replace": "" }
//     ]
//   }
//
// `env` names the variable the check reads to locate the artifact under test; the script sets it to
// the mutated file's path inside the copy. A check with no such escape hatch cannot be mutation-
// proven — that is a property of the check, and the report says so rather than pretending.
//
// Usage:  node scripts/prove-checks.mjs [--skill conductor] [--strict]
//         --strict  exit 1 if any declared mutation fails to produce RED (for CI)
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i === -1 ? d : argv[i + 1]; };
const STRICT = argv.includes('--strict');
const SKILL = arg('skill', 'conductor');

const SKILL_DIR = join(REPO, 'plugins/lirbox/skills', SKILL);
const MANIFEST = join(SKILL_DIR, 'evals/checks-manifest.json');
if (!existsSync(MANIFEST)) {
  console.error(`no manifest at ${MANIFEST}`);
  process.exit(2);
}
const checks = JSON.parse(readFileSync(MANIFEST, 'utf8')).checks;

let proven = 0, failed = 0, rot = 0;
const unproven = [];

for (const [name, entry] of Object.entries(checks)) {
  const muts = entry.mutations;
  if (!Array.isArray(muts) || muts.length === 0) { unproven.push(name); continue; }
  const checkFile = join(SKILL_DIR, 'evals/checks', `${name}.check.mjs`);
  if (!existsSync(checkFile)) { console.log(`ROT   ${name} — no such check file`); rot++; continue; }

  for (const m of muts) {
    const tmp = mkdtempSync(join(tmpdir(), `prove-${name}-`));
    const copy = join(tmp, 'skill');
    try {
      cpSync(SKILL_DIR, copy, { recursive: true });
      const target = join(copy, m.file);
      const before = readFileSync(target, 'utf8');
      const hits = before.split(m.find).length - 1;
      if (hits !== 1) {
        console.log(`ROT   ${name} — mutation "${m.why}" matched ${hits}x (need exactly 1); it is stale`);
        rot++;
        continue;
      }
      writeFileSync(target, before.replace(m.find, m.replace));

      let code = 0;
      try {
        execFileSync('node', [checkFile], {
          cwd: REPO, stdio: 'pipe',
          env: { ...process.env, [m.env]: target },
        });
      } catch (e) { code = typeof e.status === 'number' ? e.status : 1; }

      if (code === 1) { console.log(`PROVEN ${name} — RED when: ${m.why}`); proven++; }
      else if (code === 0) { console.log(`FALSE-GREEN ${name} — still passed when: ${m.why}`); failed++; }
      else { console.log(`ROT   ${name} — exit ${code} (failed to run) when: ${m.why}`); rot++; }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
}

console.log(`\n${SKILL}: ${proven} proven, ${failed} false-green, ${rot} harness-rot, ${unproven.length} unproven`);
if (unproven.length) {
  console.log(`unproven (no mutations declared — these are trusted on faith):\n  ${unproven.join('\n  ')}`);
}
if (failed || rot) {
  console.error(`\nFAIL: ${failed} check(s) did not notice their own invariant being removed; ${rot} could not run.`);
  process.exit(1);
}
if (STRICT && proven === 0) {
  console.error('\nFAIL (--strict): no mutation proofs declared at all.');
  process.exit(1);
}
console.log('OK — every declared mutation produced a RED.');
process.exit(0);
