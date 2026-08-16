#!/usr/bin/env node
// Run ledger: append-only notes for an orchestration run, plus the generated view.
//
// The orchestrator never writes HTML. It appends entries here; this script owns
// both files:
//
//   .orchestration/<run>/notes.jsonl                  append-only, the truth
//   .orchestration/<run>/implementation-notes.html    regenerated on every append
//
// Append-only is the point, not just tidier storage. "Overturned claims are
// withdrawn, not deleted" stops being a rule the agent has to remember and
// becomes a thing it cannot do: correcting a claim appends {supersedes},
// and the view renders the original struck through with its replacement beneath.
//
// Usage:
//   notes.mjs lane <name> --status doing|blocked|done [--item S] [--blocked-on S] [--artifact S]
//   notes.mjs add <type> --title S [--body S] [--lane S] [--unproven] [--supersedes ID] ...
//   notes.mjs answer <id> --answer S
//   notes.mjs supersede <id> --title S [--body S]
//   notes.mjs ack <id> [--overturn S]          <- the user's, never the orchestrator's
//   notes.mjs render
//
// Types: lane | decision | deviation | tradeoff | question | finding

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';

const TYPES = ['decision', 'deviation', 'tradeoff', 'question', 'finding'];
const STATUSES = ['doing', 'blocked', 'done'];

const die = (m) => { console.error(m); process.exit(1); };

// ---------------------------------------------------------------- args

function parseArgs(argv) {
  const flags = {}, positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) { flags[key] = true; }
      else { flags[key] = next; i++; }
    } else positional.push(a);
  }
  return { flags, positional };
}

const { flags, positional } = parseArgs(process.argv.slice(2));
const cmd = positional[0];

// ---------------------------------------------------------------- run dir

function resolveRun() {
  if (flags.run) {
    const p = flags.run.includes('/') ? flags.run : join('.orchestration', flags.run);
    if (!existsSync(p)) die(`no such run: ${p}`);
    return p;
  }
  if (!existsSync('.orchestration')) die('no .orchestration/ here — pass --run <path>');
  const runs = readdirSync('.orchestration', { withFileTypes: true })
    .filter((d) => d.isDirectory()).map((d) => d.name);
  if (runs.length === 0) die('no runs under .orchestration/ — pass --run <path>');
  // Guessing between runs is how an entry lands in the wrong ledger. Refuse instead.
  if (runs.length > 1) die(`${runs.length} runs under .orchestration/ (${runs.join(', ')}) — pass --run <slug>`);
  return join('.orchestration', runs[0]);
}

const RUN = resolveRun();
const LEDGER = join(RUN, 'notes.jsonl');
const VIEW = join(RUN, 'implementation-notes.html');

const readLedger = () => (existsSync(LEDGER) ? readFileSync(LEDGER, 'utf8') : '')
  .split('\n').filter(Boolean).map((l, i) => {
    try { return JSON.parse(l); } catch { die(`notes.jsonl line ${i + 1} is not JSON — refusing to touch a corrupt ledger`); }
  });

function nextId(entries, type) {
  const prefix = type === 'question' ? 'q' : type === 'lane' ? 'l' : 'n';
  const used = entries.filter((e) => e.id?.startsWith(prefix + '-'))
    .map((e) => parseInt(e.id.slice(prefix.length + 1), 10)).filter(Number.isFinite);
  return `${prefix}-${String(Math.max(0, ...used) + 1).padStart(2, '0')}`;
}

function append(entry) {
  mkdirSync(RUN, { recursive: true });
  appendFileSync(LEDGER, JSON.stringify(entry) + '\n');
  return entry;
}

const findEntry = (entries, id) => entries.find((e) => e.id === id) || die(`no entry ${id} in ${LEDGER}`);

// ---------------------------------------------------------------- commands

function cmdLane(entries) {
  const name = positional[1] || die('lane needs a name');
  const status = flags.status || die(`lane needs --status ${STATUSES.join('|')}`);
  if (!STATUSES.includes(status)) die(`--status must be one of ${STATUSES.join('|')}`);
  if (status === 'blocked' && !flags['blocked-on']) {
    // A blocked lane with no reason is the exact state the Now table exists to expose.
    die('--status blocked needs --blocked-on "<the actual question>"');
  }
  return append({
    id: nextId(entries, 'lane'), ts: new Date().toISOString(), type: 'lane', lane: name,
    status, item: flags.item || null,
    blocked_on: flags['blocked-on'] || null, artifact: flags.artifact || null,
  });
}

function cmdAdd(entries) {
  const type = positional[1] || die(`add needs a type: ${TYPES.join(' | ')}`);
  if (!TYPES.includes(type)) die(`unknown type "${type}" — one of ${TYPES.join(' | ')}`);
  const title = flags.title || die('--title is required');

  // The two schema gates. Both encode a hard rule from the orchestrator prompt
  // that was previously only written down, and therefore skippable under load.
  if (type === 'finding' && !flags.cmd && !flags.unproven) {
    die('a finding needs --cmd "<command>" or an explicit --unproven.\n'
      + 'Put the command beside the claim: an inference in the same register as a\n'
      + 'measurement is how a wrong fact enters the record.');
  }
  if (type === 'decision' && !flags['would-overturn']) {
    die('a decision needs --would-overturn "<condition>".\n'
      + 'A successor can act on "overturned if X still holds". It can do nothing with "chose option 1".');
  }

  const id = nextId(entries, type);
  const entry = {
    id, ts: new Date().toISOString(), type,
    lane: flags.lane || null, title, body: flags.body || null,
    unproven: !!flags.unproven, supersedes: flags.supersedes || null,
  };
  if (flags.options) entry.options = String(flags.options).split('|').map((s) => s.trim());
  if (flags.chosen) entry.chosen = flags.chosen;
  if (type === 'decision') {
    entry.would_overturn = flags['would-overturn'];
    entry.ack = null;                       // only the user closes this
  }
  if (type === 'finding') {
    entry.cmd = flags.cmd || null;
    entry.result = flags.result || null;
    if (flags.exit !== undefined) entry.exit = Number(flags.exit);
  }
  if (flags.supersedes) findEntry(entries, flags.supersedes);

  append(entry);
  if (type === 'decision') writeStoreDecision(entry);
  return entry;
}

// Decisions write through to the lanes store rather than keeping a parallel copy
// — one writer, so the store and the ledger cannot disagree. Every path that
// produces a decision routes here, including supersede: a replacement decision
// missing from the store is exactly the drift this is meant to prevent.
function writeStoreDecision(entry) {
  const dir = join(RUN, 'decisions');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${entry.id}.json`), JSON.stringify({
    fork: entry.title, options: entry.options || [], chosen: entry.chosen || null,
    reason: entry.body || null, would_overturn: entry.would_overturn,
    supersedes: entry.supersedes || undefined,
  }, null, 2) + '\n');
}

function cmdAnswer(entries) {
  const id = positional[1] || die('answer needs an id');
  const target = findEntry(entries, id);
  if (target.type !== 'question') die(`${id} is a ${target.type}, not a question`);
  const answer = flags.answer || die('--answer is required');
  return append({
    id: nextId(entries, 'note'), ts: new Date().toISOString(), type: 'answer',
    answers: id, answer,
  });
}

function cmdSupersede(entries) {
  const id = positional[1] || die('supersede needs an id');
  const old = findEntry(entries, id);
  const title = flags.title || die('--title is required');
  const entry = {
    id: nextId(entries, old.type), ts: new Date().toISOString(), type: old.type,
    lane: flags.lane || old.lane, title, body: flags.body || null,
    unproven: !!flags.unproven, supersedes: id,
  };
  if (old.type === 'decision') {
    entry.would_overturn = flags['would-overturn'] || old.would_overturn;
    entry.ack = null;                       // a replacement is unseen again
  }
  if (flags.options) entry.options = String(flags.options).split('|').map((s) => s.trim());
  if (flags.chosen) entry.chosen = flags.chosen;
  append(entry);
  if (entry.type === 'decision') writeStoreDecision(entry);
  return entry;
}

function cmdAck(entries) {
  const id = positional[1] || die('ack needs an id');
  const target = findEntry(entries, id);
  if (target.type !== 'decision') die(`${id} is a ${target.type} — only decisions are acked`);
  return append({
    id: nextId(entries, 'note'), ts: new Date().toISOString(), type: 'ack',
    acks: id,
    // Recorded so an orchestrator that acks its own decision leaves the evidence
    // in a file it cannot delete from.
    acked_by: flags['acked-by'] || process.env.NOTES_ACTOR || 'user',
    overturn: flags.overturn && flags.overturn !== true ? flags.overturn : null,
  });
}

// ---------------------------------------------------------------- projection

// Fold the append-only log into what the view needs. Nothing is dropped; the
// superseded and acked entries are marked, never removed.
function project(entries) {
  const lanes = new Map();
  const acks = new Map();
  const answers = new Map();
  const superseded = new Map();

  for (const e of entries) {
    if (e.type === 'lane') lanes.set(e.lane, e);
    else if (e.type === 'ack') acks.set(e.acks, e);
    else if (e.type === 'answer') answers.set(e.answers, e);
    if (e.supersedes) superseded.set(e.supersedes, e.id);
  }

  const notes = entries.filter((e) => !['lane', 'ack', 'answer'].includes(e.type)).map((e) => ({
    ...e,
    superseded_by: superseded.get(e.id) || null,
    ack: acks.get(e.id) || null,
    answer: answers.get(e.id) || null,
    // Cheap-or-baked is derived, never stored: if the lane that acted on the
    // decision is still doing, it is cheap to reverse; done means baked in.
    reversibility: e.lane && lanes.get(e.lane)
      ? (lanes.get(e.lane).status === 'done' ? 'baked' : 'cheap') : null,
  }));

  const first = entries[0]?.ts || null;
  return {
    run: basename(RUN),
    started: first,
    generated: new Date().toISOString(),
    lanes: [...lanes.values()],
    notes,
  };
}

// ---------------------------------------------------------------- render

function render(model) {
  mkdirSync(RUN, { recursive: true });
  const json = JSON.stringify(model).replace(/</g, '\\u003c');
  writeFileSync(VIEW, template().replace('/*__LEDGER__*/null', json));
  return VIEW;
}

// ---------------------------------------------------------------- main

const entries = readLedger();

switch (cmd) {
  case 'lane':      cmdLane(entries); break;
  case 'add':       cmdAdd(entries); break;
  case 'answer':    cmdAnswer(entries); break;
  case 'supersede': cmdSupersede(entries); break;
  case 'ack':       cmdAck(entries); break;
  case 'render':    break;
  default:
    die('usage: notes.mjs lane|add|answer|supersede|ack|render  (see header of this file)');
}

// Every mutating call re-renders. No separate render step to forget.
const model = project(readLedger());
const out = render(model);
const unseen = model.notes.filter((n) => n.type === 'decision' && !n.ack && !n.superseded_by).length;
// Surfaced on stdout so the count reaches the orchestrator's turn summary and
// cannot sit unread in a file nobody opened.
console.log(`${out}${unseen ? `  ·  ! ${unseen} decision${unseen > 1 ? 's' : ''} unseen` : ''}`);

// ---------------------------------------------------------------- template
// Single self-contained file: the model is inlined at the marker below, so it
// opens over file:// with no server and no build step. Deliberately avoids
// template literals in the embedded view script so this outer literal is safe.
// A hoisted function declaration, not a const — render() above runs before this
// point in the file, and a const would be in its temporal dead zone.

function template() { return String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Run ledger</title>
<style>
:root {
  --paper:#fbfbfd; --surface:#fff; --sunk:#f2f2f7; --line:#dedee8; --line-soft:#ebebf2;
  --ink:#16171f; --ink-2:#3f4152; --muted:#74768a; --faint:#9a9cb0;
  --accent:#4340a8; --accent-bg:#edecfa;
  --amber:#9a6008; --amber-bg:#fcf1de;
  --red:#a32d2d; --red-bg:#fbeaea;
  --green:#26714a; --green-bg:#e6f4ec;
  --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;
  --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --paper:#0e0f14; --surface:#161822; --sunk:#1c1e29; --line:#2b2e3d; --line-soft:#232632;
  --ink:#eceef6; --ink-2:#c3c6d6; --muted:#8e91a6; --faint:#6a6d82;
  --accent:#9a97f0; --accent-bg:#23213f;
  --amber:#e0a94a; --amber-bg:#33270f;
  --red:#f08a8a; --red-bg:#351a1a;
  --green:#6fd39b; --green-bg:#12301f;
}}
:root[data-theme="dark"]{
  --paper:#0e0f14; --surface:#161822; --sunk:#1c1e29; --line:#2b2e3d; --line-soft:#232632;
  --ink:#eceef6; --ink-2:#c3c6d6; --muted:#8e91a6; --faint:#6a6d82;
  --accent:#9a97f0; --accent-bg:#23213f;
  --amber:#e0a94a; --amber-bg:#33270f;
  --red:#f08a8a; --red-bg:#351a1a;
  --green:#6fd39b; --green-bg:#12301f;
}
*{box-sizing:border-box}
body{background:var(--paper);color:var(--ink);font-family:var(--sans);font-size:15px;line-height:1.6;margin:0;-webkit-font-smoothing:antialiased}
.wrap{max-width:900px;margin:0 auto;padding:36px 24px 100px}
.run-head{display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:10px;padding-bottom:12px;border-bottom:1px solid var(--line)}
.run-name{font-family:var(--mono);font-size:18px;font-weight:600}
.run-sub{font-family:var(--mono);font-size:11.5px;color:var(--faint)}
.counts{display:flex;flex-wrap:wrap;gap:7px;margin:14px 0 30px}
.count{font-family:var(--mono);font-size:11.5px;padding:4px 10px;border-radius:20px;border:1px solid var(--line);color:var(--muted);background:var(--surface);white-space:nowrap}
.count.warn{border-color:var(--amber);color:var(--amber);background:var(--amber-bg);font-weight:600}
.count.bad{border-color:var(--red);color:var(--red);background:var(--red-bg);font-weight:600}
.band{font-family:var(--mono);font-size:10.5px;letter-spacing:.13em;text-transform:uppercase;color:var(--muted);margin:0 0 9px}
.band.warn{color:var(--amber)}
.scroll{overflow-x:auto;margin-bottom:26px}
table{border-collapse:collapse;width:100%;min-width:580px;font-family:var(--mono);font-size:13px}
th{text-align:left;font-size:10px;letter-spacing:.09em;text-transform:uppercase;color:var(--muted);font-weight:500;padding:0 14px 9px 0;border-bottom:1px solid var(--line)}
td{padding:9px 14px 9px 0;border-bottom:1px solid var(--line-soft);color:var(--ink-2);vertical-align:top}
td:first-child{color:var(--ink)}
tr.blocked td:first-child{box-shadow:inset 3px 0 0 var(--red);padding-left:11px}
.pill{display:inline-block;font-size:10.5px;padding:2px 8px;border-radius:20px;font-weight:600;margin-left:6px}
.pill.doing{background:var(--accent-bg);color:var(--accent)}
.pill.blocked{background:var(--red-bg);color:var(--red)}
.pill.done{background:var(--green-bg);color:var(--green)}
.dcard{border:1px solid var(--line);border-left:3px solid var(--amber);border-radius:0 5px 5px 0;padding:12px 15px;margin-bottom:8px;background:var(--surface)}
.dcard .top{display:flex;justify-content:space-between;gap:14px;align-items:baseline;margin-bottom:5px}
.dcard .ttl{font-size:13.5px;font-weight:600;color:var(--ink)}
.dcard .id{font-family:var(--mono);font-size:11px;color:var(--faint);white-space:nowrap}
.dcard .ovr{font-family:var(--mono);font-size:11.5px;color:var(--ink-2);margin-bottom:5px}
.dcard .ovr b{color:var(--amber);font-weight:500}
.dcard .prov{font-family:var(--mono);font-size:11px;color:var(--faint)}
.cheap{color:var(--green)} .baked{color:var(--red)}
.qrow{display:flex;justify-content:space-between;gap:14px;font-size:13px;padding:7px 0;border-bottom:1px solid var(--line-soft);color:var(--ink-2)}
.qrow .id{font-family:var(--mono);font-size:11px;color:var(--faint);white-space:nowrap}
.filters{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:30px 0 14px;font-family:var(--mono);font-size:11.5px}
.chip{border:1px solid var(--line);border-radius:20px;padding:3px 11px;color:var(--muted);background:var(--surface);cursor:pointer;font:inherit}
.chip[aria-pressed="true"]{background:var(--accent);border-color:var(--accent);color:#fff;font-weight:600}
:root[data-theme="dark"] .chip[aria-pressed="true"]{color:#14121f}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .chip[aria-pressed="true"]{color:#14121f}}
.tcard{border:1px solid var(--line);border-radius:5px;padding:13px 15px;margin-bottom:8px;background:var(--surface)}
.tcard .top{display:flex;gap:9px;align-items:baseline;margin-bottom:6px;flex-wrap:wrap}
.badge{font-family:var(--mono);font-size:10px;letter-spacing:.1em;padding:2px 7px;border-radius:3px;font-weight:600;background:var(--accent-bg);color:var(--accent)}
.badge.decision{background:var(--amber-bg);color:var(--amber)}
.badge.gone{background:var(--sunk);color:var(--faint)}
.tcard .lane{font-family:var(--mono);font-size:11px;color:var(--muted)}
.tcard .id{font-family:var(--mono);font-size:11px;color:var(--faint);margin-left:auto;white-space:nowrap}
.tcard .ttl{font-size:14px;font-weight:600;color:var(--ink);margin-bottom:4px}
.tcard .body{font-size:13px;color:var(--ink-2);margin-bottom:9px}
.tcard.sup{opacity:.58}
.tcard.sup .ttl{text-decoration:line-through;text-decoration-color:var(--faint)}
.cmd{font-family:var(--mono);font-size:11.5px;background:var(--sunk);border:1px solid var(--line-soft);border-radius:4px;padding:8px 11px;color:var(--ink-2);overflow-x:auto;white-space:pre-wrap}
.cmd .out{color:var(--green)}
.empty{color:var(--faint);font-size:13px;font-style:italic;padding:6px 0 20px}
.foot{margin-top:40px;padding-top:14px;border-top:1px solid var(--line);font-family:var(--mono);font-size:11px;color:var(--faint)}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:2px}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
</style>
</head>
<body>
<div class="wrap" id="app"></div>
<script id="ledger" type="application/json">/*__LEDGER__*/null</script>
<script>
(function () {
  var M = JSON.parse(document.getElementById('ledger').textContent);
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  };
  var ago = function (iso) {
    if (!iso) return '—';
    var m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + 'm';
    var h = Math.floor(m / 60);
    return h < 24 ? h + 'h ' + (m % 60) + 'm' : Math.floor(h / 24) + 'd';
  };
  var clock = function (iso) { return iso ? new Date(iso).toTimeString().slice(0, 5) : ''; };

  var live = M.notes.filter(function (n) { return !n.superseded_by; });
  var unseen = live.filter(function (n) { return n.type === 'decision' && !n.ack; });
  var open = live.filter(function (n) { return n.type === 'question' && !n.answer; });
  var unproven = live.filter(function (n) { return n.unproven; });
  var blocked = M.lanes.filter(function (l) { return l.status === 'blocked'; });

  var state = { type: 'all', lane: 'all', unprovenOnly: false, showSup: false };

  function head() {
    var c = [];
    c.push('<span class="count">● ' + M.lanes.length + ' lanes</span>');
    if (blocked.length) c.push('<span class="count bad">⚠ ' + blocked.length + ' blocked</span>');
    if (unseen.length) c.push('<span class="count warn">! ' + unseen.length + ' decisions unseen</span>');
    if (open.length) c.push('<span class="count">? ' + open.length + ' open</span>');
    if (unproven.length) c.push('<span class="count">◌ ' + unproven.length + ' unproven</span>');
    return '<div class="run-head"><span class="run-name">' + esc(M.run) + '</span>' +
      '<span class="run-sub">started ' + clock(M.started) + ' · ' + ago(M.started) + '</span></div>' +
      '<div class="counts">' + c.join('') + '</div>';
  }

  function now() {
    if (!M.lanes.length) return '';
    var rows = M.lanes.map(function (l) {
      return '<tr class="' + (l.status === 'blocked' ? 'blocked' : '') + '">' +
        '<td>' + esc(l.lane) + '<span class="pill ' + l.status + '">' + l.status + '</span></td>' +
        '<td>' + esc(l.item || '—') + '</td>' +
        '<td>' + ago(l.ts) + '</td>' +
        '<td>' + esc(l.blocked_on || '—') + '</td>' +
        '<td>' + esc(l.artifact || '—') + '</td></tr>';
    }).join('');
    return '<p class="band">Now</p><div class="scroll"><table><thead><tr>' +
      '<th>lane</th><th>on</th><th>since</th><th>blocked on</th><th>last</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  function unseenBand() {
    if (!unseen.length) return '';
    var cards = unseen.map(function (d) {
      var prov = '';
      if (d.reversibility === 'cheap') prov = esc(d.lane) + ' · still doing — <span class="cheap">cheap to reverse</span>';
      else if (d.reversibility === 'baked') prov = esc(d.lane) + ' · done — <span class="baked">baked in</span>';
      else prov = 'no lane attached';
      return '<div class="dcard"><div class="top"><span class="ttl">' + esc(d.title) + '</span>' +
        '<span class="id">' + clock(d.ts) + ' · ' + esc(d.id) + '</span></div>' +
        '<div class="ovr"><b>overturned if →</b> ' + esc(d.would_overturn) + '</div>' +
        '<div class="prov">' + prov + '</div></div>';
    }).join('');
    return '<p class="band warn">! Decisions you have not seen (' + unseen.length + ')</p>' + cards +
      '<p class="empty">Clear with <code>notes.mjs ack &lt;id&gt;</code> — yours to run, not the orchestrator’s.</p>';
  }

  function questions() {
    if (!open.length) return '';
    return '<p class="band">? Open questions (' + open.length + ')</p>' + open.map(function (q) {
      return '<div class="qrow"><span>' + esc(q.title) + '</span>' +
        '<span class="id">' + esc(q.id) + ' · ' + ago(q.ts) + '</span></div>';
    }).join('') + '<div style="height:18px"></div>';
  }

  function filters() {
    var lanes = M.lanes.map(function (l) { return l.lane; });
    var types = ['all', 'decision', 'deviation', 'tradeoff', 'question', 'finding'];
    var t = types.map(function (x) {
      return '<button class="chip" data-f="type" data-v="' + x + '" aria-pressed="' +
        (state.type === x) + '">' + x + '</button>';
    }).join('');
    var l = lanes.length ? ['all'].concat(lanes).map(function (x) {
      return '<button class="chip" data-f="lane" data-v="' + esc(x) + '" aria-pressed="' +
        (state.lane === x) + '">' + esc(x) + '</button>';
    }).join('') : '';
    return '<div class="filters">' + t + (l ? '<span style="color:var(--faint)">·</span>' + l : '') +
      '<button class="chip" data-f="unprovenOnly" aria-pressed="' + state.unprovenOnly + '">◌ unproven only</button>' +
      '<button class="chip" data-f="showSup" aria-pressed="' + state.showSup + '">show superseded</button></div>';
  }

  function timeline() {
    var rows = M.notes.slice().reverse().filter(function (n) {
      if (n.superseded_by && !state.showSup) return false;
      if (state.type !== 'all' && n.type !== state.type) return false;
      if (state.lane !== 'all' && n.lane !== state.lane) return false;
      if (state.unprovenOnly && !n.unproven) return false;
      return true;
    });
    if (!rows.length) return '<p class="empty">Nothing matches this filter.</p>';
    return rows.map(function (n) {
      var cls = 'badge' + (n.type === 'decision' ? ' decision' : '') + (n.superseded_by ? ' gone' : '');
      var tags = [];
      if (n.lane) tags.push(esc(n.lane));
      if (n.unproven) tags.push('◌ unproven');
      if (n.superseded_by) tags.push('superseded by ' + esc(n.superseded_by));
      if (n.ack && n.ack.overturn) tags.push('overturned');
      else if (n.ack) tags.push('acked');
      var out = '<div class="tcard' + (n.superseded_by ? ' sup' : '') + '">' +
        '<div class="top"><span class="' + cls + '">' + n.type.toUpperCase() + '</span>' +
        '<span class="lane">' + tags.join(' · ') + '</span>' +
        '<span class="id">' + clock(n.ts) + ' · ' + esc(n.id) + '</span></div>' +
        '<div class="ttl">' + esc(n.title) + '</div>';
      if (n.body) out += '<div class="body">' + esc(n.body) + '</div>';
      if (n.chosen) out += '<div class="body">chose <b>' + esc(n.chosen) + '</b>' +
        (n.options ? ' from ' + esc(n.options.join(' | ')) : '') + '</div>';
      if (n.would_overturn) out += '<div class="body">overturned if → ' + esc(n.would_overturn) + '</div>';
      if (n.answer) out += '<div class="body">answered: ' + esc(n.answer.answer) + '</div>';
      if (n.cmd) out += '<div class="cmd">$ ' + esc(n.cmd) +
        (n.result ? '\n<span class="out">' + esc(n.result) + '</span>' : '') + '</div>';
      return out + '</div>';
    }).join('');
  }

  function paint() {
    document.getElementById('app').innerHTML = head() + now() + unseenBand() + questions() +
      filters() + timeline() +
      '<p class="foot">' + M.notes.length + ' entries · generated ' + clock(M.generated) +
      ' · append-only, nothing here was deleted</p>';
    Array.prototype.forEach.call(document.querySelectorAll('.chip'), function (b) {
      b.addEventListener('click', function () {
        var f = b.dataset.f;
        if (f === 'unprovenOnly' || f === 'showSup') state[f] = !state[f];
        else state[f] = b.dataset.v;
        paint();
      });
    });
  }
  paint();
})();
</script>
</body>
</html>`; }
