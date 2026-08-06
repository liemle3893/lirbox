// CHECK — every static element the editor wires a handler to must SURVIVE the first React render.
//
// index.html nested #bar (holding #save/#replan/#approve/#status) inside #canvas, while
// editor.js mounts with `ReactDOM.createRoot($('canvas'))`. React clears its mount target's
// children on first render, so by the time the useEffect that assigns `.onclick` ran, those
// four elements no longer existed: "Cannot set properties of null (setting 'onclick')" —
// thrown from inside a render effect, which takes the whole component down, not just the
// buttons. #detail/#violations survived only because they live in #panel, OUTSIDE the root,
// which disguised a dead editor as merely dead buttons.
//
// That page IS the mandatory step-3 approval gate. Broken, the only way past it is to POST
// /action by hand — i.e. a human approving a graph shape they could not look at. So this is
// the approval gate failing open in practice, not a cosmetic bug.
//
// The invariant is structural and is derived from BOTH files rather than asserted about
// either: whatever element editor.js passes to createRoot, no id that index.html declares
// statically AND editor.js addresses may sit underneath it. It therefore also catches the
// reverse regression — moving the mount up to $('app') — which no assertion about #bar's
// position would.
// Locked (evals/**): improvement loops may NEVER edit this file.
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { readFileSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const EDITOR = resolve(HERE, '..', '..', 'scripts', 'editor');

// Mutation hatches for scripts/prove-checks.mjs — it copies the skill tree, mutates ONE file
// in the copy, and points the matching variable at it. One per file, since a mutation
// declares exactly one `env`.
const htmlFile = process.env.LOOM_EDITOR_HTML_OVERRIDE || join(EDITOR, 'index.html');
const jsFile = process.env.LOOM_EDITOR_JS_OVERRIDE || join(EDITOR, 'editor.js');

const html = readFileSync(htmlFile, 'utf8');
const js = readFileSync(jsFile, 'utf8');

let bad = 0;
const ok = (c, m) => { if (c) { console.log(`PASS ${m}`); } else { console.error(`FAIL ${m}`); bad++; } };

// ---- what does editor.js mount, and what does it address? ----------------

// ANCHOR. If this misses, `mount` is undefined, nothing is ever reported as nested, and the
// check passes while scanning for a container it never found.
const mountMatch = /createRoot\(\s*\$\(\s*['"]([\w-]+)['"]\s*\)\s*\)/.exec(js);
ok(!!mountMatch, 'found the createRoot mount target in editor.js');
if (!mountMatch) { console.error('\neditor-handles-survive-react-mount: 1 failed'); process.exit(1); }
const mount = mountMatch[1];

const addressed = new Set(
  [...js.matchAll(/\$\(\s*['"]([\w-]+)['"]\s*\)/g)].map((m) => m[1]).filter((id) => id !== mount),
);

// ---- where does index.html put each id? ----------------------------------

// <style> holds CSS selectors like `#bar { ... }` and <script>/comments hold arbitrary angle
// brackets; strip all three before treating the rest as markup.
const markup = html
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/<style\b[\s\S]*?<\/style>/gi, '')
  .replace(/<script\b[\s\S]*?<\/script>/gi, '');

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr']);

// id -> list of ancestor ids, outermost first.
const ancestors = new Map();
const stack = [];
for (const m of markup.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*)>/g)) {
  const [, closing, rawTag, attrs] = m;
  const tag = rawTag.toLowerCase();
  if (closing) { if (!VOID.has(tag)) stack.pop(); continue; }
  const idm = /\bid\s*=\s*['"]([\w-]+)['"]/.exec(attrs);
  const id = idm ? idm[1] : null;
  if (id) ancestors.set(id, stack.filter(Boolean));
  if (VOID.has(tag) || /\/\s*$/.test(attrs)) continue;
  stack.push(id);
}

ok(ancestors.has(mount), `index.html declares the mount target #${mount}`);

// ---- the invariant -------------------------------------------------------

let scanned = 0;
for (const id of [...addressed].sort()) {
  const chain = ancestors.get(id);
  // Ids created at runtime (the detail panel's innerHTML: #cap, #prompt, #comment,
  // #addComment) are not in index.html and are not this check's business — they are
  // rebuilt after every render by the code that then wires them.
  if (!chain) continue;
  scanned++;
  ok(!chain.includes(mount),
    `#${id} is wired by editor.js and is NOT inside the React mount #${mount}`
    + (chain.length ? ` (ancestors: ${chain.map((a) => '#' + a).join(' > ')})` : ' (top level)'));
}

// A check that scanned nothing proves nothing. Six static ids are wired today
// (save, replan, approve, status, detail, violations).
ok(scanned >= 4, `scanned the statically-declared ids editor.js wires (found ${scanned}, expected >= 4)`);

if (bad) { console.error(`\neditor-handles-survive-react-mount: ${bad} failed`); process.exit(1); }
console.log('editor-handles-survive-react-mount: ok');
