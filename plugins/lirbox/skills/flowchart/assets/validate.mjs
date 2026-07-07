#!/usr/bin/env node
// Headless static validator for flowchart-skill output — the verify gate a subagent can
// actually run (no browser, no network, no npm install). Zero dependencies.
//
// It extracts every `<pre class="mermaid">` graph block and flags the label-escaping
// failures that break Mermaid's parser/renderer in the browser (see issue #2):
//   1. raw  ( ) { } [ ] "  inside a node/edge label   → parse error
//   2. literal `\n` used for a line break               → renders as the text "\n"
//   3. HTML entities `&#NN;` in a label                 → decoded by textContent → parse error
//   4. non-ASCII (—, …, →, …) in a node/edge label      → btoa() InvalidCharacterError at render
//
// Usage:
//   node validate.mjs <file.html> [more.html ...]
//   node validate.mjs                 # defaults to ./*-flowchart.html
// Exit 0 = every mermaid block clean; exit 1 = at least one finding (or no files found).

import { readFileSync, readdirSync } from 'node:fs';

const SPECIALS = ['(', ')', '{', '}', '[', ']', '"'];
const ENTITY = { '(': '#40;', ')': '#41;', '{': '#123;', '}': '#125;', '[': '#91;', ']': '#93;', '"': '#34;' };

// Every `<pre class="mermaid"> … </pre>` block, with the file line its content starts on.
function mermaidBlocks(html) {
  const re = /<pre[^>]*class=["'][^"']*\bmermaid\b[^"']*["'][^>]*>([\s\S]*?)<\/pre>/gi;
  const out = [];
  let m;
  while ((m = re.exec(html))) {
    const startLine = html.slice(0, m.index).split('\n').length;
    out.push({ text: m[1], startLine });
  }
  return out;
}

// Structural graph lines carry no label text — skip them to avoid false positives.
function isStructural(t) {
  return t === '' || t.startsWith('%%') || t.startsWith('classDef') || t.startsWith('click') ||
    t.startsWith('style ') || t.startsWith('linkStyle') || t.startsWith('subgraph') ||
    t === 'end' || /^(flowchart|graph)\b/.test(t);
}

// Label spans on a line: node-shape inners [..] {..} (covers ([..]) and [/../]), edge labels |..|,
// and dash-form edge labels (A -- text --> B, A -. text .-> B, A == text ==> B).
function spans(line) {
  const labels = [];
  const edges = [];
  for (const mm of line.matchAll(/\|([^|]*)\|/g)) edges.push(mm[1]);
  // Dash-form: opener (--, -., ==) + label + arrow close. First label char excludes
  // - . = > | and whitespace so plain arrows (-->, --->, -.->, ==>, ---) never match.
  for (const mm of line.matchAll(/(?:--|-\.|==)\s*([^\s>|.=-][^>|]*?)\s*(?:-->|\.->|==>)/g)) edges.push(mm[1]);
  for (const mm of line.matchAll(/\[([^\]]*)\]/g)) labels.push(mm[1]);
  for (const mm of line.matchAll(/\{([^}]*)\}/g)) labels.push(mm[1]);
  return { labels, edges };
}

function checkLabel(text, { edge }) {
  const issues = [];
  for (const ch of SPECIALS) {
    if (text.includes(ch)) issues.push(`raw "${ch}" in ${edge ? 'edge ' : ''}label — use Mermaid entity ${ENTITY[ch]}`);
  }
  if (/&#\d+;|&#x[0-9a-f]+;/i.test(text)) issues.push(`HTML entity "&#…;" in label — textContent decodes it; use Mermaid's "#NN;" (no ampersand)`);
  if (text.includes('\\n')) issues.push(`literal "\\n" in label — use <br/> for a line break`);
  if (/[^\x00-\x7F]/.test(text)) {
    const bad = [...new Set([...text].filter((c) => c.charCodeAt(0) > 127))].join(' ');
    issues.push(`non-ASCII (${bad}) in ${edge ? 'edge' : 'node'} label — btoa() throws at render; map —→- …→... →→->`);
  }
  return issues;
}

function validateFile(file) {
  let html;
  try { html = readFileSync(file, 'utf8'); }
  catch (e) { return [{ line: 0, msg: `cannot read: ${e.message}` }]; }
  const blocks = mermaidBlocks(html);
  if (blocks.length === 0) return [{ line: 0, msg: 'no <pre class="mermaid"> block found' }];
  const findings = [];
  for (const b of blocks) {
    const lines = b.text.split('\n');
    lines.forEach((raw, i) => {
      const t = raw.trim();
      if (isStructural(t)) return;
      const { labels, edges } = spans(raw);
      const line = b.startLine + i;
      for (const l of labels) for (const msg of checkLabel(l, { edge: false })) findings.push({ line, msg, snippet: t });
      for (const e of edges) for (const msg of checkLabel(e, { edge: true })) findings.push({ line, msg, snippet: t });
    });
  }
  return findings;
}

// ---- main ----
let files = process.argv.slice(2);
if (files.length === 0) {
  try { files = readdirSync('.').filter((f) => f.endsWith('-flowchart.html')); } catch { files = []; }
}
if (files.length === 0) {
  console.error('validate.mjs: no files given and no *-flowchart.html in cwd');
  process.exit(1);
}

let total = 0;
for (const file of files) {
  const findings = validateFile(file);
  if (findings.length === 0) {
    console.log(`PASS  ${file}`);
    continue;
  }
  total += findings.length;
  console.log(`FAIL  ${file}  (${findings.length})`);
  for (const f of findings) {
    console.log(`  ${file}:${f.line}  ${f.msg}`);
    if (f.snippet) console.log(`        ${f.snippet}`);
  }
}
if (total > 0) {
  console.error(`\n${total} finding(s) across ${files.length} file(s) — fix the labels above, then re-run.`);
  process.exit(1);
}
console.log(`\nAll ${files.length} file(s) clean.`);
