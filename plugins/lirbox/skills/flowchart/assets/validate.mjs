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
  // Round-node inners (..): innermost paren pairs, so ((circle)) yields "circle".
  // Skip composite-shape inners like ([stadium]) / ({..}) — the [..]/{..} passes cover those.
  for (const mm of line.matchAll(/\(([^()]*)\)/g)) {
    const inner = mm[1];
    if (/^\[[\s\S]*\]$/.test(inner) || /^\{[\s\S]*\}$/.test(inner)) continue;
    labels.push(inner);
  }
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

// ---- page contract ----
//
// Label escaping is only half the gate. A page can have a perfectly escaped graph and still be
// rubble: an author regex anchored on `%% TEMPLATE-GRAPH-START` matches the template's OWN
// instruction comment (it quotes the marker) and swallows <head>, <style> and <header> on the way
// to the real marker. Observed — and this validator printed PASS on the result.
//
// So we also enforce what SKILL.md's Verify checklist already writes down in prose.
//
// Only for files that CLAIM to be a finished page. The fixtures in evals/ are bare mermaid
// fragments with no panel wiring; running the page contract over them would turn every one of
// them red. A finished page always carries the template's panel wiring or its leftover markers.
function looksLikeFinishedPage(html) {
  return /\bDEFAULT_NODE\b/.test(html) || /\bselectNode\b/.test(html) ||
    /TEMPLATE-(?:GRAPH|STEPS)-(?:START|END)/.test(html);
}

function structuralFindings(rawHtml, graphText) {
  const out = [];
  // Comments are not the page. A commented-out <h1> is not a header, and the template's own
  // instruction comment quotes `%% TEMPLATE-GRAPH-START` — counting that as a leftover marker
  // would flag every correctly-filled page. Blanking comments while preserving newlines keeps
  // reported line numbers honest. This is the same mistake an author regex makes when it anchors
  // on a marker the comment also contains; the validator does not get to make it too.
  const html = rawHtml.replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, ' '));
  const at = (needle) => (needle && html.includes(needle) ? html.slice(0, html.indexOf(needle)).split('\n').length : 0);
  const add = (msg, needle) => out.push({ line: at(needle), msg });

  const h1 = (html.match(/<h1[^>]*class=["'][^"']*\btitle\b[^"']*["']/gi) || []).length;
  if (h1 !== 1) add(`page contract: expected exactly one <h1 class="title">, found ${h1} — the header was lost or duplicated`);

  if (!/<style[\s>]/i.test(html)) add('page contract: no <style> block — the page renders unstyled');

  const leftovers = [...new Set(html.match(/\{\{[^}\n]{0,120}\}\}/g) || [])];
  if (leftovers.length) add(`page contract: ${leftovers.length} unfilled placeholder(s) left: ${leftovers.slice(0, 3).join(' ')}`, leftovers[0]);

  const markers = [...new Set(html.match(/TEMPLATE-(?:GRAPH|STEPS)-(?:START|END)/g) || [])];
  if (markers.length) add(`page contract: template marker(s) still present: ${markers.join(' ')} — replace the block and delete both markers`, markers[0]);

  const crit = (graphText.match(/:::crit\b/g) || []).length;
  if (crit !== 1) add(`page contract: expected exactly one :::crit node, found ${crit} — highlight the single control point`);

  const script = (html.match(/<script[^>]*\bsrc=["'][^"']*mermaid[^"']*["'][^>]*>/i) || [])[0];
  if (!script) add('page contract: no Mermaid <script src=…> — the chart cannot render');
  else {
    if (!/\bintegrity=/i.test(script)) add('page contract: the Mermaid <script> lost its integrity attribute — never drop SRI', script);
    if (!/\bcrossorigin=/i.test(script)) add('page contract: the Mermaid <script> lost its crossorigin attribute', script);
  }

  // Every clickable node must open something, and the default panel must exist.
  const stepKeys = new Set();
  const stepsBlock = (html.match(/const\s+STEPS\s*=\s*\{([\s\S]*?)\n\s*\};/) || [])[1];
  if (stepsBlock) for (const m of stepsBlock.matchAll(/^\s{0,8}([A-Za-z_]\w*)\s*:\s*\{/gm)) stepKeys.add(m[1]);
  if (!stepKeys.size) add('page contract: no STEPS entries found — every node panel would be empty');
  else {
    const clicked = [...graphText.matchAll(/^\s*click\s+(\w+)\s/gm)].map((m) => m[1]);
    const orphan = [...new Set(clicked.filter((id) => !stepKeys.has(id)))];
    if (orphan.length) add(`page contract: click wired for node(s) with no STEPS entry: ${orphan.join(', ')} — clicking them opens nothing`);
    const dflt = (html.match(/DEFAULT_NODE\s*=\s*["'](\w+)["']/) || [])[1];
    if (!dflt) add('page contract: DEFAULT_NODE is not set — the panel is empty on load');
    else if (!stepKeys.has(dflt)) add(`page contract: DEFAULT_NODE "${dflt}" is not a STEPS key — the panel is empty on load`);
  }
  return out;
}

function validateFile(file) {
  let html;
  try { html = readFileSync(file, 'utf8'); }
  catch (e) { return [{ line: 0, msg: `cannot read: ${e.message}` }]; }
  const blocks = mermaidBlocks(html);
  if (blocks.length === 0) return [{ line: 0, msg: 'no <pre class="mermaid"> block found' }];
  const findings = [];
  if (looksLikeFinishedPage(html)) findings.push(...structuralFindings(html, blocks.map((b) => b.text).join('\n')));
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
