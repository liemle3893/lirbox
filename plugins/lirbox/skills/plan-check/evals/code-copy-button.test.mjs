// WHETSTONE ACCEPTANCE-CHECK (RED on baseline) — concern: code-copy-button.
// A reader should be able to copy an inline <code> snippet (a command / path /
// evidence) to the clipboard in one action, with a brief "copied" confirmation —
// implemented as INLINE, SELF-CONTAINED JavaScript in template.html. The report
// must stay fully offline: no external CSS/JS/fonts/images.
//
// GREEN iff BOTH hold:
//   (1) a clipboard-write mechanism is present in an inline <script> AND is hooked
//       onto <code> elements (click handler on code, or a generated copy button).
//   (2) self-contained still holds: no <script src>, no <link href> stylesheet, no
//       remote http(s) font/img/script/style URLs.
//
// Runs standalone:  node code-copy-button.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = join(HERE, '..', 'assets', 'template.html');

const html = readFileSync(TEMPLATE, 'utf8');

// --- (1) copy-to-clipboard wired to code snippets ---------------------------
// Isolate inline <script> bodies (external <script src> bodies are empty anyway).
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join('\n');

const hasClipboardWrite =
  /navigator\s*\.\s*clipboard/.test(scripts) ||
  /clipboard\s*\.\s*writeText/.test(scripts) ||
  /\.writeText\s*\(/.test(scripts) ||
  /execCommand\s*\(\s*['"]copy['"]\s*\)/.test(scripts);

// Some hook onto <code>: a query/selection of code elements, or a copy affordance.
const hooksCode =
  /(querySelector(?:All)?|getElementsByTagName)\s*\(\s*['"][^'"]*code[^'"]*['"]\s*\)/i.test(scripts) ||
  /['"]code['"]/.test(scripts) ||
  /copy/i.test(scripts);

const conjunct1 = hasClipboardWrite && hooksCode;

// --- (2) self-contained / offline ------------------------------------------
const externalScript = /<script\b[^>]*\bsrc\s*=/i.test(html);
const externalStylesheet = /<link\b[^>]*\brel\s*=\s*["']?stylesheet[^>]*\bhref\s*=/i.test(html) ||
  /<link\b[^>]*\bhref\s*=[^>]*\brel\s*=\s*["']?stylesheet/i.test(html);
const remoteUrl = /(?:src|href)\s*=\s*["']https?:\/\//i.test(html);
const cssRemote = /url\(\s*['"]?https?:\/\//i.test(html);

const externalRefs = [];
if (externalScript) externalRefs.push('<script src>');
if (externalStylesheet) externalRefs.push('<link rel=stylesheet href>');
if (remoteUrl) externalRefs.push('remote src/href http(s) URL');
if (cssRemote) externalRefs.push('remote url() in CSS');
const conjunct2 = externalRefs.length === 0;

// --- verdict ----------------------------------------------------------------
if (conjunct1 && conjunct2) {
  console.log('PASS code-copy-button: inline clipboard-copy wired to <code>, still self-contained.');
  process.exit(0);
}

const why = [];
if (!hasClipboardWrite) why.push('no clipboard-write call (navigator.clipboard/writeText/execCommand copy) in any inline <script>');
else if (!hooksCode) why.push('clipboard code present but not hooked onto <code> / a copy affordance');
if (!conjunct2) why.push(`external resource(s) present: ${externalRefs.join(', ')}`);
console.error(`FAIL code-copy-button: ${why.join('; ')}.`);
process.exit(1);
