#!/usr/bin/env node
/*
 * Detect anyone who did not use the door.
 *
 *   node reconcile.mjs --root <run-dir>
 *
 * Recomputes every lane's state from the evidence ARTIFACTS ALONE and diffs it
 * against the state recorded in transitions.jsonl. A hand-written row surfaces
 * as drift. Exit 1 if any drift, 0 if clean.
 *
 * Limits, stated rather than hidden: the stuck states (blocked-*, wedged, dead)
 * leave no artifact, so they are reported UNVERIFIABLE, not clean.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadRun, lanesIn, stateOf, STUCK } from './transition.mjs';

/** State implied by artifacts only. Never reads transitions.jsonl. */
export function recompute(run, lane) {
  const d = run.dispatch.find((x) => x.lane === lane);
  const ev = run.evidence.filter((e) => e.lane === lane);
  const has = (k) => ev.some((e) => e.kind === k);
  const independent = ev.some((e) => e.kind === 'verification' && d && e.produced_by !== d.agent_name);
  let s = d ? 'dispatched' : 'proposed';
  if (has('report')) s = 'reported';
  if (independent) s = 'verified';
  if (has('commit')) s = 'durable';          // durable outranks verified and does not imply it
  if (has('publish') && independent) s = 'published';
  return s;
}

function main(argv) {
  const i = argv.indexOf('--root');
  const root = i < 0 ? undefined : argv[i + 1];
  if (!root) { process.stderr.write('usage: reconcile.mjs --root <dir>\n'); return 2; }
  const run = loadRun(root);
  const rows = [], missing = [];
  for (const e of run.evidence)
    if (e.path && !fs.existsSync(path.resolve(root, e.path)) && !fs.existsSync(e.path)) missing.push(e);
  for (const lane of lanesIn(run)) {
    const recorded = stateOf(run, lane);
    if (STUCK.includes(recorded)) { rows.push({ lane, recorded, derived: '-', verdict: 'UNVERIFIABLE' }); continue; }
    const derived = recompute(run, lane);
    rows.push({ lane, recorded, derived, verdict: recorded === derived ? 'ok' : 'DRIFT' });
  }
  const w = Math.max(4, ...rows.map((r) => r.lane.length));
  process.stdout.write(`lane${' '.repeat(w - 4)}  recorded          derived           verdict\n`);
  for (const r of rows)
    process.stdout.write(`${r.lane.padEnd(w)}  ${r.recorded.padEnd(16)}  ${r.derived.padEnd(16)}  ${r.verdict}\n`);
  for (const e of missing) process.stdout.write(`MISSING ARTIFACT  ${e.lane}  ${e.kind}  ${e.path}\n`);
  const drift = rows.filter((r) => r.verdict === 'DRIFT');
  process.stdout.write(`\n${drift.length} drift, ${missing.length} missing artifact(s), ${rows.filter((r) => r.verdict === 'UNVERIFIABLE').length} unverifiable, ${rows.length} lanes\n`);
  for (const r of drift) process.stdout.write(`DRIFT  ${r.lane}: recorded '${r.recorded}' but artifacts only support '${r.derived}'\n`);
  return drift.length || missing.length ? 1 : 0;
}

if (process.argv[1] && process.argv[1].endsWith('reconcile.mjs')) process.exit(main(process.argv));
