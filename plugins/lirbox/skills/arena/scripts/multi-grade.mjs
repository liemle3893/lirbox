#!/usr/bin/env node
/*
 * MULTI-DIMENSION GRADER — scores a delivered result on the axes conductor actually claims,
 * not on correctness alone.
 *
 * WHY. swe-grade.mjs emits ONE verdict: hidden F2P green + fixture P2P green. That is "did the
 * feature get built", and a bare `claude -p` session does that trivially — measured 2026-08-01,
 * 7/7 registered tasks resolved raw, five of them under 90s. On that axis the suite is saturated
 * and lift is bounded at zero. But conductor's pitch was never correctness alone; it is docs,
 * isolation, and delivery against a recorded definition of done. Those three had never been
 * measured on any task by any arm. This grader measures them.
 *
 * === THE FAIRNESS RULE, and it is the whole design ===
 * A dimension is only admissible if BOTH arms were ASKED for it and BOTH arms COULD satisfy it.
 * Grading "does docs/changes/<name>/ exist" would score raw 0 by construction — that measures
 * "did you run conductor", not "did you deliver well", and the resulting lift would be an artefact
 * of the question. So:
 *   - every anchor below is GENERIC (any committed prose; any branch; any recorded criteria),
 *     never conductor's specific paths or filenames;
 *   - the caller MUST give both arms the same deliverable list (see --prompt-contract), and the
 *     raw arm must be re-run under that contract rather than compared against an older run that
 *     was never asked.
 * Violating either turns a measurement into a rigged demo.
 *
 * DIMENSIONS (each 0..1, all deterministic — no judge; a stochastic judge must never contribute
 * to a scalar a loop keeps or reverts on):
 *   correctness  delegated to swe-grade.mjs: F2P passed/total, zeroed if P2P regressed
 *   docs         committed prose describing the change (any path, any of .md/.html/.txt)
 *   isolation    work committed on a non-base ref with a clean tree; base left untouched
 *   dod          acceptance criteria recorded (>=2 enumerated), plus verification evidence
 *
 * Usage:
 *   node multi-grade.mjs --task <id> --repo <clone-dir> [--base <sha>] [--json]
 * Exit 0 always (a low score is a result). Exit 2 on setup error only.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, existsSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..', '..', '..');
const SUITE = JSON.parse(readFileSync(join(REPO, 'plugins/lirbox/skills/conductor/arena/suite.json'), 'utf8'));

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); const v = process.argv[i + 1]; return i > -1 ? (v && !v.startsWith('--') ? v : true) : d; };
const die = (m) => { console.error('multi-grade: ' + m); process.exit(2); };

const taskId = arg('task'); if (!taskId || taskId === true) die('--task <id> required');
const clone = arg('repo'); if (!clone || clone === true) die('--repo <clone-dir> required');
const task = SUITE.tasks.find((t) => t.id === taskId); if (!task) die(`unknown task ${taskId}`);
const BASE = String(arg('base', task.sha));

const git = (...a) => { try { return execFileSync('git', ['-C', clone, ...a], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); } catch { return ''; } };

// ---- which ref carries the delivery -------------------------------------------------
// Prefer a branch that is AHEAD of base (any name — never assume conductor's `wf/`).
const branches = git('branch', '--format=%(refname:short)').split('\n').map((s) => s.trim()).filter(Boolean);
let deliveryRef = null;
for (const b of branches) {
  const ahead = git('rev-list', '--count', `${BASE}..${b}`).trim();
  if (Number(ahead) > 0) { deliveryRef = b; break; }
}
const dirty = git('status', '--porcelain').split('\n').filter(Boolean).length;

// ---- correctness: delegate, never re-implement ---------------------------------------
const work = mkdtempSync(join(tmpdir(), 'multi-grade-'));
const diffPath = join(work, 'delivery.diff');
if (deliveryRef) {
  writeFileSync(diffPath, git('diff', BASE, deliveryRef));
} else {
  git('add', '-A');
  writeFileSync(diffPath, git('diff', '--cached', BASE));
}
const g = spawnSync('node', [join(HERE, 'swe-grade.mjs'), '--task', taskId, '--diff', diffPath], { encoding: 'utf8' });
let correctness = 0, f2p = null, p2p = null;
try {
  const grade = JSON.parse(g.stdout);
  f2p = grade.f2p; p2p = grade.p2p;
  correctness = (p2p && p2p.pass === false) ? 0 : (f2p && f2p.total ? f2p.passed / f2p.total : 0);
} catch { /* correctness stays 0; reported below as ungraded */ }

// ---- the delivered file set ----------------------------------------------------------
const nameStatus = (deliveryRef ? git('diff', '--name-status', BASE, deliveryRef) : git('diff', '--cached', '--name-status', BASE))
  .split('\n').map((l) => l.trim()).filter(Boolean)
  .map((l) => { const [st, ...rest] = l.split(/\s+/); return { st, path: rest.join(' ') }; });
const added = nameStatus.filter((f) => f.st.startsWith('A')).map((f) => f.path);
const touched = nameStatus.map((f) => f.path);
const readAt = (p) => { try { return deliveryRef ? git('show', `${deliveryRef}:${p}`) : readFileSync(join(clone, p), 'utf8'); } catch { return ''; } };

// ---- docs: any committed prose that actually describes THIS change --------------------
// Generic on purpose: any path, any of .md/.html/.txt. Substance is required so an empty
// placeholder cannot score — but the bar is "a human could learn what changed", not a format.
const PROSE = new Set(['.md', '.html', '.txt']);
const proseFiles = added.filter((p) => PROSE.has(extname(p).toLowerCase()) && !/^(test|tests|spec)\//.test(p));
let docs = 0;
const docEvidence = [];
for (const p of proseFiles) {
  const body = readAt(p);
  if (body.length < 200) { docEvidence.push(`${p} (thin, ${body.length}b)`); docs = Math.max(docs, 0.5); continue; }
  // does it reference something that actually changed? (a touched source path or its basename)
  const refsChange = touched.some((t) => t !== p && (body.includes(t) || body.includes(t.split('/').pop())));
  docEvidence.push(`${p} (${body.length}b${refsChange ? ', references changed files' : ', generic'})`);
  docs = Math.max(docs, refsChange ? 1 : 0.5);
}
if (!proseFiles.length) docEvidence.push('no committed prose file added');

// ---- isolation: branch + clean tree + base untouched ----------------------------------
let isolation = 0;
const isoEvidence = [];
if (deliveryRef) { isolation += 0.5; isoEvidence.push(`work on ref '${deliveryRef}'`); }
else isoEvidence.push('no branch ahead of base — edits made in place');
if (dirty === 0) { isolation += 0.5; isoEvidence.push('working tree clean (committed)'); }
else isoEvidence.push(`working tree dirty (${dirty} uncommitted path(s))`);

// ---- dod: criteria recorded, plus evidence they were checked -------------------------
// Enumerated criteria in any committed prose OR in the delivery's commit messages.
const commitMsgs = deliveryRef ? git('log', '--format=%B', `${BASE}..${deliveryRef}`) : '';
const criteriaSources = [...proseFiles.map((p) => ({ where: p, body: readAt(p) })), { where: 'commit messages', body: commitMsgs }];
const ENUM = /(^|\n)\s*(?:[-*]\s*\[[ xX]\]|\d+[.)]\s+|[-*]\s+)/g;
const VERIFIED = /\b(verified|passing|passes|all tests? pass|green|confirmed|✓|✅|\[x\])\b/i;
let dod = 0;
const dodEvidence = [];
for (const src of criteriaSources) {
  if (!src.body) continue;
  const n = (src.body.match(ENUM) || []).length;
  if (n < 2) continue;
  const verified = VERIFIED.test(src.body);
  dodEvidence.push(`${src.where}: ${n} enumerated item(s)${verified ? ' + verification evidence' : ''}`);
  dod = Math.max(dod, verified ? 1 : 0.5);
}
if (!dodEvidence.length) dodEvidence.push('no enumerated acceptance criteria found in prose or commit messages');

rmSync(work, { recursive: true, force: true });

const out = {
  task: taskId,
  deliveryRef: deliveryRef || null,
  dimensions: {
    correctness: Number(correctness.toFixed(4)),
    docs: Number(docs.toFixed(4)),
    isolation: Number(isolation.toFixed(4)),
    dod: Number(dod.toFixed(4)),
  },
  mean: Number(((correctness + docs + isolation + dod) / 4).toFixed(4)),
  evidence: { correctness: { f2p, p2p }, docs: docEvidence, isolation: isoEvidence, dod: dodEvidence },
};

if (arg('json', false)) console.log(JSON.stringify(out));
else {
  console.log(`${taskId}  ref=${out.deliveryRef || '(none — in-place)'}`);
  for (const [k, v] of Object.entries(out.dimensions)) console.log(`  ${k.padEnd(12)} ${v.toFixed(2)}`);
  console.log(`  ${'mean'.padEnd(12)} ${out.mean.toFixed(2)}`);
  for (const [k, ev] of Object.entries(out.evidence)) {
    if (k === 'correctness') continue;
    for (const e of ev) console.log(`     ${k}: ${e}`);
  }
}
