#!/usr/bin/env node
// Headless static validator for component-diagram output. Zero deps (node:fs).
// Reuses flowchart's 4 label-escaping rules (same flowchart/graph syntax) and adds
// component structural checks: a mermaid block exists & is a flowchart/graph, ≥1 subgraph,
// no decision diamonds, every click id has a STEPS entry, DEFAULT_NODE resolves, exactly
// one :::crit, SRI intact, no leftover template markers/placeholders.
// Usage: node validate.mjs <file.html> [more…]   (defaults to ./*-component.html)
import { readFileSync, readdirSync } from 'node:fs';

const SPECIALS = ['(', ')', '{', '}', '[', ']', '"'];
const ENTITY = { '(': '#40;', ')': '#41;', '{': '#123;', '}': '#125;', '[': '#91;', ']': '#93;', '"': '#34;' };

function mermaidBlocks(html) {
  const re = /<pre[^>]*class=["'][^"']*\bmermaid\b[^"']*["'][^>]*>([\s\S]*?)<\/pre>/gi;
  const out = []; let m;
  while ((m = re.exec(html))) out.push({ text: m[1], startLine: html.slice(0, m.index).split('\n').length });
  return out;
}
function isStructural(t) {
  return t === '' || t.startsWith('%%') || t.startsWith('classDef') || t.startsWith('click') ||
    t.startsWith('style ') || t.startsWith('linkStyle') || t.startsWith('subgraph') ||
    t === 'end' || /^(flowchart|graph)\b/.test(t);
}
function spans(line) {
  const labels = [], edges = [];
  for (const mm of line.matchAll(/\|([^|]*)\|/g)) edges.push(mm[1]);
  for (const mm of line.matchAll(/\[([^\]]*)\]/g)) labels.push(mm[1]);
  for (const mm of line.matchAll(/\{([^}]*)\}/g)) labels.push(mm[1]);
  return { labels, edges };
}
function checkLabel(text, { edge }) {
  const issues = [];
  for (const ch of SPECIALS) if (text.includes(ch)) issues.push(`raw "${ch}" in ${edge ? 'edge ' : ''}label — use Mermaid entity ${ENTITY[ch]}`);
  if (/&#\d+;|&#x[0-9a-f]+;/i.test(text)) issues.push(`HTML entity "&#…;" in label — use Mermaid's "#NN;" (no ampersand)`);
  if (text.includes('\\n')) issues.push(`literal "\\n" in label — use <br/> for a line break`);
  if (edge && /[^\x00-\x7F]/.test(text)) {
    const bad = [...new Set([...text].filter((c) => c.charCodeAt(0) > 127))].join(' ');
    issues.push(`non-ASCII (${bad}) in edge label — btoa() throws at render; map —→- …→... →→->`);
  }
  return issues;
}

function validateFile(file) {
  let html;
  try { html = readFileSync(file, 'utf8'); } catch (e) { return [{ line: 0, msg: `cannot read: ${e.message}` }]; }
  const findings = [];
  const push = (line, msg, snippet) => findings.push({ line, msg, snippet });

  // Whole-file structural checks
  if (/\{\{/.test(html)) push(0, 'leftover {{…}} placeholder');
  if (/TEMPLATE-(GRAPH|STEPS)/.test(html)) push(0, 'leftover TEMPLATE-* marker — delete markers in generated output');
  if (!/integrity=/.test(html) || !/crossorigin/.test(html)) push(0, 'Mermaid <script> is missing integrity/crossorigin (SRI)');
  const critCount = (html.match(/:::crit\b/g) || []).length;
  if (critCount !== 1) push(0, `expected exactly one :::crit node, found ${critCount}`);

  const blocks = mermaidBlocks(html);
  if (blocks.length === 0) return [...findings, { line: 0, msg: 'no <pre class="mermaid"> block found' }];

  for (const b of blocks) {
    const lines = b.text.split('\n');
    const joined = b.text;
    if (!/^\s*(flowchart|graph)\b/m.test(joined)) push(b.startLine, 'mermaid block is not a flowchart/graph');
    if (!/^\s*subgraph\b/m.test(joined)) push(b.startLine, 'no subgraph boundary — a component diagram needs ≥1 boundary');

    lines.forEach((raw, i) => {
      const t = raw.trim();
      const line = b.startLine + i;
      // diamond shape id{...} is forbidden (that is flowchart's job)
      if (!t.startsWith('classDef') && /[\w)\]]\s*\{[^{}]*\}/.test(t)) push(line, 'decision diamond {…} not allowed in a component diagram');
      // Rectangles only: every component must be a plain `id[Label]`. Reject exotic node
      // shapes — the docs forbid them (references/components.md). A shape opener is the
      // bracket sequence right after a node id; a plain rectangle opens with `[` + a label
      // char (not another shape bracket). Flag stadium `id([…])`, cylinder `id[(…)]`,
      // subroutine `id[[…]]`, parallelogram/trapezoid `id[/…/]` `id[\…\]`, circle `id((…))`,
      // hexagon `id{{…}}`, and asymmetric `id>…]`. (Bare diamonds `id{…}` are caught above.)
      for (const m of t.matchAll(/\b\w+\s*(\(\(|\(\[|\[\(|\[\[|\[\/|\[\\|\{\{|>)/g)) {
        const shapes = { '((': 'circle', '([': 'stadium', '[(': 'cylinder', '[[': 'subroutine',
          '[/': 'parallelogram', '[\\': 'trapezoid', '{{': 'hexagon', '>': 'asymmetric' };
        push(line, `exotic node shape ${shapes[m[1]]} (${m[0]}…) — use a plain rectangle id[Label] only`, t);
      }
      if (isStructural(t)) return;
      // every dependency edge must be typed (calls/reads/publishes) — flag a bare
      // `-->` / `-.->` arrow carrying no label. First drop inline-labeled edges
      // (`A -- text --> B`, `A -. text .-> B`) so only the operator remains to inspect,
      // then any leftover arrow with no following `|label|` is untyped.
      const stripped = t.replace(/--+[^->|]+-+>/g, ' ').replace(/-\.+[^->|]+\.-+>/g, ' ');
      for (const a of stripped.matchAll(/(-\.?-*->)(\s*\|[^|]*\|)?/g)) {
        if (!a[2]) push(line, `untyped dependency edge "${a[1]}" — every edge needs a |label| (calls/reads/publishes)`, t);
      }
      const { labels, edges } = spans(raw);
      for (const l of labels) for (const msg of checkLabel(l, { edge: false })) push(line, msg, t);
      for (const e of edges) for (const msg of checkLabel(e, { edge: true })) push(line, msg, t);
    });
  }

  // click ↔ STEPS parity
  const clickIds = [...html.matchAll(/click\s+(\w+)\s+selectNode/g)].map((m) => m[1]);
  const stepsBlock = (html.match(/const\s+STEPS\s*=\s*\{([\s\S]*?)\};/) || [, ''])[1];
  const stepKeys = new Set([...stepsBlock.matchAll(/^\s*(\w+)\s*:\s*\{/gm)].map((m) => m[1]));
  for (const id of clickIds) if (!stepKeys.has(id)) push(0, `click target "${id}" has no STEPS entry`);
  const def = (html.match(/const\s+DEFAULT_NODE\s*=\s*["'](\w+)["']/) || [])[1];
  if (!def || !stepKeys.has(def)) push(0, `DEFAULT_NODE "${def || '(unset)'}" is not a STEPS key`);

  return findings;
}

let files = process.argv.slice(2);
if (files.length === 0) { try { files = readdirSync('.').filter((f) => f.endsWith('-component.html')); } catch { files = []; } }
if (files.length === 0) { console.error('validate.mjs: no files given and no *-component.html in cwd'); process.exit(1); }

let total = 0;
for (const file of files) {
  const findings = validateFile(file);
  if (findings.length === 0) { console.log(`PASS  ${file}`); continue; }
  total += findings.length;
  console.log(`FAIL  ${file}  (${findings.length})`);
  for (const f of findings) { console.log(`  ${file}:${f.line}  ${f.msg}`); if (f.snippet) console.log(`        ${f.snippet}`); }
}
if (total > 0) { console.error(`\n${total} finding(s) across ${files.length} file(s).`); process.exit(1); }
console.log(`\nAll ${files.length} file(s) clean.`);
