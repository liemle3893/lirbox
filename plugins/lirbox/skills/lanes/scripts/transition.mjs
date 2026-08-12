#!/usr/bin/env node
/*
 * The ONLY sanctioned writer of lane state.
 *
 *   node transition.mjs --root <run-dir> --lane <id> --to <state> --reason "..."
 *
 * Two transitions are REFUSED, not discouraged:
 *   reported -> verified  needs a verification artifact whose producing agent
 *                         name differs from the dispatched implementing agent.
 *   -> published          needs 'verified' somewhere in the lane's history.
 *                         durable (committed) is NOT verified.
 *
 * This is a door, not a wall: anyone with Bash can append to transitions.jsonl
 * by hand. reconcile.mjs is what detects them.
 */
import fs from 'node:fs';
import path from 'node:path';

export const LADDER = ['proposed', 'planned', 'dispatched', 'reported', 'verified', 'durable', 'published'];
export const STUCK = ['blocked-on-user', 'blocked-on-task', 'blocked-on-agent', 'wedged', 'dead'];
export const STATES = [...LADDER, ...STUCK];

export const TABLE = {
  'proposed': ['planned', 'blocked-on-user'],
  'planned': ['dispatched', 'blocked-on-user', 'blocked-on-task'],
  'dispatched': ['reported', 'wedged', 'dead', 'blocked-on-agent', 'blocked-on-task', 'blocked-on-user'],
  'reported': ['verified', 'durable', 'dispatched', 'blocked-on-user'],
  'verified': ['durable', 'blocked-on-user'],
  'durable': ['published', 'verified', 'dispatched', 'blocked-on-user'],
  'published': [],
  'blocked-on-user': ['proposed', 'planned', 'dispatched', 'reported'],
  'blocked-on-task': ['planned', 'dispatched'],
  'blocked-on-agent': ['dispatched', 'dead'],
  'wedged': ['dispatched', 'dead'],   // ctrl+c via pane send-keys frees a wedge
  'dead': ['dispatched'],             // a dead lane needs replacing, not freeing
};

/** Pure. ctx = { lane, implementor, evidence[], history[] }. */
export function check(from, to, ctx = {}) {
  const ev = ctx.evidence || [], hist = ctx.history || [], lane = ctx.lane || '?';
  if (!STATES.includes(from)) return { ok: false, why: `unknown state '${from}'` };
  if (!STATES.includes(to)) return { ok: false, why: `unknown state '${to}'` };
  if (!TABLE[from].includes(to))
    return { ok: false, why: `${lane}: illegal ${from} -> ${to}; legal from '${from}': ${TABLE[from].join(', ') || '(terminal)'}` };
  if (to === 'verified') {
    const v = ev.filter((e) => e.kind === 'verification');
    if (!v.length)
      return { ok: false, why: `${lane}: no verification artifact. implementor='${ctx.implementor}'. A self-report can never become verified.` };
    if (!v.some((e) => e.produced_by !== ctx.implementor))
      return { ok: false, why: `${lane}: verification produced by the implementing agent — implementor='${ctx.implementor}' verifier='${v[0].produced_by}' (same name). A self-report can never become verified.` };
  }
  if (to === 'published' && !hist.includes('verified'))
    return { ok: false, why: `${lane}: -> published requires 'verified' in history; history=[${hist.join(' -> ') || 'empty'}]. durable (committed) is not verified.` };
  return { ok: true, why: `${from} -> ${to}` };
}

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
// A file may hold one record or an array of them — a live lane appends its own
// file; a seeded run ships one array. Both read identically.
const dirJson = (d) => (fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.json')).sort()
  .flatMap((f) => { const j = readJson(path.join(d, f)); return Array.isArray(j) ? j : [j]; }) : []);

export function loadRun(root) {
  const tf = path.join(root, 'transitions.jsonl');
  return {
    root,
    dispatch: dirJson(path.join(root, 'dispatch')),
    evidence: dirJson(path.join(root, 'evidence')),
    transitions: fs.existsSync(tf) ? fs.readFileSync(tf, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [],
  };
}
export const historyOf = (run, lane) => run.transitions.filter((t) => t.lane === lane).map((t) => t.to);
export const stateOf = (run, lane) => historyOf(run, lane).at(-1) || 'proposed';
export const lanesIn = (run) => [...new Set([...run.dispatch.map((d) => d.lane), ...run.transitions.map((t) => t.lane)])].sort();

/** Build the ctx `check` needs, from the store alone. */
export function ctxFor(run, lane) {
  const d = run.dispatch.find((x) => x.lane === lane);
  return { lane, implementor: d ? d.agent_name : null, evidence: run.evidence.filter((e) => e.lane === lane), history: historyOf(run, lane) };
}

function main(argv) {
  const arg = (n) => { const i = argv.indexOf('--' + n); return i < 0 ? undefined : argv[i + 1]; };
  const root = arg('root'), lane = arg('lane'), to = arg('to'), reason = arg('reason') || '';
  if (!root || !lane || !to) { process.stderr.write('usage: transition.mjs --root <dir> --lane <id> --to <state> [--reason "..."]\n'); return 2; }
  const run = loadRun(root);
  const from = stateOf(run, lane);
  const r = check(from, to, ctxFor(run, lane));
  if (!r.ok) { process.stderr.write(`REFUSED  ${r.why}\n`); return 1; }
  fs.appendFileSync(path.join(root, 'transitions.jsonl'),
    JSON.stringify({ lane, from, to, reason, at: new Date().toISOString() }) + '\n');
  process.stdout.write(`OK  ${lane}: ${from} -> ${to}${reason ? '  (' + reason + ')' : ''}\n`);
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith('transition.mjs')) process.exit(main(process.argv));
