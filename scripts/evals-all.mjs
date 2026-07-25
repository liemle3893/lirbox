#!/usr/bin/env node
/*
 * REPO-WIDE REGRESSION GATE — the thing that stops a fixed bug coming back.
 *
 * Every skill's frozen acceptance-checks are the durable residue of a bug that was already fixed
 * once. Until this script existed they only ran when a whetstone run happened to target that skill,
 * and even then only that run's own items — so a past fix could come undone with nothing watching.
 * That is not hypothetical: conductor's `book-under-flag` was fixed, verified, merged, then silently
 * re-accreted across seven consecutive runs before a human noticed by hand.
 *
 * This runs ALL of them, for EVERY skill, on every push and PR (.github/workflows/evals.yml).
 *
 * For each plugins/lirbox/skills/<skill>/evals/:
 *   1. FLOOR      — run.mjs must exit 0 (characterization: what worked before still works).
 *   2. MANIFEST   — checks-manifest.json must list every checks/*.check.mjs, both directions.
 *                   A check on disk but not in the manifest is an UNGUARDED check → failure.
 *   3. CHECKS     — expect "green" → MUST exit 0 (a past fix came undone if not).
 *                   expect "red"   → MUST exit 0 or 1; >=2 is harness rot (it failed to RUN).
 *                   A red check turning green NEVER fails — it prints a promote-me notice.
 *                   (Exact-match would be wrong: whetstone reverts anything that breaks the floor,
 *                   so demanding "red stays red" would revert the fix that resolves the concern.)
 *   4. NETS       — scripts/test-*.cjs generator regression nets (skipped under --fast; some clone
 *                   fixture bundles and run npm, which is minutes not milliseconds).
 *
 * Usage:
 *   node scripts/evals-all.mjs              # everything
 *   node scripts/evals-all.mjs --fast       # skip the slow generator nets
 *   node scripts/evals-all.mjs --skill conductor
 *   node scripts/evals-all.mjs --list       # what would run, run nothing
 *
 * Exit 0 iff every floor passed, every green check is green, every manifest is in sync, and no
 * check failed to run. Exit 1 otherwise. Exit 2 on usage/structural error.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const SKILLS = join(REPO, 'plugins', 'lirbox', 'skills');

const argv = process.argv.slice(2);
const has = (f) => argv.includes('--' + f);
const val = (f) => { const i = argv.indexOf('--' + f); return i > -1 ? argv[i + 1] : null; };
const FAST = has('fast');
const ONLY = val('skill');
const LIST = has('list');

const CHECK_TIMEOUT_MS = 180_000;
const NET_TIMEOUT_MS = 900_000;

let failures = [];
let promotes = [];
let ran = { floors: 0, checks: 0, nets: 0 };
const fail = (skill, msg) => { failures.push(`${skill}: ${msg}`); console.error(`  FAIL  ${msg}`); };

function run(cmd, args, timeout) {
  try {
    execFileSync(cmd, args, { cwd: REPO, stdio: 'pipe', timeout });
    return { code: 0 };
  } catch (e) {
    if (e.killed || e.signal) return { code: 124, out: `timed out after ${timeout}ms` };
    return { code: typeof e.status === 'number' ? e.status : 1, out: String(e.stdout || '') + String(e.stderr || '') };
  }
}

let skills;
try {
  skills = readdirSync(SKILLS).filter((d) => statSync(join(SKILLS, d)).isDirectory()).sort();
} catch (e) {
  console.error(`evals-all: cannot read ${SKILLS}: ${e.message}`);
  process.exit(2);
}
if (ONLY) {
  if (!skills.includes(ONLY)) { console.error(`evals-all: no such skill "${ONLY}"`); process.exit(2); }
  skills = [ONLY];
}

console.log(`Repo-wide regression gate — ${skills.length} skill(s)${FAST ? ' (--fast: generator nets skipped)' : ''}\n`);

for (const skill of skills) {
  const evals = join(SKILLS, skill, 'evals');
  const checksDir = join(evals, 'checks');
  const manifestPath = join(evals, 'checks-manifest.json');
  const floor = join(evals, 'run.mjs');

  const onDisk = existsSync(checksDir)
    ? readdirSync(checksDir).filter((f) => f.endsWith('.check.mjs')).map((f) => basename(f, '.check.mjs')).sort()
    : [];
  const hasFloor = existsSync(floor);
  if (!hasFloor && !onDisk.length) continue;   // skill carries no evals at all

  console.log(`── ${skill}`);
  if (LIST) {
    console.log(`   floor: ${hasFloor ? 'run.mjs' : '(none)'} | checks: ${onDisk.length} | manifest: ${existsSync(manifestPath) ? 'yes' : 'NO'}`);
    continue;
  }

  // ---- 1. floor ----
  if (hasFloor) {
    const r = run('node', [floor], CHECK_TIMEOUT_MS);
    ran.floors++;
    if (r.code === 0) console.log('  ok    floor');
    else fail(skill, `floor run.mjs exited ${r.code}\n${(r.out || '').split('\n').slice(-12).join('\n')}`);
  }

  if (!onDisk.length) { console.log(''); continue; }

  // ---- 2. manifest ----
  if (!existsSync(manifestPath)) {
    fail(skill, `${onDisk.length} frozen check(s) but NO evals/checks-manifest.json — they are unguarded: `
      + `nothing declares whether each should be green. Add one listing: ${onDisk.join(', ')}`);
    console.log('');
    continue;
  }
  let manifest;
  try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')); }
  catch (e) { fail(skill, `checks-manifest.json is not valid JSON: ${e.message}`); console.log(''); continue; }

  const entries = (manifest && manifest.checks) || {};
  const listed = Object.keys(entries).sort();
  const unlisted = onDisk.filter((c) => !listed.includes(c));
  const phantom = listed.filter((c) => !onDisk.includes(c));
  if (unlisted.length) fail(skill, `not in the manifest (unguarded): ${unlisted.join(', ')}`);
  if (phantom.length) fail(skill, `in the manifest but no such check file: ${phantom.join(', ')}`);

  // ---- 3. checks ----
  for (const name of onDisk) {
    const spec = entries[name];
    if (!spec) continue;                                   // already reported unlisted
    const expect = spec.expect;
    if (!['green', 'red'].includes(expect)) { fail(skill, `${name}: expect must be "green" or "red" (got ${JSON.stringify(expect)})`); continue; }

    const r = run('node', [join(checksDir, name + '.check.mjs')], CHECK_TIMEOUT_MS);
    ran.checks++;
    if (expect === 'green') {
      if (r.code === 0) console.log(`  ok    ${name} (green)`);
      else fail(skill, `${name}: expected GREEN, exited ${r.code}`
        + (r.code >= 2 ? ' — harness rot: the check failed to RUN' : ' — REGRESSION: a past fix came undone')
        + `\n${(r.out || '').split('\n').slice(-10).join('\n')}`);
    } else {
      if (r.code >= 2) fail(skill, `${name}: known-red check exited ${r.code} — harness rot: it failed to RUN, which hides whether the concern is still open`);
      else if (r.code === 0) { promotes.push(`${skill}/${name}`); console.log(`  ok    ${name} (red → now GREEN; promote it to "green")`); }
      else console.log(`  ok    ${name} (red, still open)`);
    }
  }
  console.log('');
}

// ---- 4. generator regression nets ----
if (!LIST && !FAST) {
  console.log('── generator regression nets');
  for (const skill of skills) {
    const sdir = join(SKILLS, skill, 'scripts');
    if (!existsSync(sdir)) continue;
    for (const f of readdirSync(sdir).filter((x) => /^test-.*\.cjs$/.test(x)).sort()) {
      const r = run('node', [join(sdir, f)], NET_TIMEOUT_MS);
      ran.nets++;
      if (r.code === 0) console.log(`  ok    ${skill}/${f}`);
      else fail(skill, `${f} exited ${r.code}\n${(r.out || '').split('\n').slice(-12).join('\n')}`);
    }
  }
  console.log('');
}

if (LIST) process.exit(0);

if (promotes.length) console.log(`NOTE: ${promotes.length} red check(s) now pass — promote to "green": ${promotes.join(', ')}\n`);

console.log(`ran ${ran.floors} floor(s), ${ran.checks} check(s), ${ran.nets} generator net(s)`);
if (failures.length) {
  console.error(`\nGATE RED — ${failures.length} failure(s):`);
  for (const f of failures) console.error(`  • ${f.split('\n')[0]}`);
  process.exit(1);
}
console.log('\nGATE GREEN — every floor passed and every guarded check holds.');
