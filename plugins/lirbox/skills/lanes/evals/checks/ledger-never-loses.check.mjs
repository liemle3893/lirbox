#!/usr/bin/env node
// Frozen check: the run ledger cannot lose an entry, and cannot accept one that
// is missing the field which makes it actionable.
//
// The invariant, in one line: an append-only ledger is only worth having if the
// schema refuses incomplete entries and superseding never deletes.
//
// Four things it holds down, each a rule the orchestrator prompt previously only
// asked for politely — and therefore skipped under context pressure:
//
//   1. superseding preserves the original       ("withdrawn, not deleted")
//   2. a finding needs --cmd or --unproven      ("put the command beside the claim")
//   3. a decision needs --would-overturn        (a successor can act on a condition,
//                                                not on "chose option 1")
//   4. only a decision can be acked, and the ack records who
//
// NOTES_OVERRIDE points at the script under test (set by prove-checks).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const script = process.env.NOTES_OVERRIDE
  || join(here, '..', '..', 'scripts', 'notes.mjs');

const repo = mkdtempSync(join(tmpdir(), 'lanes-ledger-'));
mkdirSync(join(repo, '.orchestration', 'r1'), { recursive: true });

const cleanup = () => rmSync(repo, { recursive: true, force: true });
const fail = (m) => { cleanup(); throw new Error(m); };

const run = (...args) => {
  try {
    return { code: 0, out: execFileSync(process.execPath, [script, ...args], {
      cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) { return { code: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') }; }
};

const ledger = () => readFileSync(join(repo, '.orchestration/r1/notes.jsonl'), 'utf8')
  .trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));

const model = () => {
  const html = readFileSync(join(repo, '.orchestration/r1/implementation-notes.html'), 'utf8');
  const m = html.match(/<script id="ledger"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) fail('rendered view has no inlined ledger payload');
  return JSON.parse(m[1].replace(/\\u003c/g, '<'));
};

const idOf = (needle) => {
  const hit = ledger().filter((e) => e.title && e.title.includes(needle));
  if (!hit.length) fail(`no entry titled like "${needle}"`);
  return hit[hit.length - 1].id;
};

// -- 2. the finding gate -----------------------------------------------------
if (run('add', 'finding', '--title', 'inferred, never run').code === 0) {
  fail('a finding with neither --cmd nor --unproven was accepted — an inference now sits in the record in the same register as a measurement');
}
if (run('add', 'finding', '--title', 'measured', '--cmd', 'true', '--result', 'exit 0').code !== 0) {
  fail('a finding WITH --cmd was refused');
}
if (run('add', 'finding', '--title', 'honest guess', '--unproven').code !== 0) {
  fail('a finding explicitly marked --unproven was refused');
}

// -- 3. the decision gate ----------------------------------------------------
if (run('add', 'decision', '--title', 'capable over context', '--chosen', 'capable').code === 0) {
  fail('a decision with no --would-overturn was accepted — a successor cannot act on it');
}
if (run('add', 'decision', '--title', 'verifier on gadget-execution', '--lane', 'v',
  '--would-overturn', 'storage work recurs').code !== 0) {
  fail('a decision WITH --would-overturn was refused');
}

// A blocked lane with no reason defeats the one column the Now table exists for.
if (run('lane', 'v', '--status', 'blocked').code === 0) {
  fail('a blocked lane with no --blocked-on was accepted — the Now table would show a block with no question');
}

// -- 1. superseding preserves ------------------------------------------------
const original = idOf('verifier on gadget-execution');
if (run('supersede', original, '--title', 'verifier spawns against a SHA').code !== 0) {
  fail('supersede was refused');
}
const after = model();
const kept = after.notes.find((n) => n.id === original);
if (!kept) fail('superseding DELETED the original entry — an append-only ledger that drops rows teaches nothing and hides the error rate');
if (kept.superseded_by === null || kept.superseded_by === undefined) {
  fail('the superseded original is present but unmarked — it reads as a live claim');
}
if (!after.notes.some((n) => n.superseded === original || n.supersedes === original)) {
  fail('the replacement does not point back at what it replaced');
}

// The store is the other half: a replacement decision missing from decisions/
// means the ledger and the store disagree about what was decided.
const replacement = idOf('spawns against a SHA');
try {
  readFileSync(join(repo, '.orchestration/r1/decisions', `${replacement}.json`), 'utf8');
} catch {
  fail(`replacement decision ${replacement} never reached decisions/ — store and ledger now disagree`);
}

// -- 4. ack is for decisions, and records who --------------------------------
const finding = idOf('measured');
if (run('ack', finding).code === 0) fail('a finding was acked — only decisions carry an ack lifecycle');

if (run('ack', replacement, '--acked-by', 'user').code !== 0) fail('acking a decision failed');
const acked = model().notes.find((n) => n.id === replacement);
if (!acked.ack) fail('ack did not attach to the decision');
if (!acked.ack.acked_by) {
  fail('the ack records no actor — an orchestrator acking its own decision would leave no evidence');
}

cleanup();
console.log('ledger-never-loses: OK');
