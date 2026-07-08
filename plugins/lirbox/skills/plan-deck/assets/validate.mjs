#!/usr/bin/env node
// Headless validator for a generated plan-deck HTML page. Exit 0 = valid, 1 = invalid.
// Catches the ways a filled plan-deck drifts from its own contract. Regex-based
// (controlled template).
//
//   node validate.mjs <plan-deck.html>
//
// Contract (mirrors SKILL.md step 5):
//   1. No leftover {{placeholder}} tokens.
//   2. Exactly one <h1 class="title">.
//   3. Section ids and TOC hrefs match — same set AND same order (page order == TOC).
//   4. Numbered .sec-num badges form a gapless 01..N sequence in document order.
//   5. The optional `decisions` lead section, when present, is FIRST (before every
//      numbered section) and carries no .sec-num badge.

import { readFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) { console.error('usage: validate.mjs <plan-deck.html>'); process.exit(2); }

let html;
try { html = readFileSync(path, 'utf8'); }
catch (e) { console.error(`cannot read ${path}: ${e.message}`); process.exit(2); }

const errors = [];

// 1. placeholders
const ph = html.match(/\{\{[^}]+\}\}/g);
if (ph) errors.push(`leftover placeholder(s): ${[...new Set(ph)].join(', ')}`);

// 2. single title
const titles = (html.match(/<h1\b[^>]*\bclass="[^"]*\btitle\b[^"]*"/g) || []).length;
if (titles !== 1) errors.push(`expected exactly one <h1 class="title">, found ${titles}`);

// 3. ids vs toc — set and order
const ids = [...html.matchAll(/<section\b[^>]*\bid="([^"]+)"/g)].map((m) => m[1]);
const toc = [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
const idSet = new Set(ids);
const tocSet = new Set(toc);
for (const id of ids) if (!tocSet.has(id)) errors.push(`section #${id} has no TOC link`);
for (const t of toc) if (!idSet.has(t)) errors.push(`TOC links #${t} but no such section`);
if (idSet.size === tocSet.size && ids.join(',') !== toc.join(',')) {
  errors.push(`TOC order [${toc.join(', ')}] != section order [${ids.join(', ')}]`);
}

// 4. numbered badges gapless 01..N
const badges = [...html.matchAll(/class="sec-num"[^>]*>([^<]+)</g)].map((m) => m[1].trim());
const expected = badges.map((_, i) => String(i + 1).padStart(2, '0'));
if (badges.join(',') !== expected.join(',')) {
  errors.push(`section badges [${badges.join(', ')}] are not a gapless 01..${expected.at(-1) ?? '00'} sequence`);
}

// 5. decisions lead is first + un-numbered
if (idSet.has('decisions')) {
  if (ids[0] !== 'decisions') errors.push(`the "decisions" lead must come first, before the numbered plan (is at position ${ids.indexOf('decisions') + 1})`);
  const sec = html.match(/<section\b[^>]*\bid="decisions"[\s\S]*?<\/section>/);
  if (sec && /class="sec-num"/.test(sec[0])) errors.push('the "decisions" lead must be un-numbered (has a .sec-num badge)');
}

if (errors.length) {
  console.error(`INVALID ${path}`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`VALID ${path} — 1 title, ${ids.length} section(s), badges ${badges.join('/') || '—'}`);
