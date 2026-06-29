#!/usr/bin/env node
// Headless static validator for sequence-diagram output. Zero deps (node:fs).
// Checks: one mermaid block that is a sequenceDiagram with autonumber; message↔STEPLIST
// parity (count match); DEFAULT_STEP in range; exactly one crit step; no literal "\n", ";",
// or unescaped "#" in message text (known render-breakers — escape with <br/>, avoid ";",
// write a literal hash as #35;); SRI intact; no leftover template markers/placeholders.
// Heuristics documented in the plan/components.md.
//
// MESSAGE COUNT (the parity heuristic) — counts LOGICAL steps, matching how a STEPLIST is
// authored ("one entry per autonumbered message, in order"). An `alt`/`opt` block is ONE
// trust/decision step with mutually-exclusive outcomes, so only the FIRST (primary) branch's
// messages are counted; messages after an `else` inside the same alt/opt are the *alternative*
// outcomes of that already-counted step and are skipped — they do not get their own STEPLIST
// entry. `loop`/`par` messages are sequential/concurrent (genuinely distinct steps) and are
// each counted. This is what lets the canonical alt/else clean fixture (5 raw arrows, 4
// logical steps) map 1:1 to its 4-entry STEPLIST.
// Usage: node validate.mjs <file.html> [more…]   (defaults to ./*-sequence.html)
import { readFileSync, readdirSync } from 'node:fs';

const BLOCK_KW = /^(participant|actor|note|alt|else|opt|loop|par|and|end|rect|activate|deactivate|autonumber|title|box|critical|break)\b/;
const ARROW = /^\s*[\w"']+\s*(?:--?(?:>>|>|\)|x))\s*([+-]?)[\w"']+\s*:(.*)$/;

function mermaidBlocks(html) {
  const re = /<pre[^>]*class=["'][^"']*\bmermaid\b[^"']*["'][^>]*>([\s\S]*?)<\/pre>/gi;
  const out = []; let m;
  while ((m = re.exec(html))) out.push({ text: m[1], startLine: html.slice(0, m.index).split('\n').length });
  return out;
}

// Split a STEPLIST array body into its top-level `{…}` entry sources. Tracks brace depth and
// string state so braces inside string values don't confuse the boundaries.
function steplistEntries(listBlock) {
  const entries = []; let depth = 0, start = -1, str = null;
  for (let i = 0; i < listBlock.length; i++) {
    const c = listBlock[i];
    if (str) { if (c === '\\') i++; else if (c === str) str = null; continue; }
    if (c === '"' || c === "'" || c === '`') { str = c; continue; }
    if (c === '{') { if (depth === 0) start = i; depth++; }
    else if (c === '}') { depth--; if (depth === 0 && start >= 0) { entries.push(listBlock.slice(start, i + 1)); start = -1; } }
  }
  return entries;
}

function validateFile(file) {
  let html;
  try { html = readFileSync(file, 'utf8'); } catch (e) { return [{ line: 0, msg: `cannot read: ${e.message}` }]; }
  const findings = [];
  const push = (line, msg, snippet) => findings.push({ line, msg, snippet });

  if (/\{\{/.test(html)) push(0, 'leftover {{…}} placeholder');
  if (/TEMPLATE-(SEQ|STEPLIST)/.test(html)) push(0, 'leftover TEMPLATE-* marker — delete markers in generated output');
  if (!/integrity=/.test(html) || !/crossorigin/.test(html)) push(0, 'Mermaid <script> is missing integrity/crossorigin (SRI)');

  const blocks = mermaidBlocks(html);
  if (blocks.length === 0) return [...findings, { line: 0, msg: 'no <pre class="mermaid"> block found' }];
  if (blocks.length > 1) push(blocks[1].startLine, `expected one mermaid block, found ${blocks.length}`);

  const b = blocks[0];
  const lines = b.text.split('\n');
  if (!/^\s*sequenceDiagram\b/m.test(b.text)) push(b.startLine, 'mermaid block is not a sequenceDiagram');
  if (!/^\s*autonumber\b/m.test(b.text)) push(b.startLine, 'no autonumber — the numbered side-list needs it');

  // Message count = logical steps. Within an alt/opt block, only the primary (pre-`else`)
  // branch's messages count; `else`-alternative messages are collapsed into that step.
  // Stack of {type, branch} frames lets nested blocks be handled correctly.
  let msgCount = 0;
  // Activation-bar balance: every opener (`->>+` suffix, or `activate X`) must have a matching
  // closer (`-->>-` suffix, or `deactivate X`). A net-positive count = a dangling bar Mermaid
  // renders broken. We track a running counter, not per-participant, since the defect is simply
  // "an open with no matching close."
  let activations = 0;
  const stack = [];
  const inSkippedBranch = () => stack.some((f) => (f.type === 'alt' || f.type === 'opt') && f.branch > 0);
  lines.forEach((raw, i) => {
    const t = raw.trim();
    const line = b.startLine + i;
    if (t === '' || t.startsWith('%%')) return;
    if (/^(alt|opt|loop|par|rect|critical|break)\b/.test(t)) { stack.push({ type: t.split(/\s+/)[0], branch: 0 }); return; }
    if (/^else\b/.test(t)) { const f = stack[stack.length - 1]; if (f) f.branch++; return; }
    if (/^and\b/.test(t)) return; // par-branch separator: messages still count (concurrent ≠ alternative)
    if (/^end\b/.test(t)) { stack.pop(); return; }
    if (/^activate\b/.test(t)) { activations++; return; }
    if (/^deactivate\b/.test(t)) { activations--; return; }
    if (BLOCK_KW.test(t)) return;
    const mm = t.match(ARROW);
    if (mm) {
      if (mm[1] === '+') activations++;
      else if (mm[1] === '-') activations--;
      const text = mm[2];
      if (text.includes('\\n')) push(line, 'literal "\\n" in message text — use <br/>', t);
      if (text.includes(';')) push(line, '";" in message text — Mermaid may treat it as a separator; remove it', t);
      // A bare "#" is Mermaid's entity-escape introducer in message text (#35;, #9829;, #59;).
      // An unescaped "#" not forming a valid "#<name-or-digits>;" entity makes Mermaid swallow
      // following text as a malformed entity → mangled/empty render (no parse error to see).
      // Allow a correctly-formed entity escape; flag any other literal "#".
      if (/#(?![a-zA-Z0-9]+;)/.test(text)) push(line, 'literal "#" in message text — Mermaid reads it as an entity-code introducer; escape it as #35; (a real entity like #9829; is fine)', t);
      if (!inSkippedBranch()) msgCount++;
    }
  });
  if (msgCount === 0) push(b.startLine, 'no messages found in the sequenceDiagram');
  if (activations > 0) push(b.startLine, `unbalanced activation bar — ${activations} activation(s) opened (->>+ or activate) without a matching close (-->>- or deactivate); Mermaid renders this broken`);
  else if (activations < 0) push(b.startLine, `unbalanced activation bar — ${-activations} activation close(s) (-->>- or deactivate) without a matching open; Mermaid renders this broken`);

  // STEPLIST parity (count title: keys in the STEPLIST array)
  const listBlock = (html.match(/const\s+STEPLIST\s*=\s*\[([\s\S]*?)\];/) || [, ''])[1];
  const stepCount = (listBlock.match(/\btitle\s*:/g) || []).length;
  if (stepCount !== msgCount) push(0, `STEPLIST has ${stepCount} entries but the diagram has ${msgCount} messages — they must match 1:1`);
  // Each entry needs BOTH `from` and `to`: the detail panel renders the who→who chip only when
  // both are present, and the authoring guide treats them as required. Flag any half-populated
  // (or missing) one so a no-chip entry can't slip past the title-count parity check.
  steplistEntries(listBlock).forEach((entry, i) => {
    const missing = ['from', 'to'].filter((k) => !new RegExp(`\\b${k}\\s*:`).test(entry));
    if (missing.length) {
      const title = (entry.match(/\btitle\s*:\s*(["'`])((?:\\.|(?!\1).)*)\1/) || [, , `#${i + 1}`])[2];
      push(0, `STEPLIST entry "${title}" is missing ${missing.join('/')} — both from and to are required (the who→who chip needs both)`);
    }
  });
  const critCount = (listBlock.match(/\bcrit\s*:\s*true\b/g) || []).length;
  if (critCount !== 1) push(0, `expected exactly one STEPLIST entry with crit:true, found ${critCount}`);
  const defM = html.match(/const\s+DEFAULT_STEP\s*=\s*(\d+)/);
  const def = defM ? Number(defM[1]) : NaN;
  if (!(def >= 0 && def < stepCount)) push(0, `DEFAULT_STEP ${defM ? def : '(unset)'} out of range [0, ${stepCount})`);

  return findings;
}

let files = process.argv.slice(2);
if (files.length === 0) { try { files = readdirSync('.').filter((f) => f.endsWith('-sequence.html')); } catch { files = []; } }
if (files.length === 0) { console.error('validate.mjs: no files given and no *-sequence.html in cwd'); process.exit(1); }

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
