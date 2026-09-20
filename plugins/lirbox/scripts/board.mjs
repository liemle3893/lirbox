#!/usr/bin/env node
/*
 * board.mjs — the aggregate progress signal for an orchestrated run. Deterministic, no model.
 *
 * One JSON file per slice under .orchestration/<slug>/slices/<id>.json. `--set` is the only writer.
 *
 *   node plugins/lirbox/scripts/board.mjs --run <slug>
 *   node plugins/lirbox/scripts/board.mjs --run <slug> --set <id> --status <s> \
 *        [--delivers TEXT] [--criterion "CMD :: EXPECTED"]... [--exit N] \
 *        [--by WHO] [--verified-by WHO] [--at ISO]
 *
 * THE ONE COLUMN A BOARD CANNOT FAKE: verified_by stays null until somebody OTHER than the slice's
 * recorded implementor records it. A self-report is refused, and so is a verification of a slice
 * nobody has claimed — "verified" with no implementor is a signature on an empty page. That is the
 * entire point of the file; `N of M delivered` counts only delivered-AND-verified slices.
 *
 * Deliberately absent: state machine, transition log, database, reconcile. The store that did all
 * that was 384 KB and unreadable. Four statuses. If you are reaching for a fifth, stop and report.
 */
import { mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const STATUSES = ['planned', 'in_progress', 'blocked', 'delivered'];

const die = (msg) => { console.error(`board: ${msg}`); process.exit(2); };

function parseArgs(argv) {
  const out = { criterion: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) die(`unexpected argument ${a}`);
    const k = a.slice(2);
    const v = argv[++i];
    if (v === undefined || v.startsWith('--')) die(`--${k} needs a value`);
    if (k === 'criterion') out.criterion.push(v);
    else out[k] = v;
  }
  return out;
}

// "cmd :: expected" — both halves required. A criterion with no command is not a criterion, it is
// a wish, and a wish on a progress board reads exactly like a verified fact.
function parseCriterion(raw) {
  const parts = raw.split('::');
  if (parts.length !== 2) die(`criterion must be "COMMAND :: EXPECTED", got ${JSON.stringify(raw)}`);
  const command = parts[0].trim();
  const expected = parts[1].trim();
  if (!command) die(`criterion has no command: ${JSON.stringify(raw)}`);
  if (!expected) die(`criterion has no expected value: ${JSON.stringify(raw)}`);
  return { command, expected };
}

const slicesDir = (slug) => join('.orchestration', slug, 'slices');

function load(slug) {
  const dir = slicesDir(slug);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
}

function set(slug, args) {
  const id = args.set;
  if (!/^[A-Za-z0-9._-]+$/.test(id)) die(`--set id must be [A-Za-z0-9._-]+, got ${JSON.stringify(id)}`);
  if (!args.status) die('--set needs --status');
  if (!STATUSES.includes(args.status)) die(`--status must be one of ${STATUSES.join(', ')}`);

  const dir = slicesDir(slug);
  const file = join(dir, `${id}.json`);
  const prior = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;

  const slice = prior || {
    id, delivers: '', criteria: [], exit: null,
    status: 'planned', implementor: null, verified_by: null, updated_at: null,
  };

  if (args.delivers !== undefined) slice.delivers = args.delivers;
  if (args.criterion.length) slice.criteria = args.criterion.map(parseCriterion);
  if (args.exit !== undefined) {
    if (!/^-?\d+$/.test(args.exit)) die(`--exit must be an integer, got ${JSON.stringify(args.exit)}`);
    slice.exit = Number(args.exit);
  }
  if (args.by !== undefined) slice.implementor = args.by;
  slice.status = args.status;

  if (args['verified-by'] !== undefined) {
    const who = args['verified-by'];
    if (!slice.implementor) die(`cannot verify ${id}: no implementor recorded (--by) — verification with nobody to check against is not verification`);
    if (who === slice.implementor) die(`cannot verify ${id}: --verified-by "${who}" is its own implementor — verification must come from somebody else`);
    slice.verified_by = who;
  }

  // No clock in here — the caller owns the time. Omitting --at nulls it rather than carrying the
  // previous write's timestamp forward, because a stale time read as current is worse than none.
  slice.updated_at = args.at ?? null;

  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(slice, null, 2) + '\n');
}

const done = (s) => s.status === 'delivered' && !!s.verified_by;

function print(slug, slices) {
  const cols = [
    ['ID', (s) => s.id],
    ['STATUS', (s) => s.status],
    ['EXIT', (s) => (s.exit === null || s.exit === undefined ? '—' : String(s.exit))],
    ['VERIFIED_BY', (s) => s.verified_by || '—'],
    ['DELIVERS', (s) => s.delivers || '—'],
  ];
  const rows = [cols.map((c) => c[0]), ...slices.map((s) => cols.map((c) => c[1](s)))];
  const w = cols.map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  console.log(`run: ${slug}`);
  for (const r of rows) console.log(r.map((cell, i) => cell.padEnd(w[i])).join('  ').trimEnd());
  console.log(`\n${slices.filter(done).length} of ${slices.length} delivered`);
}

const args = parseArgs(process.argv.slice(2));
if (!args.run) die('--run <slug> is required');
if (args.set !== undefined) set(args.run, args);
print(args.run, load(args.run));
