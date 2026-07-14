#!/usr/bin/env node
/*
 * SWE-bench-style grader for arena fixture tasks — rung-1 (test-verified) grading of a delivered diff.
 *
 * Pattern (mirrors SWE-bench): each task ships a HIDDEN `grader/` dir (never given to the agent):
 *   grader/fail_to_pass/*.test.cjs   # RED on the base commit, GREEN iff the feature is correctly built
 *   (PASS_TO_PASS = the fixture's own `npm test` — must STAY green after the diff)
 *
 * Verdict: resolved = (all PASS_TO_PASS still pass) AND (all FAIL_TO_PASS now pass).
 *
 * Modes:
 *   node swe-grade.mjs --task <id> --diff <path.diff>     # grade a delivered diff (git apply onto base)
 *   node swe-grade.mjs --task <id> --repo <dir> --ref <branch>   # grade a wf/ branch in an existing clone
 *   node swe-grade.mjs --task <id> --validate              # discrimination gate: on the UNMODIFIED base,
 *                                                          #   PASS_TO_PASS must PASS and every FAIL_TO_PASS
 *                                                          #   must FAIL (else the grader can't discriminate)
 *
 * Output: one JSON line on stdout:
 *   { task, mode, p2p: {pass}, f2p: {passed, total, failures[]}, resolved }   exit 0 iff resolved
 *   (--validate: { task, mode:"validate", p2pGreenOnBase, f2pRedOnBase:{red,total,leaks[]}, ok } exit 0 iff ok)
 *
 * Zero-dep, worker-side (fs/git allowed here — this is NOT the restricted conductor layer).
 * Anti-gaming: F2P tests are injected AFTER the diff is applied, into a scratch dir the agent never saw;
 * pass the task CONTENT (not a path near grader/) to agents so hidden tests stay hidden.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, mkdirSync, mkdtempSync, cpSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..', '..', '..'); // lirbox repo root
const TASKS_DIR = join(REPO_ROOT, 'plugins', 'lirbox', 'skills', 'conductor', 'arena', 'tasks');

function arg(name, def) { const i = process.argv.indexOf('--' + name); const v = process.argv[i + 1]; return i > -1 ? (v && !v.startsWith('--') ? v : true) : def; }
function die(msg, code = 2) { console.error('swe-grade: ' + msg); process.exit(code); }

const task = arg('task');
if (!task || task === true) die('usage: swe-grade.mjs --task <id> [--diff <path> | --repo <dir> --ref <branch> | --validate]');
const taskDir = join(TASKS_DIR, task);
if (!existsSync(taskDir)) die(`unknown task "${task}" (no ${taskDir})`);
const ref = JSON.parse(readFileSync(join(taskDir, 'repo.ref'), 'utf8'));
const bundle = join(taskDir, ref.bundle);
const baseSha = ref.sha;
const graderDir = join(taskDir, 'grader');
const f2pDir = join(graderDir, 'fail_to_pass');
if (!existsSync(f2pDir)) die(`task "${task}" has no grader/fail_to_pass/ — not SWE-gradeable yet`);

const validate = !!arg('validate', false);
const diffPath = arg('diff');
const srcRepo = arg('repo');
const srcRef = arg('ref');

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}
function tryRun(cmd, args, opts = {}) {
  try { sh(cmd, args, opts); return { ok: true }; }
  catch (e) { return { ok: false, out: ((e.stdout || '') + (e.stderr || '')).slice(-500) }; }
}

// --- materialize the graded tree ---
const work = mkdtempSync(join(tmpdir(), 'swe-grade-'));
const clone = join(work, 'clone');
sh('git', ['clone', '-q', bundle, clone]);
sh('git', ['-C', clone, 'checkout', '-q', baseSha]);

if (!validate) {
  if (diffPath && diffPath !== true) {
    const apply = tryRun('git', ['-C', clone, 'apply', '--whitespace=nowarn', resolve(String(diffPath))]);
    if (!apply.ok) {
      console.log(JSON.stringify({ task, mode: 'diff', resolved: false, error: 'diff-does-not-apply', detail: apply.out }));
      rmSync(work, { recursive: true, force: true });
      process.exit(1);
    }
  } else if (srcRepo && srcRef) {
    // Pull the delivered tree from a wf/ branch of an existing clone (conductor delivers there).
    const patch = sh('git', ['-C', resolve(String(srcRepo)), 'diff', baseSha, String(srcRef)]);
    const pfile = join(work, 'wf.patch');
    writeFileSync(pfile, patch);
    const apply = tryRun('git', ['-C', clone, 'apply', '--whitespace=nowarn', pfile]);
    if (!apply.ok) {
      console.log(JSON.stringify({ task, mode: 'ref', resolved: false, error: 'diff-does-not-apply', detail: apply.out }));
      rmSync(work, { recursive: true, force: true });
      process.exit(1);
    }
  } else {
    die('grading mode needs --diff <path> or --repo <dir> --ref <branch> (or use --validate)');
  }
}

// --- PASS_TO_PASS: the fixture's own suite ---
const p2p = tryRun('npm', ['test', '--silent'], { cwd: clone });

// --- FAIL_TO_PASS: inject hidden tests AFTER the diff, run each ---
const hidden = join(clone, '.swe-hidden');
mkdirSync(hidden, { recursive: true });
const f2pTests = readdirSync(f2pDir).filter((f) => f.endsWith('.test.cjs')).sort();
if (!f2pTests.length) die('grader/fail_to_pass/ has no *.test.cjs');
const f2pResults = [];
for (const t of f2pTests) {
  cpSync(join(f2pDir, t), join(hidden, t));
  const r = tryRun('node', [join(hidden, t)], { cwd: clone });
  f2pResults.push({ test: t, pass: r.ok, ...(r.ok ? {} : { out: r.out }) });
}

rmSync(work, { recursive: true, force: true });

if (validate) {
  // Discrimination gate: base must be P2P-green and F2P-RED (every hidden test fails on base).
  const leaks = f2pResults.filter((r) => r.pass).map((r) => r.test);
  const ok = p2p.ok && leaks.length === 0;
  console.log(JSON.stringify({ task, mode: 'validate', p2pGreenOnBase: p2p.ok, f2pRedOnBase: { red: f2pResults.length - leaks.length, total: f2pResults.length, leaks }, ok }));
  process.exit(ok ? 0 : 1);
}

const passed = f2pResults.filter((r) => r.pass).length;
const failures = f2pResults.filter((r) => !r.pass).map((r) => ({ test: r.test, out: r.out }));
const resolved = p2p.ok && passed === f2pResults.length;
console.log(JSON.stringify({ task, mode: diffPath ? 'diff' : 'ref', p2p: { pass: p2p.ok }, f2p: { passed, total: f2pResults.length, failures }, resolved }));
process.exit(resolved ? 0 : 1);
